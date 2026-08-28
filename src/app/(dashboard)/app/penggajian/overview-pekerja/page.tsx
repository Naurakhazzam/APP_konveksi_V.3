import { getOverviewPekerja } from '@/lib/actions/penggajian/overview-pekerja.actions';
import { PageWrapper } from '@/components/ui/PageWrapper';
import OverviewPekerjaClient from './OverviewPekerjaClient';

export const metadata = { title: 'Overview Pekerja' };

/** Rentang minggu berjalan, Senin sampai Minggu. */
function mingguBerjalan() {
  const hariIni = new Date();
  const hari = hariIni.getDay();            // 0 = Minggu
  const mundur = hari === 0 ? 6 : hari - 1; // Senin sebagai awal minggu

  const senin = new Date(hariIni);
  senin.setDate(hariIni.getDate() - mundur);
  const minggu = new Date(senin);
  minggu.setDate(senin.getDate() + 6);

  const iso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  return { dari: iso(senin), sampai: iso(minggu) };
}

export default async function OverviewPekerjaPage() {
  const { dari, sampai } = mingguBerjalan();
  const ringkasan = await getOverviewPekerja(dari, sampai);

  return (
    <PageWrapper
      title="Overview Pekerja"
      subtitle="Siapa mengerjakan apa minggu ini, dan mana yang upahnya belum dibayar."
    >
      <div className="mt-6">
        <OverviewPekerjaClient initialData={ringkasan} dari={dari} sampai={sampai} />
      </div>
    </PageWrapper>
  );
}
