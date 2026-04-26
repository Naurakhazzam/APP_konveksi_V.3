import { PageWrapper } from '@/components/ui/PageWrapper';
import { getOverheadRateInfo } from '@/lib/actions/keuangan/overhead.actions';
import OverheadSettingClient from './OverheadSettingClient';

export const metadata = {
  title: 'Setting Overhead | Stitchlyx',
  description: 'Konfigurasi periode dan rate overhead',
};

export default async function OverheadSettingPage() {
  const rateInfo = await getOverheadRateInfo();

  return (
    <PageWrapper
      title="Setting Overhead"
      subtitle="Konfigurasi periode dan perhitungan rate overhead per pcs"
    >
      <div className="mt-6 max-w-2xl">
        <OverheadSettingClient initialRateInfo={rateInfo} />
      </div>
    </PageWrapper>
  );
}
