/**
 * Periode kerja baru dimulai dari PO-0099 (reset 15 Nov 2026; awalnya PO-0100,
 * dimundurkan ke PO-0099 atas permintaan user 16 Nov 2026).
 * Laporan keuangan default hanya menampilkan PO dengan nomor >= PO_AWAL_PERIODE;
 * PO lama bisa dimunculkan lewat centang "Tampilkan PO lama".
 */
export const PO_AWAL_PERIODE = 99;

/** "PO-0101" → 101; format lain → NaN */
export function nomorPo(noPo: string | null | undefined): number {
  const m = /(\d+)/.exec(noPo ?? '');
  return m ? parseInt(m[1], 10) : NaN;
}

/** true bila PO termasuk periode baru (PO-0100 ke atas) */
export function poPeriodeBaru(noPo: string | null | undefined): boolean {
  const n = nomorPo(noPo);
  return !Number.isNaN(n) && n >= PO_AWAL_PERIODE;
}
