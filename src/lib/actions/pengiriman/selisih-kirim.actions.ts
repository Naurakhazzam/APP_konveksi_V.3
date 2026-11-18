'use server';

import { createClient } from '@/lib/supabase/server';
import { getUserFromClaims } from '@/lib/auth/session';
import { revalidatePath } from 'next/cache';

const TENANT_ID = 'STX-001';

// Selisih Kirim: pcs yang kurang saat Validasi Kirim (qty diterima < qty kirim).
// Kantor cukup mengisi qty diterima; OWNER yang menjelaskan selisihnya.
// Semua tulis lewat RPC (lihat migrasi 20261118_selisih_kirim.sql).

export type SelisihKirimStatus = 'menunggu' | 'ketinggalan' | 'hilang' | 'salah_hitung';
export type JawabanSelisih = 'ketinggalan' | 'hilang' | 'salah_hitung';

export interface SelisihKirimRow {
  id: string;
  status: SelisihKirimStatus;
  surat_jalan_id: string;
  nomor_sj: string;
  tanggal_sj: string;
  tanggal_validasi: string | null;
  klien_nama: string;
  barcode: string;
  no_po: string;
  model_nama: string;
  warna: string;
  size: string;
  qty_kirim: number;
  qty_diterima: number;
  qty: number;
  harga_satuan: number;
  keterangan: string | null;
  sj_pengganti: { id: string; nomor_sj: string } | null;
  dijawab_at: string | null;
  created_at: string;
}

async function resolveUserId(): Promise<string> {
  const supabase = await createClient();
  const { data: { user }, error } = await getUserFromClaims(supabase);
  if (error || !user) throw new Error('Sesi Anda sudah habis, silakan login ulang.');
  return user.id;
}

function one<T>(v: T | T[] | null | undefined): T | null {
  if (Array.isArray(v)) return v[0] ?? null;
  return v ?? null;
}

function revalidateSemua() {
  revalidatePath('/app/pengiriman/selisih-kirim');
  revalidatePath('/app/pengiriman/validasi');
  revalidatePath('/app/pengiriman/buat-surat-jalan');
  revalidatePath('/app/pengiriman/riwayat');
  revalidatePath('/app', 'layout'); // tanda angka di menu
}

export async function getSelisihKirimList(): Promise<SelisihKirimRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('selisih_kirim')
    .select(`
      id, status, surat_jalan_id, qty_kirim, qty_diterima, qty, harga_satuan,
      keterangan, dijawab_at, created_at,
      sj:surat_jalan!selisih_kirim_surat_jalan_id_fkey (nomor_sj, tanggal, tanggal_validasi, klien:klien_id (nama)),
      pengganti:surat_jalan!selisih_kirim_sj_pengganti_id_fkey (id, nomor_sj),
      bundle:bundle_id (
        barcode,
        po:po_id (no_po),
        po_item:po_item_id (warna, size, produk:produk_id (model_produk:model_id (nama)))
      )
    `)
    .eq('tenant_id', TENANT_ID)
    .order('created_at', { ascending: false });

  if (error) throw new Error(`Gagal memuat selisih kirim: ${error.message}`);

  return (data ?? []).map((r: any) => {
    const sj = one(r.sj) as any;
    const b = one(r.bundle) as any;
    const pi = one(b?.po_item) as any;
    const pengganti = one(r.pengganti) as any;
    return {
      id: r.id,
      status: r.status,
      surat_jalan_id: r.surat_jalan_id,
      nomor_sj: sj?.nomor_sj ?? '-',
      tanggal_sj: sj?.tanggal ?? '',
      tanggal_validasi: sj?.tanggal_validasi ?? null,
      klien_nama: one(sj?.klien as any)?.nama ?? '-',
      barcode: b?.barcode ?? '-',
      no_po: one(b?.po as any)?.no_po ?? '-',
      model_nama: one(one(pi?.produk as any)?.model_produk as any)?.nama ?? '-',
      warna: pi?.warna ?? '',
      size: pi?.size ?? '',
      qty_kirim: Number(r.qty_kirim) || 0,
      qty_diterima: Number(r.qty_diterima) || 0,
      qty: Number(r.qty) || 0,
      harga_satuan: Number(r.harga_satuan) || 0,
      keterangan: r.keterangan,
      sj_pengganti: pengganti ? { id: pengganti.id, nomor_sj: pengganti.nomor_sj } : null,
      dijawab_at: r.dijawab_at,
      created_at: r.created_at,
    };
  });
}

/** Jumlah baris selisih yang belum dijelaskan owner — untuk tanda di menu. */
export async function getJumlahSelisihMenunggu(): Promise<number> {
  const supabase = await createClient();
  const { count, error } = await supabase
    .from('selisih_kirim')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', TENANT_ID)
    .eq('status', 'menunggu');
  if (error) return 0;
  return count ?? 0;
}

export async function jawabSelisihKirim(id: string, jawaban: JawabanSelisih, keterangan: string): Promise<void> {
  const userId = await resolveUserId();
  const supabase = await createClient();
  if (jawaban === 'hilang' && !keterangan.trim()) {
    throw new Error('Tulis keterangan kenapa barangnya hilang/rusak.');
  }
  const { error } = await supabase.rpc('jawab_selisih_kirim', {
    p_id: id,
    p_jawaban: jawaban,
    p_keterangan: keterangan.trim() || null,
    p_user_id: userId,
    p_tenant_id: TENANT_ID,
  });
  if (error) throw new Error(error.message.replace(/^\[[^\]]+\]\s*/, ''));
  revalidateSemua();
}

export async function batalJawabSelisihKirim(id: string): Promise<void> {
  const userId = await resolveUserId();
  const supabase = await createClient();
  const { error } = await supabase.rpc('batal_jawab_selisih_kirim', {
    p_id: id,
    p_user_id: userId,
    p_tenant_id: TENANT_ID,
  });
  if (error) throw new Error(error.message.replace(/^\[[^\]]+\]\s*/, ''));
  revalidateSemua();
}
