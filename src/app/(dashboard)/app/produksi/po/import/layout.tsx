import { redirect } from 'next/navigation';
import { getCurrentUserProfile, isProduksiReadOnly } from '@/lib/auth/permissions';

/** Import PO murni form input — role read-only diarahkan ke Daftar Artikel PO. */
export default async function ImportPoLayout({ children }: { children: React.ReactNode }) {
  const profile = await getCurrentUserProfile();
  if (isProduksiReadOnly(profile?.role)) redirect('/app/produksi/daftar-po');
  return <>{children}</>;
}
