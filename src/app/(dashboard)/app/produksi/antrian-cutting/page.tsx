import { getCuttingRows } from "@/lib/actions/produksi/cutting-v2.actions";
import { getCurrentUserProfile } from '@/lib/auth/permissions';
import { PageWrapper } from '@/components/ui/PageWrapper';
import AntrianCuttingClient from './AntrianCuttingClient';

export default async function AntrianCuttingPage() {
  const [poList, profile] = await Promise.all([
    getCuttingRows(),
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
