import { getBukuKasEntries, getPOListForKas, getHppKomponenOverhead } from '@/lib/actions/keuangan/buku-kas.actions';
import { bulanBerjalan } from '@/lib/bulan-berjalan';
import BukuKasClient from './BukuKasClient';

export const metadata = {
  title: 'Buku Kas | Stitchlyx',
};

export default async function BukuKasPage() {
  try {
    // Default: bulan berjalan (WIB)
    const { bulan, tahun } = bulanBerjalan();
    const [entries, poList, kompoList] = await Promise.all([
      getBukuKasEntries({ bulan, tahun }),
      getPOListForKas(),
      getHppKomponenOverhead(),
    ]);
    return <BukuKasClient initialEntries={entries} poList={poList} kompoList={kompoList} defaultBulan={bulan} defaultTahun={tahun} />;
  } catch (e) {
    return (
      <div className="p-8 text-red-400">
        Error memuat Buku Kas: {String(e)}
      </div>
    );
  }
}
