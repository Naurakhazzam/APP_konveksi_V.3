/* eslint-disable @typescript-eslint/no-explicit-any */
import { batasAwalPeriode } from './periode-po';
import { getBundleIdsPeriodeBaru } from './periode-po.server';

type Supa = { rpc: (fn: string, args: Record<string, unknown>) => any; from: (t: string) => any };

const TENANT_ID = 'STX-001';

/**
 * Uang dari klien (DP/pelunasan) = pembayaran tagihan, BUKAN pendapatan.
 * Pendapatan diakui dari Surat Jalan (lihat pendapatanSjPerBulan).
 */
export const KATEGORI_BAYAR_KLIEN = ['DP Klien', 'Pelunasan Klien'];

export const LABEL_PENDAPATAN_SJ = 'Penjualan (Surat Jalan)';

export interface PendapatanBulan {
  /** Invoice netto (setelah validasi kirim & potongan reject kantor) */
  nilai: number;
  /** Bagian nilai dari SJ yang belum divalidasi kantor (masih pakai qty kirim) */
  belumValidasi: number;
}

/**
 * Pendapatan per bulan ('YYYY-MM') dari Surat Jalan: invoice otomatis (qty kirim × harga jual saat
 * SJ dibuat), dikoreksi saat Validasi Kirim (qty diterima, qty lebih disetujui) dan dipotong reject
 * kantor. Dicatat di bulan tanggal invoice (= tanggal SJ). Satu sumber untuk Laba Rugi, Ringkasan,
 * Laporan Bulan & Proyeksi Surplus.
 * Periode baru: hanya porsi barang bundle PO periode baru, dan invoice mulai TANGGAL_AWAL_PERIODE.
 */
export async function pendapatanSjPerBulan(
  supabase: Supa, dari: string, sampai: string, hanyaPeriodeBaru: boolean,
): Promise<Map<string, PendapatanBulan>> {
  const dariEfektif = hanyaPeriodeBaru ? batasAwalPeriode(dari) : dari;
  const hasil = new Map<string, PendapatanBulan>();
  if (dariEfektif > sampai) return hasil;

  const { data: invRaw, error: invErr } = await supabase
    .from('invoice')
    .select('id, tanggal, total_nilai, potongan_reject, surat_jalan_id, surat_jalan:surat_jalan_id(tanggal_validasi)')
    .eq('tenant_id', TENANT_ID)
    .gte('tanggal', dariEfektif)
    .lte('tanggal', sampai);
  if (invErr) throw new Error(invErr.message);
  const invData = (invRaw ?? []) as any[];

  // Porsi PO periode baru per SJ = nilai barang bundle periode baru ÷ nilai seluruh barang SJ
  const porsiSj = new Map<string, number>();
  if (hanyaPeriodeBaru) {
    const sjIds = [...new Set(invData.map(i => i.surat_jalan_id).filter(Boolean))] as string[];
    if (sjIds.length) {
      const bundleBaru = await getBundleIdsPeriodeBaru(supabase);
      const { data: sjItems, error: sjErr } = await supabase
        .from('surat_jalan_item')
        .select('sj_id, bundle_id, qty_kirim, qty_diterima, harga_satuan')
        .in('sj_id', sjIds);
      if (sjErr) throw new Error(sjErr.message);
      const nilai = new Map<string, { baru: number; semua: number }>();
      ((sjItems ?? []) as any[]).forEach(it => {
        const kirim = Number(it.qty_kirim ?? 0);
        const akui  = it.qty_diterima == null ? kirim : Math.min(Number(it.qty_diterima), kirim);
        const v     = akui * Number(it.harga_satuan ?? 0);
        const cur   = nilai.get(it.sj_id) ?? { baru: 0, semua: 0 };
        cur.semua += v;
        if (bundleBaru.has(String(it.bundle_id))) cur.baru += v;
        nilai.set(it.sj_id, cur);
      });
      nilai.forEach((n, id) => porsiSj.set(id, n.semua > 0 ? n.baru / n.semua : 0));
    }
  }

  invData.forEach(i => {
    const netto = Math.max(0, Number(i.total_nilai ?? 0) - Number(i.potongan_reject ?? 0));
    const porsi = hanyaPeriodeBaru ? (porsiSj.get(i.surat_jalan_id) ?? 0) : 1;
    const v = Math.round(netto * porsi);
    if (!v) return;
    const bulan = String(i.tanggal).slice(0, 7);
    const cur = hasil.get(bulan) ?? { nilai: 0, belumValidasi: 0 };
    cur.nilai += v;
    const sj = Array.isArray(i.surat_jalan) ? i.surat_jalan[0] : i.surat_jalan;
    if (!sj?.tanggal_validasi) cur.belumValidasi += v;
    hasil.set(bulan, cur);
  });
  return hasil;
}
