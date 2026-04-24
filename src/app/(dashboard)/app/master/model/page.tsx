import { getModelList } from '@/lib/actions/master/detail.actions';
import { PageWrapper } from '@/components/ui/PageWrapper';
import Link from 'next/link';

export default async function ModelListPage() {
  const models = await getModelList();
  return (
    <PageWrapper title="Setup Model" subtitle="Pilih model untuk mengatur aksesori dan detail produksi.">
      <div className="mt-6 grid gap-3">
        {models.map((m: any) => (
          <Link
            key={m.id}
            href={`/app/master/model/${m.id}`}
            className="flex items-center justify-between p-4 rounded-xl bg-[#16181A] border border-[#2A2D31] hover:border-[#e5c17b]/40 transition-colors"
          >
            <div>
              <p className="text-sm font-semibold text-[#e8eaed]">{m.nama}</p>
              <p className="text-xs text-[#9aa0a6]">{m.kategori_produk?.nama ?? '-'}</p>
            </div>
            <span className="text-xs text-[#e5c17b]">Setup →</span>
          </Link>
        ))}
      </div>
    </PageWrapper>
  );
}
