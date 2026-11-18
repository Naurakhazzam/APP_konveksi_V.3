/**
 * Tanggal kejadian Selesai Cutting / Selesai Packing (F3 Laporan Per PO).
 * Admin boleh mengisi tanggal mundur maksimal 7 hari; disimpan terpisah dari
 * waktu_selesai (jam sistem) dan dicatat di audit_log oleh DB.
 * Dipakai di client (batas input tanggal) dan server (validasi awal).
 */

export const MAKS_MUNDUR_HARI = 7;

/** Tanggal hari ini (WIB) format YYYY-MM-DD. */
export function hariIniWib(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());
}

/** Tanggal paling awal yang boleh dipilih (hari ini − 7), YYYY-MM-DD. */
export function batasMundurWib(): string {
  const [y, m, d] = hariIniWib().split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d - MAKS_MUNDUR_HARI));
  return t.toISOString().slice(0, 10);
}

/**
 * null bila tidak perlu dipasang (kosong / sama dengan hari ini).
 * Lempar error bila di luar rentang — dipanggil SEBELUM RPC utama supaya
 * tahap tidak terlanjur tercatat dengan tanggal salah.
 */
export function normalisasiTanggalKejadian(tanggal: string | null | undefined): string | null {
  if (!tanggal) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tanggal)) throw new Error('Format tanggal kejadian tidak valid');
  const hariIni = hariIniWib();
  if (tanggal > hariIni) throw new Error('Tanggal kejadian tidak boleh melebihi hari ini');
  if (tanggal < batasMundurWib()) {
    throw new Error(`Tanggal kejadian paling lama mundur ${MAKS_MUNDUR_HARI} hari`);
  }
  return tanggal === hariIni ? null : tanggal;
}
