import { getKaryawanForTahap, getInventoryItemsAktif } from '@/lib/actions/produksi/scan.actions';
import { getAntrianPerTahap, getSelesaiPerTahap } from '@/lib/actions/produksi/stage-bundles.actions';
import { PageWrapper } from '@/components/ui/PageWrapper';
import ScanCuttingClient from './ScanCuttingClient';
import { StageListSectionContainer } from '@/components/produksi/StageListSectionContainer';

export default async function ScanCuttingPage() {
  const [karyawanList, inventoryItems, antrianResult, selesaiResult] = await Promise.all([
    getKaryawanForTahap('cutting'),
    getInventoryItemsAktif(),
    getAntrianPerTahap('cutting', 1, 20),
    getSelesaiPerTahap('cutting', 1, 20)
  ]);

  return (
    <PageWrapper
      title="Scan Station — Cutting"
      subtitle="Input penerimaan bundle dan pendaftaran pemakaian bahan"
    >
      <div className="space-y-8">
        <ScanCuttingClient 
          karyawanList={karyawanList} 
          inventoryItems={inventoryItems} 
        />

        <StageListSectionContainer 
          tahap="cutting"
          initialAntrian={antrianResult}
          initialSelesai={selesaiResult}
        />
      </div>
    </PageWrapper>
  );
}
