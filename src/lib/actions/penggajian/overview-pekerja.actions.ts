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
  return String(v).replace(/[;\n\r]/g, ' ').trim();
}

/**
 * Tarik seluruh data Overview Pekerja pada satu periode jadi CSV — susunannya
 * mengikuti tampilan di layar: ringkasan per pekerja, lalu rincian
 * pekerjaannya DIKELOMPOKKAN PER TAHAP (bukan satu tabel tercampur semua
 * tahap) — supaya rincian upah finishing per-pengiriman yang bisa puluhan
 * baris per tahap tetap mudah dibaca.
 */
export async function getOverviewPekerjaExportCSV(
  dari: string,
  sampai: string,
): Promise<string> {
  const profile = await getCurrentUserProfile();
  if (!profile) throw new Error('Unauthorized');

  const ringkasan = await getOverviewPekerja(dari, sampai);

  const baris: string[] = [
    `Overview Pekerja;${dari} s.d. ${sampai}`,
    '',
  ];

  for (const p of ringkasan) {
    const rincian = await getDetailPekerja(p.karyawan_id, dari, sampai);

    baris.push(
      `Nama;${selCsv(p.nama)}`,
      `Jabatan;${selCsv(p.jabatan)}`,
      `Total Dikerjakan (pcs);${p.total_pcs}`,
      `Perlu Dibayar;${p.total_upah}`,
      `Jumlah Pekerjaan;${p.jumlah_pekerjaan}`,
      `Belum Dibayar;${p.jml_belum_dibayar}`,
      `Sedang Dikerjakan;${p.jml_sedang_dikerjakan}`,
      '',
    );

    const perTahap = new Map<string, DetailPekerjaan[]>();
    for (const r of rincian) {
      if (!perTahap.has(r.tahap)) perTahap.set(r.tahap, []);
      perTahap.get(r.tahap)!.push(r);
    }

    for (const tahap of TAHAP_URUTAN_EXPORT) {
      const grup = perTahap.get(tahap);
      if (!grup || grup.length === 0) continue;

      const qtyTahap = grup.reduce((s, r) => s + r.qty, 0);
      const upahTahap = grup.reduce((s, r) => s + r.upah, 0);

      baris.push(
        `${selCsv(TAHAP_LABEL_EXPORT[tahap] ?? tahap)};${grup.length} item;${qtyTahap} pcs;${upahTahap}`,
        'Tanggal;Artikel;Warna;Size;PO;Klien;Qty;Harga/Pcs;Upah;Status',
      );

      for (const r of grup) {
        const status = r.keadaan === 'sedang_dikerjakan' ? 'Sedang Dikerjakan' : 'Perlu Dibayar';
        baris.push([
          r.tanggal,
          selCsv(r.model_nama),
          selCsv(r.warna),
          selCsv(r.size),
          selCsv(r.no_po),
          selCsv(r.klien_nama),
          r.qty,
          r.harga_per_pcs,
          r.upah,
          status,
        ].join(';'));
      }

      baris.push('');
    }

    baris.push('');
  }

  return baris.join('\n');
}

/**
 * Tarik data Overview Pekerja jadi CSV untuk kepentingan kantor — sumbernya
 * SAMA dengan getOverviewPekerjaExportCSV (hanya yang belum lunas atau
 * sedang dikerjakan, pekerja yang sudah lunas semua tidak ikut), tapi
 * disusun ulang per TAHAP (bukan per pekerja) dan TANPA kolom nama
 * karyawan — untuk melihat total ongkos per tahap produksi minggu itu
 * tanpa perlu menampilkan siapa mengerjakan apa.
 */
export async function getExportKantorCSV(
  dari: string,
  sampai: string,
): Promise<string> {
  const profile = await getCurrentUserProfile();
  if (!profile) throw new Error('Unauthorized');

  const ringkasan = await getOverviewPekerja(dari, sampai);

  const semuaRincian: DetailPekerjaan[] = [];
  for (const p of ringkasan) {
    const rincian = await getDetailPekerja(p.karyawan_id, dari, sampai);
    semuaRincian.push(...rincian);
  }

  const perTahap = new Map<string, DetailPekerjaan[]>();
  for (const r of semuaRincian) {
    if (!perTahap.has(r.tahap)) perTahap.set(r.tahap, []);
    perTahap.get(r.tahap)!.push(r);
  }

  const baris: string[] = [
    `Export Kantor;${dari} s.d. ${sampai}`,
    '',
  ];

  for (const tahap of TAHAP_URUTAN_EXPORT) {
    const grup = perTahap.get(tahap);
    if (!grup || grup.length === 0) continue;

    const qtyTahap = grup.reduce((s, r) => s + r.qty, 0);
    const upahTahap = grup.reduce((s, r) => s + r.upah, 0);

    grup.sort((a, b) => a.tanggal.localeCompare(b.tanggal) || a.no_po.localeCompare(b.no_po));

    baris.push(
      `${selCsv(TAHAP_LABEL_EXPORT[tahap] ?? tahap)};${grup.length} item;${qtyTahap} pcs;${upahTahap}`,
      'Tanggal;Artikel;Warna;Size;PO;Klien;Qty;Harga/Pcs;Upah;Status',
    );

    for (const r of grup) {
      const status = r.keadaan === 'sedang_dikerjakan' ? 'Sedang Dikerjakan' : 'Perlu Dibayar';
      baris.push([
        r.tanggal,
        selCsv(r.model_nama),
        selCsv(r.warna),
        selCsv(r.size),
        selCsv(r.no_po),
        selCsv(r.klien_nama),
        r.qty,
        r.harga_per_pcs,
        r.upah,
        status,
      ].join(';'));
    }

    baris.push('');
  }

  return baris.join('\n');
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
