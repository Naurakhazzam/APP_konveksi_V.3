import { PageWrapper } from '@/components/ui/PageWrapper';
import { getCurrentUserProfile } from '@/lib/auth/permissions';
import { getPendingApprovals } from '@/lib/actions/produksi/qty-approval.actions';
import { redirect } from 'next/navigation';
import ApprovalClient from './ApprovalClient';
import { Badge } from '@/components/ui/badge';

export default async function ApprovalPage() {
  const profile = await getCurrentUserProfile();
  
  if (!profile || profile.role !== 'owner') {
    redirect('/app');
  }

  const initialData = await getPendingApprovals();

  return (
    <PageWrapper
      title="Approval QTY Lebih"
      subtitle="Otorisasi permintaan penyelesaian bundle dengan jumlah melebihi QTY terima."
      actions={
        <div className="flex items-center gap-2">
          <Badge className="bg-[#e5c17b]/20 text-[#e5c17b] border-[#e5c17b]/30 px-3 py-1">
            {initialData.length} Menunggu
          </Badge>
        </div>
      }
    >
      <div className="mt-6">
        <ApprovalClient initialData={initialData} />
      </div>
    </PageWrapper>
  );
}
