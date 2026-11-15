import { getJurnalEntries, getKategoriTrxList, getPOList } from '@/lib/actions/keuangan/jurnal.actions';
import { bulanBerjalan } from '@/lib/bulan-berjalan';
import { PageWrapper } from '@/components/ui/PageWrapper';
import JurnalClient from './JurnalClient';

export const metadata = {
  title: 'Jurnal Produksi | Stitchlyx',
};

export default async function JurnalUmumPage() {
  try {
    const { bulan, tahun } = bulanBerjalan();
    const [entries, kategoriList, poList] = await Promise.all([
      getJurnalEntries({ bulan, tahun }),
      getKategoriTrxList(),
      getPOList(),
    ]);

    return (
      <PageWrapper
        title="Jurnal Produksi"
        subtitle="Catatan transaksi keuangan produksi."
      >
        <JurnalClient
          initialEntries={entries}
          kategoriList={kategoriList}
          poList={poList}
          defaultBulan={bulan}
          defaultTahun={tahun}
        />
      </PageWrapper>
    );
  } catch (e) {
    return (
      <div className="p-8 text-red-400">
        Error memuat data jurnal: {String(e)}
      </div>
    );
  }
}
