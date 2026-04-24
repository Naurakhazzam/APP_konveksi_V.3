import { PageWrapper } from '@/components/ui/PageWrapper';
import { getAntrianPerTahap, getSelesaiPerTahap }
  from '@/lib/actions/produksi/stage-bundles.actions';
import ScanSimpleClient
  from '@/app/(dashboard)/app/produksi/scan/_shared/ScanSimpleClient';
import { StageListSectionContainer }
  from '@/components/produksi/StageListSectionContainer';

export default async function ScanPackingPage() {
  const [antrianResult, selesaiResult] = await Promise.all([
    getAntrianPerTahap('packing', 1, 20),
    getSelesaiPerTahap('packing', 1, 20),
  ]);

  return (
    <PageWrapper
      title="Scan — Packing"
      subtitle="Scan barcode untuk penerimaan dan penyelesaian bundle"
    >
      <div className="space-y-8">
        <ScanSimpleClient
          tahap="packing"
          tahapLabel="Packing"
          mode="standard"
        />
        <StageListSectionContainer
          tahap="packing"
          initialAntrian={antrianResult}
          initialSelesai={selesaiResult}
        />
      </div>
    </PageWrapper>
  );
}

    </PageWrapper>
  );
}
