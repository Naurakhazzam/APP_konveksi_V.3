/**
 * Patokan pemakaian bahan (sheet HPP) — dipakai di Selesai Cutting dan tab
 * Pemakaian Bahan. Patokan berlaku untuk TOTAL bahan utama per pcs: artikel
 * dua warna (A x B) mencatat dua bahan yang dijumlah sebelum dibandingkan.
 *
 * Tanpa toleransi: di atas patokan = boros, di bawah = irit.
 */

export type StatusPemakaian = 'irit' | 'sesuai' | 'boros' | 'tanpa';

/** Bahan utama = nama bahan diawali jenis bahan kategori ("Bahan JN", "Toyobo"…). */
export function isBahanUtama(namaBahan: string, jenisBahan: string | null | undefined): boolean {
  if (!jenisBahan) return true;
  return namaBahan.toLowerCase().startsWith(jenisBahan.toLowerCase());
}

/** Bandingkan pemakaian per pcs dengan patokan (dibulatkan 3 desimal). */
export function statusPemakaian(aktualPerPcs: number, patokan: number | null | undefined): StatusPemakaian {
  if (patokan == null || !(patokan > 0)) return 'tanpa';
  const a = Math.round(aktualPerPcs * 1000);
  const p = Math.round(patokan * 1000);
  if (a > p) return 'boros';
  if (a < p) return 'irit';
  return 'sesuai';
}

/** Persen selisih terhadap patokan, mis. -7 (irit 7%) atau +4 (boros 4%). */
export function persenSelisih(aktualPerPcs: number, patokan: number): number {
  return Math.round(((aktualPerPcs - patokan) / patokan) * 100);
}

export const STATUS_LABEL: Record<StatusPemakaian, string> = {
  irit: 'Irit', sesuai: 'Sesuai', boros: 'Boros', tanpa: 'Tanpa patokan',
};

export const STATUS_CLASS: Record<StatusPemakaian, string> = {
  irit: 'text-green-400 bg-green-500/10 border-green-500/30',
  sesuai: 'text-sky-300 bg-sky-500/10 border-sky-500/30',
  boros: 'text-red-400 bg-red-500/10 border-red-500/30',
  tanpa: 'text-[#9aa0a6] bg-[#2A2D31]/40 border-[#2A2D31]',
};
