import { getWarnaAksesori } from '@/lib/actions/produksi/model-aksesori.actions';
import { PageWrapper } from '@/components/ui/PageWrapper';
import AksesoriWarnaClient from './AksesoriWarnaClient';

export default async function AksesoriWarnaPage() {
  const data = await getWarnaAksesori();
  return (
    <PageWrapper
      title="Aksesori Per Warna"
      subtitle="Setup aksesori yang berbeda berdasarkan warna produk (contoh: benang jahit)."
    >
      <AksesoriWarnaClient initialData={data} />
    </PageWrapper>
  );
}
