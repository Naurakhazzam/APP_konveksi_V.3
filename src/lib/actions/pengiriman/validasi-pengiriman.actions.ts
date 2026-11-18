'use server';

import { createClient } from '@/lib/supabase/server';
import { getUserFromClaims } from '@/lib/auth/session';
import { revalidatePath } from 'next/cache';
import bcrypt from 'bcryptjs';

const TENANT_ID = 'STX-001';
const REVALIDATE_PATH = '/app/pengiriman/validasi';

// ─── Helper ───────────────────────────────────────────────────────────────────

async function resolveUserId(): Promise<string> {
  const supabase = await createClient();
  const { data: { user }, error } = await getUserFromClaims(supabase);
  if (error || !user) throw new Error('Sesi Anda sudah habis, silakan login ulang.');
  return user.id;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SuratJalanItemValidasi {
  surat_jalan_item_id: string;
  bundle_id: string;
  barcode: string;
  no_po: string;
  model_nama: string | null;
  warna: string;
  size: string;
  qty_kirim: number;
  qty_diterima: number | null;  // null = belum divalidasi
  harga_satuan: number;         // dari po_item.harga_satuan
  /** Hanya untuk SJ kirim ulang: nomor reject & SJ asal yang dikirim ulang. */
  nomor_reject?: string;
  nomor_sj_asal?: string;
}

export interface SuratJalanSiapValidasi {
  id: string;
  nomor_sj: string;
  tanggal: string;
  klien_nama: string;
  total_bundle: number;
  total_qty_kirim: number;
  status: string;
  /** 'kirim_ulang' = kiriman ulang barang reject (isi = kirim_ulang_item). */
  jenis: 'normal' | 'kirim_ulang';
  items: SuratJalanItemValidasi[];
}

export interface ValidasiItemInput {
  surat_jalan_item_id: string;
  qty_diterima: number;
  /** Pcs yang sampai tapi cacat → diretur ke konveksi (memotong tagihan). */
  qty_reject?: number;
  reject_alasan_id?: string | null;
  reject_keterangan?: string | null;
}

export interface ValidasiResult {
  status: string;
  has_kurang: boolean;
  has_lebih: boolean;
  approval_ids: string[];
}

// ─── 1. getSuratJalanSiapValidasi ─────────────────────────────────────────────

/**
 * Fetch semua SJ yang belum tervalidasi (status: dikirim / selisih_lebih / final belum divalidasi).
 * SJ selisih_kurang tidak lagi di sini — kekurangannya menunggu penjelasan owner
 * di menu Selisih Kirim (jawaban "salah hitung" mengembalikan SJ ke status dikirim).
 * Join ke surat_jalan_item → bundle → po_item untuk ambil harga_satuan.
 */
export async function getSuratJalanSiapValidasi(): Promise<SuratJalanSiapValidasi[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('surat_jalan')
    .select(`
      id,
      nomor_sj,
      tanggal,
      status,
      jenis,
      tanggal_validasi,
      klien:klien_id (nama),
      kirim_ulang_item (
        id,
        qty,
        qty_diterima,
        urutan,
        reject_kantor:reject_kantor_id (
          nomor_reject,
          surat_jalan:surat_jalan_id (nomor_sj),
          produk:produk_id (nama),
          bundle:bundle_id (barcode, po:po_id (no_po), po_item:po_item_id (warna, size))
        )
      ),
      surat_jalan_item (
        id,
        qty_kirim,
        qty_diterima,
        urutan,
        bundle:bundle_id (
          id,
          barcode,
          po:po_id (no_po),
          po_item:po_item_id (
            hpp_estimasi,
            warna,
            size,
            produk:produk_id (
              model_produk:model_id (nama)
            )
          )
        )
      )
    `)
    .eq('tenant_id', TENANT_ID)
    .or('status.in.(dikirim,selisih_lebih),and(status.eq.final,tanggal_validasi.is.null)')
    .order('tanggal', { ascending: false });

  if (error) throw new Error(`Gagal memuat SJ siap validasi: ${error.message}`);

  return (data ?? []).map((sj: any) => {
    const jenis: 'normal' | 'kirim_ulang' = sj.jenis === 'kirim_ulang' ? 'kirim_ulang' : 'normal';

    // Samakan urutannya dengan surat jalan yang dicetak, supaya petugas
    // validasi mencocokkan baris demi baris tanpa perlu mencari-cari.
    const items: SuratJalanItemValidasi[] = jenis === 'kirim_ulang'
      ? [...(sj.kirim_ulang_item ?? [])]
          .sort((a: any, b: any) => (a.urutan ?? 0) - (b.urutan ?? 0))
          .map((it: any) => {
            const rk = it.reject_kantor;
            return {
              surat_jalan_item_id: it.id,
              bundle_id: '',
              barcode: rk?.bundle?.barcode ?? '-',
              no_po: rk?.bundle?.po?.no_po ?? '-',
              model_nama: rk?.produk?.nama ?? null,
              warna: rk?.bundle?.po_item?.warna ?? '',
              size: rk?.bundle?.po_item?.size ?? '',
              qty_kirim: it.qty ?? 0,
              qty_diterima: it.qty_diterima ?? null,
              harga_satuan: 0,
              nomor_reject: rk?.nomor_reject ?? '-',
              nomor_sj_asal: rk?.surat_jalan?.nomor_sj ?? '-',
            };
          })
      : [...(sj.surat_jalan_item ?? [])]
      .sort((a: any, b: any) => (a.urutan ?? 0) - (b.urutan ?? 0))
      .map((it: any) => {
      const b = it.bundle;
      return {
        surat_jalan_item_id: it.id,
        bundle_id: b?.id ?? '',
        barcode: b?.barcode ?? '-',
        no_po: b?.po?.no_po ?? '-',
        model_nama: b?.po_item?.produk?.model_produk?.nama ?? null,
        warna: b?.po_item?.warna ?? '-',
        size: b?.po_item?.size ?? '-',
        qty_kirim: it.qty_kirim ?? 0,
        qty_diterima: it.qty_diterima ?? null,
        harga_satuan: b?.po_item?.hpp_estimasi ?? 0,
      };
    });

    const total_qty_kirim = items.reduce((s, it) => s + it.qty_kirim, 0);

    return {
      id: sj.id,
      nomor_sj: sj.nomor_sj,
      tanggal: sj.tanggal,
      status: sj.status,
      jenis,
      klien_nama: sj.klien?.nama ?? 'Unknown',
      total_bundle: items.length,
      total_qty_kirim,
      items,
    };
  });
}

// ─── 2. submitValidasiPengiriman ──────────────────────────────────────────────

/**
 * Submit hasil validasi (qty_diterima per item).
 * Memanggil RPC validasi_pengiriman di DB.
 * Return: { status, has_kurang, has_lebih, approval_ids }
 */
export async function submitValidasiPengiriman(
  surat_jalan_id: string,
  items: ValidasiItemInput[],
  catatan: string,
): Promise<ValidasiResult> {
  const userId = await resolveUserId();
  const supabase = await createClient();

  const { data, error } = await supabase.rpc('validasi_pengiriman', {
    p_surat_jalan_id: surat_jalan_id,
    p_items: items,
    p_catatan: catatan || null,
    p_user_id: userId,
    p_tenant_id: TENANT_ID,
  });

  if (error) throw new Error(`Gagal submit validasi: ${error.message}`);

  revalidatePath(REVALIDATE_PATH);
  revalidatePath('/app/pengiriman/riwayat');
  revalidatePath('/app/pengiriman/reject-kantor');
  revalidatePath('/app/pengiriman/selisih-kirim');
  revalidatePath('/app/keuangan/invoice');

  return data as ValidasiResult;
}

// ─── 2b. submitValidasiKirimUlang ─────────────────────────────────────────────

/** Validasi SJ kirim ulang (barang reject yang sudah diperbaiki). */
export async function submitValidasiKirimUlang(
  surat_jalan_id: string,
  items: { kirim_ulang_item_id: string; qty_diterima: number }[],
  catatan: string,
): Promise<ValidasiResult> {
  const userId = await resolveUserId();
  const supabase = await createClient();

  const { data, error } = await supabase.rpc('validasi_kirim_ulang', {
    p_surat_jalan_id: surat_jalan_id,
    p_items: items,
    p_catatan: catatan || null,
    p_user_id: userId,
    p_tenant_id: TENANT_ID,
  });

  if (error) throw new Error(`Gagal submit validasi: ${error.message}`);

  revalidatePath(REVALIDATE_PATH);
  revalidatePath('/app/pengiriman/riwayat');
  revalidatePath('/app/pengiriman/reject-kantor');
  revalidatePath('/app/keuangan/invoice');

  return data as ValidasiResult;
}

// ─── 3. approveQtyLebihPengiriman ─────────────────────────────────────────────

/**
 * Verifikasi PIN owner via bcrypt, kemudian panggil RPC approve_qty_lebih_pengiriman.
 * Pola identik dengan resolveQtyApproval di qty-approval.actions.ts.
 */
export async function approveQtyLebihPengiriman(
  approval_id: string,
  pin: string,
  action: 'approved' | 'rejected' = 'approved',
  catatan?: string,
): Promise<{ status: string }> {
  const userId = await resolveUserId();
  const supabase = await createClient();

  // 1. Fetch approval_pin dari user_profile
  const { data: profile, error: profileErr } = await supabase
    .from('user_profile')
    .select('approval_pin')
    .eq('id', userId)
    .maybeSingle();

  if (profileErr) throw new Error(profileErr.message);
  if (!profile?.approval_pin) {
    throw new Error('PIN belum diset. Setup PIN terlebih dahulu di Settings.');
  }

  // 2. Verifikasi PIN dengan bcrypt
  const isPinValid = await bcrypt.compare(pin, profile.approval_pin);
  if (!isPinValid) throw new Error('PIN tidak valid');

  // 3. Jalankan RPC approve_qty_lebih_pengiriman
  const { data, error } = await supabase.rpc('approve_qty_lebih_pengiriman', {
    p_approval_id: approval_id,
    p_catatan: action === 'approved' ? (catatan ?? '') : 'Ditolak',
    p_user_id: userId,
    p_tenant_id: TENANT_ID,
  });

  if (error) throw new Error(`Gagal approve: ${error.message}`);

  revalidatePath(REVALIDATE_PATH);

  return data as { status: string };
}
