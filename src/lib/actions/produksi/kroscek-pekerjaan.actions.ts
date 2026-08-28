'use server';

import { createClient } from '@/lib/supabase/server';

const TENANT_ID = 'STX-001';

/**
 * Ringkasan hasil kerja tanpa angka rupiah — untuk kroscek lapangan vs sistem
 * oleh tim produksi.
 *
 * Angka upah sengaja DIBUANG di server, bukan sekadar tidak ditampilkan di
 * layar. Kalau hanya disembunyikan lewat CSS atau tidak dirender, nilainya
 * tetap ikut terkirim ke browser dan bisa dibaca siapa pun yang membuka
 * panel jaringan. Yang tidak pernah dikirim tidak bisa dibocorkan.
 *
 * Isinya hanya pekerjaan yang MASIH TERBUKA: selesai tapi upahnya belum
 * dibayar, atau sedang dikerjakan. Pekerjaan yang sudah lunas tidak ada lagi
 * yang perlu dicocokkan ke lapangan, jadi pekerja yang seluruh pekerjaannya
 * sudah lunas otomatis tidak muncul.
 */
export type KeadaanKerja = 'belum_dibayar' | 'sedang_dikerjakan';

export interface HasilKerjaPekerja {
  karyawan_id: string;
  nama: string;
  jabatan: string;
  jumlah_pekerjaan: number;
  total_pcs: number;
  jml_belum_dibayar: number;
  jml_sedang_dikerjakan: number;
  daftar_tahap: string[];
}

export interface RincianHasilKerja {
  id: string;
  tanggal: string;
  tahap: string;
  keadaan: KeadaanKerja;
  qty: number;
  barcode: string;
  no_po: string;
  model_nama: string;
  warna: string;
  size: string;
  klien_nama: string;
}

export async function getHasilKerjaPekerja(
  dari: string,
  sampai: string,
): Promise<HasilKerjaPekerja[]> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc('kroscek_pekerja_periode', {
    p_dari: dari,
    p_sampai: sampai,
    p_tenant_id: TENANT_ID,
  });

  if (error) throw new Error(`Gagal memuat hasil kerja: ${error.message}`);

  return ((data ?? []) as any[]).map(r => ({
    karyawan_id: r.karyawan_id,
    nama: r.nama,
    jabatan: r.jabatan,
    jumlah_pekerjaan: Number(r.jumlah_pekerjaan) || 0,
    total_pcs: Number(r.total_pcs) || 0,
    jml_belum_dibayar: Number(r.jml_belum_dibayar) || 0,
    jml_sedang_dikerjakan: Number(r.jml_sedang_dikerjakan) || 0,
    daftar_tahap: r.daftar_tahap ?? [],
  }));
}

export async function getRincianHasilKerja(
  karyawan_id: string,
  dari: string,
  sampai: string,
): Promise<RincianHasilKerja[]> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc('kroscek_detail_pekerja', {
    p_karyawan_id: karyawan_id,
    p_dari: dari,
    p_sampai: sampai,
    p_tenant_id: TENANT_ID,
  });

  if (error) throw new Error(`Gagal memuat rincian hasil kerja: ${error.message}`);

  return ((data ?? []) as any[]).map(r => ({
    id: r.id,
    tanggal: r.tanggal,
    tahap: r.tahap ?? '-',
    keadaan: (r.keadaan === 'sedang_dikerjakan' ? 'sedang_dikerjakan' : 'belum_dibayar') as KeadaanKerja,
    qty: Number(r.qty) || 0,
    barcode: r.barcode,
    no_po: r.no_po,
    model_nama: r.model_nama,
    warna: r.warna,
    size: r.size,
    klien_nama: r.klien_nama,
  }));
}
