import { createClient } from '@/lib/supabase/server';
import { PageWrapper } from '@/components/ui/PageWrapper';
import ImportPoClient from './ImportPoClient';

export default async function ImportPoPage() {
  const supabase = await createClient();
  
  const { data: klienData, error } = await supabase
    .from('klien')
    .select('id, nama')
    .eq('tenant_id', 'STX-001')
    .order('nama');

  if (error) {
    console.error('Error fetching clients for import:', error);
  }

  const klienList = klienData || [];

  return (
    <PageWrapper 
      title="Import PO Massal" 
      subtitle="Upload file Excel untuk membuat banyak Purchase Order sekaligus"
    >
      <ImportPoClient klienList={klienList} />
    </PageWrapper>
  );
}
