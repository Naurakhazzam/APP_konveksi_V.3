import { getRingkasanKeuangan } from '@/lib/actions/keuangan/ringkasan.actions';
import { PageWrapper } from '@/components/ui/PageWrapper';
import RingkasanClient from './RingkasanClient';

export const metadata = { title: 'Ringkasan Keuangan | Stitchlyx' };

export default async function RingkasanPage() {
  try {
    const data = await getRingkasanKeuangan();
    return (
      <PageWrapper title="Ringkasan Keuangan" subtitle="Dashboard utama keuangan perusahaan">
        <div className="mt-6">
          <RingkasanClient initialData={data} />
        </div>
      </PageWrapper>
    );
  } catch (e) {
    return <div className="p-8 text-red-400">Error memuat data: {String(e)}</div>;
  }
}
