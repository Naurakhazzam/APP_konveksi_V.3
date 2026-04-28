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
  const bulanSampai = String(now.getMonth() + 1);
  const tahunSampai = String(now.getFullYear());
  const bulanDari   = bulanSampai;
  const tahunDari   = tahunSampai;
  const data = await getDashboardKPI(bulanDari, tahunDari, bulanSampai, tahunSampai);

  return (
    <PageWrapper title="Dashboard" subtitle={`Selamat datang, ${profile.nama}`}>
      <DashboardClient
        initialData={data}
        initialBulanDari={bulanDari}
        initialTahunDari={tahunDari}
        initialBulanSampai={bulanSampai}
        initialTahunSampai={tahunSampai}
      />
    </PageWrapper>
  );
}
