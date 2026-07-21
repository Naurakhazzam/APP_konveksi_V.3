import { PageWrapper } from '@/components/ui/PageWrapper';
import LacakBarcodeClient from './LacakBarcodeClient';

export default function LacakBarcodePage() {
  return (
    <PageWrapper
      title="Lacak Barcode"
      subtitle="Scan barcode untuk cek posisi produksi, status kirim, dan penjahitnya — berguna saat menangani retur"
    >
      <LacakBarcodeClient />
    </PageWrapper>
  );
}
