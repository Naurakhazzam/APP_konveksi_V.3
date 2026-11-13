/**
 * Semua tanggal "hari ini" di aplikasi mengikuti jam Indonesia (WIB),
 * bukan UTC. Jangan memotong hasil toISOString() untuk dapat tanggal:
 * itu tanggal UTC, sehingga antara 00:00–07:00 WIB hasilnya masih kemarin.
 */
export const ZONA_WAKTU = 'Asia/Jakarta';

/** Tanggal 'YYYY-MM-DD' menurut WIB untuk waktu `d` (default: sekarang). */
export function tanggalWIB(d: Date = new Date()): string {
  return d.toLocaleDateString('en-CA', { timeZone: ZONA_WAKTU });
}
