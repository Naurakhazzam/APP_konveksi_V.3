import { getLaporanGaji } from '@/lib/actions/keuangan/laporan-gaji.actions';
import { PageWrapper } from '@/components/ui/PageWrapper';
import LaporanGajiClient from './LaporanGajiClient';

export const metadata = { title: 'Laporan Gaji | Stitchlyx' };

export default async function LaporanGajiPage() {
  try {
    const data = await getLaporanGaji();
    return (
      <PageWrapper title="Laporan Gaji" subtitle="Ringkasan penggajian dari sudut pandang keuangan">
        <div className="mt-6">
          <LaporanGajiClient initialData={data} />
        </div>
      </PageWrapper>
    );
  } catch (e) {
    return <div className="p-8 text-red-400">Error memuat data: {String(e)}</div>;
  }
}
