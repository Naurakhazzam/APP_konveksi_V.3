import { redirect } from 'next/navigation';
import { getCurrentUserProfile } from '@/lib/auth/permissions';

/**
 * Route guard khusus untuk module Master Data.
 * Sesuai BR-10, hanya 'owner' yang memiliki hak akses mutlak untuk melihat & mengubah master.
 * Mencegah kebocoran UI tanpa harus menduplikasi perlindungan di setiap level halaman.
 */
export default async function MasterDataLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await getCurrentUserProfile();

  if (!profile || profile.role !== 'owner') {
    // Jika bukan owner, tendang balik ke dashboard utama
    redirect('/app/dashboard');
  }

  // Jika owner, loloskan dan render child view (Karyawan, Kategori, atau Klien)
  return <>{children}</>;
}
