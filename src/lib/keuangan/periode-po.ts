/**
 * Periode kerja baru dimulai dari PO-0099 (reset 15 Nov 2026; awalnya PO-0100,
 * dimundurkan ke PO-0099 atas permintaan user 16 Nov 2026).
 * Laporan keuangan default hanya menampilkan PO dengan nomor >= PO_AWAL_PERIODE;
 * PO lama bisa dimunculkan lewat centang "Tampilkan PO lama".
 */
export const PO_AWAL_PERIODE = 99;

/** Tanggal awal periode baru (Buku Kas mulai dipakai ulang) — data sebelumnya diabaikan */
export const TANGGAL_AWAL_PERIODE = '2026-11-14';

/** Batas bawah tanggal untuk angka uang periode baru: tanggal sebelum TANGGAL_AWAL_PERIODE diabaikan */
export function batasAwalPeriode(tanggal: string): string {
  return tanggal < TANGGAL_AWAL_PERIODE ? TANGGAL_AWAL_PERIODE : tanggal;
}

/** true bila tanggal 'YYYY-MM-DD' termasuk periode baru */
export function tanggalPeriodeBaru(tanggal: string | null | undefined): boolean {
  return !!tanggal && String(tanggal).slice(0, 10) >= TANGGAL_AWAL_PERIODE;
}

/**
 * Biaya PO periode baru yang terjadi sebelum TANGGAL_AWAL_PERIODE (mis. kain & upah PO-0099 sejak
 * akhir Okt) dilaporkan di tanggal awal periode — permintaan user: "semua biaya PO-0099 masuk November".
 */
export function tanggalLaporan(tanggal: string): string {
  const t = String(tanggal).slice(0, 10);
  return t < TANGGAL_AWAL_PERIODE ? TANGGAL_AWAL_PERIODE : t;
}

/**
 * Rentang query untuk data per PO/bundle periode baru (upah, pemakaian): rentang yang memuat awal
 * periode ikut menarik data sebelumnya (dilaporkan di awal periode); rentang sebelum periode = kosong.
 */
export function rentangPeriodeBaru(dari: string, sampai: string): [string, string] {
  if (sampai < TANGGAL_AWAL_PERIODE) return ['9999-12-31', sampai];
  if (dari <= TANGGAL_AWAL_PERIODE) return ['1900-01-01', sampai];
  return [dari, sampai];
}

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
