import { PageWrapper } from '@/components/ui/PageWrapper';
import { getAntrianPerTahap, getSelesaiPerTahap }
  from '@/lib/actions/produksi/stage-bundles.actions';
import ScanSimpleClient
  from '@/app/(dashboard)/app/produksi/scan/_shared/ScanSimpleClient';
import { StageListSectionContainer }
  from '@/components/produksi/StageListSectionContainer';

export default async function ScanSteamPage() {
  const [antrianResult, selesaiResult] = await Promise.all([
    getAntrianPerTahap('steam', 1, 20),
    getSelesaiPerTahap('steam', 1, 20),
  ]);

  return (
    <PageWrapper
      title="Scan — Steam"
      subtitle="Scan barcode untuk penerimaan dan penyelesaian bundle"
    >
      <div className="space-y-8">
        <ScanSimpleClient
          tahap="steam"
          tahapLabel="Steam"
          mode="single"
        />
        <StageListSectionContainer
          tahap="steam"
          initialAntrian={antrianResult}
          initialSelesai={selesaiResult}
        />
      </div>
    </PageWrapper>
  );
}
