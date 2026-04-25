import { PageWrapper } from '@/components/ui/PageWrapper';
import { getAntrianPerTahap, getSelesaiPerTahap }
  from '@/lib/actions/produksi/stage-bundles.actions';
import { getKaryawan } from '@/lib/actions/master/karyawan.actions';
import ScanSimpleClient
  from '@/app/(dashboard)/app/produksi/scan/_shared/ScanSimpleClient';
import { StageListSectionContainer }
  from '@/components/produksi/StageListSectionContainer';

export default async function ScanLubangKancingPage() {
  const [antrianResult, selesaiResult, karyawanList] = await Promise.all([
    getAntrianPerTahap('lubang_kancing', 1, 20),
    getSelesaiPerTahap('lubang_kancing', 1, 20),
    getKaryawan(),
  ]);

  const hengky = karyawanList?.find(k => 
    k.nama?.toUpperCase().includes('HENGKY')
  );

  return (
    <PageWrapper
      title="Scan — Lubang Kancing"
      subtitle="Scan barcode untuk penerimaan dan penyelesaian bundle"
    >
      <div className="space-y-8">
        <ScanSimpleClient
          tahap="lubang_kancing"
          tahapLabel="Lubang Kancing"
          mode="single"
          karyawanId={hengky?.id}
        />
        <StageListSectionContainer
          tahap="lubang_kancing"
          initialAntrian={antrianResult}
          initialSelesai={selesaiResult}
        />
      </div>
    </PageWrapper>
  );
}
