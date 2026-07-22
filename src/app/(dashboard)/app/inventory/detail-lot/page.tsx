import { PageWrapper } from '@/components/ui/PageWrapper';
import { getBahanBakuList } from '@/lib/actions/inventory/lot-detail.actions';
import DetailLotClient from './DetailLotClient';

export default async function DetailLotPage() {
  const bahanList = await getBahanBakuList();

  return (
    <PageWrapper
      title="Detail LOT"
      subtitle="Telusuri LOT bahan baku: PO ini pakai LOT apa saja, atau LOT ini sudah jadi produk apa saja"
    >
      <DetailLotClient bahanList={bahanList} />
    </PageWrapper>
  );
}
