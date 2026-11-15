import { getCuttingRows, getPemakaianCutting } from "@/lib/actions/produksi/cutting-v2.actions";
import { getCurrentUserProfile } from '@/lib/auth/permissions';
import { PageWrapper } from '@/components/ui/PageWrapper';
import AntrianCuttingClient from './AntrianCuttingClient';
import { getPuringData } from '@/lib/actions/produksi/potong-puring.actions';

export default async function AntrianCuttingPage() {
  const [poList, pemakaian, profile, puring] = await Promise.all([
    getCuttingRows(),
    getPemakaianCutting(),
    getCurrentUserProfile(),
    getPuringData(),
  ]);

  return (
    <PageWrapper
      title="Cutting"
      subtitle="Kelola proses cutting per Purchase Order"
    >
      <AntrianCuttingClient poList={poList} pemakaian={pemakaian} puring={puring} role={profile?.role ?? 'mandor'} />
    </PageWrapper>
  );
}
