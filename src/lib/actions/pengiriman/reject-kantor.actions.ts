'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { TANGGAL_AWAL_PERIODE } from '@/lib/keuangan/periode-po';

const TENANT_ID = 'STX-001';

// Reject yang ditemukan KANTOR pada barang kiriman (retur ke konveksi).
// Selama belum dikirim ulang, nilainya memotong tagihan SJ asal.
// Semua tulis lewat RPC (migrasi 20261115_reject_kantor.sql & 20261118_reject_kantor_v2.sql).

export type RejectKantorStatus = 'retur' | 'diperbaiki' | 'tidak_bisa' | 'dibeli_kantor' | 'selesai';
export type RejectTingkat = 'minor' | 'mayor' | 'parah';

export interface KirimUlangRingkas {
  nomor_sj: string;
  sj_id: string;
  tanggal: string;
  qty: number;
  qty_diterima: number | null;
}

export interface RejectKantorRow {
  id: string;
  nomor_reject: string;
  tanggal: string;
  /** 'sj' = barang dari surat jalan di sistem; 'barang_lama' = kiriman lama di luar sistem (tanpa SJ). */
  sumber: 'sj' | 'barang_lama';
  surat_jalan_id: string | null;
  nomor_sj: string;
  klien_nama: string;
  produk_nama: string;
  model_nama: string;
  alasan_nama: string;
  jenis_nama: string;
  tingkat: RejectTingkat;
  qty: number;
  /** Pcs yang sudah dikirim ulang (pakai qty diterima bila SJ kirim ulang sudah divalidasi). */
  terkirim: number;
  sisa: number;
  harga_satuan: number;
  /** Diisi bila status 'dibeli_kantor'. */
  harga_beli_kantor: number | null;
  /** Nilai yang hilang: sisa × harga, atau sisa × (harga − harga beli) bila dibeli kantor. */
  potongan: number;
  status: RejectKantorStatus;
  waktu_temuan: 'saat_terima' | 'belakangan';
  keterangan: string | null;
  kirim_ulang: KirimUlangRingkas[];
}

export interface ProdukLaporFifo {
  produk_id: string;
  produk_nama: string;
  /** Pcs yang sudah diterima kantor & belum dicatat reject (SJ periode baru, tervalidasi). */
  sisa: number;
  jumlah_sj: number;
}

export interface ProdukMaster {
  id: string;
  nama: string;
  harga_jual: number;
}

export interface DataLaporReject {
  fifo: ProdukLaporFifo[];
  produkSemua: ProdukMaster[];
  klien: { id: string; nama: string }[];
}

function revalidateSemua() {
  revalidatePath('/app/pengiriman/reject-kantor');
  revalidatePath('/app/pengiriman/validasi');
  revalidatePath('/app/pengiriman/riwayat');
  revalidatePath('/app/keuangan/invoice');
}

function one<T>(v: T | T[] | null | undefined): T | null {
  if (Array.isArray(v)) return v[0] ?? null;
  return v ?? null;
}

// ─── Baca ─────────────────────────────────────────────────────────────────────

export async function getRejectKantorList(): Promise<RejectKantorRow[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('reject_kantor')
    .select(`
      id, nomor_reject, tanggal, qty, harga_satuan, harga_beli_kantor, status, waktu_temuan, keterangan, tingkat, sumber,
      klien:klien_id ( nama ),
      surat_jalan:surat_jalan_id ( id, nomor_sj, klien:klien_id ( nama ) ),
      produk:produk_id ( nama, model_produk:model_id ( nama ) ),
      alasan:alasan_reject_id ( nama, jenis_reject:jenis_reject_id ( nama ) ),
      kirim_ulang_item ( qty, qty_diterima, sj:sj_id ( id, nomor_sj, tanggal ) )
    `)
    .eq('tenant_id', TENANT_ID)
    .order('tanggal', { ascending: false })
    .order('nomor_reject', { ascending: false });

  if (error) throw new Error(`Gagal memuat reject kantor: ${error.message}`);

  return (data ?? []).map((r: any) => {
    const sj = one(r.surat_jalan) as any;
    const produk = one(r.produk) as any;
    const alasan = one(r.alasan) as any;
    const kirimUlang: KirimUlangRingkas[] = (r.kirim_ulang_item ?? []).map((k: any) => {
      const ks = one(k.sj) as any;
      return {
        nomor_sj: ks?.nomor_sj ?? '-',
        sj_id: ks?.id ?? '',
        tanggal: ks?.tanggal ?? '',
        qty: Number(k.qty ?? 0),
        qty_diterima: k.qty_diterima == null ? null : Number(k.qty_diterima),
      };
    });
    const terkirim = kirimUlang.reduce((s, k) => s + (k.qty_diterima ?? k.qty), 0);
    const qty = Number(r.qty ?? 0);
    const sisa = Math.max(qty - terkirim, 0);
    const harga = Number(r.harga_satuan ?? 0);
    const hargaBeli = r.harga_beli_kantor == null ? null : Number(r.harga_beli_kantor);
    const perPcs = r.status === 'dibeli_kantor' ? Math.max(harga - (hargaBeli ?? 0), 0) : harga;

    return {
      id: r.id,
      nomor_reject: r.nomor_reject,
      tanggal: r.tanggal,
      sumber: r.sumber === 'barang_lama' ? 'barang_lama' : 'sj',
      surat_jalan_id: sj?.id ?? null,
      nomor_sj: sj?.nomor_sj ?? 'Barang lama',
      klien_nama: (one(r.klien) as any)?.nama ?? (one(sj?.klien) as any)?.nama ?? '-',
      produk_nama: produk?.nama ?? '-',
      model_nama: (one(produk?.model_produk) as any)?.nama ?? produk?.nama ?? '-',
      alasan_nama: alasan?.nama ?? '-',
      jenis_nama: (one(alasan?.jenis_reject) as any)?.nama ?? '-',
      tingkat: (r.tingkat ?? 'mayor') as RejectTingkat,
      qty,
      terkirim,
      sisa,
      harga_satuan: harga,
      harga_beli_kantor: hargaBeli,
      potongan: sisa * perPcs,
      status: r.status,
      waktu_temuan: r.waktu_temuan,
      keterangan: r.keterangan ?? null,
      kirim_ulang: kirimUlang,
    };
  });
}

/**
 * Data form "Lapor Reject":
 * - fifo: produk yang sudah diterima kantor (SJ biasa periode baru, sudah divalidasi)
 *   beserta sisa pcs yang masih bisa dilapor reject — sama dengan hitungan RPC.
 * - produkSemua + klien: untuk pilihan "Barang lama (di luar sistem)".
 */
export async function getDataLaporReject(): Promise<DataLaporReject> {
  const supabase = await createClient();

  const [sjiRes, rkRes, produkRes, klienRes] = await Promise.all([
    supabase
      .from('surat_jalan_item')
      .select(`
        id, qty_kirim, qty_diterima,
        sj:sj_id!inner ( id, jenis, tanggal, tanggal_validasi ),
        bundle:bundle_id ( po_item:po_item_id ( produk_id, produk:produk_id ( nama ) ) )
      `)
      .eq('tenant_id', TENANT_ID)
      .eq('sj.jenis', 'normal')
      .gte('sj.tanggal', TANGGAL_AWAL_PERIODE)
      .not('sj.tanggal_validasi', 'is', null)
      .limit(5000),
    supabase
      .from('reject_kantor')
      .select('surat_jalan_item_id, qty')
      .eq('tenant_id', TENANT_ID)
      .not('surat_jalan_item_id', 'is', null),
    supabase
      .from('produk')
      .select('id, nama, harga_jual')
      .eq('tenant_id', TENANT_ID)
      .order('nama')
      .limit(5000),
    supabase.from('klien').select('id, nama').eq('tenant_id', TENANT_ID).order('nama'),
  ]);

  if (sjiRes.error) throw new Error(`Gagal memuat surat jalan: ${sjiRes.error.message}`);
  if (produkRes.error) throw new Error(`Gagal memuat produk: ${produkRes.error.message}`);

  const sudah = new Map<string, number>();
  (rkRes.data ?? []).forEach((r: any) => {
    sudah.set(r.surat_jalan_item_id, (sudah.get(r.surat_jalan_item_id) ?? 0) + Number(r.qty ?? 0));
  });

  const perProduk = new Map<string, ProdukLaporFifo & { sjSet: Set<string> }>();
  (sjiRes.data ?? []).forEach((it: any) => {
    const sj = one(it.sj) as any;
    const pi = one(one(it.bundle as any)?.po_item) as any;
    if (!sj || !pi?.produk_id) return;
    const kirim = Number(it.qty_kirim ?? 0);
    const basis = Math.min(Number(it.qty_diterima ?? kirim), kirim);
    const sisa = basis - (sudah.get(it.id) ?? 0);
    if (sisa <= 0) return;
    const cur = perProduk.get(pi.produk_id) ?? {
      produk_id: pi.produk_id,
      produk_nama: (one(pi.produk) as any)?.nama ?? '-',
      sisa: 0,
      jumlah_sj: 0,
      sjSet: new Set<string>(),
    };
    cur.sisa += sisa;
    cur.sjSet.add(sj.id);
    cur.jumlah_sj = cur.sjSet.size;
    perProduk.set(pi.produk_id, cur);
  });

  return {
    fifo: [...perProduk.values()]
      .map(({ sjSet: _s, ...p }) => p)
      .sort((a, b) => a.produk_nama.localeCompare(b.produk_nama)),
    produkSemua: (produkRes.data ?? []).map((p: any) => ({ id: p.id, nama: p.nama, harga_jual: Number(p.harga_jual ?? 0) })),
    klien: (klienRes.data ?? []).map((k: any) => ({ id: k.id, nama: k.nama })),
  };
}

// ─── Tulis ────────────────────────────────────────────────────────────────────

export interface AlokasiReject { nomor_reject: string; nomor_sj: string; qty: number }

/** Lapor reject belakangan — sistem membagi ke SJ secara FIFO (SJ terlama dulu). */
export async function laporRejectKantor(input: {
  produk_id: string;
  qty: number;
  alasan_reject_id: string;
  tingkat: RejectTingkat;
  keterangan?: string;
}): Promise<{ error?: string; alokasi?: AlokasiReject[] }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('lapor_reject_kantor', {
    p_produk_id: input.produk_id,
    p_qty: input.qty,
    p_alasan_reject_id: input.alasan_reject_id,
    p_tingkat: input.tingkat,
    p_keterangan: input.keterangan ?? null,
    p_tenant_id: TENANT_ID,
  });
  if (error) return { error: error.message };
  revalidateSemua();
  return { alokasi: ((data as any)?.alokasi ?? []) as AlokasiReject[] };
}

/** Reject barang lama (kiriman di luar sistem): tanpa SJ, tidak memotong invoice. */
export async function laporRejectBarangLama(input: {
  produk_id: string;
  klien_id: string | null;
  qty: number;
  alasan_reject_id: string;
  tingkat: RejectTingkat;
  harga_satuan: number | null;
  keterangan?: string;
}): Promise<{ error?: string; nomor_reject?: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('lapor_reject_barang_lama', {
    p_produk_id: input.produk_id,
    p_klien_id: input.klien_id,
    p_qty: input.qty,
    p_alasan_reject_id: input.alasan_reject_id,
    p_tingkat: input.tingkat,
    p_harga_satuan: input.harga_satuan,
    p_keterangan: input.keterangan ?? null,
    p_tenant_id: TENANT_ID,
  });
  if (error) return { error: error.message };
  revalidateSemua();
  return { nomor_reject: (data as any)?.nomor_reject ?? '' };
}

export async function ubahStatusRejectKantor(
  id: string,
  status: 'retur' | 'diperbaiki' | 'tidak_bisa',
): Promise<{ error?: string }> {
  const supabase = await createClient();
  const { error } = await supabase.rpc('ubah_status_reject_kantor', {
    p_id: id,
    p_status: status,
    p_tenant_id: TENANT_ID,
  });
  if (error) return { error: error.message };
  revalidateSemua();
  return {};
}

/** Kantor membeli barang reject (harga lebih murah) — potongan permanen = selisih harga × sisa. */
export async function rejectDibeliKantor(id: string, hargaBeli: number): Promise<{ error?: string }> {
  const supabase = await createClient();
  const { error } = await supabase.rpc('selesaikan_reject_dibeli_kantor', {
    p_id: id,
    p_harga_beli: hargaBeli,
    p_tenant_id: TENANT_ID,
  });
  if (error) return { error: error.message };
  revalidateSemua();
  return {};
}

export async function ubahTingkatRejectKantor(id: string, tingkat: RejectTingkat): Promise<{ error?: string }> {
  const supabase = await createClient();
  const { error } = await supabase.rpc('ubah_tingkat_reject_kantor', {
    p_id: id,
    p_tingkat: tingkat,
    p_tenant_id: TENANT_ID,
  });
  if (error) return { error: error.message };
  revalidateSemua();
  return {};
}

export async function hapusRejectKantor(id: string): Promise<{ error?: string }> {
  const supabase = await createClient();
  const { error } = await supabase.rpc('hapus_reject_kantor', {
    p_id: id,
    p_tenant_id: TENANT_ID,
  });
  if (error) return { error: error.message };
  revalidateSemua();
  return {};
}

export async function buatSjKirimUlang(input: {
  tanggal: string;
  catatan?: string;
  items: { reject_kantor_id: string; qty: number }[];
}): Promise<{ error?: string; id?: string; nomor_sj?: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('buat_sj_kirim_ulang', {
    p_tanggal: input.tanggal,
    p_catatan: input.catatan ?? null,
    p_items: input.items,
    p_tenant_id: TENANT_ID,
  });
  if (error) return { error: error.message };
  revalidateSemua();
  return data as { id: string; nomor_sj: string };
}
