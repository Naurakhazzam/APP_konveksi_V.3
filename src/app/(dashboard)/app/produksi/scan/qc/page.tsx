import { PageWrapper } from '@/components/ui/PageWrapper';
import { getAntrianPerTahap, getSelesaiPerTahap }
  from '@/lib/actions/produksi/stage-bundles.actions';
import ScanSimpleClient
  from '@/app/(dashboard)/app/produksi/scan/_shared/ScanSimpleClient';
import { StageListSectionContainer }
  from '@/components/produksi/StageListSectionContainer';

export default async function ScanQCPage() {
  const [antrianResult, selesaiResult] = await Promise.all([
    getAntrianPerTahap('qc', 1, 20),
    getSelesaiPerTahap('qc', 1, 20),
  ]);

  return (
    <PageWrapper
      title="Scan — QC"
      subtitle="Scan barcode untuk penerimaan dan penyelesaian bundle"
    >
      <div className="space-y-8">
        <ScanSimpleClient
          tahap="qc"
          tahapLabel="QC"
          mode="single"
        />
        <StageListSectionContainer
          tahap="qc"
          initialAntrian={antrianResult}
          initialSelesai={selesaiResult}
        />
      </div>
    </PageWrapper>
  );
}
