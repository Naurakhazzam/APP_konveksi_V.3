import { getAntrianData } from '@/lib/actions/produksi/antrian.actions';
import { PageWrapper } from '@/components/ui/PageWrapper';
import AntrianCuttingClient from './AntrianCuttingClient';

export default async function AntrianCuttingPage() {
  const data = await getAntrianData();

  return (
    <PageWrapper
      title="Antrian Cutting"
      subtitle="Daftar bundle yang menunggu proses pemotongan"
    >
      <AntrianCuttingClient
        antrianBundles={data.antrian}
        dipotongBundles={data.dipotong}
      />
    </PageWrapper>
  );
}
