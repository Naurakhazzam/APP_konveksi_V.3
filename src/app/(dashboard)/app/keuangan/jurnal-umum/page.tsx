import { getJurnalEntries, getKategoriTrxList } from '@/lib/actions/keuangan/jurnal.actions';
import { PageWrapper } from '@/components/ui/PageWrapper';
import JurnalClient from './JurnalClient';

export const metadata = {
  title: 'Jurnal Umum | Stitchlyx',
};

export default async function JurnalUmumPage() {
  try {
    const [entries, kategoriList] = await Promise.all([
      getJurnalEntries(),
      getKategoriTrxList(),
    ]);

    return (
      <PageWrapper
        title="Jurnal Umum"
        subtitle="Catatan semua transaksi keuangan perusahaan."
      >
        <JurnalClient
          initialEntries={entries}
          kategoriList={kategoriList}
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
