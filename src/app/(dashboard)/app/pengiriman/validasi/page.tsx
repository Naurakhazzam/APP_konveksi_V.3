import { getSuratJalanSiapValidasi } from '@/lib/actions/pengiriman/validasi-pengiriman.actions';
import { getAlasanRejectList } from '@/lib/actions/produksi/reject.actions';
import { getQtyLebihKirimPending } from '@/lib/actions/pengiriman/surat-jalan.actions';
import ValidasiClient from './ValidasiClient';
import QtyLebihKirimSection from './QtyLebihKirimSection';

export const metadata = {
  title: 'Validasi Pengiriman | Stitchlyx Syncore',
  description: 'Validasi penerimaan bundle oleh klien setelah pengiriman',
};

export default async function ValidasiPage() {
  const [sjList, alasanList, qtyLebihPending] = await Promise.all([
    getSuratJalanSiapValidasi(),
    getAlasanRejectList(),
    getQtyLebihKirimPending(),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[#e8eaed]">Validasi Pengiriman</h1>
        <p className="text-sm text-[#9aa0a6] mt-1">
          Catat qty yang diterima klien dan konfirmasi selisih (kurang / lebih)
        </p>
      </div>

      <QtyLebihKirimSection initialPending={qtyLebihPending} />

      <ValidasiClient initialSjList={sjList} alasanList={alasanList} />
    </div>
  );
}
