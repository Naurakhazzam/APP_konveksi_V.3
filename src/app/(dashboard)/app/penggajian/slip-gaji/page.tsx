import { getKaryawanAktif } from '@/lib/actions/penggajian/penggajian.actions';
import SlipGajiClient from './SlipGajiClient';
import { PageWrapper } from '@/components/ui/PageWrapper';

export const metadata = { title: 'Slip Gaji' };

export default async function SlipGajiPage() {
  const karyawanList = await getKaryawanAktif();
  return (
    <PageWrapper title="Slip Gaji" subtitle="Generate slip gaji per karyawan per periode">
      <div className="mt-6">
        <SlipGajiClient karyawanList={karyawanList} />
      </div>
    </PageWrapper>
  );
}
