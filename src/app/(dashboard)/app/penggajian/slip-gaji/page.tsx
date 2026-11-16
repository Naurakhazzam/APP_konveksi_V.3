import { getKaryawanAktif } from '@/lib/actions/penggajian/penggajian.actions';
import SlipGajiClient from './SlipGajiClient';
import { PageWrapper } from '@/components/ui/PageWrapper';

export const metadata = { title: 'Slip Gaji' };

export default async function SlipGajiPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  // ?karyawan=<id>&tanggal=YYYY-MM-DD → langsung tampilkan slip pekan yang memuat tanggal itu
  const sp = await searchParams;
  const karyawan = typeof sp.karyawan === 'string' ? sp.karyawan : undefined;
  const tanggal = typeof sp.tanggal === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(sp.tanggal) ? sp.tanggal : undefined;

  const karyawanList = await getKaryawanAktif();
  return (
    <PageWrapper title="Slip Gaji" subtitle="Generate slip gaji per karyawan per periode">
      <div className="mt-6">
        <SlipGajiClient
          key={`${karyawan ?? ''}|${tanggal ?? ''}`}
          karyawanList={karyawanList}
          initialKaryawanId={karyawan}
          initialTanggal={tanggal}
        />
      </div>
    </PageWrapper>
  );
}
