import Link from 'next/link';
import { Upload } from 'lucide-react';
import { getNextPoNumber, getKlienList, getModelList } from '@/lib/actions/produksi/po.actions';
import { PageWrapper } from '@/components/ui/PageWrapper';
import { Button } from '@/components/ui/button';
import { InputPoForm } from './InputPoForm';

export default async function InputPoPage() {
  const [nextPoNumber, klienList, modelList] = await Promise.all([
    getNextPoNumber(),
    getKlienList(),
    getModelList(),
  ]);

  return (
    <PageWrapper
      title="Input Purchase Order"
      subtitle="Buat PO baru dan generate barcode bundle otomatis"
      actions={
        <Link href="/app/produksi/po/import">
          <Button variant="outline" className="flex items-center gap-2 border-[#2A2D31] text-[#e8eaed] hover:bg-[#2A2D31]">
            <Upload className="w-4 h-4" />
            Import Massal
          </Button>
        </Link>
      }
    >
      <InputPoForm
        defaultPoNumber={nextPoNumber}
        klienList={klienList}
        modelList={modelList}
      />
    </PageWrapper>
  );
}
