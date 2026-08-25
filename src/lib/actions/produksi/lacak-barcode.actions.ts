'use server';

import { createClient } from '@/lib/supabase/server';
import type { SupabaseClient } from '@supabase/supabase-js';

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
  model_nama: string | null;
  warna: string;
  size: string;
}

export type LacakBarcodeResponse =
  | { type: 'found'; data: LacakBarcodeResult }
  | { type: 'multiple'; candidates: LacakBarcodeCandidate[] }
  | { type: 'not_found' };

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

  // Tahap sekarang = tahap pertama dalam urutan yang belum berstatus 'selesai'.
  let tahapSekarang = 'Selesai Semua Tahap';
  for (const t of TAHAP_ORDER) {
    if (statusTahap[t]?.status !== 'selesai') {
      tahapSekarang = TAHAP_LABEL[t];
      break;
    }
  }

  // Qty efektif bundle ini: qty tahap paling akhir yang sudah tersentuh
  // (qty_selesai lebih diutamakan dari qty_terima, cutting pakai qty_aktual)
  // — supaya benar untuk bundle hasil Split, yang qty-nya beda dari
  // qty_per_bundle rencana po_item.
  let qtyEfektif: number | null = null;
  for (const t of [...TAHAP_ORDER].reverse()) {
    const info = statusTahap[t] as any;
    if (!info) continue;
    if (t === 'cutting') {
      if (info.qty_aktual != null) { qtyEfektif = info.qty_aktual; break; }
    } else {
      if (info.qty_selesai != null) { qtyEfektif = info.qty_selesai; break; }
      if (info.qty_terima != null) { qtyEfektif = info.qty_terima; break; }
    }
  }
  const qtyFinal: number = qtyEfektif ?? (poItem?.qty_per_bundle ?? 0);

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

  const { data: matches, error } = await supabase
    .from('bundle')
    .select(`
      barcode,
      po:po_id(no_po),
      po_item:po_item_id(warna, size, produk:produk_id(model_produk:model_id(nama)))
    `)
    .ilike('barcode', `%${trimmed}%`)
    .eq('tenant_id', TENANT_ID)
    .limit(10);

  if (error) throw new Error(error.message);
  if (!matches || matches.length === 0) return { type: 'not_found' };

  if (matches.length === 1) {
    const detail = await fetchDetail(supabase, matches[0].barcode);
    return detail ? { type: 'found', data: detail } : { type: 'not_found' };
  }

  const candidates: LacakBarcodeCandidate[] = matches.map((m: any) => {
    const po = Array.isArray(m.po) ? m.po[0] : m.po;
    const poItem = Array.isArray(m.po_item) ? m.po_item[0] : m.po_item;
    const produk = Array.isArray(poItem?.produk) ? poItem.produk[0] : poItem?.produk;
    const model = Array.isArray(produk?.model_produk) ? produk.model_produk[0] : produk?.model_produk;
    return {
      barcode: m.barcode,
      no_po: po?.no_po ?? '',
      model_nama: model?.nama ?? null,
      warna: poItem?.warna ?? '',
      size: poItem?.size ?? '',
    };
  });

  return { type: 'multiple', candidates };
}

// Resolusi 1 barcode persis — dipakai saat user memilih salah satu dari
// daftar kandidat hasil partial search.
export async function lacakBarcodeExact(barcode: string): Promise<LacakBarcodeResult | null> {
  const supabase = await createClient();
  return fetchDetail(supabase, barcode);
}
