import { PageWrapper } from '@/components/ui/PageWrapper';
import { getModelById } from '@/lib/actions/master/detail.actions';
import { getModelAksesori } from '@/lib/actions/produksi/model-aksesori.actions';
import { redirect, notFound } from 'next/navigation';
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

  try {
    const [model, aksesoris] = await Promise.all([
      getModelById(id),
      getModelAksesori(id)
    ]);

    if (!model) {
      notFound();
    }

    return (
      <PageWrapper
        title={model.nama}
        subtitle={`Detail model dan manajemen kebutuhan aksesori.`}
        actions={
          <Link 
            href="/app/master/produk"
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
  } catch (error) {
    console.error('Error fetching model detail:', error);
    redirect('/app/master/produk');
  }
}
