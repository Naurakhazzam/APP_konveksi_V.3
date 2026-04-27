import { getLaporanLR } from '@/lib/actions/keuangan/laporan-lr.actions';
import LaporanLRClient from './LaporanLRClient';

export default async function LaporanLRPage() {
  const tahun = new Date().getFullYear();
  const data  = await getLaporanLR(tahun);

  return <LaporanLRClient initialData={data} initialTahun={tahun} />;
}
