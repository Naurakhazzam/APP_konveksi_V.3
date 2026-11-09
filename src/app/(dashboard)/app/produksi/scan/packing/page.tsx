import { PageWrapper } from '@/components/ui/PageWrapper';
import { getAntrianTahap, getRiwayatSelesaiTahap }
  from '@/lib/actions/produksi/tahap-borongan.actions';
import ScanSimpleClient
  from '@/app/(dashboard)/app/produksi/scan/_shared/ScanSimpleClient';
import TahapListClient
  from '@/app/(dashboard)/app/produksi/scan/_shared/TahapListClient';

export default async function ScanPackingPage() {
  const [antrian, selesai] = await Promise.all([
    getAntrianTahap('packing'),
    getRiwayatSelesaiTahap('packing', 1, 20),
  ]);

  return (
    <PageWrapper
      title="Scan — Packing"
      subtitle="Scan barcode untuk penerimaan dan penyelesaian bundle"
    >
      <div className="space-y-8">
        {/* Panel scan atas dibiarkan (terima → selesai + cetak ulang hang tag). */}
        <ScanSimpleClient tahap="packing" tahapLabel="Packing" mode="standard" />
        <TahapListClient tahap="packing" initialAntrian={antrian} initialSelesai={selesai} />
      </div>
    </PageWrapper>
  );
}
