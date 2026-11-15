'use server';

import { createClient } from '@/lib/supabase/server';
import { poPeriodeBaru } from '@/lib/keuangan/periode-po';

/* eslint-disable @typescript-eslint/no-explicit-any */

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
  /** true = hanya pendapatan/pengeluaran PO periode baru (PO-0100 ke atas) */
  hanyaPeriodeBaru = false,
): Promise<LaporanLRData> {
  const supabase = await createClient();

  const bln_dari   = bulan_dari   ?? 1;
  const bln_sampai = bulan_sampai ?? 12;

  const date_dari   = tahun + '-' + String(bln_dari).padStart(2, '0') + '-01';
  const lastDay     = new Date(tahun, bln_sampai, 0).getDate();
  const date_sampai = tahun + '-' + String(bln_sampai).padStart(2, '0') + '-' + String(lastDay).padStart(2, '0');

  const { data: pembayaranData, error: pembayaranError } = await supabase
    .from('invoice_pembayaran')
    .select('jumlah, tanggal, invoice_id')
    .eq('tenant_id', TENANT_ID)
    .gte('tanggal', date_dari)
    .lte('tanggal', date_sampai);

  if (pembayaranError) throw new Error(pembayaranError.message);

  const { data: kasRaw, error: kasError } = await supabase
    .from('buku_kas')
    .select('nominal, tanggal, kategori, po:po_id(no_po)')
    .eq('tenant_id', TENANT_ID)
    .eq('tipe', 'keluar')
    .gte('tanggal', date_dari)
    .lte('tanggal', date_sampai);

  if (kasError) throw new Error(kasError.message);

  // Pengeluaran yang ditandai ke PO lama ikut disembunyikan; yang tanpa PO tetap dihitung
  const kasData = hanyaPeriodeBaru
    ? (kasRaw ?? []).filter((k: any) => {
        const noPo = (Array.isArray(k.po) ? k.po[0]?.no_po : k.po?.no_po) as string | undefined;
        return !noPo || poPeriodeBaru(noPo);
      })
    : (kasRaw ?? []);

  // Porsi pendapatan PO periode baru per invoice = nilai barang PO-0100+ ÷ nilai seluruh barang di surat jalannya
  const porsiInvoice = new Map<string, number>();
  if (hanyaPeriodeBaru) {
    const invoiceIds = [...new Set((pembayaranData ?? []).map((p: any) => p.invoice_id).filter(Boolean))] as string[];
    if (invoiceIds.length) {
      const { data: invData, error: invErr } = await supabase
        .from('invoice').select('id, surat_jalan_id').in('id', invoiceIds);
      if (invErr) throw new Error(invErr.message);
      const sjIds = [...new Set((invData ?? []).map((i: any) => i.surat_jalan_id).filter(Boolean))] as string[];
      const nilaiSj = new Map<string, { baru: number; semua: number }>();
      if (sjIds.length) {
        const { data: sjItems, error: sjErr } = await supabase
          .from('surat_jalan_item')
          .select('sj_id, qty_kirim, bundle:bundle_id(po_item:po_item_id(po:po_id(no_po), produk:produk_id(harga_jual)))')
          .in('sj_id', sjIds);
        if (sjErr) throw new Error(sjErr.message);
        (sjItems ?? []).forEach((it: any) => {
          const bundle = Array.isArray(it.bundle) ? it.bundle[0] : it.bundle;
          const pi     = Array.isArray(bundle?.po_item) ? bundle.po_item[0] : bundle?.po_item;
          const po     = Array.isArray(pi?.po) ? pi.po[0] : pi?.po;
          const produk = Array.isArray(pi?.produk) ? pi.produk[0] : pi?.produk;
          const nilai  = Number(it.qty_kirim ?? 0) * Number(produk?.harga_jual ?? 0);
          const cur    = nilaiSj.get(it.sj_id) ?? { baru: 0, semua: 0 };
          cur.semua += nilai;
          if (poPeriodeBaru(po?.no_po)) cur.baru += nilai;
          nilaiSj.set(it.sj_id, cur);
        });
      }
      (invData ?? []).forEach((i: any) => {
        const n = nilaiSj.get(i.surat_jalan_id);
        // Invoice tanpa surat jalan / tanpa nilai: tidak bisa ditelusuri ke PO → tetap dihitung
        porsiInvoice.set(i.id, n && n.semua > 0 ? n.baru / n.semua : 1);
      });
    }
  }

  const bulanMap: Record<number, LaporanLRBulan> = {};

  const ensure = (bln: number) => {
    if (!bulanMap[bln]) bulanMap[bln] = emptyBulan(bln, tahun);
    return bulanMap[bln];
  };

  (pembayaranData ?? []).forEach((p: any) => {
    const bln = new Date(p.tanggal).getMonth() + 1;
    const porsi = hanyaPeriodeBaru ? (porsiInvoice.get(p.invoice_id) ?? 1) : 1;
    ensure(bln).pendapatan += Math.round(Number(p.jumlah) * porsi);
  });

  kasData.forEach((k: any) => {
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
