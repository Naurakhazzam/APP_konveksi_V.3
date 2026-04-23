import { getBundlesReadyToShip } from '@/lib/actions/pengiriman/surat-jalan.actions';
import { PageWrapper } from '@/components/ui/PageWrapper';
import BuatSuratJalanClient from './BuatSuratJalanClient';

export default async function BuatSuratJalanPage() {
  const bundles = await getBundlesReadyToShip();
  return (
    <PageWrapper title="Buat Surat Jalan" subtitle="Pilih bundle yang siap dikirim lalu finalisasi.">
      <BuatSuratJalanClient initialBundles={bundles} />
    </PageWrapper>
  );
}
