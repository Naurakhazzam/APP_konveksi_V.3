import { getLaporanLR } from '@/lib/actions/keuangan/laporan-lr.actions';
import LaporanLRClient from './LaporanLRClient';

export default async function LaporanLRPage() {
  const tahun = new Date().getFullYear();
  // Default: fokus PO periode baru (PO-0100 ke atas)
  const data  = await getLaporanLR(tahun, undefined, undefined, true);

  return <LaporanLRClient initialData={data} initialTahun={tahun} />;
}
