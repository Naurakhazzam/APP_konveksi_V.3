import { getRekapGaji } from '@/lib/actions/penggajian/penggajian.actions';
import RekapGajiClient from './RekapGajiClient';
import { PageWrapper } from '@/components/ui/PageWrapper';

export const metadata = { title: 'Rekap Gaji' };

// Helper to get default cycle (Last Saturday to Next Friday)
function getPayrollCycleRange() {
  const today = new Date();
  const dayOfWeek = today.getDay(); // 0=Sunday, 6=Saturday
  const daysToLastSaturday = dayOfWeek === 6 ? 0 : dayOfWeek + 1;
  const lastSaturday = new Date(today);
  lastSaturday.setDate(today.getDate() - daysToLastSaturday);
  const nextFriday = new Date(lastSaturday);
  nextFriday.setDate(lastSaturday.getDate() + 6);

  return {
    dari: lastSaturday.toISOString().split('T')[0],
    sampai: nextFriday.toISOString().split('T')[0]
  };
}

export default async function RekapGajiPage() {
  const range = getPayrollCycleRange();
  const rekap = await getRekapGaji(range.dari, range.sampai);

  return (
    <PageWrapper title="Rekap Gaji" subtitle="Manajemen pembayaran upah borongan dan kasbon">
      <div className="mt-6">
        <RekapGajiClient 
          initialRekap={rekap} 
          tanggal_dari={range.dari} 
          tanggal_sampai={range.sampai} 
        />
      </div>
    </PageWrapper>
  );
}
