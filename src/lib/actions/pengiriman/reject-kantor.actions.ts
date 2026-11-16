'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';

const TENANT_ID = 'STX-001';

// Reject yang ditemukan KANTOR pada barang kiriman (retur ke konveksi).
// Selama belum dikirim ulang, nilainya memotong tagihan SJ asal.
// Semua tulis lewat RPC (lihat migrasi 20261115_reject_kantor.sql).

export type RejectKantorStatus = 'retur' | 'diperbaiki' | 'tidak_bisa' | 'selesai';

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
  surat_jalan_id: string;
  nomor_sj: string;
  klien_nama: string;
  produk_nama: string;
  model_nama: string;
  alasan_nama: string;
  jenis_nama: string;
  qty: number;
  /** Pcs yang sudah dikirim ulang (pakai qty diterima bila SJ kirim ulang sudah divalidasi). */
  terkirim: number;
  sisa: number;
  harga_satuan: number;
  /** sisa × harga — yang sedang memotong tagihan. */
  potongan: number;
  status: RejectKantorStatus;
  waktu_temuan: 'saat_terima' | 'belakangan';
  keterangan: string | null;
  kirim_ulang: KirimUlangRingkas[];
}

export interface SjProdukLapor {
  produk_id: string;
  produk_nama: string;
  qty: number;          // qty diterima (atau qty kirim bila belum divalidasi)
  sudah_reject: number;
}

export interface SjUntukLapor {
  id: string;
  nomor_sj: string;
  tanggal: string;
  klien_nama: string;
  sudah_validasi: boolean;
  produk: SjProdukLapor[];
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
      id, nomor_reject, tanggal, qty, harga_satuan, status, waktu_temuan, keterangan,
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

    return {
      id: r.id,
      nomor_reject: r.nomor_reject,
      tanggal: r.tanggal,
      surat_jalan_id: sj?.id ?? '',
      nomor_sj: sj?.nomor_sj ?? '-',
      klien_nama: (one(sj?.klien) as any)?.nama ?? '-',
      produk_nama: produk?.nama ?? '-',
      model_nama: (one(produk?.model_produk) as any)?.nama ?? produk?.nama ?? '-',
      alasan_nama: alasan?.nama ?? '-',
      jenis_nama: (one(alasan?.jenis_reject) as any)?.nama ?? '-',
      qty,
      terkirim,
      sisa,
      harga_satuan: harga,
      potongan: sisa * harga,
      status: r.status,
      waktu_temuan: r.waktu_temuan,
      keterangan: r.keterangan ?? null,
      kirim_ulang: kirimUlang,
    };
  });
}

/** Daftar SJ biasa (bukan kirim ulang) + isi per produk, untuk form "Lapor Reject". */
export async function getSjUntukLaporReject(): Promise<SjUntukLapor[]> {
  const supabase = await createClient();

  const [sjRes, rkRes] = await Promise.all([
    supabase
      .from('surat_jalan')
      .select(`
        id, nomor_sj, tanggal, tanggal_validasi,
        klien:klien_id ( nama ),
        surat_jalan_item ( qty_kirim, qty_diterima, bundle:bundle_id ( po_item:po_item_id ( produk_id, produk:produk_id ( nama ) ) ) )
      `)
      .eq('tenant_id', TENANT_ID)
      .eq('jenis', 'normal')
      .order('tanggal', { ascending: false })
      .order('nomor_sj', { ascending: false })
      .limit(200),
    supabase
      .from('reject_kantor')
      .select('surat_jalan_id, produk_id, qty')
      .eq('tenant_id', TENANT_ID),
  ]);

  if (sjRes.error) throw new Error(`Gagal memuat surat jalan: ${sjRes.error.message}`);

  const sudah = new Map<string, number>();
  (rkRes.data ?? []).forEach((r: any) => {
    const key = `${r.surat_jalan_id}|${r.produk_id}`;
    sudah.set(key, (sudah.get(key) ?? 0) + Number(r.qty ?? 0));
  });

  return (sjRes.data ?? []).map((sj: any) => {
    const perProduk = new Map<string, SjProdukLapor>();
    (sj.surat_jalan_item ?? []).forEach((it: any) => {
      const pi = one(one(it.bundle as any)?.po_item) as any;
      if (!pi?.produk_id) return;
      const qty = Number(it.qty_diterima ?? it.qty_kirim ?? 0);
      const cur = perProduk.get(pi.produk_id);
      if (cur) cur.qty += qty;
      else perProduk.set(pi.produk_id, {
        produk_id: pi.produk_id,
        produk_nama: (one(pi.produk) as any)?.nama ?? '-',
        qty,
        sudah_reject: sudah.get(`${sj.id}|${pi.produk_id}`) ?? 0,
      });
    });

    return {
      id: sj.id,
      nomor_sj: sj.nomor_sj,
      tanggal: sj.tanggal,
      klien_nama: (one(sj.klien) as any)?.nama ?? '-',
      sudah_validasi: !!sj.tanggal_validasi,
      produk: [...perProduk.values()].sort((a, b) => a.produk_nama.localeCompare(b.produk_nama)),
    };
  }).filter(sj => sj.produk.length > 0);
}

// ─── Tulis ────────────────────────────────────────────────────────────────────

export async function laporRejectKantor(input: {
  surat_jalan_id: string;
  produk_id: string;
  qty: number;
  alasan_reject_id: string;
  keterangan?: string;
}): Promise<{ error?: string; nomor_reject?: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('lapor_reject_kantor', {
    p_surat_jalan_id: input.surat_jalan_id,
    p_produk_id: input.produk_id,
    p_qty: input.qty,
    p_alasan_reject_id: input.alasan_reject_id,
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
