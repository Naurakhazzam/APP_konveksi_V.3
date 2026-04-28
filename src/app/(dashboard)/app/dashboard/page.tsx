import { redirect } from 'next/navigation';
import { getCurrentUserProfile } from '@/lib/auth/permissions';
import { PageWrapper } from '@/components/ui/PageWrapper';
import { getDashboardKPI } from '@/lib/actions/dashboard/dashboard.actions';
import DashboardClient from './DashboardClient';

export default async function DashboardPage() {
  const profile = await getCurrentUserProfile();

  if (!profile) {
    redirect('/login');
  }

  const now   = new Date();
  const bulan = String(now.getMonth() + 1);
  const tahun = String(now.getFullYear());
  const data  = await getDashboardKPI(bulan, tahun);

  return (
    <PageWrapper title="Dashboard" subtitle={`Selamat datang, ${profile.nama}`}>
      <DashboardClient
        initialData={data}
        initialBulan={bulan}
        initialTahun={tahun}
      />
    </PageWrapper>
  );
}
