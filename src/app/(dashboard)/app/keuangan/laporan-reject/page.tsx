import { getLaporanReject, getKaryawanList } from '@/lib/actions/keuangan/laporan-reject.actions';
import { bulanBerjalan } from '@/lib/bulan-berjalan';
import { PageWrapper } from '@/components/ui/PageWrapper';
import LaporanRejectClient from './LaporanRejectClient';

export const metadata = { title: 'Laporan Potongan Reject | Stitchlyx' };

export default async function LaporanRejectPage() {
  try {
    const { bulan, tahun } = bulanBerjalan();
    const [data, karyawanList] = await Promise.all([
      getLaporanReject({ bulan, tahun, hanyaPeriodeBaru: true }),
      getKaryawanList(),
    ]);
    return (
      <PageWrapper title="Laporan Potongan Reject" subtitle="Potongan upah karyawan karena reject produksi, dan pengembaliannya setelah rework">
        <div className="mt-6">
          <LaporanRejectClient initialData={data} karyawanList={karyawanList} defaultBulan={bulan} defaultTahun={tahun} />
        </div>
      </PageWrapper>
    );
  } catch (e) {
    return <div className="p-8 text-red-400">Error memuat data: {String(e)}</div>;
  }
}
