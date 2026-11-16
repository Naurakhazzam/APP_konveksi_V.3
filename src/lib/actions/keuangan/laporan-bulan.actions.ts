'use server';

import { createClient } from '@/lib/supabase/server';
import { KATEGORI_SETORAN_MODAL } from './buku-kas.types';
import { PO_AWAL_PERIODE, batasAwalPeriode, rentangPeriodeBaru } from '@/lib/keuangan/periode-po';
import { getBundleIdsPeriodeBaru, getPoIdsPeriodeBaru } from '@/lib/keuangan/periode-po.server';
import { overheadPerBulan, pembantuPerBulan } from '@/lib/keuangan/biaya-bulanan.server';
import { pendapatanSjPerBulan, KATEGORI_BAYAR_KLIEN, LABEL_PENDAPATAN_SJ } from '@/lib/keuangan/pendapatan.server';

const TENANT_ID = 'STX-001';

// ─── TYPES ─────────────────────────────────────────────────────────────────

export interface LaporanBulanData {
  bulan: string;
  tahun: string;

  pemasukan: {
    kategori_nama: string;
    total: number;
  }[];
  total_pemasukan: number;

  pengeluaran: {
    jenis: 'direct_bahan' | 'direct_upah' | 'overhead';
    label: string;
    total: number;
  }[];
  total_pengeluaran: number;

  saldo: number;
  /** DP/pelunasan klien yang masuk Buku Kas bulan ini — info kas, tidak masuk pemasukan */
  kas_dari_klien: number;
  /** Bagian pemasukan Surat Jalan yang belum divalidasi kantor */
  pendapatan_belum_validasi: number;
}

const JENIS_LABEL: Record<string, string> = {
  direct_bahan: 'Pemakaian Bahan',
  direct_upah: 'Upah Produksi',
  overhead: 'Biaya Overhead',
};

// ─── FUNCTION ──────────────────────────────────────────────────────────────

export async function getLaporanBulan(
  bulan: string,
  tahun: string,
  /** true = hanya angka PO periode baru (PO-0100 ke atas); entri tanpa PO tetap dihitung */
  hanyaPeriodeBaru = false,
): Promise<LaporanBulanData> {
  const supabase = await createClient();
  const poBaru = hanyaPeriodeBaru ? await getPoIdsPeriodeBaru(supabase) : null;
  const bundleBaru = hanyaPeriodeBaru ? await getBundleIdsPeriodeBaru(supabase) : null;
  const mm = bulan.padStart(2, '0');

  const lastDay = new Date(Number(tahun), Number(mm), 0).getDate();
  const awal = `${tahun}-${mm}-01`;
  const akhir = `${tahun}-${mm}-${String(lastDay).padStart(2, '0')}`;

  // Buku kas tipe='masuk' untuk range bulan (DP klien, pelunasan, dll)
  const { data: bukuKasRaw, error: bukuKasErr } = await supabase
    .from('buku_kas')
    .select('nominal, kategori, po_id')
    .eq('tenant_id', TENANT_ID)
    .eq('tipe', 'masuk')
    .neq('kategori', KATEGORI_SETORAN_MODAL) // modal pemilik bukan pendapatan
    .gte('tanggal', hanyaPeriodeBaru ? batasAwalPeriode(`${tahun}-${mm}-01`) : `${tahun}-${mm}-01`)
    .lte('tanggal', `${tahun}-${mm}-${String(lastDay).padStart(2, '0')}`);

  if (bukuKasErr) throw new Error(bukuKasErr.message);
  const bukuKasData = poBaru
    ? (bukuKasRaw ?? []).filter((k: any) => !k.po_id || poBaru.has(String(k.po_id)))
    : (bukuKasRaw ?? []);

  // Upah bulan ini: baca dari gaji_ledger (earned, belum/sudah lunas)
  const { data: gajiLedgerRaw, error: gajiLedgerErr } = await supabase
    .from('gaji_ledger')
    .select('total, tipe, sumber_id')
    .eq('tenant_id', TENANT_ID)
    .in('status', ['belum_lunas', 'lunas'])
    // Upah PO periode baru sebelum awal periode dilaporkan di bulan awal periode
    .gte('tanggal', hanyaPeriodeBaru ? rentangPeriodeBaru(awal, akhir)[0] : `${tahun}-${mm}-01`)
    .lte('tanggal', `${tahun}-${mm}-${String(lastDay).padStart(2, '0')}`);

  if (gajiLedgerErr) throw new Error(gajiLedgerErr.message);
  const gajiLedgerData = bundleBaru
    ? (gajiLedgerRaw ?? []).filter((g: any) => bundleBaru.has(String(g.sumber_id)))
    : (gajiLedgerRaw ?? []);

  // ─── Pemasukan: group by kategori ───
  // Sama dengan Laporan Laba Rugi: pendapatan = nilai Surat Jalan (setelah validasi kirim & reject)
  // + Pendapatan Lain. DP/pelunasan klien = pembayaran tagihan → hanya info (kas_dari_klien).
  const pemasukanMap: Record<string, number> = {};
  const sjMap = await pendapatanSjPerBulan(supabase, awal, akhir, hanyaPeriodeBaru);
  const sjBulan = sjMap.get(`${tahun}-${mm}`) ?? { nilai: 0, belumValidasi: 0 };
  if (sjBulan.nilai > 0) pemasukanMap[LABEL_PENDAPATAN_SJ] = sjBulan.nilai;

  let kas_dari_klien = 0;
  (bukuKasData ?? []).forEach((k: any) => {
    const nama = (k.kategori as string) || 'Lainnya';
    if (KATEGORI_BAYAR_KLIEN.includes(nama)) { kas_dari_klien += Number(k.nominal); return; }
    pemasukanMap[nama] = (pemasukanMap[nama] || 0) + Number(k.nominal);
  });

  const pemasukan = Object.entries(pemasukanMap).map(([kategori_nama, total]) => ({
    kategori_nama,
    total,
  }));
  const total_pemasukan = pemasukan.reduce((s, p) => s + p.total, 0);

  // ─── Pengeluaran: group by jenis ───
  const pengeluaranMap: Record<string, number> = {};

  // Overhead dari Buku Kas (+ alokasi biaya tetap, Operasional, Lainnya) — jurnal_entry tidak lagi diisi
  const [ovMap, pembantuMap] = await Promise.all([
    overheadPerBulan(supabase, awal, akhir, hanyaPeriodeBaru),
    pembantuPerBulan(supabase, awal, akhir, hanyaPeriodeBaru),
  ]);
  const overhead = Math.round(ovMap.get(`${tahun}-${mm}`) ?? 0);
  if (overhead > 0) pengeluaranMap['overhead'] = overhead;

  // direct_bahan dari catatan pemakaian (kain cutting + aksesori, modal FIFO) —
  // sama dengan sumber Laporan Per PO
  const { data: bahanData, error: bahanErr } = await supabase.rpc('get_biaya_bahan_bulanan', {
    p_dari: `${tahun}-${mm}-01`,
    p_sampai: `${tahun}-${mm}-${String(lastDay).padStart(2, '0')}`,
    p_tenant_id: TENANT_ID,
    p_po_mulai: hanyaPeriodeBaru ? PO_AWAL_PERIODE : null,
  });
  if (bahanErr) throw new Error(bahanErr.message);
  const biayaBahan = (bahanData ?? []).reduce(
    (s: number, r: any) => s + Number(r.biaya_kain ?? 0) + Number(r.biaya_aksesori ?? 0), 0);
  // + belanja bahan pembantu (sistem saldo)
  const totalBahan = Math.round(biayaBahan + (pembantuMap.get(`${tahun}-${mm}`) ?? 0));
  if (totalBahan > 0) pengeluaranMap['direct_bahan'] = totalBahan;

  // Gabungkan direct_upah dari gaji_ledger (upah earned, belum/sudah lunas)
  // reject_potong = potongan (mengurangi), sama dengan Ringkasan
  const upahLedger = (gajiLedgerData ?? []).reduce(
    (s: number, r: any) => r.tipe === 'reject_potong' ? s - Number(r.total) : s + Number(r.total), 0
  );
  if (upahLedger > 0) pengeluaranMap['direct_upah'] = upahLedger;

  const pengeluaran = (['direct_bahan', 'direct_upah', 'overhead'] as const)
    .filter((jenis) => (pengeluaranMap[jenis] ?? 0) > 0)
    .map((jenis) => ({
      jenis,
      label: JENIS_LABEL[jenis] ?? jenis,
      total: pengeluaranMap[jenis] ?? 0,
    }));
  const total_pengeluaran = pengeluaran.reduce((s, p) => s + p.total, 0);

  return {
    bulan,
    tahun,
    pemasukan,
    total_pemasukan,
    pengeluaran,
    total_pengeluaran,
    saldo: total_pemasukan - total_pengeluaran,
    kas_dari_klien,
    pendapatan_belum_validasi: sjBulan.belumValidasi,
  };
}
