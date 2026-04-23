import { getKasbon, getKaryawanAktif } from '@/lib/actions/penggajian/penggajian.actions';
import KasbonClient from './KasbonClient';
import { PageWrapper } from '@/components/ui/PageWrapper';

export const metadata = { title: 'Kasbon Karyawan' };

export default async function KasbonPage() {
  const [kasbonList, karyawanList] = await Promise.all([
    getKasbon(),
    getKaryawanAktif(),
  ]);
  return (
    <PageWrapper title="Kasbon" subtitle="Kelola kasbon dan pinjaman karyawan">
      <div className="mt-6">
        <KasbonClient initialData={kasbonList} karyawanList={karyawanList} />
      </div>
    </PageWrapper>
  );
}
