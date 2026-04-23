import { PageWrapper } from '@/components/ui/PageWrapper';
import { getKaryawanForTahap, getInventoryItemsAktif } from '@/lib/actions/produksi/scan.actions';
import { getAntrianPerTahap, getSelesaiPerTahap } from '@/lib/actions/produksi/stage-bundles.actions';
import ScanJahitClient from './ScanJahitClient';
import { StageListSectionContainer } from '@/components/produksi/StageListSectionContainer';

export default async function ScanJahitPage() {
  const [karyawanList, inventoryItems, antrianResult, selesaiResult] = 
    await Promise.all([
      getKaryawanForTahap('jahit'),
      getInventoryItemsAktif(),
      getAntrianPerTahap('jahit', 1, 20),
      getSelesaiPerTahap('jahit', 1, 20),
    ]);

  return (
    <PageWrapper
      title="Scan — Jahit"
      subtitle="Scan barcode untuk penerimaan dan penyelesaian bundle di tahap jahit"
    >
      <div className="space-y-8">
        <ScanJahitClient
          karyawanList={karyawanList}
          inventoryItems={inventoryItems}
        />
        <StageListSectionContainer
          tahap="jahit"
          initialAntrian={antrianResult}
          initialSelesai={selesaiResult}
        />
      </div>
    </PageWrapper>
  );
}
