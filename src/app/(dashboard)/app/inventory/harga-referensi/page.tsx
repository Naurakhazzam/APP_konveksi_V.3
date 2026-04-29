import { getHargaReferensiItems } from '@/lib/actions/inventory/item.actions';
import HargaReferensiClient from './HargaReferensiClient';

export default async function HargaReferensiPage() {
  const items = await getHargaReferensiItems();
  return <HargaReferensiClient items={items} />;
}
