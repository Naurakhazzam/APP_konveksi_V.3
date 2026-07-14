import { getPOCuttingList } from '@/lib/actions/produksi/cutting.actions';
import { getCurrentUserProfile } from '@/lib/auth/permissions';
import { PageWrapper } from '@/components/ui/PageWrapper';
import AntrianCuttingClient from './AntrianCuttingClient';

export default async function AntrianCuttingPage() {
  const [poList, profile] = await Promise.all([
    getPOCuttingList(),
    getCurrentUserProfile(),
  ]);

  return (
    <PageWrapper
      title="Cutting"
      subtitle="Kelola proses cutting per Purchase Order"
    >
      <AntrianCuttingClient poList={poList} role={profile?.role ?? 'mandor'} />
    </PageWrapper>
  );
}
