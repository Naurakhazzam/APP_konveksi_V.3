import { getLaporanReject, getKaryawanList } from '@/lib/actions/keuangan/laporan-reject.actions';
import { PageWrapper } from '@/components/ui/PageWrapper';
import LaporanRejectClient from './LaporanRejectClient';

export const metadata = { title: 'Laporan Koreksi QTY | Stitchlyx' };

export default async function LaporanRejectPage() {
  try {
    const [data, karyawanList] = await Promise.all([
      getLaporanReject(),
      getKaryawanList(),
    ]);
    return (
      <PageWrapper title="Laporan Koreksi QTY" subtitle="Daftar reject dan potongan upah karyawan">
        <div className="mt-6">
          <LaporanRejectClient initialData={data} karyawanList={karyawanList} />
        </div>
      </PageWrapper>
    );
  } catch (e) {
    return <div className="p-8 text-red-400">Error memuat data: {String(e)}</div>;
  }
}
