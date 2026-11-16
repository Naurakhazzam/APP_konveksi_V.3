'use server';

import { createClient } from '@/lib/supabase/server';
import { poPeriodeBaru, TANGGAL_AWAL_PERIODE } from '@/lib/keuangan/periode-po';
import { pendapatanSjPerBulan, KATEGORI_BAYAR_KLIEN } from '@/lib/keuangan/pendapatan.server';
import { KATEGORI_SETORAN_MODAL } from './buku-kas.types';

/* eslint-disable @typescript-eslint/no-explicit-any */

const TENANT_ID = 'STX-001';

export interface LaporanLRBulan {
  label            : string;
  bulan            : number;
  tahun            : number;
  /** Nilai surat jalan (invoice netto setelah validasi & potongan reject) + Pendapatan Lain Buku Kas */
  pendapatan       : number;
  /** Bagian pendapatan dari SJ yang belum divalidasi kantor (masih pakai qty kirim) */
  pendapatan_belum_validasi: number;
  /** Uang DP/pelunasan klien yang masuk Buku Kas — info kas, tidak menambah laba */
  kas_dari_klien   : number;
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
  total_pendapatan_belum_validasi: number;
  total_kas_dari_klien    : number;
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

const keUtc = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
/** Selisih hari inklusif antara dua tanggal 'YYYY-MM-DD' */
const hariInklusif = (a: string, b: string) => Math.round((keUtc(b) - keUtc(a)) / 86_400_000) + 1;

function emptyBulan(bln: number, tahun: number): LaporanLRBulan {
  return {
    label            : BULAN_LABEL[bln] + ' ' + tahun,
    bulan            : bln,
    tahun,
    pendapatan       : 0,
    pendapatan_belum_validasi: 0,
    kas_dari_klien   : 0,
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
  /** true = hanya pendapatan/pengeluaran PO periode baru (PO-0100 ke atas) */
  hanyaPeriodeBaru = false,
): Promise<LaporanLRData> {
  const supabase = await createClient();

  const bln_dari   = bulan_dari   ?? 1;
  const bln_sampai = bulan_sampai ?? 12;

  const date_dari   = tahun + '-' + String(bln_dari).padStart(2, '0') + '-01';
  const lastDay     = new Date(tahun, bln_sampai, 0).getDate();
  const date_sampai = tahun + '-' + String(bln_sampai).padStart(2, '0') + '-' + String(lastDay).padStart(2, '0');

  // Default (periode baru): Buku Kas sebelum TANGGAL_AWAL_PERIODE diabaikan (data lama)
  const dariEfektif = hanyaPeriodeBaru && date_dari < TANGGAL_AWAL_PERIODE ? TANGGAL_AWAL_PERIODE : date_dari;

  // Uang masuk & keluar = Buku Kas saja (fitur pembayaran invoice belum dipakai; jangan dijumlah dua kali)
  const { data: kasRaw, error: kasError } = await supabase
    .from('buku_kas')
    .select('tipe, nominal, tanggal, kategori, overhead_sub_id, po:po_id(no_po)')
    .eq('tenant_id', TENANT_ID)
    .gte('tanggal', dariEfektif)
    .lte('tanggal', date_sampai);

  if (kasError) throw new Error(kasError.message);

  // Biaya tetap (kontrak sewa rumah): dialokasikan per hari, bukan saat dibayar.
  // Pembayaran Buku Kas untuk sub-kelompok berkontrak diabaikan supaya tidak terhitung dua kali.
  const { data: btRaw, error: btError } = await supabase
    .from('biaya_tetap')
    .select('nominal, tanggal_mulai, tanggal_selesai, overhead_sub_id')
    .eq('tenant_id', TENANT_ID);
  if (btError) throw new Error(btError.message);
  const btData = (btRaw ?? []) as any[];
  const subKontrak = new Set(btData.map(b => String(b.overhead_sub_id)));

  // Baris yang ditandai ke PO lama ikut disembunyikan; yang tanpa PO tetap dihitung
  const kasTanpaKontrak = (kasRaw ?? []).filter((k: any) =>
    !(k.kategori === 'Biaya Overhead' && k.overhead_sub_id && subKontrak.has(String(k.overhead_sub_id))));
  const kasData = hanyaPeriodeBaru
    ? kasTanpaKontrak.filter((k: any) => {
        const noPo = (Array.isArray(k.po) ? k.po[0]?.no_po : k.po?.no_po) as string | undefined;
        return !noPo || poPeriodeBaru(noPo);
      })
    : kasTanpaKontrak;

  const bulanMap: Record<number, LaporanLRBulan> = {};

  const ensure = (bln: number) => {
    if (!bulanMap[bln]) bulanMap[bln] = emptyBulan(bln, tahun);
    return bulanMap[bln];
  };

  kasData.forEach((k: any) => {
    const bln     = Number(String(k.tanggal).slice(5, 7));
    const row     = ensure(bln);
    const nominal = Number(k.nominal);
    if (k.tipe === 'masuk') {
      // Setoran modal pemilik bukan pendapatan; DP/pelunasan klien = pembayaran tagihan SJ
      if (k.kategori === KATEGORI_SETORAN_MODAL) return;
      if (KATEGORI_BAYAR_KLIEN.includes(k.kategori)) row.kas_dari_klien += nominal;
      else row.pendapatan += nominal;
      return;
    }
    if (k.tipe !== 'keluar') return;
    switch (k.kategori) {
      case 'Pembelian Bahan':
      case 'Bahan Pembantu':    row.pembelian_bahan   += nominal; break;
      case 'Pembayaran Gaji':   row.pembayaran_gaji   += nominal; break;
      case 'Biaya Overhead':
      case 'Biaya Peralatan':   row.biaya_overhead    += nominal; break;
      case 'Biaya Operasional': row.biaya_operasional += nominal; break;
      default:                  row.biaya_lainnya     += nominal; break;
    }
  });

  // Pendapatan dari surat jalan (invoice netto setelah validasi kirim & reject kantor)
  const sjPerBulan = await pendapatanSjPerBulan(supabase, date_dari, date_sampai, hanyaPeriodeBaru);
  sjPerBulan.forEach((p, ym) => {
    const row = ensure(Number(ym.slice(5, 7)));
    row.pendapatan += p.nilai;
    row.pendapatan_belum_validasi += p.belumValidasi;
  });

  // Sewa per bulan → Biaya Operasional. Mulai bulan awal periode (mode default), sampai bulan berjalan.
  const sekarang = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Jakarta' }).slice(0, 7);
  const blnAwalSewa = hanyaPeriodeBaru ? TANGGAL_AWAL_PERIODE.slice(0, 7) : '0000-00';
  for (let bln = bln_dari; bln <= bln_sampai; bln++) {
    const ym = tahun + '-' + String(bln).padStart(2, '0');
    if (ym < blnAwalSewa || ym > sekarang) continue;
    const awalBln  = ym + '-01';
    const akhirBln = ym + '-' + String(new Date(tahun, bln, 0).getDate()).padStart(2, '0');
    const sewa = btData.reduce((s, b) => {
      const awal  = b.tanggal_mulai > awalBln ? b.tanggal_mulai : awalBln;
      const akhir = b.tanggal_selesai < akhirBln ? b.tanggal_selesai : akhirBln;
      if (akhir < awal) return s;
      return s + Number(b.nominal) / hariInklusif(b.tanggal_mulai, b.tanggal_selesai) * hariInklusif(awal, akhir);
    }, 0);
    if (sewa > 0) ensure(bln).biaya_operasional += Math.round(sewa);
  }

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
  const total_pendapatan_belum_validasi = bulan_list.reduce((s, b) => s + b.pendapatan_belum_validasi, 0);
  const total_kas_dari_klien    = bulan_list.reduce((s, b) => s + b.kas_dari_klien, 0);
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
    total_pendapatan_belum_validasi,
    total_kas_dari_klien,
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
