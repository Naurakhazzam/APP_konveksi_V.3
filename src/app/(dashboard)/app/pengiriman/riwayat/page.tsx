import { getSuratJalanList } from '@/lib/actions/pengiriman/surat-jalan.actions';
import { PageWrapper } from '@/components/ui/PageWrapper';
import RiwayatClient from './RiwayatClient';

export default async function RiwayatSuratJalanPage() {
  const riwayatList = await getSuratJalanList();
  return (
    <PageWrapper title="Riwayat Surat Jalan" subtitle="Semua surat jalan yang sudah dibuat.">
      <RiwayatClient initialData={riwayatList} />
    </PageWrapper>
  );
}
