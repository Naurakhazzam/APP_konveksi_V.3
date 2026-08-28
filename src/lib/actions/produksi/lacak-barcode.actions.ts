'use server';

import { createClient } from '@/lib/supabase/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { matchesBundleSearch, tokenizeSearch } from '@/lib/search/bundle-search';

const TENANT_ID = 'STX-001';

const TAHAP_ORDER = ['cutting', 'jahit', 'lubang_kancing', 'buang_benang', 'qc', 'steam', 'packing'] as const;
const TAHAP_LABEL: Record<(typeof TAHAP_ORDER)[number], string> = {
  cutting: 'Cutting',
  jahit: 'Jahit',
  lubang_kancing: 'Lubang Kancing',
  buang_benang: 'Buang Benang',
  qc: 'QC',
  steam: 'Steam',
  packing: 'Packing',
};

export interface LacakBarcodeResult {
  barcode: string;
  no_po: string;
  klien_nama: string;
  model_nama: string | null;
  warna: string;
  size: string;
  qty_per_bundle: number;
  tahap_sekarang: string;
  status_kirim: 'belum_dikirim' | 'sudah_dikirim';
  nomor_sj: string | null;
  tanggal_kirim: string | null;
  penjahit_nama: string | null;
  penjahit_waktu: string | null;
}

export interface LacakBarcodeCandidate {
  barcode: string;
  no_po: string;
  klien_nama: string;
  model_nama: string | null;
  warna: string;
  size: string;
  qty: number;
  tahap_sekarang: string;
  status_kirim: 'belum_dikirim' | 'sudah_dikirim';
}

export type LacakBarcodeResponse =
  | { type: 'found'; data: LacakBarcodeResult }
  /** `total` bisa lebih besar dari jumlah candidates kalau hasilnya dipangkas. */
  | { type: 'multiple'; candidates: LacakBarcodeCandidate[]; total: number }
  | { type: 'not_found' };

/** Batas kandidat yang dikirim ke layar. PO terbesar punya 54 bundle, jadi
 *  satu nomor PO utuh masih muat tanpa terpotong. */
const MAKS_KANDIDAT = 60;

/** Tahap pertama dalam urutan yang belum berstatus 'selesai'. */
function tahapBerjalan(statusTahap: any): string {
  const st = (statusTahap ?? {}) as Record<string, { status?: string }>;
  for (const t of TAHAP_ORDER) {
    if (st[t]?.status !== 'selesai') return TAHAP_LABEL[t];
  }
  return 'Selesai Semua Tahap';
}

/**
 * Qty sebenarnya bundle ini: diambil dari tahap PALING AKHIR yang sudah
 * tersentuh, bukan dari qty_per_bundle rencana — karena untuk bundle hasil
 * Split atau cutting partial kedua angka itu berbeda.
 */
function qtyEfektifBundle(statusTahap: any, qtyRencana: number): number {
  const st = (statusTahap ?? {}) as Record<string, any>;
  for (const t of [...TAHAP_ORDER].reverse()) {
    const info = st[t];
    if (!info) continue;
    if (t === 'cutting') {
      if (info.qty_aktual != null) return info.qty_aktual;
    } else {
      if (info.qty_selesai != null) return info.qty_selesai;
      if (info.qty_terima != null) return info.qty_terima;
    }
  }
  return qtyRencana;
}

// Ambil detail lengkap 1 bundle by barcode PERSIS (case-insensitive, tanpa wildcard).
async function fetchDetail(supabase: SupabaseClient, barcode: string): Promise<LacakBarcodeResult | null> {
  const { data, error } = await supabase
    .from('bundle')
    .select(`
      barcode,
      status_tahap,
      po:po_id(no_po, klien:klien_id(nama)),
      po_item:po_item_id(warna, size, qty_per_bundle, produk:produk_id(model_produk:model_id(nama))),
      surat_jalan_item(sj:sj_id(nomor_sj, tanggal))
    `)
    .ilike('barcode', barcode)
    .eq('tenant_id', TENANT_ID)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) return null;

  const row = data as any;
  const po = Array.isArray(row.po) ? row.po[0] : row.po;
  const klien = Array.isArray(po?.klien) ? po.klien[0] : po?.klien;
  const poItem = Array.isArray(row.po_item) ? row.po_item[0] : row.po_item;
  const produk = Array.isArray(poItem?.produk) ? poItem.produk[0] : poItem?.produk;
  const model = Array.isArray(produk?.model_produk) ? produk.model_produk[0] : produk?.model_produk;
  const sjItem = Array.isArray(row.surat_jalan_item) ? row.surat_jalan_item[0] : row.surat_jalan_item;
  const sj = Array.isArray(sjItem?.sj) ? sjItem.sj[0] : sjItem?.sj;

  const statusTahap = (row.status_tahap ?? {}) as Record<string, {
    status?: string;
    karyawan_id?: string | null;
    waktu_terima?: string;
    waktu_selesai?: string | null;
  }>;

  // Penjahit: khusus tahap jahit, karena hanya tahap ini yang mewajibkan
  // assign karyawan per bundle (tahap lain sifatnya borongan/kelompok).
  let penjahitNama: string | null = null;
  let penjahitWaktu: string | null = null;
  const jahitInfo = statusTahap.jahit;
  if (jahitInfo?.karyawan_id) {
    const { data: karyawan } = await supabase
      .from('karyawan')
      .select('nama')
      .eq('id', jahitInfo.karyawan_id)
      .maybeSingle();
    penjahitNama = karyawan?.nama ?? null;
    penjahitWaktu = jahitInfo.waktu_selesai ?? jahitInfo.waktu_terima ?? null;
  }

  const tahapSekarang = tahapBerjalan(statusTahap);
  const qtyFinal = qtyEfektifBundle(statusTahap, poItem?.qty_per_bundle ?? 0);

  return {
    barcode: row.barcode,
    no_po: po?.no_po ?? '',
    klien_nama: klien?.nama ?? '',
    model_nama: model?.nama ?? null,
    warna: poItem?.warna ?? '',
    size: poItem?.size ?? '',
    qty_per_bundle: qtyFinal,
    tahap_sekarang: tahapSekarang,
    status_kirim: sj ? 'sudah_dikirim' : 'belum_dikirim',
    nomor_sj: sj?.nomor_sj ?? null,
    tanggal_kirim: sj?.tanggal ?? null,
    penjahit_nama: penjahitNama,
    penjahit_waktu: penjahitWaktu,
  };
}

// Cek status bundle via barcode: posisi tahap saat ini, sudah dikirim atau
// belum, dan siapa penjahit yang mengerjakannya — dipakai terutama saat
// menangani retur, supaya bisa langsung tahu penjahitnya tanpa telusuri manual.
//
// Barcode asli formatnya "PO-{no_po}-{5 digit urut global}-bdl{3 digit}",
// tapi di lapangan orang sering cuma ingat/ketik sebagian (mis. cuma nomor
// urut tengahnya, "00311"). Jadi: coba exact match dulu, kalau tidak ketemu
// baru cari partial match di seluruh barcode.
export async function lacakBarcode(query: string): Promise<LacakBarcodeResponse> {
  const trimmed = query.trim();
  if (!trimmed) return { type: 'not_found' };

  const supabase = await createClient();

  const exact = await fetchDetail(supabase, trimmed);
  if (exact) return { type: 'found', data: exact };

  // Pencarian tidak lagi terbatas ke kolom barcode. Nomor PO memang kebetulan
  // ikut ketemu karena tercetak di dalam barcode, tapi nama artikel (model,
  // warna, size) tersimpan di tabel lain — mengetik "zubair navy xxl" dulu
  // menghasilkan nol. Sekarang seluruh field dicocokkan per kata dan bebas
  // urutan lewat helper yang sama dengan Packing & Buat Surat Jalan, sehingga
  // "2XL" pun mengerti bahwa di data tertulis "XXL".
  const { data: rows, error } = await supabase
    .from('bundle')
    .select(`
      barcode,
      status_tahap,
      po:po_id(no_po, klien:klien_id(nama)),
      po_item:po_item_id(warna, size, qty_per_bundle, produk:produk_id(model_produk:model_id(nama))),
      surat_jalan_item(id)
    `)
    .eq('tenant_id', TENANT_ID);

  if (error) throw new Error(error.message);
  if (!rows || rows.length === 0) return { type: 'not_found' };

  const tokens = tokenizeSearch(trimmed);

  const cocok = (rows as any[])
    .map(m => {
      const po = Array.isArray(m.po) ? m.po[0] : m.po;
      const klien = Array.isArray(po?.klien) ? po.klien[0] : po?.klien;
      const poItem = Array.isArray(m.po_item) ? m.po_item[0] : m.po_item;
      const produk = Array.isArray(poItem?.produk) ? poItem.produk[0] : poItem?.produk;
      const model = Array.isArray(produk?.model_produk) ? produk.model_produk[0] : produk?.model_produk;

      return {
        barcode: m.barcode as string,
        no_po: po?.no_po ?? '',
        klien_nama: klien?.nama ?? '',
        model_nama: model?.nama ?? null,
        warna: poItem?.warna ?? '',
        size: poItem?.size ?? '',
        qty: qtyEfektifBundle(m.status_tahap, poItem?.qty_per_bundle ?? 0),
        tahap_sekarang: tahapBerjalan(m.status_tahap),
        status_kirim: ((m.surat_jalan_item ?? []).length > 0
          ? 'sudah_dikirim' : 'belum_dikirim') as 'sudah_dikirim' | 'belum_dikirim',
      };
    })
    .filter(c => matchesBundleSearch(c, tokens));

  if (cocok.length === 0) return { type: 'not_found' };

  if (cocok.length === 1) {
    const detail = await fetchDetail(supabase, cocok[0].barcode);
    return detail ? { type: 'found', data: detail } : { type: 'not_found' };
  }

  cocok.sort((a, b) =>
    a.no_po.localeCompare(b.no_po) || a.barcode.localeCompare(b.barcode));

  return {
    type: 'multiple',
    candidates: cocok.slice(0, MAKS_KANDIDAT),
    total: cocok.length,
  };
}

// Resolusi 1 barcode persis — dipakai saat user memilih salah satu dari
// daftar kandidat hasil partial search.
export async function lacakBarcodeExact(barcode: string): Promise<LacakBarcodeResult | null> {
  const supabase = await createClient();
  return fetchDetail(supabase, barcode);
}
