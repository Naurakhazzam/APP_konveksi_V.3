import { PageWrapper } from '@/components/ui/PageWrapper';
import { getCurrentUserProfile } from '@/lib/auth/permissions';
import { getSelisihKirimList } from '@/lib/actions/pengiriman/selisih-kirim.actions';
import SelisihKirimClient from './SelisihKirimClient';

export const metadata = {
  title: 'Selisih Kirim | Stitchlyx Syncore',
  description: 'Pcs yang kurang saat validasi kirim, menunggu penjelasan owner.',
};

export default async function SelisihKirimPage() {
  const [profile, rows] = await Promise.all([getCurrentUserProfile(), getSelisihKirimList()]);

  return (
    <PageWrapper
      title="Selisih Kirim"
      subtitle="Pcs yang diterima kantor lebih sedikit dari surat jalan — owner menjelaskan: ketinggalan, hilang/rusak, atau kantor salah hitung"
    >
      <SelisihKirimClient rows={rows} role={profile?.role ?? null} />
    </PageWrapper>
  );
}
