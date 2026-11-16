'use server';

import { createClient } from '@/lib/supabase/server';
import { hitungKinerja, type KinerjaData } from '@/lib/keuangan/kinerja.server';
import { poPeriodeBaru } from '@/lib/keuangan/periode-po';
import { getLaporanPOList } from './laporan-po.actions';

export interface RingkasanKeuanganData {
  /** Angka bulan terpilih dari mesin Kinerja Keuangan (sama persis dengan menu Kinerja Keuangan) */
  kinerja: KinerjaData;
  /** PO yang biaya aktualnya (bahan + upah) melebihi patokan HPP */
  po_melebihi_patokan: { po_id: string; no_po: string; klien_nama: string; gap: number }[];
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
  return { kinerja, po_melebihi_patokan };
}
