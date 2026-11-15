/**
 * Bulan & tahun berjalan menurut WIB — dipakai sebagai default filter bulan
 * di halaman-halaman laporan. bulan = "01".."12", tahun = "YYYY".
 */
export function bulanBerjalan(): { bulan: string; tahun: string } {
  const [tahun, bulan] = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit',
  }).format(new Date()).split('-');
  return { bulan, tahun };
}
