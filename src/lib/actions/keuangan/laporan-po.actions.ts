'use server';
/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Laporan Per PO — Perkiraan (HPP × pcs dipotong) vs Aktual, per komponen.
 *
 * Kolom tiap komponen: Perkiraan | Aktual sejauh ini | Sisa perkiraan | Selisih
 *   - Perkiraan  = HPP sheet × pcs yang dipotong (get_laporan_po_perkiraan).
 *   - Aktual     = kain & aksesori modal FIFO (harga_pakai), upah tercatat (lunas + terutang),
 *                  bahan pembantu = pemakaian dari Saldo Bahan Pembantu, overhead = metode pcs-hari.
 *                  Angka & total sama dengan mesin Kinerja Keuangan (kinerja.server.ts).
 *   - Sisa       = bagian perkiraan untuk pcs yang biayanya belum tercatat (tahap belum selesai,
 *                  aksesori yang masih menunggu harga LOT).
 *   - Selisih    = aktual + sisa − perkiraan (positif = boros, negatif = hemat).
 * Tanda: Final / Berjalan / Menunggu harga; overhead bulan berjalan = sementara.
 */

import { createClient } from '@/lib/supabase/server';
import { hitungKinerja, type KinerjaPO } from '@/lib/keuangan/kinerja.server';
import { PO_AWAL_PERIODE, poPeriodeBaru } from '@/lib/keuangan/periode-po';
import {
  hitungKesimpulan, susunQty,
  type BarisKomponen, type BarisQty, type KesimpulanPO,
} from '@/lib/keuangan/komponen-po';

export type { BarisKomponen, BarisQty, KesimpulanPO, GrupKomponen, TandaBaris, RincianKomponen } from '@/lib/keuangan/komponen-po';

const TENANT_ID = 'STX-001';
/** Batas selisih PO (di luar beda tarif) dianggap boros / hemat (Rp) */
const AMBANG_SELISIH = 50_000;

export type TandaPO = 'final' | 'berjalan' | 'menunggu_harga' | 'belum_dipotong';

export interface POLaporanItem {
  po_id: string;
  no_po: string;
  klien_nama: string;
  tanggal: string;
  /** qty order */
  total_qty: number;
  pcs_potong: number;
  qty_shipped: number;
  perkiraan: number;
  aktual: number;
  sisa: number;
  selisih: number;
  /** Bagian selisih karena tarif HPP berubah (bukan hemat/boros) */
  beda_tarif: number;
  tanda: TandaPO;
  overhead: number;
  overhead_sementara: boolean;
  /** Selisih di luar beda tarif (dipakai Ringkasan Keuangan) */
  gap: number;
  status: 'hemat' | 'boncos' | 'on_budget';
  nilai_project: number;
  /** Laba PO dari Kinerja Keuangan (nilai jual − aktual − sisa perkiraan lengkap) */
  profit_final: number;
  margin_pct_final: number;
  kesimpulan: KesimpulanPO | null;
}

// ─── Susun data dari mesin Kinerja ───────────────────────────────────────────

interface DataLaporan {
  baris: Map<string, BarisKomponen[]>;
  kinerja: Map<string, KinerjaPO>;
  qty: Map<string, BarisQty[]>;
  overheadSementara: boolean;
}

async function susunLaporan(supabase: any, po_id?: string): Promise<DataLaporan> {
  const [k, qtyRes] = await Promise.all([
    hitungKinerja(supabase, 'semua'),
    supabase.rpc('get_laporan_po_qty', { p_tenant_id: TENANT_ID, p_po_mulai: po_id ? null : PO_AWAL_PERIODE, p_po_id: po_id ?? null }),
  ]);
  if (qtyRes.error) throw new Error(qtyRes.error.message);
  const kinerja = new Map(k.po.map(p => [p.po_id, p]));
  const baris = new Map(k.po.map(p => [p.po_id, p.komponen]));
  const perPo = new Map<string, any[]>();
  ((qtyRes.data ?? []) as any[]).forEach(r => {
    const id = String(r.po_id);
    perPo.set(id, [...(perPo.get(id) ?? []), r]);
  });
  const qty = new Map([...perPo.entries()].map(([id, rows]) => [id, susunQty(rows)]));
  return { baris, kinerja, qty, overheadSementara: k.overheadSementara };
}

function ringkas(rows: BarisKomponen[], overheadSementara: boolean) {
  const jml = (f: (r: BarisKomponen) => number) => rows.reduce((s, r) => s + f(r), 0);
  const perkiraan = jml(r => r.perkiraan), aktual = jml(r => r.aktual), sisa = jml(r => r.sisa);
  const tanda: TandaPO = rows.length === 0 ? 'belum_dipotong'
    : rows.some(r => r.tanda === 'menunggu_harga') ? 'menunggu_harga'
    : rows.some(r => r.tanda === 'berjalan' || r.tanda === 'belum_tercatat') ? 'berjalan'
    : 'final';
  const overhead = rows.filter(r => r.grup === 'overhead' || r.grup === 'pembantu').reduce((s, r) => s + r.aktual, 0);
  return {
    perkiraan, aktual, sisa, selisih: aktual + sisa - perkiraan, beda_tarif: jml(r => r.beda_tarif),
    tanda, overhead, overhead_sementara: overheadSementara && rows.length > 0,
  };
}

function kesimpulanPO(lap: DataLaporan, po_id: string, r: ReturnType<typeof ringkas>): KesimpulanPO | null {
  const k = lap.kinerja.get(po_id);
  const baris = lap.baris.get(po_id) ?? [];
  if (!k || baris.length === 0) return null;
  return hitungKesimpulan({
    nilai_jual: k.nilai_jual, baris, qty: lap.qty.get(po_id) ?? [],
    sementara: r.tanda !== 'final' || r.overhead_sementara,
  });
}

// ─── Daftar PO ────────────────────────────────────────────────────────────────

export async function getLaporanPOList(filters?: { bulan?: string; tahun?: string }): Promise<POLaporanItem[]> {
  const supabase = await createClient();

  let dateStart: string | undefined, dateEnd: string | undefined;
  if (filters?.tahun) {
    const tahun = parseInt(filters.tahun);
    if (filters?.bulan) {
      const bulan = parseInt(filters.bulan);
      dateStart = `${tahun}-${String(bulan).padStart(2, '0')}-01`;
      const nb = bulan === 12 ? 1 : bulan + 1, ny = bulan === 12 ? tahun + 1 : tahun;
      dateEnd = `${ny}-${String(nb).padStart(2, '0')}-01`;
    } else {
      dateStart = `${tahun}-01-01`;
      dateEnd = `${tahun + 1}-01-01`;
    }
  }

  let poQuery = supabase
    .from('po')
    .select('id, no_po, tanggal_order, klien:klien_id(nama), po_item(qty_order, produk:produk_id(harga_jual))')
    .eq('tenant_id', TENANT_ID)
    .order('tanggal_order', { ascending: false });
  if (dateStart) poQuery = poQuery.gte('tanggal_order', dateStart);
  if (dateEnd) poQuery = poQuery.lt('tanggal_order', dateEnd);

  const [{ data: poData, error: poError }, lap] = await Promise.all([poQuery, susunLaporan(supabase)]);
  if (poError) throw new Error(poError.message);

  return ((poData ?? []) as any[])
    .filter(po => poPeriodeBaru(po.no_po) || lap.kinerja.has(po.id))
    .map(po => {
      const k = lap.kinerja.get(po.id);
      const r = ringkas(lap.baris.get(po.id) ?? [], lap.overheadSementara);
      const total_qty = (po.po_item ?? []).reduce((s: number, pi: any) => s + Number(pi.qty_order), 0);
      const nilai_project = k ? k.nilai_jual : (po.po_item ?? []).reduce((s: number, pi: any) =>
        s + Number(pi.produk?.harga_jual ?? 0) * Number(pi.qty_order), 0);
      const profit_final = k ? Math.round(k.laba) : 0;
      const gap = r.selisih - r.beda_tarif;
      const status: POLaporanItem['status'] = gap > AMBANG_SELISIH ? 'boncos'
        : gap < -AMBANG_SELISIH ? 'hemat' : 'on_budget';
      return {
        po_id: po.id, no_po: po.no_po, klien_nama: (po.klien as any)?.nama ?? '-', tanggal: po.tanggal_order,
        total_qty, pcs_potong: k?.pcs ?? 0, qty_shipped: k?.pcs_kirim ?? 0,
        perkiraan: r.perkiraan, aktual: r.aktual, sisa: r.sisa, selisih: r.selisih, beda_tarif: r.beda_tarif, tanda: r.tanda,
        overhead: r.overhead, overhead_sementara: r.overhead_sementara,
        gap, status,
        nilai_project, profit_final,
        margin_pct_final: nilai_project > 0 && k ? Math.round((profit_final / nilai_project) * 100) : 0,
        kesimpulan: kesimpulanPO(lap, po.id, r),
      };
    });
}

// ─── Detail satu PO ───────────────────────────────────────────────────────────

export interface POHPPDetail {
  baris: BarisKomponen[];
  qty: BarisQty[];
  kesimpulan: KesimpulanPO | null;
  aktual_breakdown: {
    jenis: 'direct_bahan' | 'direct_upah' | 'pembantu' | 'overhead';
    keterangan: string;
    tanggal: string;
    nominal: number;
  }[];
  totals: {
    perkiraan: number;
    aktual: number;
    sisa: number;
    selisih: number;
    beda_tarif: number;
    tanda: TandaPO;
    overhead_sementara: boolean;
  };
}

export async function getPOHPPDetail(po_id: string): Promise<POHPPDetail> {
  const supabase = await createClient();
  const [lap, pemRes, upahRes] = await Promise.all([
    susunLaporan(supabase, po_id),
    supabase.rpc('get_biaya_pemakaian_detail_po', { p_po_id: po_id, p_tenant_id: TENANT_ID }),
    supabase.rpc('get_biaya_upah_detail_po', { p_po_id: po_id, p_tenant_id: TENANT_ID }),
  ]);
  if (pemRes.error) throw new Error(pemRes.error.message);
  if (upahRes.error) throw new Error(upahRes.error.message);

  const baris = lap.baris.get(po_id) ?? [];
  const r = ringkas(baris, lap.overheadSementara);
  const k = lap.kinerja.get(po_id);

  const aktual_breakdown: POHPPDetail['aktual_breakdown'] = [
    ...((pemRes.data ?? []) as any[]).map(p => ({
      jenis: 'direct_bahan' as const,
      keterangan: `${p.item_nama} — ${p.tahap} (${Number(p.qty_pakai).toLocaleString('id-ID')} × Rp ${Number(p.harga_satuan).toLocaleString('id-ID')})`,
      tanggal: p.tgl_pertama ?? '',
      nominal: Number(p.subtotal),
    })),
    ...((upahRes.data ?? []) as any[]).map(u => ({
      jenis: 'direct_upah' as const,
      keterangan: `${u.karyawan_nama} — ${u.keterangan} (${Number(u.qty_bundle)} pcs)`,
      tanggal: u.tanggal ?? '',
      nominal: Number(u.total),
    })),
    ...baris.filter(b => b.grup === 'pembantu' && b.aktual > 0).map(b => ({
      jenis: 'pembantu' as const,
      keterangan: `Bahan pembantu ${b.nama} — pemakaian dari Saldo Bahan Pembantu`,
      tanggal: '',
      nominal: b.aktual,
    })),
    ...(k && k.overhead_alokasi > 0 ? [{
      jenis: 'overhead' as const,
      keterangan: `Overhead produksi metode pcs-hari (sewa, listrik, makan, operasional) — ${k.pcs} pcs selama dalam proses${lap.overheadSementara ? ' · sementara' : ''}`,
      tanggal: '',
      nominal: k.overhead_alokasi,
    }] : []),
    ...(k && k.overhead_langsung_kas > 0 ? [{
      jenis: 'overhead' as const,
      keterangan: 'Overhead bertanda PO ini di Buku Kas (mis. pembuatan sampel)',
      tanggal: '',
      nominal: k.overhead_langsung_kas,
    }] : []),
  ];

  return {
    baris,
    qty: lap.qty.get(po_id) ?? [],
    kesimpulan: kesimpulanPO(lap, po_id, r),
    aktual_breakdown,
    totals: {
      perkiraan: r.perkiraan, aktual: r.aktual, sisa: r.sisa, selisih: r.selisih, beda_tarif: r.beda_tarif,
      tanda: r.tanda, overhead_sementara: r.overhead_sementara,
    },
  };
}

// ─── HPP per Size ─────────────────────────────────────────────────────────────

const SIZE_ORDER = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL', '3XL', '4XL'];
const sizeRank = (s: string) => { const i = SIZE_ORDER.indexOf(s.toUpperCase()); return i === -1 ? 99 : i; };

export interface HPPPerSizeRow {
  warna: string;
  size: string;
  /** pcs dipotong */
  qty: number;
  perkiraan: number;
  biaya_kain: number;
  biaya_aksesori: number;
  biaya_upah: number;
  overhead: number;
  total_hpp: number;
  hpp_per_pcs: number;
}

export interface HPPPerSizeResult {
  rows: HPPPerSizeRow[];
  overhead_rate_per_pcs: number;
  overhead_sementara: boolean;
}

/**
 * HPP aktual per warna + size (pcs dipotong).
 *   Kain     : modal FIFO pemakaian_bahan (harga_pakai, else LOT × qty)
 *   Aksesori : pemakaian_aksesori.harga_pakai (bagian yang menunggu harga belum berbiaya)
 *   Upah     : gaji_ledger lunas + terutang per bundle
 *   Overhead : overhead PO (pcs-hari + pembantu + bertanda PO) dibagi rata per pcs dipotong
 */
export async function getPOHPPPerSizeResult(po_id: string): Promise<HPPPerSizeResult> {
  const supabase = await createClient();

  const { data: poItems, error: piErr } = await supabase
    .from('po_item')
    .select('id, warna, size, produk:produk_id ( hpp_item ( qty, harga_satuan ) )')
    .eq('po_id', po_id);
  if (piErr) throw new Error('po_item: ' + piErr.message);
  if (!poItems || poItems.length === 0) return { rows: [], overhead_rate_per_pcs: 0, overhead_sementara: false };
  const poItemIds = poItems.map((pi: any) => pi.id);

  const [{ data: bundles, error: bErr }, k] = await Promise.all([
    supabase.from('bundle').select('id, po_item_id, status_tahap').in('po_item_id', poItemIds).eq('tenant_id', TENANT_ID),
    hitungKinerja(supabase, 'semua'),
  ]);
  if (bErr) throw new Error('bundle: ' + bErr.message);

  // Hanya bundle yang sudah dipotong (sama dengan basis Kinerja)
  const bundlePoItem = new Map<string, string>();
  const pcsItem = new Map<string, number>();
  ((bundles ?? []) as any[]).forEach(b => {
    const c = b.status_tahap?.cutting;
    if (!c || !['selesai', 'partial'].includes(c.status)) return;
    bundlePoItem.set(b.id, b.po_item_id);
    pcsItem.set(b.po_item_id, (pcsItem.get(b.po_item_id) ?? 0) + Number(c.qty_aktual ?? 0));
  });
  const bundleIds = [...bundlePoItem.keys()];

  const kainMap = new Map<string, number>(), aksMap = new Map<string, number>(), upahMap = new Map<string, number>();
  const tambah = (m: Map<string, number>, id: string | undefined, n: number) => { if (id) m.set(id, (m.get(id) ?? 0) + n); };
  if (bundleIds.length > 0) {
    const [kainRes, aksRes, gajiRes] = await Promise.all([
      supabase.from('pemakaian_bahan')
        .select('bundle_id, qty_pakai, harga_pakai, batch:inventory_batch_id(harga_satuan), item:inventory_item_id(harga_referensi)')
        .in('bundle_id', bundleIds).eq('tenant_id', TENANT_ID),
      supabase.from('pemakaian_aksesori')
        .select('bundle_id, qty_pakai, harga_pakai, item:inventory_item_id(harga_referensi)')
        .in('bundle_id', bundleIds).eq('tenant_id', TENANT_ID),
      supabase.from('gaji_ledger')
        .select('sumber_id, total, tipe, status')
        .in('sumber_id', bundleIds).in('status', ['lunas', 'belum_lunas']).eq('tenant_id', TENANT_ID),
    ]);
    for (const r of [kainRes, aksRes, gajiRes]) if (r.error) throw new Error(r.error.message);
    const satu = (x: any) => (Array.isArray(x) ? x[0] : x);
    ((kainRes.data ?? []) as any[]).forEach(r => {
      const hp = Number(r.harga_pakai) || 0;
      const n = hp !== 0 ? hp : Number(r.qty_pakai) * Number(satu(r.batch)?.harga_satuan ?? satu(r.item)?.harga_referensi ?? 0);
      tambah(kainMap, bundlePoItem.get(r.bundle_id), n);
    });
    ((aksRes.data ?? []) as any[]).forEach(r => {
      const n = r.harga_pakai != null ? Number(r.harga_pakai) : Number(r.qty_pakai) * Number(satu(r.item)?.harga_referensi ?? 0);
      tambah(aksMap, bundlePoItem.get(r.bundle_id), n);
    });
    ((gajiRes.data ?? []) as any[]).forEach(r =>
      tambah(upahMap, bundlePoItem.get(r.sumber_id), (r.tipe === 'reject_potong' ? -1 : 1) * (Number(r.total) || 0)));
  }

  const kPo = k.po.find(p => p.po_id === po_id);
  const rate = kPo && kPo.pcs > 0 ? kPo.overhead / kPo.pcs : 0;

  const agg = new Map<string, HPPPerSizeRow>();
  (poItems as any[]).forEach(pi => {
    const id = String(pi.id);
    const qty = pcsItem.get(id) ?? 0;
    const hppPcs = ((pi.produk?.hpp_item ?? []) as any[]).reduce((s, hi) => s + Number(hi.qty) * Number(hi.harga_satuan), 0);
    const key = `${pi.warna || '-'}||${pi.size || '-'}`;
    const row = agg.get(key) ?? { warna: pi.warna || '-', size: pi.size || '-', qty: 0, perkiraan: 0,
      biaya_kain: 0, biaya_aksesori: 0, biaya_upah: 0, overhead: 0, total_hpp: 0, hpp_per_pcs: 0 };
    row.qty += qty;
    row.perkiraan += hppPcs * qty;
    row.biaya_kain += kainMap.get(id) ?? 0;
    row.biaya_aksesori += aksMap.get(id) ?? 0;
    row.biaya_upah += upahMap.get(id) ?? 0;
    row.overhead += rate * qty;
    agg.set(key, row);
  });
  const rows = [...agg.values()].map(r => {
    const total_hpp = r.biaya_kain + r.biaya_aksesori + r.biaya_upah + r.overhead;
    return { ...r, total_hpp, hpp_per_pcs: r.qty > 0 ? Math.round(total_hpp / r.qty) : 0 };
  }).sort((a, b) => a.warna.localeCompare(b.warna) || sizeRank(a.size) - sizeRank(b.size));

  return { rows, overhead_rate_per_pcs: rate, overhead_sementara: k.overheadSementara };
}
