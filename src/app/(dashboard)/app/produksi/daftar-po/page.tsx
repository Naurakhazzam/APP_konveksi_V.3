import { PageWrapper } from '@/components/ui/PageWrapper';
import { getPoArtikelList } from '@/lib/actions/produksi/daftar-po.actions';
import DaftarPoClient from './DaftarPoClient';

export default async function DaftarPoPage() {
  const [aktifData, semuaData] = await Promise.all([
    getPoArtikelList('aktif'),
    getPoArtikelList('semua'),
  ]);

  return (
    <PageWrapper
      title="Daftar Artikel PO"
      subtitle="Semua artikel per PO — klik Detail untuk melihat tahapan kerja, cetak barcode, atau tiket nomor cutting"
    >
      <DaftarPoClient aktifData={aktifData} semuaData={semuaData} />
    </PageWrapper>
  );
}
