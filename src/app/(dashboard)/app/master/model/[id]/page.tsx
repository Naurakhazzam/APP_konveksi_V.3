import { PageWrapper } from '@/components/ui/PageWrapper';
import { getModelById } from '@/lib/actions/master/detail.actions';
import { getModelAksesori } from '@/lib/actions/produksi/model-aksesori.actions';
import { notFound } from 'next/navigation';
import ModelDetailClient from './ModelDetailClient';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';

interface PageProps {
  params: {
    id: string;
  };
}

export default async function ModelDetailPage({ params }: PageProps) {
  const { id } = params;

  let model: any = null;
  let aksesoris: any[] = [];
  let errorMsg: string | null = null;

  try {
    const results = await Promise.all([
      getModelById(id),
      getModelAksesori(id)
    ]);
    model = results[0];
    aksesoris = results[1];
  } catch (err: any) {
    errorMsg = err?.message ?? String(err);
  }

  if (errorMsg) {
    return (
      <div style={{ padding: '40px', fontFamily: 'monospace' }}>
        <h2 style={{ color: 'red' }}>DEBUG ERROR</h2>
        <pre style={{ background: '#1a1a1a', color: '#ff6b6b', padding: '20px', borderRadius: '8px', whiteSpace: 'pre-wrap' }}>
          {errorMsg}
        </pre>
      </div>
    );
  }

  if (!model) {
    notFound();
  }

  return (
    <PageWrapper
      title={model.nama}
      subtitle={"Detail model dan manajemen kebutuhan aksesori."}
      actions={
        <Link
          href="/app/master/model"
          className="flex items-center gap-2 text-sm text-[#9aa0a6] hover:text-[#e8eaed] transition-colors"
        >
          <ArrowLeft size={16} />
          Kembali ke Daftar
        </Link>
      }
    >
      <div className="mt-6">
        <ModelDetailClient model={model} initialAksesoris={aksesoris} />
      </div>
    </PageWrapper>
  );
}
