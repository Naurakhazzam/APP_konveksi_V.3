import { getJurnalEntries, getKategoriTrxList, getPOList } from '@/lib/actions/keuangan/jurnal.actions';
import { PageWrapper } from '@/components/ui/PageWrapper';
import JurnalClient from './JurnalClient';

export const metadata = {
  title: 'Jurnal Produksi | Stitchlyx',
};

export default async function JurnalUmumPage() {
  try {
    const [entries, kategoriList, poList] = await Promise.all([
      getJurnalEntries(),
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
