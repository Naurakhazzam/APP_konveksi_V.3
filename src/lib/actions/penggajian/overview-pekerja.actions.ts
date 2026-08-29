'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { getCurrentUserProfile } from '@/lib/auth/permissions';

const TENANT_ID = 'STX-001';

/**
 * Ringkasan upah yang MASIH TERBUKA — belum dibayar atau sedang dikerjakan.
 * Pekerja yang seluruh upahnya sudah lunas tidak muncul, karena halaman ini
 * dipakai sebagai acuan untuk melunaskan.
 */
export interface RingkasanPekerja {
  karyawan_id: string;
  nama: string;
  jabatan: string;
  /** Berapa kali menyelesaikan pekerjaan (satu bundle per tahap = satu). */
  jumlah_pekerjaan: number;
  total_pcs: number;
  total_upah: number;
  upah_lunas: number;
  upah_belum_lunas: number;
  total_potongan: number;
  /**
   * Nilai pekerjaan yang MASIH dikerjakan — dihitung dari tarif HPP, bukan
   * dari entri upah (yang baru terbentuk saat discan selesai). Sengaja
   * dipisah dari total_upah supaya kewajiban yang sudah pasti tidak
   * tercampur dengan yang belum jadi.
   */
  upah_perkiraan: number;
  jml_belum_dibayar: number;
  jml_sedang_dikerjakan: number;
  daftar_tahap: string[];
}

export interface DetailPekerjaan {
  id: string;
  tanggal: string;
  tahap: string;
  /** 'sedang_dikerjakan' berarti upahnya masih perkiraan, belum jadi kewajiban. */
  keadaan: 'belum_dibayar' | 'sedang_dikerjakan';
  tipe: string;
  status: 'belum_lunas' | 'lunas' | 'escrow' | 'cancelled';
  tanggal_bayar: string | null;
  upah: number;
  harga_per_pcs: number;
  qty: number;
  barcode: string;
  no_po: string;
  model_nama: string;
  produk_nama: string;
  warna: string;
  size: string;
  klien_nama: string;
}

/**
 * Ringkasan pekerjaan seluruh pekerja dalam satu periode — dipakai untuk
 * kartu KPI di halaman Overview Pekerja.
 */
export async function getOverviewPekerja(
  dari: string,
  sampai: string,
): Promise<RingkasanPekerja[]> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc('overview_pekerja_periode', {
    p_dari: dari,
    p_sampai: sampai,
    p_tenant_id: TENANT_ID,
  });

  if (error) throw new Error(`Gagal memuat overview pekerja: ${error.message}`);

  return ((data ?? []) as any[]).map(r => ({
    karyawan_id: r.karyawan_id,
    nama: r.nama,
    jabatan: r.jabatan,
    jumlah_pekerjaan: Number(r.jumlah_pekerjaan) || 0,
    total_pcs: Number(r.total_pcs) || 0,
    total_upah: Number(r.total_upah) || 0,
    upah_lunas: Number(r.upah_lunas) || 0,
    upah_belum_lunas: Number(r.upah_belum_lunas) || 0,
    total_potongan: Number(r.total_potongan) || 0,
    upah_perkiraan: Number(r.upah_perkiraan) || 0,
    jml_belum_dibayar: Number(r.jml_belum_dibayar) || 0,
    jml_sedang_dikerjakan: Number(r.jml_sedang_dikerjakan) || 0,
    daftar_tahap: r.daftar_tahap ?? [],
  }));
}

export interface HasilPelunasan {
  nama: string;
  jumlah_entri: number;
  total: number;
}

/**
 * Tandai seluruh upah seorang pekerja pada periode ini sebagai lunas.
 *
 * Yang masih dikerjakan TIDAK ikut — upahnya belum terbentuk, jadi belum ada
 * yang bisa dilunaskan. Sesudah ini pekerjanya hilang dari halaman, mengikuti
 * aturan "sudah lunas = tidak ditampilkan".
 */
export async function lunaskanUpahPekerja(
  karyawan_id: string,
  dari: string,
  sampai: string,
): Promise<HasilPelunasan> {
  const profile = await getCurrentUserProfile();
  if (!profile) throw new Error('Unauthorized');

  const supabase = await createClient();

  const { data, error } = await supabase.rpc('lunaskan_upah_pekerja', {
    p_karyawan_id: karyawan_id,
    p_dari: dari,
    p_sampai: sampai,
    p_user_id: profile.id,
    p_tenant_id: TENANT_ID,
  });

  if (error) throw new Error(error.message || 'Gagal melunaskan upah');

  revalidatePath('/app/penggajian/overview-pekerja');
  revalidatePath('/app/penggajian/rekap-gaji');
  revalidatePath('/app/produksi/kroscek-pekerjaan');

  const r = data as any;
  return {
    nama: r?.nama ?? '-',
    jumlah_entri: Number(r?.jumlah_entri) || 0,
    total: Number(r?.total) || 0,
  };
}

/** Rincian pekerjaan satu orang — isi jendela yang terbuka saat kartu diklik. */
export async function getDetailPekerja(
  karyawan_id: string,
  dari: string,
  sampai: string,
): Promise<DetailPekerjaan[]> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc('detail_pekerja_periode', {
    p_karyawan_id: karyawan_id,
    p_dari: dari,
    p_sampai: sampai,
    p_tenant_id: TENANT_ID,
  });

  if (error) throw new Error(`Gagal memuat rincian pekerjaan: ${error.message}`);

  return ((data ?? []) as any[]).map(r => ({
    id: r.id,
    tanggal: r.tanggal,
    tahap: r.tahap ?? '-',
    keadaan: (r.keadaan === 'sedang_dikerjakan' ? 'sedang_dikerjakan' : 'belum_dibayar') as
      DetailPekerjaan['keadaan'],
    tipe: r.tipe,
    status: r.status,
    tanggal_bayar: r.tanggal_bayar ?? null,
    upah: Number(r.upah) || 0,
    harga_per_pcs: Number(r.harga_per_pcs) || 0,
    qty: Number(r.qty) || 0,
    barcode: r.barcode,
    no_po: r.no_po,
    model_nama: r.model_nama,
    produk_nama: r.produk_nama,
    warna: r.warna,
    size: r.size,
    klien_nama: r.klien_nama,
  }));
}
