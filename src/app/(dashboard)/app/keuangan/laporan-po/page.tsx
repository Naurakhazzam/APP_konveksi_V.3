import { getLaporanPOList } from '@/lib/actions/keuangan/laporan-po.actions';
import { bulanBerjalan } from '@/lib/bulan-berjalan';
import { PageWrapper } from '@/components/ui/PageWrapper';
import LaporanPOClient from './LaporanPOClient';

export const metadata = {
  title: 'Laporan Per PO | Stitchlyx',
  description: 'Perkiraan HPP vs biaya aktual per Purchase Order',
};

export default async function LaporanPerPOPage() {
  try {
    const { bulan, tahun } = bulanBerjalan();
    const laporanList = await getLaporanPOList({ bulan, tahun });

    return (
      <PageWrapper
        title="Laporan Per PO"
        subtitle="Perkiraan (HPP × pcs dipotong) vs biaya aktual per komponen"
      >
        <div className="mt-6">
          <LaporanPOClient initialData={laporanList} defaultBulan={bulan} defaultTahun={tahun} />
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
