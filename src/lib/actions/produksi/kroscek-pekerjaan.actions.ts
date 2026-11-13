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

/**
 * Export Kroscek Pekerjaan (Excel, base64) untuk dicocokkan dengan lapangan:
 * dikelompokkan per jabatan, satu tabel per pekerja, satu baris per
 * tahap + artikel (PO, model, warna, size), dengan qty-nya.
 * Sumbernya sama persis dengan layar (rincian per pekerja) dan — seperti
 * layarnya — TIDAK memuat angka rupiah.
 */
export async function getKroscekExportExcel(dari: string, sampai: string): Promise<string> {
  const profile = await getCurrentUserProfile();
  if (!profile) throw new Error('Unauthorized');

  const pekerja = await getHasilKerjaPekerja(dari, sampai);

  const kelompok = new Map<string, BarisExport>();

  for (const p of pekerja) {
    const rincian = await getRincianHasilKerja(p.karyawan_id, dari, sampai);
    for (const r of rincian) {
      const kunci = [p.karyawan_id, r.tahap, r.no_po, r.model_nama, r.warna, r.size].join('|');
      let b = kelompok.get(kunci);
      if (!b) {
        b = {
          karyawan_id: p.karyawan_id, nama: p.nama, jabatan: p.jabatan, tahap: r.tahap, no_po: r.no_po,
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
  // Jabatan diurutkan mengikuti alur produksi: jabatan yang tahap paling
  // awalnya lebih dulu (Cutting → Jahit → ... → Packing), seri → abjad.
  const kunciJabatan = (j: string) => (j || '').trim().toLowerCase();
  const urutJabatan = new Map<string, number>();
  for (const b of kelompok.values()) {
    const k = kunciJabatan(b.jabatan);
    urutJabatan.set(k, Math.min(urutJabatan.get(k) ?? 99, urutTahap(b.tahap)));
  }

  const daftar = [...kelompok.values()].sort((a, b) =>
    (urutJabatan.get(kunciJabatan(a.jabatan))! - urutJabatan.get(kunciJabatan(b.jabatan))!)
    || kunciJabatan(a.jabatan).localeCompare(kunciJabatan(b.jabatan), 'id')
    || a.nama.localeCompare(b.nama, 'id')
    || a.karyawan_id.localeCompare(b.karyawan_id)
    || urutTahap(a.tahap) - urutTahap(b.tahap)
    || a.no_po.localeCompare(b.no_po)
    || a.model.localeCompare(b.model, 'id')
    || a.warna.localeCompare(b.warna, 'id')
    || a.size.localeCompare(b.size, 'id'));

  return buatExcelKroscek(daftar, kunciJabatan, dari, sampai);
}

type BarisExport = {
  karyawan_id: string; nama: string; jabatan: string; tahap: string; no_po: string;
  model: string; warna: string; size: string;
  bundle: Set<string>; qty_selesai: number; qty_sedang: number;
};

/**
 * Susun file Excel: satu blok per jabatan, di dalamnya satu tabel bergaris
 * per pekerja (judul nama → header kolom → baris artikel → total per tahap),
 * dengan jarak dua baris kosong antar pekerja. Dikembalikan sebagai base64
 * karena server action tidak bisa mengirim Buffer ke browser.
 */
async function buatExcelKroscek(
  daftar: BarisExport[],
  kunciJabatan: (j: string) => string,
  dari: string,
  sampai: string,
): Promise<string> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Kroscek Pekerjaan', {
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 },
  });

  const KOLOM = ['No', 'Tahap', 'No PO', 'Model', 'Warna', 'Size',
    'Jumlah Bundle', 'Qty Selesai', 'Qty Sedang Dikerjakan', 'Qty Total'];
  const N = KOLOM.length;
  ws.columns = [6, 16, 18, 28, 16, 8, 10, 12, 14, 11].map(width => ({ width }));

  const garis = { style: 'thin' as const, color: { argb: 'FF808080' } };
  const kotak = { top: garis, left: garis, bottom: garis, right: garis };
  const isi = (argb: string) => ({ type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb } });

  const tambahBarisPenuh = (teks: string, opsi: { fill: string; warnaFont: string; ukuran: number; tinggi: number }) => {
    const r = ws.addRow([teks]);
    ws.mergeCells(r.number, 1, r.number, N);
    const c = r.getCell(1);
    c.font = { bold: true, size: opsi.ukuran, color: { argb: opsi.warnaFont } };
    c.fill = isi(opsi.fill);
    c.alignment = { vertical: 'middle', indent: 1 };
    c.border = kotak;
    r.height = opsi.tinggi;
    return r;
  };

  const judul = ws.addRow([`KROSCEK PEKERJAAN  —  ${dari} s.d. ${sampai}`]);
  ws.mergeCells(judul.number, 1, judul.number, N);
  judul.getCell(1).font = { bold: true, size: 14 };
  judul.height = 22;
  ws.addRow([]);

  // Kelompokkan per jabatan → per pekerja, urutan mengikuti `daftar`.
  const blokJabatan: { jabatan: string; pekerja: { nama: string; baris: BarisExport[] }[] }[] = [];
  for (const b of daftar) {
    let jab = blokJabatan[blokJabatan.length - 1];
    if (!jab || kunciJabatan(jab.jabatan) !== kunciJabatan(b.jabatan)) {
      jab = { jabatan: b.jabatan || '-', pekerja: [] };
      blokJabatan.push(jab);
    }
    let pk = jab.pekerja[jab.pekerja.length - 1];
    if (!pk || pk.baris[0].karyawan_id !== b.karyawan_id) {
      pk = { nama: b.nama, baris: [] };
      jab.pekerja.push(pk);
    }
    pk.baris.push(b);
  }

  blokJabatan.forEach((jab, ij) => {
    if (ij > 0) { ws.addRow([]); ws.addRow([]); ws.addRow([]); }
    tambahBarisPenuh(`${jab.jabatan.toUpperCase()}  (${jab.pekerja.length} orang)`,
      { fill: 'FF1F3864', warnaFont: 'FFFFFFFF', ukuran: 13, tinggi: 22 });
    ws.addRow([]);

    jab.pekerja.forEach((pk, ip) => {
      if (ip > 0) { ws.addRow([]); ws.addRow([]); }

      tambahBarisPenuh(pk.nama, { fill: 'FFD9E1F2', warnaFont: 'FF000000', ukuran: 12, tinggi: 20 });

      const header = ws.addRow(KOLOM);
      header.eachCell(c => {
        c.font = { bold: true };
        c.fill = isi('FFF2F2F2');
        c.border = kotak;
        c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      });
      header.height = 30;

      const totalTahap = new Map<string, { bundle: number; selesai: number; sedang: number }>();
      pk.baris.forEach((b, i) => {
        const r = ws.addRow([
          i + 1, TAHAP_LABEL_EXPORT[b.tahap] ?? b.tahap, b.no_po, b.model, b.warna, b.size,
          b.bundle.size, b.qty_selesai, b.qty_sedang, b.qty_selesai + b.qty_sedang,
        ]);
        r.eachCell({ includeEmpty: true }, (c, col) => {
          c.border = kotak;
          if (col === 1 || col === 6) c.alignment = { horizontal: 'center' };
        });
        const t = totalTahap.get(b.tahap) ?? { bundle: 0, selesai: 0, sedang: 0 };
        t.bundle += b.bundle.size; t.selesai += b.qty_selesai; t.sedang += b.qty_sedang;
        totalTahap.set(b.tahap, t);
      });

      // Total dipisah per tahap — satu baju terhitung di tiap tahap, jadi
      // menjumlah lintas tahap menghasilkan angka yang tidak masuk akal.
      for (const [tahap, t] of totalTahap) {
        const label = totalTahap.size > 1 ? `TOTAL ${(TAHAP_LABEL_EXPORT[tahap] ?? tahap).toUpperCase()}` : 'TOTAL';
        const r = ws.addRow([label, '', '', '', '', '', t.bundle, t.selesai, t.sedang, t.selesai + t.sedang]);
        ws.mergeCells(r.number, 1, r.number, 6);
        r.eachCell({ includeEmpty: true }, c => {
          c.font = { bold: true };
          c.fill = isi('FFFFF2CC');
          c.border = kotak;
        });
        r.getCell(1).alignment = { horizontal: 'right' };
      }
    });
  });

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf as ArrayBuffer).toString('base64');
}
