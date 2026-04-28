import { redirect } from 'next/navigation';
import { getCurrentUserProfile } from '@/lib/auth/permissions';
import { PageWrapper } from '@/components/ui/PageWrapper';
import { getPemakaianBahan } from '@/lib/actions/inventory/pemakaian-bahan.actions';
import PemakaianBahanClient from './PemakaianBahanClient';

export default async function PemakaianBahanPage() {
  const profile = await getCurrentUserProfile();

  if (!profile) {
    redirect('/login');
  }

  const now = new Date();
  const bulanSampai = String(now.getMonth() + 1);
  const tahunSampai = String(now.getFullYear());
  const bulanDari = bulanSampai;
  const tahunDari = tahunSampai;

  const data = await getPemakaianBahan(bulanDari, tahunDari, bulanSampai, tahunSampai);

  return (
    <PageWrapper
      title="Histori Pemakaian Bahan"
      subtitle="Riwayat penggunaan bahan baku per bundle produksi"
    >
      <PemakaianBahanClient
        initialData={data}
        initialBulanDari={bulanDari}
        initialTahunDari={tahunDari}
        initialBulanSampai={bulanSampai}
        initialTahunSampai={tahunSampai}
      />
    </PageWrapper>
  );
}
