import { getSaldoPembantu, type SaldoPembantuData } from '@/lib/actions/keuangan/saldo-pembantu.actions';
import { PageWrapper } from '@/components/ui/PageWrapper';
import { getCurrentUserProfile } from '@/lib/auth/permissions';
import SaldoPembantuClient from './SaldoPembantuClient';

export const metadata = {
  title: 'Saldo Bahan Pembantu | Stitchlyx',
  description: 'Belanja bahan pembantu vs jatah HPP, dan rekap penghematan',
};

export default async function SaldoPembantuPage() {
  let data: SaldoPembantuData | null = null;
  let error: string | null = null;
  const profile = await getCurrentUserProfile();
  const bolehUbah = !!profile && ['owner', 'admin_keuangan'].includes(profile.role);
  try {
    data = await getSaldoPembantu();
  } catch (e) {
    error = String(e);
  }

  if (!data) {
    return <div className="p-8 text-red-400">Error memuat saldo bahan pembantu: {error}</div>;
  }

  return (
    <PageWrapper
      title="Saldo Bahan Pembantu"
      subtitle="Barang lama (saldo awal) & belanja Buku Kas dihabiskan oleh jatah HPP × pcs selesai jahit; sisa jatah = penghematan"
    >
      <div className="mt-6">
        <SaldoPembantuClient data={data} bolehUbah={bolehUbah} />
      </div>
    </PageWrapper>
  );
}
