import { getSuratJalanList, getNilaiJualSuratJalanList } from '@/lib/actions/pengiriman/surat-jalan.actions';
import { PageWrapper } from '@/components/ui/PageWrapper';
import RiwayatClient from './RiwayatClient';

export default async function RiwayatSuratJalanPage() {
  const [riwayatList, nilaiJual] = await Promise.all([getSuratJalanList(), getNilaiJualSuratJalanList()]);
  return (
    <PageWrapper title="Riwayat Surat Jalan" subtitle="Semua surat jalan yang sudah dibuat.">
      <RiwayatClient initialData={riwayatList} nilaiJual={nilaiJual} />
    </PageWrapper>
  );
}
