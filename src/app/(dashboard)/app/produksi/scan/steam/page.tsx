import { PageWrapper } from '@/components/ui/PageWrapper';
import { getAntrianPerTahap, getSelesaiPerTahap }
  from '@/lib/actions/produksi/stage-bundles.actions';
import { getKaryawan } from '@/lib/actions/master/karyawan.actions';
import ScanSimpleClient
  from '@/app/(dashboard)/app/produksi/scan/_shared/ScanSimpleClient';
import { StageListSectionContainer }
  from '@/components/produksi/StageListSectionContainer';

export default async function ScanSteamPage() {
  const [antrianResult, selesaiResult, karyawanList] = await Promise.all([
    getAntrianPerTahap('steam', 1, 20),
    getSelesaiPerTahap('steam', 1, 20),
    getKaryawan(),
  ]);

  const hengky = karyawanList?.find(k => 
    k.nama?.toUpperCase().includes('HENGKY')
  );

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
          karyawanId={hengky?.id}
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
