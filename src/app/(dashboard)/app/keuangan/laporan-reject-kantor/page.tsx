import { PageWrapper } from '@/components/ui/PageWrapper';
import { getRejectKantorList } from '@/lib/actions/pengiriman/reject-kantor.actions';
import LaporanRejectKantorClient from './LaporanRejectKantorClient';

export const metadata = {
  title: 'Laporan Reject Kantor | Stitchlyx Syncore',
  description: 'Kerugian reject dari kantor per tingkat, penyelesaian, produk, alasan dan surat jalan.',
};

export default async function LaporanRejectKantorPage() {
  try {
    const rows = await getRejectKantorList();
    return (
      <PageWrapper
        title="Laporan Reject Kantor"
        subtitle="Barang reject dari kantor: kerugian bersih, yang masih menggantung, dan yang sudah pulih"
      >
        <LaporanRejectKantorClient rows={rows} />
      </PageWrapper>
    );
  } catch (e) {
    return <div className="p-8 text-red-400">Error memuat data: {String(e)}</div>;
  }
}
