import { PageWrapper } from '@/components/ui/PageWrapper';
import { AlertOctagon } from 'lucide-react';

export default function MasterResetPage() {
  return (
    <PageWrapper
      title="Reset Factory"
      subtitle="Utility penghapusan dan reset data master/transaksi secara massal."
    >
      <div className="flex h-[400px] flex-col items-center justify-center rounded-xl border border-red-500/20 bg-red-500/5 p-8 text-center text-[#e8eaed]">
        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-red-500/20 text-red-500">
          <AlertOctagon className="h-8 w-8" />
        </div>
        <h3 className="mb-2 text-xl font-bold text-red-500">Coming Soon</h3>
        <p className="max-w-md text-[#9aa0a6]">
          Fitur kontrol berbahaya ini akan menghapus semua data (Soft / Hard Delete). Tersedia di Phase 13.
        </p>
      </div>
    </PageWrapper>
  );
}
