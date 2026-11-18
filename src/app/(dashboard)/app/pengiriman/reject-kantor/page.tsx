import { PageWrapper } from '@/components/ui/PageWrapper';
import { getCurrentUserProfile } from '@/lib/auth/permissions';
import { getAlasanRejectList } from '@/lib/actions/produksi/reject.actions';
import { getRejectKantorList, getDataLaporReject } from '@/lib/actions/pengiriman/reject-kantor.actions';
import RejectKantorClient from './RejectKantorClient';

export const metadata = {
  title: 'Reject Kantor | Stitchlyx Syncore',
  description: 'Barang reject yang diretur kantor: perbaikan, kirim ulang, dan potongan tagihan.',
};

export default async function RejectKantorPage() {
  const [profile, rows, dataLapor, alasanList] = await Promise.all([
    getCurrentUserProfile(),
    getRejectKantorList(),
    getDataLaporReject(),
    getAlasanRejectList(),
  ]);

  return (
    <PageWrapper
      title="Reject Kantor"
      subtitle="Barang yang diretur kantor — diperbaiki, dikirim ulang dengan surat jalan, atau memotong tagihan"
    >
      <RejectKantorClient
        rows={rows}
        dataLapor={dataLapor}
        alasanList={alasanList}
        role={profile?.role ?? null}
      />
    </PageWrapper>
  );
}
