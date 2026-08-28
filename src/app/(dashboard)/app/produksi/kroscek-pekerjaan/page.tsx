import { getHasilKerjaPekerja } from '@/lib/actions/produksi/kroscek-pekerjaan.actions';
import { PageWrapper } from '@/components/ui/PageWrapper';
import KroscekPekerjaanClient from './KroscekPekerjaanClient';

export const metadata = { title: 'Kroscek Pekerjaan' };

/**
 * Rentang satu siklus penggajian: SABTU sampai JUMAT.
 *
 * Bukan Senin–Minggu. Cutoff-nya mengikuti siklus gaji yang dipakai halaman
 * Rekap Gaji, supaya angka di sini bisa langsung dicocokkan dengan
 * perhitungan upah — kalau batas minggunya beda, jumlah pcs-nya ikut beda
 * dan kroscek jadi tidak ada gunanya.
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

export default async function KroscekPekerjaanPage() {
  const { dari, sampai } = siklusGajiBerjalan();
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
