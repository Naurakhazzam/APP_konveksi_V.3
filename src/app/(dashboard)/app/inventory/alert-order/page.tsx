import { getAlertItems, getKategoriTrxBahan } from '@/lib/actions/inventory/inventory.actions';
import AlertOrderClient from './AlertOrderClient';

export const metadata = {
  title: 'Alert Stok Inventory',
};

export default async function AlertOrderPage() {
  const [alertItems, kategoriTrxList] = await Promise.all([
    getAlertItems(),
    getKategoriTrxBahan(),
  ]);

  return (
    <div className="p-6">
      <AlertOrderClient 
        items={alertItems} 
        kategoriTrxList={kategoriTrxList} 
      />
    </div>
  );
}
