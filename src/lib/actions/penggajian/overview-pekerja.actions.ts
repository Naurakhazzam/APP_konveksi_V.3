'use server';

import { createClient } from '@/lib/supabase/server';

const TENANT_ID = 'STX-001';

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
  daftar_tahap: string[];
}

export interface DetailPekerjaan {
  id: string;
  tanggal: string;
  tahap: string;
  tipe: string;
  status: 'belum_lunas' | 'lunas' | 'escrow' | 'cancelled';
  tanggal_bayar: string | null;
  upah: number;
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
    daftar_tahap: r.daftar_tahap ?? [],
  }));
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
    tipe: r.tipe,
    status: r.status,
    tanggal_bayar: r.tanggal_bayar ?? null,
    upah: Number(r.upah) || 0,
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
