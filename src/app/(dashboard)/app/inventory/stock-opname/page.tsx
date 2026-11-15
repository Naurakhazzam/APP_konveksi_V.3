import { PageWrapper } from '@/components/ui/PageWrapper';
import { getOpnameData } from '@/lib/actions/inventory/stock-opname.actions';
import { bulanBerjalan } from '@/lib/bulan-berjalan';
import StockOpnameClient from './StockOpnameClient';

export const metadata = { title: 'Stock Opname | Stitchlyx' };

export default async function StockOpnamePage() {
  const data = await getOpnameData();
  const { bulan, tahun } = bulanBerjalan();
  const hariIni = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());
  return (
    <PageWrapper title="Stock Opname" subtitle="Hitung fisik stok — pemakaian bahan pembantu dihitung dari selisihnya">
      <StockOpnameClient data={data} hariIni={hariIni} bulanIni={`${tahun}-${bulan}`} />
    </PageWrapper>
  );
}
