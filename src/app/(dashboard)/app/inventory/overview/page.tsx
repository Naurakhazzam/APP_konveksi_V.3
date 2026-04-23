import { getInventoryOverview, getKategoriTrxBahan } from '@/lib/actions/inventory/inventory.actions';
import { getWarna } from '@/lib/actions/master/detail.actions';
import InventoryOverviewClient from './InventoryOverviewClient';

export const metadata = {
  title: 'Overview Stok',
};

export default async function InventoryOverviewPage() {
  const [items, kategoriList, warnaList] = await Promise.all([
    getInventoryOverview(),
    getKategoriTrxBahan(),
    getWarna(),
  ]);

  return (
    <div className="p-6">
      <InventoryOverviewClient 
        items={items} 
        kategoriTrxList={kategoriList}
        warnaList={warnaList}
      />
    </div>
  );
}
