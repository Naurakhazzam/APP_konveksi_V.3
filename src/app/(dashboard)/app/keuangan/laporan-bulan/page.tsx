import { getLaporanBulan } from '@/lib/actions/keuangan/laporan-bulan.actions';
import { PageWrapper } from '@/components/ui/PageWrapper';
import LaporanBulanClient from './LaporanBulanClient';

export const metadata = { title: 'Laporan Per Bulan | Stitchlyx' };

export default async function LaporanBulanPage() {
  const now = new Date();
  const bulan = String(now.getMonth() + 1);
  const tahun = String(now.getFullYear());

  try {
    const data = await getLaporanBulan(bulan, tahun);
    return (
      <PageWrapper title="Laporan Per Bulan" subtitle="Income statement sederhana per periode bulanan">
        <div className="mt-6">
          <LaporanBulanClient initialData={data} />
        </div>
      </PageWrapper>
    );
  } catch (e) {
    return <div className="p-8 text-red-400">Error memuat data: {String(e)}</div>;
  }
}
