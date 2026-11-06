'use server';

import { createClient } from '@/lib/supabase/server';
import { getCurrentUserProfile } from '@/lib/auth/permissions';

const TENANT_ID = 'STX-001';

const angkaPerTahap = (v: unknown): Record<string, number> =>
  Object.fromEntries(Object.entries((v ?? {}) as Record<string, unknown>).map(([k, n]) => [k, Number(n) || 0]));

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
  /** Jumlah pcs per tahap — jangan dijumlah lintas tahap (satu baju dihitung di tiap tahap). */
  pcs_per_tahap: Record<string, number>;
}

export interface RincianHasilKerja {
  id: string;
  /** Dipakai untuk mencetak ulang SK bundle ini langsung dari layar kroscek. */
  bundle_id: string;
  po_item_id: string;
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
    pcs_per_tahap: angkaPerTahap(r.pcs_per_tahap),
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
    bundle_id: r.bundle_id ?? '',
    po_item_id: r.po_item_id ?? '',
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

const TAHAP_LABEL_EXPORT: Record<string, string> = {
  cutting: 'Cutting',
  jahit: 'Jahit',
  lubang_kancing: 'Lubang Kancing',
  buang_benang: 'Buang Benang',
  qc: 'QC',
  steam: 'Steam',
  packing: 'Packing',
};

const TAHAP_URUTAN_EXPORT = ['cutting', 'jahit', 'lubang_kancing', 'buang_benang', 'qc', 'steam', 'packing'];

/** Bersihkan satu nilai supaya aman dipakai di CSV berdelimiter ';'. */
function selCsv(v: string | number): string {
  return String(v ?? '').replace(/[;\n\r]/g, ' ').trim();
}

/**
 * Export Kroscek Pekerjaan untuk dicocokkan dengan lapangan: satu baris per
 * pekerja + tahap + artikel (PO, model, warna, size), dengan qty-nya.
 * Sumbernya sama persis dengan layar (rincian per pekerja) dan — seperti
 * layarnya — TIDAK memuat angka rupiah.
 */
export async function getKroscekExportCSV(dari: string, sampai: string): Promise<string> {
  const profile = await getCurrentUserProfile();
  if (!profile) throw new Error('Unauthorized');

  const pekerja = await getHasilKerjaPekerja(dari, sampai);

  type Baris = {
    nama: string; jabatan: string; tahap: string; no_po: string;
    model: string; warna: string; size: string;
    bundle: Set<string>; qty_selesai: number; qty_sedang: number;
  };
  const kelompok = new Map<string, Baris>();

  for (const p of pekerja) {
    const rincian = await getRincianHasilKerja(p.karyawan_id, dari, sampai);
    for (const r of rincian) {
      const kunci = [p.karyawan_id, r.tahap, r.no_po, r.model_nama, r.warna, r.size].join('|');
      let b = kelompok.get(kunci);
      if (!b) {
        b = {
          nama: p.nama, jabatan: p.jabatan, tahap: r.tahap, no_po: r.no_po,
          model: r.model_nama, warna: r.warna, size: r.size,
          bundle: new Set(), qty_selesai: 0, qty_sedang: 0,
        };
        kelompok.set(kunci, b);
      }
      b.bundle.add(r.bundle_id || r.barcode);
      if (r.keadaan === 'sedang_dikerjakan') b.qty_sedang += r.qty; else b.qty_selesai += r.qty;
    }
  }

  const urutTahap = (t: string) => {
    const i = TAHAP_URUTAN_EXPORT.indexOf(t);
    return i < 0 ? 99 : i;
  };
  const daftar = [...kelompok.values()].sort((a, b) =>
    a.nama.localeCompare(b.nama, 'id')
    || urutTahap(a.tahap) - urutTahap(b.tahap)
    || a.no_po.localeCompare(b.no_po)
    || a.model.localeCompare(b.model, 'id')
    || a.warna.localeCompare(b.warna, 'id')
    || a.size.localeCompare(b.size, 'id'));

  const baris: string[] = [
    `Kroscek Pekerjaan;${dari} s.d. ${sampai}`,
    '',
    ['Nama', 'Jabatan', 'Tahap', 'No PO', 'Model', 'Warna', 'Size',
     'Jumlah Bundle', 'Qty Selesai', 'Qty Sedang Dikerjakan', 'Qty Total'].join(';'),
  ];

  for (const b of daftar) {
    baris.push([
      selCsv(b.nama), selCsv(b.jabatan), selCsv(TAHAP_LABEL_EXPORT[b.tahap] ?? b.tahap),
      selCsv(b.no_po), selCsv(b.model), selCsv(b.warna), selCsv(b.size),
      b.bundle.size, b.qty_selesai, b.qty_sedang, b.qty_selesai + b.qty_sedang,
    ].join(';'));
  }

  return baris.join('\n');
}
