import { getInventoryOverview, getKategoriTrxBahan } from '@/lib/actions/inventory/inventory.actions';
import { getWarna } from '@/lib/actions/master/detail.actions';
import { getCurrentUserProfile } from '@/lib/auth/permissions';
import InventoryOverviewClient from './InventoryOverviewClient';

export const metadata = {
  title: 'Overview Stok',
};

export default async function InventoryOverviewPage() {
  const [items, kategoriList, warnaList, profile] = await Promise.all([
    getInventoryOverview(),
    getKategoriTrxBahan(),
    getWarna(),
    getCurrentUserProfile(),
  ]);
  const bolehSetoranModal = !!profile && ['owner', 'admin_keuangan'].includes(profile.role);

  return (
    <div className="p-6">
      <InventoryOverviewClient 
        items={items} 
        kategoriTrxList={kategoriList}
        warnaList={warnaList}
        bolehSetoranModal={bolehSetoranModal}
      />
    </div>
  );
}
