import { PageWrapper } from '@/components/ui/PageWrapper';
import { getKaryawanForTahap, getAntrianJahit } from '@/lib/actions/produksi/scan.actions';
import { getSelesaiPerTahap } from '@/lib/actions/produksi/stage-bundles.actions';
import ScanJahitClient from './ScanJahitClient';
import JahitListClient from './JahitListClient';

export default async function ScanJahitPage() {
  const [karyawanList, antrianResult, selesaiResult] = 
    await Promise.all([
      getKaryawanForTahap('jahit'),
      getAntrianJahit(),
      getSelesaiPerTahap('jahit', 1, 20),
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
