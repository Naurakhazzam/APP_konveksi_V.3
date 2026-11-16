import { redirect } from 'next/navigation';

/**
 * Menu ini digantikan Kinerja Keuangan (laba rugi akrual per bulan / sejak awal periode) — 16 Nov 2026.
 * Alamat lama dialihkan supaya tautan yang tersimpan tetap jalan.
 */
export default function Page() {
  redirect('/app/keuangan/proyeksi-surplus');
}
