import { PageWrapper } from '@/components/ui/PageWrapper';
import { getKaryawanForTahap, getAntrianJahit } from '@/lib/actions/produksi/scan.actions';
import { getRiwayatSelesaiJahit } from '@/lib/actions/produksi/jahit.actions';
import ScanJahitClient from './ScanJahitClient';
import JahitListClient from './JahitListClient';

export default async function ScanJahitPage() {
  const [karyawanList, antrianResult, selesaiResult] = 
    await Promise.all([
      getKaryawanForTahap('jahit'),
      getAntrianJahit(),
      getRiwayatSelesaiJahit(1, 20),
    ]);

  return (
    <PageWrapper
      title="Scan — Jahit"
      subtitle="Scan barcode untuk penerimaan dan penyelesaian bundle di tahap jahit"
    >
      <div className="space-y-2">
        <ScanJahitClient
          karyawanList={karyawanList}
        />
        <JahitListClient
          initialAntrian={antrianResult}
          initialSelesai={selesaiResult}
          karyawanList={karyawanList}
        />
      </div>
    </PageWrapper>
  );
}
