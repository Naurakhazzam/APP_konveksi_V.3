import { redirect } from 'next/navigation';

/**
 * Root page untuk Master Data. 
 * Secara default, jika user hanya me-navigate ke /app/master,
 * maka redirect langsung ke child pertama: Karyawan.
 */
export default function MasterPage() {
  redirect('/app/master/karyawan');
}
