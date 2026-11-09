import { PageWrapper } from '@/components/ui/PageWrapper';
import { getAntrianTahap, getRiwayatSelesaiTahap, type TahapBorongan }
  from '@/lib/actions/produksi/tahap-borongan.actions';
import { TAHAP_CONFIG } from '@/modules/produksi/constants/tahap';
import ScanSimpleClient from './ScanSimpleClient';
import TahapListClient from './TahapListClient';

/** Halaman bersama Lubang Kancing, Buang Benang, QC, Steam. */
export default async function TahapBoronganPage({ tahap }: { tahap: TahapBorongan }) {
  const [antrian, selesai] = await Promise.all([
    getAntrianTahap(tahap),
    getRiwayatSelesaiTahap(tahap, 1, 20),
  ]);
  const label = TAHAP_CONFIG[tahap].label;

  return (
    <PageWrapper
      title={`Scan — ${label}`}
      subtitle="Scan barcode untuk penerimaan dan penyelesaian bundle"
    >
      <div className="space-y-8">
        <ScanSimpleClient tahap={tahap} tahapLabel={label} mode="single" />
        <TahapListClient tahap={tahap} initialAntrian={antrian} initialSelesai={selesai} />
      </div>
    </PageWrapper>
  );
}
