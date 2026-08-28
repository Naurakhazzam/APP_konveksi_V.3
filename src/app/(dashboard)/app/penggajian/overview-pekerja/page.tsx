import { getOverviewPekerja } from '@/lib/actions/penggajian/overview-pekerja.actions';
import { PageWrapper } from '@/components/ui/PageWrapper';
import OverviewPekerjaClient from './OverviewPekerjaClient';

export const metadata = { title: 'Overview Pekerja' };

/**
 * Rentang satu siklus penggajian: SABTU sampai JUMAT — sama seperti Rekap Gaji,
 * supaya total di halaman ini bisa langsung dicocokkan dengan perhitungan upah.
 */
function siklusGajiBerjalan() {
  const hariIni = new Date();
  const hari = hariIni.getDay();                 // 0 = Minggu, 6 = Sabtu
  const mundur = hari === 6 ? 0 : hari + 1;      // Sabtu sebagai awal siklus

  const sabtu = new Date(hariIni);
  sabtu.setDate(hariIni.getDate() - mundur);
  const jumat = new Date(sabtu);
  jumat.setDate(sabtu.getDate() + 6);

  const iso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  return { dari: iso(sabtu), sampai: iso(jumat) };
}

export default async function OverviewPekerjaPage() {
  const { dari, sampai } = siklusGajiBerjalan();
  const ringkasan = await getOverviewPekerja(dari, sampai);

  return (
    <PageWrapper
      title="Overview Pekerja"
      subtitle="Upah yang masih perlu dibayar minggu ini — yang sudah lunas tidak ditampilkan."
    >
      <div className="mt-6">
        <OverviewPekerjaClient initialData={ringkasan} dari={dari} sampai={sampai} />
      </div>
    </PageWrapper>
  );
}
