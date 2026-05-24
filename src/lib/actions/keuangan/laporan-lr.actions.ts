'use server';

import { createClient } from '@/lib/supabase/server';

const TENANT_ID = 'STX-001';

export interface LaporanLRBulan {
  label            : string;
  bulan            : number;
  tahun            : number;
  pendapatan       : number;
  pembelian_bahan  : number;
  pembayaran_gaji  : number;
  biaya_overhead   : number;
  biaya_operasional: number;
  biaya_lainnya    : number;
  total_pengeluaran: number;
  laba_bersih      : number;
  margin_pct       : number;
}

export interface LaporanLRData {
  bulan_list              : LaporanLRBulan[];
  total_pendapatan        : number;
  total_pembelian_bahan   : number;
  total_pembayaran_gaji   : number;
  total_biaya_overhead    : number;
  total_biaya_operasional : number;
  total_biaya_lainnya     : number;
  total_pengeluaran       : number;
  total_laba_bersih       : number;
  margin_pct              : number;
}

const BULAN_LABEL = [
  '', 'Jan','Feb','Mar','Apr','Mei','Jun',
  'Jul','Agt','Sep','Okt','Nov','Des',
];

function emptyBulan(bln: number, tahun: number): LaporanLRBulan {
  return {
    label            : BULAN_LABEL[bln] + ' ' + tahun,
    bulan            : bln,
    tahun,
    pendapatan       : 0,
    pembelian_bahan  : 0,
    pembayaran_gaji  : 0,
    biaya_overhead   : 0,
    biaya_operasional: 0,
    biaya_lainnya    : 0,
    total_pengeluaran: 0,
    laba_bersih      : 0,
    margin_pct       : 0,
  };
}

export async function getLaporanLR(
  tahun       : number,
  bulan_dari  ?: number,
  bulan_sampai?: number,
): Promise<LaporanLRData> {
  const supabase = await createClient();

  const bln_dari   = bulan_dari   ?? 1;
  const bln_sampai = bulan_sampai ?? 12;

  const date_dari   = tahun + '-' + String(bln_dari).padStart(2, '0') + '-01';
  const lastDay     = new Date(tahun, bln_sampai, 0).getDate();
  const date_sampai = tahun + '-' + String(bln_sampai).padStart(2, '0') + '-' + String(lastDay).padStart(2, '0');

  const { data: pembayaranData, error: pembayaranError } = await supabase
    .from('invoice_pembayaran')
    .select('jumlah, tanggal')
    .eq('tenant_id', TENANT_ID)
    .gte('tanggal', date_dari)
    .lte('tanggal', date_sampai);

  if (pembayaranError) throw new Error(pembayaranError.message);

  const { data: kasData, error: kasError } = await supabase
    .from('buku_kas')
    .select('nominal, tanggal, kategori')
    .eq('tenant_id', TENANT_ID)
    .eq('tipe', 'keluar')
    .gte('tanggal', date_dari)
    .lte('tanggal', date_sampai);

  if (kasError) throw new Error(kasError.message);

  const bulanMap: Record<number, LaporanLRBulan> = {};

  const ensure = (bln: number) => {
    if (!bulanMap[bln]) bulanMap[bln] = emptyBulan(bln, tahun);
    return bulanMap[bln];
  };

  (pembayaranData ?? []).forEach((p: any) => {
    const bln = new Date(p.tanggal).getMonth() + 1;
    ensure(bln).pendapatan += Number(p.jumlah);
  });

  (kasData ?? []).forEach((k: any) => {
    const bln     = new Date(k.tanggal).getMonth() + 1;
    const row     = ensure(bln);
    const nominal = Number(k.nominal);
    switch (k.kategori) {
      case 'Pembelian Bahan':   row.pembelian_bahan   += nominal; break;
      case 'Pembayaran Gaji':   row.pembayaran_gaji   += nominal; break;
      case 'Biaya Overhead':    row.biaya_overhead    += nominal; break;
      case 'Biaya Operasional': row.biaya_operasional += nominal; break;
      default:                  row.biaya_lainnya     += nominal; break;
    }
  });

  Object.values(bulanMap).forEach((row) => {
    row.total_pengeluaran =
      row.pembelian_bahan +
      row.pembayaran_gaji +
      row.biaya_overhead  +
      row.biaya_operasional +
      row.biaya_lainnya;
    row.laba_bersih = row.pendapatan - row.total_pengeluaran;
    row.margin_pct  = row.pendapatan > 0
      ? Math.round((row.laba_bersih / row.pendapatan) * 100 * 10) / 10
      : 0;
  });

  const bulan_list = Array.from({ length: 12 }, (_, i) => i + 1)
    .filter(bln => bln >= bln_dari && bln <= bln_sampai)
    .map(bln => bulanMap[bln] ?? emptyBulan(bln, tahun));

  const total_pendapatan        = bulan_list.reduce((s, b) => s + b.pendapatan, 0);
  const total_pembelian_bahan   = bulan_list.reduce((s, b) => s + b.pembelian_bahan, 0);
  const total_pembayaran_gaji   = bulan_list.reduce((s, b) => s + b.pembayaran_gaji, 0);
  const total_biaya_overhead    = bulan_list.reduce((s, b) => s + b.biaya_overhead, 0);
  const total_biaya_operasional = bulan_list.reduce((s, b) => s + b.biaya_operasional, 0);
  const total_biaya_lainnya     = bulan_list.reduce((s, b) => s + b.biaya_lainnya, 0);
  const total_pengeluaran       = bulan_list.reduce((s, b) => s + b.total_pengeluaran, 0);
  const total_laba_bersih       = total_pendapatan - total_pengeluaran;
  const margin_pct              = total_pendapatan > 0
    ? Math.round((total_laba_bersih / total_pendapatan) * 100 * 10) / 10
    : 0;

  return {
    bulan_list,
    total_pendapatan,
    total_pembelian_bahan,
    total_pembayaran_gaji,
    total_biaya_overhead,
    total_biaya_operasional,
    total_biaya_lainnya,
    total_pengeluaran,
    total_laba_bersih,
    margin_pct,
  };
}
