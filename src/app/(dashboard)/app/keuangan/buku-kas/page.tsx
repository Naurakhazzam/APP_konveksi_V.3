import { getBukuKasEntries, getPOListForKas, getHppKomponenOverhead } from '@/lib/actions/keuangan/buku-kas.actions';
import BukuKasClient from './BukuKasClient';

export const metadata = {
  title: 'Buku Kas | Stitchlyx',
};

export default async function BukuKasPage() {
  try {
    // Default: bulan berjalan (zona waktu WIB)
    const [tahun, bulan] = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit' })
      .format(new Date()).split('-');
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
