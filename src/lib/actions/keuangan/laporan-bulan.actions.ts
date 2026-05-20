'use server';

import { createClient } from '@/lib/supabase/server';

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
}

const JENIS_LABEL: Record<string, string> = {
  direct_bahan: 'Pembelian Bahan',
  direct_upah: 'Upah Produksi',
  overhead: 'Biaya Overhead',
};

// ─── FUNCTION ──────────────────────────────────────────────────────────────

export async function getLaporanBulan(
  bulan: string,
  tahun: string
): Promise<LaporanBulanData> {
  const supabase = await createClient();
  const mm = bulan.padStart(2, '0');

  const lastDay = new Date(Number(tahun), Number(mm), 0).getDate();
  const { data: jurnalData, error } = await supabase
    .from('jurnal_entry')
    .select(`
      jenis, nominal,
      kategori_trx:kategori_trx_id(nama)
    `)
    .eq('tenant_id', TENANT_ID)
    .gte('tanggal', `${tahun}-${mm}-01`)
    .lte('tanggal', `${tahun}-${mm}-${String(lastDay).padStart(2, '0')}`);

  if (error) throw new Error(error.message);

  // Buku kas tipe='masuk' untuk range bulan (DP klien, pelunasan, dll)
  const { data: bukuKasData, error: bukuKasErr } = await supabase
    .from('buku_kas')
    .select('nominal, kategori')
    .eq('tenant_id', TENANT_ID)
    .eq('tipe', 'masuk')
    .gte('tanggal', `${tahun}-${mm}-01`)
    .lte('tanggal', `${tahun}-${mm}-${String(lastDay).padStart(2, '0')}`);

  if (bukuKasErr) throw new Error(bukuKasErr.message);

  // Upah bulan ini: baca dari gaji_ledger (earned, belum/sudah lunas)
  const { data: gajiLedgerData, error: gajiLedgerErr } = await supabase
    .from('gaji_ledger')
    .select('total')
    .eq('tenant_id', TENANT_ID)
    .in('status', ['belum_lunas', 'lunas'])
    .gte('tanggal', `${tahun}-${mm}-01`)
    .lte('tanggal', `${tahun}-${mm}-${String(lastDay).padStart(2, '0')}`);

  if (gajiLedgerErr) throw new Error(gajiLedgerErr.message);

  // ─── Pemasukan: group by kategori ───
  const pemasukanMap: Record<string, number> = {};

  // Fallback: pemasukan manual dari jurnal_entry jenis='masuk'
  (jurnalData ?? []).forEach((j: any) => {
    if (j.jenis !== 'masuk') return;
    const nama = (j.kategori_trx as any)?.nama ?? 'Lainnya';
    pemasukanMap[nama] = (pemasukanMap[nama] || 0) + Number(j.nominal);
  });

  // Gabungkan pemasukan dari buku_kas
  (bukuKasData ?? []).forEach((k: any) => {
    const nama = (k.kategori as string) || 'Lainnya';
    pemasukanMap[nama] = (pemasukanMap[nama] || 0) + Number(k.nominal);
  });

  const pemasukan = Object.entries(pemasukanMap).map(([kategori_nama, total]) => ({
    kategori_nama,
    total,
  }));
  const total_pemasukan = pemasukan.reduce((s, p) => s + p.total, 0);

  // ─── Pengeluaran: group by jenis ───
  const pengeluaranMap: Record<string, number> = {};

  // Fallback: direct_bahan, direct_upah, overhead dari jurnal_entry
  (jurnalData ?? []).forEach((j: any) => {
    if (!['direct_bahan', 'direct_upah', 'overhead'].includes(j.jenis)) return;
    pengeluaranMap[j.jenis] = (pengeluaranMap[j.jenis] || 0) + Number(j.nominal);
  });

  // Gabungkan direct_upah dari gaji_ledger (upah earned, belum/sudah lunas)
  const upahLedger = (gajiLedgerData ?? []).reduce(
    (s: number, r: any) => s + Math.abs(Number(r.total)), 0
  );
  if (upahLedger > 0) {
    pengeluaranMap['direct_upah'] = (pengeluaranMap['direct_upah'] || 0) + upahLedger;
  }

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
  };
}
