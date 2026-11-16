import { PageWrapper } from '@/components/ui/PageWrapper';
import { getCurrentUserProfile } from '@/lib/auth/permissions';
import { getAlasanRejectList } from '@/lib/actions/produksi/reject.actions';
import { getRejectKantorList, getSjUntukLaporReject } from '@/lib/actions/pengiriman/reject-kantor.actions';
import RejectKantorClient from './RejectKantorClient';

export const metadata = {
  title: 'Reject Kantor | Stitchlyx Syncore',
  description: 'Barang reject yang diretur kantor: perbaikan, kirim ulang, dan potongan tagihan.',
};

export default async function RejectKantorPage() {
  const [profile, rows, sjList, alasanList] = await Promise.all([
    getCurrentUserProfile(),
    getRejectKantorList(),
    getSjUntukLaporReject(),
    getAlasanRejectList(),
  ]);

  return (
    <PageWrapper
      title="Reject Kantor"
      subtitle="Barang yang diretur kantor — diperbaiki, dikirim ulang dengan surat jalan, atau memotong tagihan"
    >
      <RejectKantorClient
        rows={rows}
        sjList={sjList}
        alasanList={alasanList}
        role={profile?.role ?? null}
      />
    </PageWrapper>
  );
}
