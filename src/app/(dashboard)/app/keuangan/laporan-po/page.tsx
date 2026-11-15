import { getLaporanPOList } from '@/lib/actions/keuangan/laporan-po.actions';
import { bulanBerjalan } from '@/lib/bulan-berjalan';
import { getOverheadRateInfo } from '@/lib/actions/keuangan/overhead.actions';
import { PageWrapper } from '@/components/ui/PageWrapper';
import LaporanPOClient from './LaporanPOClient';

export const metadata = {
  title: 'Laporan Per PO | Stitchlyx',
  description: 'HPP Estimasi vs Aktual per Purchase Order',
};

export default async function LaporanPerPOPage() {
  try {
    const { bulan, tahun } = bulanBerjalan();
    const [laporanList, rateInfo] = await Promise.all([
      getLaporanPOList({ bulan, tahun }),
      getOverheadRateInfo(),
    ]);

    return (
      <PageWrapper
        title="Laporan Per PO"
        subtitle="HPP Estimasi vs Aktual per Purchase Order"
      >
        <div className="mt-6">
          <LaporanPOClient initialData={laporanList} overheadRateInfo={rateInfo} defaultBulan={bulan} defaultTahun={tahun} />
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
