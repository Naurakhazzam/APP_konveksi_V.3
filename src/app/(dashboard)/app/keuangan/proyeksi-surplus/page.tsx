import { getProyeksiSurplus, type ProyeksiSurplusData } from '@/lib/actions/keuangan/proyeksi-surplus.actions';
import { PageWrapper } from '@/components/ui/PageWrapper';
import ProyeksiSurplusClient from './ProyeksiSurplusClient';

export const metadata = {
  title: 'Kinerja Keuangan | Stitchlyx',
  description: 'Laba rugi, posisi aset & kewajiban, dan arus kas periode berjalan',
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
    return <div className="p-8 text-red-400">Error memuat kinerja keuangan: {error}</div>;
  }

  return (
    <PageWrapper
      title="Kinerja Keuangan"
      subtitle="Laba rugi, posisi aset & kewajiban, dan arus kas — termasuk perkiraan order yang sedang berjalan"
    >
      <ProyeksiSurplusClient data={data} />
    </PageWrapper>
  );
}
