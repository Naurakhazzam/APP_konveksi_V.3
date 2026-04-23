import {
  getKategoriProdukForProduk,
  getModelProdukForProduk,
  getHppKomponen,
  getProduk,
} from '@/lib/actions/master/produk.actions';
import { getSize } from '@/lib/actions/master/detail.actions';
import { getWarna } from '@/lib/actions/master/detail.actions';
import { getCurrentUserProfile, permissions } from '@/lib/auth/permissions';
import { PageWrapper } from '@/components/ui/PageWrapper';
import { ProdukClient } from './ProdukClient';

export default async function MasterProdukPage() {
  const [profile, dataKategori, dataModel, dataSize, dataWarna, dataKomponen] =
    await Promise.all([
      getCurrentUserProfile(),
      getKategoriProdukForProduk(),
      getModelProdukForProduk(),
      getSize(),
      getWarna(),
      getHppKomponen(),
    ]);

  const isOwner       = profile?.role === 'owner';
  const canSeeFinance = profile ? permissions.canViewMarginHPP(profile.role) : false;

  // Serialisasi ke plain object agar aman dipass ke Client Component
  const plainKategori = JSON.parse(JSON.stringify(dataKategori));
  const plainModel    = JSON.parse(JSON.stringify(dataModel));
  const plainSize     = JSON.parse(JSON.stringify(dataSize));
  const plainWarna    = JSON.parse(JSON.stringify(dataWarna));
  const plainKomponen = JSON.parse(JSON.stringify(dataKomponen));

  return (
    <PageWrapper
      title="Produk & HPP"
      subtitle="Manajemen master produk dengan hierarki folder — Kategori → Model → SKU"
    >
      <ProdukClient
        isOwner={isOwner}
        canSeeFinance={canSeeFinance}
        masterKategori={plainKategori}
        masterModel={plainModel}
        masterSize={plainSize}
        masterWarna={plainWarna}
        masterKomponen={plainKomponen}
      />
    </PageWrapper>
  );
}
