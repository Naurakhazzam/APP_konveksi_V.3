import { PageWrapper } from '@/components/ui/PageWrapper';
import { getAntrianPerTahap, getSelesaiPerTahap }
  from '@/lib/actions/produksi/stage-bundles.actions';
import ScanSimpleClient
  from '@/app/(dashboard)/app/produksi/scan/_shared/ScanSimpleClient';
import { StageListSectionContainer }
  from '@/components/produksi/StageListSectionContainer';

export default async function ScanBuangBenangPage() {
  const [antrianResult, selesaiResult] = await Promise.all([
    getAntrianPerTahap('buang_benang', 1, 20),
    getSelesaiPerTahap('buang_benang', 1, 20),
  ]);

  return (
    <PageWrapper
      title="Scan — Buang Benang"
      subtitle="Scan barcode untuk penerimaan dan penyelesaian bundle"
    >
      <div className="space-y-8">
        <ScanSimpleClient
          tahap="buang_benang"
          tahapLabel="Buang Benang"
        />
        <StageListSectionContainer
          tahap="buang_benang"
          initialAntrian={antrianResult}
          initialSelesai={selesaiResult}
        />
      </div>
    </PageWrapper>
  );
}
