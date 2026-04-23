import { getTransaksiKeluar, getInventoryOverview } from '@/lib/actions/inventory/inventory.actions';
import TransaksiKeluarClient from './TransaksiKeluarClient';

export const metadata = {
  title: 'Riwayat Pemakaian Stok',
};

export default async function TransaksiKeluarPage() {
  const [data, items] = await Promise.all([
    getTransaksiKeluar(1, 30),
    getInventoryOverview(),
  ]);

  return (
    <div className="p-6">
      <TransaksiKeluarClient 
        initialData={data.data} 
        totalCount={data.total} 
        inventoryItems={items} 
      />
    </div>
  );
}
