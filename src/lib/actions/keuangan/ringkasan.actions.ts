'use server';

import { createClient } from '@/lib/supabase/server';
import { hitungKinerja, type KinerjaData } from '@/lib/keuangan/kinerja.server';
import { poPeriodeBaru } from '@/lib/keuangan/periode-po';
import { getLaporanPOList } from './laporan-po.actions';

export interface RingkasanKeuanganData {
  /** Angka bulan terpilih dari mesin Kinerja Keuangan (sama persis dengan menu Kinerja Keuangan) */
  kinerja: KinerjaData;
  /** PO yang biaya aktualnya melebihi patokan HPP (di luar beda tarif) */
  po_melebihi_patokan: { po_id: string; no_po: string; klien_nama: string; gap: number }[];
  /** PO rugi, atau margin aktual turun > 20% dari margin perkiraan */
  po_peringatan: {
    po_id: string; no_po: string; klien_nama: string; jenis: 'rugi' | 'turun';
    laba: number; margin_pct: number; margin_perkiraan_pct: number; turun_pct: number; sementara: boolean;
  }[];
}

/** @param bulan 'YYYY-MM'; kosong = bulan berjalan */
export async function getRingkasanKeuangan(bulan?: string): Promise<RingkasanKeuanganData> {
  const supabase = await createClient();
  const kini = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Jakarta' }).slice(0, 7);
  const [kinerja, poList] = await Promise.all([
    hitungKinerja(supabase, bulan ?? kini),
    getLaporanPOList().catch(() => []),
  ]);
  const po_melebihi_patokan = poList
    .filter(p => p.status === 'boncos' && poPeriodeBaru(p.no_po))
    .sort((a, b) => b.gap - a.gap)
    .slice(0, 5)
    .map(p => ({ po_id: p.po_id, no_po: p.no_po, klien_nama: p.klien_nama, gap: p.gap }));
  const po_peringatan = poList
    .filter(p => p.kesimpulan?.peringatan && poPeriodeBaru(p.no_po))
    .map(p => ({
      po_id: p.po_id, no_po: p.no_po, klien_nama: p.klien_nama, jenis: p.kesimpulan!.peringatan!,
      laba: p.kesimpulan!.margin_aktual, margin_pct: p.kesimpulan!.margin_aktual_pct,
      margin_perkiraan_pct: p.kesimpulan!.margin_perkiraan_pct, turun_pct: p.kesimpulan!.turun_pct,
      sementara: p.kesimpulan!.sementara,
    }))
    .sort((a, b) => (a.jenis === b.jenis ? a.laba - b.laba : a.jenis === 'rugi' ? -1 : 1));
  return { kinerja, po_melebihi_patokan, po_peringatan };
}
