import { getLaporanGaji } from '@/lib/actions/keuangan/laporan-gaji.actions';
import { bulanBerjalan } from '@/lib/bulan-berjalan';
import { PageWrapper } from '@/components/ui/PageWrapper';
import LaporanGajiClient from './LaporanGajiClient';

export const metadata = { title: 'Laporan Gaji | Stitchlyx' };

export default async function LaporanGajiPage() {
  try {
    const { bulan, tahun } = bulanBerjalan();
    const data = await getLaporanGaji({ bulan, tahun, hanyaPeriodeBaru: true });
    return (
      <PageWrapper title="Laporan Gaji" subtitle="Ringkasan penggajian dari sudut pandang keuangan">
        <div className="mt-6">
          <LaporanGajiClient initialData={data} defaultBulan={bulan} defaultTahun={tahun} />
        </div>
      </PageWrapper>
    );
  } catch (e) {
    return <div className="p-8 text-red-400">Error memuat data: {String(e)}</div>;
  }
}
