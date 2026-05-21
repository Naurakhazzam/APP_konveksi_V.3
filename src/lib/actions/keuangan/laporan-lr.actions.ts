'use server';

import { createClient } from '@/lib/supabase/server';

const TENANT_ID = 'STX-001';

// ─── TYPES ─────────────────────────────────────────────────────────────────

export interface LaporanLRBulan {
  label: string;         // "Jan 2025"
  bulan: number;
  tahun: number;
  pendapatan: number;    // dari invoice_pembayaran
  hpp: number;           // direct_bahan + direct_upah
  laba_kotor: number;    // pendapatan - hpp
  overhead: number;      // jurnal_entry jenis overhead
  biaya_ops: number;     // buku_kas tipe keluar (non-gaji)
  laba_bersih: number;   // laba_kotor - overhead - biaya_ops
  margin_pct: number;    // laba_bersih / pendapatan * 100
}

export interface LaporanLRData {
  bulan_list: LaporanLRBulan[];
  total_pendapatan: number;
  total_hpp: number;
  total_laba_kotor: number;
  total_overhead: number;
  total_biaya_ops: number;
  total_laba_bersih: number;
  margin_pct: number;
}

// ─── HELPER ────────────────────────────────────────────────────────────────

const BULAN_LABEL = [
  '', 'Jan','Feb','Mar','Apr','Mei','Jun',
  'Jul','Agt','Sep','Okt','Nov','Des'
];

// ─── MAIN FUNCTION ─────────────────────────────────────────────────────────

export async function getLaporanLR(
  tahun: number,
  bulan_dari?: number,  // optional: 1-12
  bulan_sampai?: number // optional: 1-12
): Promise<LaporanLRData> {
  const supabase = await createClient();

  const bln_dari  = bulan_dari  ?? 1;
  const bln_sampai = bulan_sampai ?? 12;

  const date_dari   = `${tahun}-${String(bln_dari).padStart(2,'0')}-01`;
  const lastDay     = new Date(tahun, bln_sampai, 0).getDate();
  const date_sampai = `${tahun}-${String(bln_sampai).padStart(2,'0')}-${String(lastDay).padStart(2,'0')}`;

  // ── Query 1: Pendapatan dari invoice_pembayaran ──────────────────────────
  const { data: pembayaranData } = await supabase
    .from('invoice_pembayaran')
    .select('jumlah, tanggal, invoice_id')
    .eq('tenant_id', TENANT_ID)
    .gte('tanggal', date_dari)
    .lte('tanggal', date_sampai);

  // ── Query 2: Jurnal entry (HPP + overhead) ───────────────────────────────
  const { data: jurnalData } = await supabase
    .from('jurnal_entry')
    .select('jenis, nominal, tanggal')
    .eq('tenant_id', TENANT_ID)
    .in('jenis', ['direct_bahan', 'direct_upah', 'overhead'])
    .gte('tanggal', date_dari)
    .lte('tanggal', date_sampai);

  // ── Query 3: Buku kas keluar (biaya operasional) ─────────────────────────
  const { data: kasData } = await supabase
    .from('buku_kas')
    .select('nominal, tanggal, kategori')
    .eq('tenant_id', TENANT_ID)
    .eq('tipe', 'keluar')
    .not('kategori', 'eq', 'Pembayaran Gaji')  // gaji masuk jurnal_entry sebagai direct_upah, exclude double-count
    .gte('tanggal', date_dari)
    .lte('tanggal', date_sampai);

  // ── Aggregate per bulan ──────────────────────────────────────────────────
  const bulanMap: Record<number, LaporanLRBulan> = {};

  function ensureBulan(bln: number) {
    if (!bulanMap[bln]) {
      bulanMap[bln] = {
        label: `${BULAN_LABEL[bln]} ${tahun}`,
        bulan: bln,
        tahun,
        pendapatan: 0,
        hpp: 0,
        laba_kotor: 0,
        overhead: 0,
        biaya_ops: 0,
        laba_bersih: 0,
        margin_pct: 0,
      };
    }
    return bulanMap[bln];
  }

  (pembayaranData ?? []).forEach((p: any) => {
    const bln = new Date(p.tanggal).getMonth() + 1;
    ensureBulan(bln).pendapatan += Number(p.jumlah);
  });

  (jurnalData ?? []).forEach((j: any) => {
    const bln = new Date(j.tanggal).getMonth() + 1;
    const row = ensureBulan(bln);
    if (j.jenis === 'direct_bahan' || j.jenis === 'direct_upah') {
      row.hpp += Number(j.nominal);
    } else if (j.jenis === 'overhead') {
      row.overhead += Number(j.nominal);
    }
  });

  (kasData ?? []).forEach((k: any) => {
    const bln = new Date(k.tanggal).getMonth() + 1;
    ensureBulan(bln).biaya_ops += Number(k.nominal);
  });

  // Hitung turunan per bulan
  Object.values(bulanMap).forEach((row) => {
    row.laba_kotor  = row.pendapatan - row.hpp;
    row.laba_bersih = row.laba_kotor - row.overhead - row.biaya_ops;
    row.margin_pct  = row.pendapatan > 0
      ? Math.round((row.laba_bersih / row.pendapatan) * 100 * 10) / 10
      : 0;
  });

  // Urutkan Jan → Des
  const bulan_list = Array.from({ length: 12 }, (_, i) => i + 1)
    .filter(bln => bln >= bln_dari && bln <= bln_sampai)
    .map(bln => bulanMap[bln] ?? {
      label: `${BULAN_LABEL[bln]} ${tahun}`,
      bulan: bln, tahun,
      pendapatan: 0, hpp: 0, laba_kotor: 0,
      overhead: 0, biaya_ops: 0, laba_bersih: 0, margin_pct: 0,
    });

  // Total tahunan
  const total_pendapatan  = bulan_list.reduce((s, b) => s + b.pendapatan, 0);
  const total_hpp         = bulan_list.reduce((s, b) => s + b.hpp, 0);
  const total_laba_kotor  = bulan_list.reduce((s, b) => s + b.laba_kotor, 0);
  const total_overhead    = bulan_list.reduce((s, b) => s + b.overhead, 0);
  const total_biaya_ops   = bulan_list.reduce((s, b) => s + b.biaya_ops, 0);
  const total_laba_bersih = bulan_list.reduce((s, b) => s + b.laba_bersih, 0);
  const margin_pct        = total_pendapatan > 0
    ? Math.round((total_laba_bersih / total_pendapatan) * 100 * 10) / 10
    : 0;

  return {
    bulan_list,
    total_pendapatan,
    total_hpp,
    total_laba_kotor,
    total_overhead,
    total_biaya_ops,
    total_laba_bersih,
    margin_pct,
  };
}
