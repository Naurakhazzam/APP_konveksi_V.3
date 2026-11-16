import { getBiayaOverhead, type BiayaOverheadData } from '@/lib/actions/keuangan/biaya-overhead.actions';
import { bulanBerjalan } from '@/lib/bulan-berjalan';
import { PageWrapper } from '@/components/ui/PageWrapper';
import BiayaOverheadClient from './BiayaOverheadClient';

export const metadata = {
  title: 'Biaya Overhead | Stitchlyx',
  description: 'Realisasi biaya overhead (Buku Kas) dibandingkan patokan HPP × pcs terkirim',
};

export default async function BiayaOverheadPage() {
  const { bulan, tahun } = bulanBerjalan();
  const akhir = new Date(Number(tahun), Number(bulan), 0).getDate();
  const dari = `${tahun}-${bulan}-01`;
  const sampai = `${tahun}-${bulan}-${String(akhir).padStart(2, '0')}`;

  let data: BiayaOverheadData | null = null;
  let error: string | null = null;
  try {
    data = await getBiayaOverhead({ dari, sampai, hanyaPeriodeBaru: true });
  } catch (e) {
    error = String(e);
  }

  if (!data) {
    return <div className="p-8 text-red-400">Error memuat biaya overhead: {error}</div>;
  }

  return (
    <PageWrapper
      title="Biaya Overhead"
      subtitle="Uang overhead yang keluar (Buku Kas) dibandingkan jatah di HPP × pcs yang sudah dikirim"
    >
      <div className="mt-6">
        <BiayaOverheadClient initialData={data} />
      </div>
    </PageWrapper>
  );
}
