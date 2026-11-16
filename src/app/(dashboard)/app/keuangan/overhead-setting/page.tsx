import { redirect } from 'next/navigation';

/**
 * Setting Overhead (tarif overhead per periode, tabel overhead_period) tidak dipakai lagi sejak 16 Nov 2026.
 * Overhead resmi dari menu Biaya Overhead (Buku Kas + kontrak sewa per hari) — alamat lama dialihkan ke sana.
 */
export default function Page() {
  redirect('/app/keuangan/biaya-overhead');
}
