import { getBukuKasEntries, getPOListForKas, getHppKomponenOverhead } from '@/lib/actions/keuangan/buku-kas.actions';
import BukuKasClient from './BukuKasClient';

export const metadata = {
  title: 'Buku Kas | Stitchlyx',
};

export default async function BukuKasPage() {
  try {
    const [entries, poList, kompoList] = await Promise.all([
      getBukuKasEntries(),
      getPOListForKas(),
      getHppKomponenOverhead(),
    ]);
    return <BukuKasClient initialEntries={entries} poList={poList} kompoList={kompoList} />;
  } catch (e) {
    return (
      <div className="p-8 text-red-400">
        Error memuat Buku Kas: {String(e)}
      </div>
    );
  }
}
