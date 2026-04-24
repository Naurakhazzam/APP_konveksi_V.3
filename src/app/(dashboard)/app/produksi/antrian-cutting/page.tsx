import { getPOCuttingList } from '@/lib/actions/produksi/cutting.actions';
import { PageWrapper } from '@/components/ui/PageWrapper';
import AntrianCuttingClient from './AntrianCuttingClient';

export default async function AntrianCuttingPage() {
  const poList = await getPOCuttingList();

  return (
    <PageWrapper
      title="Cutting"
      subtitle="Kelola proses cutting per Purchase Order"
    >
      <AntrianCuttingClient poList={poList} />
    </PageWrapper>
  );
}
