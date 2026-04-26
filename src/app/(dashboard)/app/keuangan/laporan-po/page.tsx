import { getLaporanPOList } from '@/lib/actions/keuangan/laporan-po.actions';
import { PageWrapper } from '@/components/ui/PageWrapper';
import LaporanPOClient from './LaporanPOClient';

export const metadata = {
  title: 'Laporan Per PO | Stitchlyx',
  description: 'HPP Estimasi vs Aktual per Purchase Order',
};

export default async function LaporanPerPOPage() {
  try {
    const laporanList = await getLaporanPOList();
    return (
      <PageWrapper
        title="Laporan Per PO"
        subtitle="HPP Estimasi vs Aktual per Purchase Order"
      >
        <div className="mt-6">
          <LaporanPOClient initialData={laporanList} />
        </div>
      </PageWrapper>
    );
  } catch (e) {
    return (
      <div className="p-8 text-red-400">
        Error memuat data laporan: {String(e)}
      </div>
    );
  }
}
