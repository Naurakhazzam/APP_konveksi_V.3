import { getJurnalProduksi, type JurnalProduksiData } from '@/lib/actions/keuangan/jurnal.actions';
import { bulanBerjalan } from '@/lib/bulan-berjalan';
import { PageWrapper } from '@/components/ui/PageWrapper';
import JurnalClient from './JurnalClient';

export const metadata = {
  title: 'Jurnal Produksi | Stitchlyx',
};

export default async function JurnalProduksiPage() {
  const { bulan, tahun } = bulanBerjalan();
  const akhir = new Date(Number(tahun), Number(bulan), 0).getDate();
  const dari = `${tahun}-${bulan}-01`;
  const sampai = `${tahun}-${bulan}-${String(akhir).padStart(2, '0')}`;

  let data: JurnalProduksiData | null = null;
  let error: string | null = null;
  try {
    data = await getJurnalProduksi({ dari, sampai, hanyaPeriodeBaru: true });
  } catch (e) {
    error = String(e);
  }

  if (!data) {
    return <div className="p-8 text-red-400">Error memuat jurnal produksi: {error}</div>;
  }

  return (
    <PageWrapper
      title="Jurnal Produksi"
      subtitle="Laporan otomatis biaya produksi: kain cutting, aksesori, bahan pembantu, upah, overhead & biaya tetap."
    >
      <JurnalClient initialData={data} />
    </PageWrapper>
  );
}
