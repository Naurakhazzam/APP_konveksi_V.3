import { getJurnalEntries, getKategoriTrxList, getPOList } from '@/lib/actions/keuangan/jurnal.actions';
import { bulanBerjalan } from '@/lib/bulan-berjalan';
import { createClient } from '@/lib/supabase/server';
import { getPoIdsPeriodeBaru } from '@/lib/keuangan/periode-po.server';
import { PageWrapper } from '@/components/ui/PageWrapper';
import JurnalClient from './JurnalClient';

export const metadata = {
  title: 'Jurnal Produksi | Stitchlyx',
};

export default async function JurnalUmumPage() {
  try {
    const { bulan, tahun } = bulanBerjalan();
    const [entries, kategoriList, poList, poBaru] = await Promise.all([
      getJurnalEntries({ bulan, tahun }),
      getKategoriTrxList(),
      getPOList(),
      createClient().then(getPoIdsPeriodeBaru),
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
          poBaruIds={[...poBaru]}
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
