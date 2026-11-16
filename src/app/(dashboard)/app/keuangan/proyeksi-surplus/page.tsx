import { getProyeksiSurplus, type ProyeksiSurplusData } from '@/lib/actions/keuangan/proyeksi-surplus.actions';
import { PageWrapper } from '@/components/ui/PageWrapper';
import ProyeksiSurplusClient from './ProyeksiSurplusClient';

export const metadata = {
  title: 'Proyeksi Surplus | Stitchlyx',
  description: 'Uang yang sudah keluar dibandingkan uang yang masuk bila semua hasil potong terkirim',
};

export default async function ProyeksiSurplusPage() {
  let data: ProyeksiSurplusData | null = null;
  let error: string | null = null;
  try {
    data = await getProyeksiSurplus();
  } catch (e) {
    error = String(e);
  }

  if (!data) {
    return <div className="p-8 text-red-400">Error memuat proyeksi surplus: {error}</div>;
  }

  return (
    <PageWrapper
      title="Proyeksi Surplus"
      subtitle="Realisasi (uang yang benar-benar masuk & keluar) + proyeksi sisa hasil potong yang belum dibayar"
    >
      <ProyeksiSurplusClient data={data} />
    </PageWrapper>
  );
}
