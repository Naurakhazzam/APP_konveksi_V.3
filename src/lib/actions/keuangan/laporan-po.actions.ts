'use server';

import { createClient } from '@/lib/supabase/server';
import { getOverheadRateInfo, getQtyShippedPerPO } from './overhead.actions';

const TENANT_ID = 'STX-001';

export interface POLaporanItem {
  po_id           : string;
  no_po           : string;
  klien_nama      : string;
  tanggal         : string;
  total_qty       : number;
  hpp_estimasi    : number;   // dari BOM (hpp_item.qty × harga_satuan × qty_order)
  biaya_bahan     : number;   // dari pemakaian: bahan_kain + aksesori (dinamis)
  biaya_upah      : number;   // dari jurnal direct_upah
  hpp_aktual      : number;   // biaya_bahan + biaya_upah
  gap             : number;   // hpp_aktual - hpp_estimasi
  status          : 'hemat' | 'boncos' | 'on_budget';
  nilai_project   : number;   // SUM(qty_order × produk.harga_jual)
  profit          : number;   // nilai_project - hpp_aktual
  margin_pct      : number;   // (profit / nilai_project) × 100
  qty_shipped     : number;
  alokasi_overhead: number;
  hpp_aktual_final: number;
  profit_final    : number;
  margin_pct_final: number;
}

/**
 * B1 — Ambil semua PO beserta kalkulasi HPP-nya.
 *
 * biaya_bahan dihitung dari tabel pemakaian (bukan jurnal_entry):
 *   - pemakaian_bahan   × inventory_batch.harga_satuan  → biaya kain (FIFO)
 *   - pemakaian_aksesori × inventory_item.harga_referensi → biaya aksesori
 * Sehingga kalau harga_referensi diupdate belakangan,
 * semua data historis langsung ikut terhitung ulang.
 */
export async function getLaporanPOList(filters?: {
  bulan?: string;
  tahun?: string;
}): Promise<POLaporanItem[]> {
  const supabase = await createClient();

  // Hitung rentang tanggal untuk filter DB-level (performa: filter di query, bukan JS)
  let dateStart: string | undefined;
  let dateEnd  : string | undefined;
  if (filters?.tahun) {
    const tahun = parseInt(filters.tahun);
    if (filters?.bulan) {
      const bulan    = parseInt(filters.bulan);
      dateStart      = `${tahun}-${String(bulan).padStart(2, '0')}-01`;
      const nb       = bulan === 12 ? 1 : bulan + 1;
      const ny       = bulan === 12 ? tahun + 1 : tahun;
      dateEnd        = `${ny}-${String(nb).padStart(2, '0')}-01`;
    } else {
      dateStart = `${tahun}-01-01`;
      dateEnd   = `${tahun + 1}-01-01`;
    }
  }

  // Step 1 — Fetch PO dengan filter tanggal di DB (bukan JS filter)
  let poQuery = supabase
    .from('po')
    .select(`
      id, no_po, tanggal_order,
      klien:klien_id(nama),
      po_item(
        qty_order,
        produk:produk_id(
          harga_jual,
          hpp_item(qty, harga_satuan)
        )
      )
    `)
    .eq('tenant_id', TENANT_ID)
    .order('tanggal_order', { ascending: false });

  if (dateStart) poQuery = poQuery.gte('tanggal_order', dateStart);
  if (dateEnd)   poQuery = poQuery.lt('tanggal_order', dateEnd);

  const { data: poData, error: poError } = await poQuery;
  if (poError) throw new Error(poError.message);

  // Step 2 — Biaya bahan dari pemakaian (dinamis & retroaktif)
  const { data: biayaData, error: biayaError } = await supabase
    .rpc('get_biaya_pemakaian_per_po', { p_tenant_id: TENANT_ID });

  if (biayaError) throw new Error(biayaError.message);

  // Step 3 — Biaya upah per PO dari gaji_ledger (fix double-count:
  //           trace gaji_ledger → bundle → po_item, bukan jurnal_entry.tag_po_ids)
  const { data: upahData, error: upahError } = await supabase
    .rpc('get_biaya_upah_per_po', { p_tenant_id: TENANT_ID });

  if (upahError) throw new Error(upahError.message);

  // Build biaya map: po_id → { bahan_kain, aksesori }
  const biayaMap = new Map<string, { biaya_aksesori: number; biaya_bahan_kain: number }>();
  (biayaData ?? []).forEach((b: any) => {
    biayaMap.set(String(b.po_id), {
      biaya_aksesori  : Number(b.biaya_aksesori)   || 0,
      biaya_bahan_kain: Number(b.biaya_bahan_kain) || 0,
    });
  });

  // Build upah map: po_id → biaya_upah (akurat per pekerjaan aktual)
  const upahMap = new Map<string, number>();
  (upahData ?? []).forEach((u: any) => {
    upahMap.set(String(u.po_id), Number(u.biaya_upah) || 0);
  });

  const filteredData = poData ?? [];

  const rateInfo = await getOverheadRateInfo();
  const qtyShippedMap = rateInfo.period
    ? await getQtyShippedPerPO(
        rateInfo.period.tanggal_mulai,
        rateInfo.period.tanggal_akhir
      )
    : {};

  const result: POLaporanItem[] = filteredData.map((po: any) => {
    // HPP Estimasi — dari BOM
    const hpp_estimasi = (po.po_item ?? []).reduce((sum: number, pi: any) => {
      const qtyOrder  = Number(pi.qty_order) || 0;
      const hppItems  = pi.produk?.hpp_item ?? [];
      const hppPerPcs = hppItems.reduce((s: number, hi: any) =>
        s + Number(hi.qty) * Number(hi.harga_satuan), 0);
      return sum + (hppPerPcs * qtyOrder);
    }, 0);

    const total_qty = (po.po_item ?? []).reduce((sum: number, pi: any) =>
      sum + Number(pi.qty_order), 0);

    // Biaya Bahan = bahan kain (FIFO) + aksesori (dinamis × harga_referensi)
    const bp          = biayaMap.get(po.id);
    const biaya_bahan = (bp?.biaya_bahan_kain ?? 0) + (bp?.biaya_aksesori ?? 0);

    // Biaya Upah — dari gaji_ledger per PO (akurat, tidak double-count)
    const biaya_upah = upahMap.get(po.id) ?? 0;

    const hpp_aktual = biaya_bahan + biaya_upah;
    const gap        = hpp_aktual - hpp_estimasi;

    const nilai_project = (po.po_item ?? []).reduce((sum: number, pi: any) =>
      sum + (Number(pi.produk?.harga_jual ?? 0) * Number(pi.qty_order)), 0);

    const profit     = nilai_project - hpp_aktual;
    const margin_pct = nilai_project > 0
      ? Math.round((profit / nilai_project) * 100)
      : 0;

    const qty_shipped        = qtyShippedMap[po.id] ?? 0;
    const alokasi_overhead   = rateInfo.overhead_rate * qty_shipped;
    const hpp_aktual_final   = hpp_aktual + alokasi_overhead;
    const profit_final       = nilai_project - hpp_aktual_final;
    const margin_pct_final   = nilai_project > 0
      ? Math.round((profit_final / nilai_project) * 100)
      : 0;

    let status: 'hemat' | 'boncos' | 'on_budget' = 'on_budget';
    if (gap > 50000)  status = 'boncos';
    else if (gap < -50000) status = 'hemat';

    return {
      po_id: po.id,
      no_po: po.no_po,
      klien_nama: (po.klien as any)?.nama ?? '-',
      tanggal: po.tanggal_order,
      total_qty,
      hpp_estimasi,
      biaya_bahan,
      biaya_upah,
      hpp_aktual,
      gap,
      status,
      nilai_project,
      profit,
      margin_pct,
      qty_shipped,
      alokasi_overhead,
      hpp_aktual_final,
      profit_final,
      margin_pct_final,
    };
  });

  return result;
}

export interface POHPPDetail {
  estimasi_breakdown: {
    nama_komponen : string;
    kategori      : string;
    qty_order     : number;
    harga_per_unit: number;
    total         : number;
  }[];
  aktual_breakdown: {
    jenis         : string;
    keterangan    : string;
    tanggal       : string;
    nominal_penuh : number;
    nominal_po    : number;
  }[];
  totals: {
    hpp_estimasi    : number;
    biaya_bahan     : number;
    biaya_upah      : number;
    hpp_aktual      : number;
    gap             : number;
    alokasi_overhead: number;
    hpp_aktual_final: number;
  };
}

/**
 * B1 — Ambil breakdown detail untuk satu PO.
 *
 * aktual_breakdown menggabungkan:
 *   - pemakaian bahan kain & aksesori (dari RPC, dinamis)
 *   - biaya upah dari jurnal_entry direct_upah
 */
export async function getPOHPPDetail(po_id: string): Promise<POHPPDetail> {
  const supabase = await createClient();

  // 1. Estimasi Breakdown (via po_item → produk → hpp_item → hpp_komponen)
  const { data: poItems, error: poErr } = await supabase
    .from('po_item')
    .select(`
      qty_order,
      hpp_estimasi,
      produk:produk_id (
        hpp_item (
          qty,
          harga_satuan,
          hpp_komponen (
            nama,
            kategori
          )
        )
      )
    `)
    .eq('po_id', po_id);

  if (poErr) throw new Error(poErr.message);

  const estMap: Record<string, {
    total: number; kategori: string; qty_order: number; harga_per_unit: number;
  }> = {};

  (poItems ?? []).forEach((pi: any) => {
    const qtyOrder = Number(pi.qty_order) || 0;
    (pi.produk?.hpp_item ?? []).forEach((hi: any) => {
      const nama          = hi.hpp_komponen?.nama     || 'Unknown';
      const kategori      = hi.hpp_komponen?.kategori || 'Lainnya';
      const harga_per_unit = Number(hi.harga_satuan) || 0;
      const lineTotal     = Number(hi.qty) * harga_per_unit * qtyOrder;
      if (!estMap[nama]) {
        estMap[nama] = { total: 0, kategori, qty_order: 0, harga_per_unit };
      }
      estMap[nama].total     += lineTotal;
      estMap[nama].qty_order += qtyOrder;
    });
  });

  const total_hpp_estimasi = Object.values(estMap).reduce((s, v) => s + v.total, 0);
  const estimasi_breakdown = Object.entries(estMap).map(([nama, val]) => ({
    nama_komponen : nama,
    kategori      : val.kategori,
    qty_order     : val.qty_order,
    harga_per_unit: val.harga_per_unit,
    total         : val.total,
  }));

  // 2. Aktual Breakdown bahan & aksesori (dinamis dari pemakaian)
  const { data: pemDetail, error: pemErr } = await supabase
    .rpc('get_biaya_pemakaian_detail_po', { p_po_id: po_id, p_tenant_id: TENANT_ID });

  if (pemErr) throw new Error(pemErr.message);

  // 3. Aktual Breakdown upah — dari gaji_ledger per PO (fix double-count)
  const { data: upahDetail, error: upahErr } = await supabase
    .rpc('get_biaya_upah_detail_po', { p_po_id: po_id, p_tenant_id: TENANT_ID });

  if (upahErr) throw new Error(upahErr.message);

  // 4. Overhead alokasi untuk PO ini
  const rateInfo = await getOverheadRateInfo();
  const qtyShippedMap = rateInfo.period
    ? await getQtyShippedPerPO(rateInfo.period.tanggal_mulai, rateInfo.period.tanggal_akhir)
    : {};
  const qty_shipped_po   = qtyShippedMap[po_id] ?? 0;
  const alokasi_overhead = Math.round(rateInfo.overhead_rate * qty_shipped_po);

  // Gabung aktual_breakdown: pemakaian + upah (gaji_ledger) + overhead
  const aktual_breakdown = [
    // Bahan kain & aksesori dari pemakaian (dinamis)
    ...(pemDetail ?? []).map((p: any) => ({
      jenis        : 'direct_bahan',
      keterangan   : `${p.item_nama} — ${p.tahap} (${Number(p.qty_pakai)} × Rp ${Number(p.harga_satuan).toLocaleString('id-ID')})`,
      tanggal      : p.tgl_pertama ?? '',
      nominal_penuh: Number(p.subtotal),
      nominal_po   : Number(p.subtotal),
    })),
    // Upah dari gaji_ledger (akurat per pekerjaan aktual, tidak double-count)
    ...(upahDetail ?? []).map((u: any) => ({
      jenis        : 'direct_upah',
      keterangan   : `${u.karyawan_nama} — ${u.keterangan} (${Number(u.qty_bundle)} pcs)`,
      tanggal      : u.tanggal ?? '',
      nominal_penuh: Number(u.total),
      nominal_po   : Number(u.total),
    })),
    // Overhead alokasi
    ...(alokasi_overhead > 0 ? [{
      jenis        : 'overhead',
      keterangan   : `Alokasi Overhead — ${qty_shipped_po} pcs × Rp ${Math.round(rateInfo.overhead_rate).toLocaleString('id-ID')}`,
      tanggal      : rateInfo.period?.tanggal_mulai ?? '',
      nominal_penuh: alokasi_overhead,
      nominal_po   : alokasi_overhead,
    }] : []),
  ];

  const biaya_bahan = aktual_breakdown
    .filter(j => j.jenis === 'direct_bahan')
    .reduce((s, j) => s + j.nominal_po, 0);

  const biaya_upah = aktual_breakdown
    .filter(j => j.jenis === 'direct_upah')
    .reduce((s, j) => s + j.nominal_po, 0);

  const hpp_aktual = biaya_bahan + biaya_upah;

  return {
    estimasi_breakdown,
    aktual_breakdown,
    totals: {
      hpp_estimasi    : total_hpp_estimasi,
      biaya_bahan,
      biaya_upah,
      hpp_aktual,
      gap             : hpp_aktual - total_hpp_estimasi,
      alokasi_overhead,
      hpp_aktual_final: hpp_aktual + alokasi_overhead,
    },
  };
}

// ─── HPP per Size ─────────────────────────────────────────────────────────────

export interface POHPPPerSizeRow {
  po_item_id      : string;
  warna           : string;
  size            : string;
  qty_order       : number;
  harga_jual      : number;
  hpp_estimasi    : number;
  biaya_bahan     : number;
  biaya_upah      : number;
  hpp_aktual      : number;
  alokasi_overhead: number;
  hpp_aktual_final: number;
  hpp_per_pcs     : number;
  nilai_project   : number;
  profit          : number;
  margin_pct      : number;
}

/**
 * Hitung HPP per size/warna (per po_item) untuk satu PO.
 * Menggabungkan BOM estimasi + aktual bahan, upah, overhead per po_item.
 */
export async function getPOHPPPerSize(po_id: string): Promise<POHPPPerSizeRow[]> {
  const supabase = await createClient();

  // 1. Fetch po_item dengan BOM dan harga_jual
  const { data: poItems, error: piErr } = await supabase
    .from('po_item')
    .select(`
      id,
      warna,
      size,
      qty_order,
      produk:produk_id (
        harga_jual,
        hpp_item (
          qty,
          harga_satuan
        )
      )
    `)
    .eq('po_id', po_id);

  if (piErr) throw new Error(piErr.message);

  // 2. Biaya bahan aktual per po_item via RPC (jika ada)
  const bahanMap = new Map<string, number>();
  const { data: bahanDetail, error: bahanErr } = await supabase
    .rpc('get_biaya_pemakaian_per_po_item', {
      p_po_id    : po_id,
      p_tenant_id: TENANT_ID,
    });
  if (!bahanErr && bahanDetail) {
    (bahanDetail as any[]).forEach((r: any) => {
      bahanMap.set(String(r.po_item_id), (bahanMap.get(String(r.po_item_id)) ?? 0) + (Number(r.subtotal) || 0));
    });
  }

  // 3. Biaya upah per po_item via RPC (jika ada)
  const upahMap = new Map<string, number>();
  const { data: upahDetail, error: upahErr } = await supabase
    .rpc('get_biaya_upah_per_po_item', {
      p_po_id    : po_id,
      p_tenant_id: TENANT_ID,
    });
  if (!upahErr && upahDetail) {
    (upahDetail as any[]).forEach((r: any) => {
      upahMap.set(String(r.po_item_id), Number(r.biaya_upah) || 0);
    });
  }

  // 4. Overhead rate
  const rateInfo = await getOverheadRateInfo();

  // 5. Qty shipped per po_item dalam periode overhead aktif
  const qtyShippedPerItem = new Map<string, number>();
  if (rateInfo.period) {
    const { data: sjItems } = await supabase
      .from('surat_jalan_item')
      .select(`
        qty_kirim,
        bundle:bundle_id ( po_item_id ),
        surat_jalan:surat_jalan_id ( tanggal )
      `)
      .gte('surat_jalan.tanggal', rateInfo.period.tanggal_mulai)
      .lte('surat_jalan.tanggal', rateInfo.period.tanggal_akhir);

    (sjItems ?? []).forEach((sji: any) => {
      const poItemId = sji.bundle?.po_item_id;
      if (poItemId) {
        qtyShippedPerItem.set(
          String(poItemId),
          (qtyShippedPerItem.get(String(poItemId)) ?? 0) + Number(sji.qty_kirim)
        );
      }
    });
  }

  // 6. Build rows
  const rows: POHPPPerSizeRow[] = (poItems ?? []).map((pi: any) => {
    const po_item_id = String(pi.id);
    const qty_order  = Number(pi.qty_order) || 0;
    const harga_jual = Number(pi.produk?.harga_jual) || 0;

    const hpp_estimasi = (pi.produk?.hpp_item ?? []).reduce(
      (s: number, hi: any) => s + Number(hi.qty) * Number(hi.harga_satuan) * qty_order, 0
    );

    const biaya_bahan      = bahanMap.get(po_item_id) ?? 0;
    const biaya_upah       = upahMap.get(po_item_id)  ?? 0;
    const hpp_aktual       = biaya_bahan + biaya_upah;
    const qty_ship         = qtyShippedPerItem.get(po_item_id) ?? 0;
    const alokasi_overhead = Math.round(rateInfo.overhead_rate * qty_ship);
    const hpp_aktual_final = hpp_aktual + alokasi_overhead;
    const hpp_per_pcs      = qty_order > 0 ? Math.round(hpp_aktual_final / qty_order) : 0;
    const nilai_project    = qty_order * harga_jual;
    const profit           = nilai_project - hpp_aktual_final;
    const margin_pct       = nilai_project > 0
      ? Math.round((profit / nilai_project) * 100)
      : 0;

    return {
      po_item_id, warna: pi.warna || '-', size: pi.size || '-',
      qty_order, harga_jual, hpp_estimasi,
      biaya_bahan, biaya_upah, hpp_aktual,
      alokasi_overhead, hpp_aktual_final, hpp_per_pcs,
      nilai_project, profit, margin_pct,
    };
  });

  rows.sort((a, b) => {
    const w = a.warna.localeCompare(b.warna);
    return w !== 0 ? w : a.size.localeCompare(b.size);
  });

  return rows;
}
