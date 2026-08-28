import { getHasilKerjaPekerja } from '@/lib/actions/produksi/kroscek-pekerjaan.actions';
import { PageWrapper } from '@/components/ui/PageWrapper';
import KroscekPekerjaanClient from './KroscekPekerjaanClient';

export const metadata = { title: 'Kroscek Pekerjaan' };

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

export default async function KroscekPekerjaanPage() {
  const { dari, sampai } = mingguBerjalan();
  const data = await getHasilKerjaPekerja(dari, sampai);

  return (
    <PageWrapper
      title="Kroscek Pekerjaan"
      subtitle="Pekerjaan yang sedang berjalan dan yang belum terbayar — cocokkan dengan lapangan."
    >
      <div className="mt-6">
        <KroscekPekerjaanClient initialData={data} dari={dari} sampai={sampai} />
      </div>
    </PageWrapper>
  );
}
