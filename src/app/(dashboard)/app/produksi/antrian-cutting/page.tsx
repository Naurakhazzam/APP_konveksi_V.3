import { getCuttingRows, getPemakaianCutting } from "@/lib/actions/produksi/cutting-v2.actions";
import { getCurrentUserProfile } from '@/lib/auth/permissions';
import { PageWrapper } from '@/components/ui/PageWrapper';
import AntrianCuttingClient from './AntrianCuttingClient';
import { getPuringData } from '@/lib/actions/produksi/potong-puring.actions';
import { getVariasiData } from '@/lib/actions/produksi/potong-variasi.actions';

export default async function AntrianCuttingPage() {
  const [poList, pemakaian, profile, puring, variasi] = await Promise.all([
    getCuttingRows(),
    getPemakaianCutting(),
    getCurrentUserProfile(),
    getPuringData(),
    getVariasiData(),
  ]);

  return (
    <PageWrapper
      title="Cutting"
      subtitle="Kelola proses cutting per Purchase Order"
    >
      <AntrianCuttingClient poList={poList} pemakaian={pemakaian} puring={puring} variasi={variasi} role={profile?.role ?? 'mandor'} />
    </PageWrapper>
  );
}
