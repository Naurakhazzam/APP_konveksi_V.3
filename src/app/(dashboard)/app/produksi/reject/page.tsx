import { PageWrapper } from '@/components/ui/PageWrapper';
import { getRejectList, getAlasanRejectList } from '@/lib/actions/produksi/reject.actions';
import { getSuratJalanList, type SuratJalanRow } from '@/lib/actions/pengiriman/surat-jalan.actions';
import RejectClient from './RejectClient';

export const metadata = {
  title: 'Manajemen Reject — Stitchlyx Syncore',
  description: 'Kelola reject produksi: konfirmasi, rework, dan penyelesaian.',
};

export default async function RejectPage() {
  const [konfirmasiList, reworkList, selesaiList, konsumenList, alasanList, suratJalanList] =
    await Promise.all([
      getRejectList('menunggu_konfirmasi'),
      getRejectList('rework'),
      getRejectList('selesai'),
      getRejectList(undefined, 'konsumen'),
      getAlasanRejectList(),
      getSuratJalanList(),
    ]);

  return (
    <PageWrapper
      title="Manajemen Reject"
      subtitle="Pantau dan kelola seluruh reject produksi dari lini jahit hingga pengiriman"
    >
      <RejectClient
        konfirmasiList={konfirmasiList}
        reworkList={reworkList}
        selesaiList={selesaiList}
        konsumenList={konsumenList}
        alasanList={alasanList}
        suratJalanList={suratJalanList}
      />
    </PageWrapper>
  );
}
