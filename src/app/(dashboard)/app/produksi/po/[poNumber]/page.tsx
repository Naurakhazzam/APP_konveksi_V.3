import { notFound } from 'next/navigation';
import { getPoDetail } from '@/lib/actions/produksi/po.actions';
import { PageWrapper } from '@/components/ui/PageWrapper';
import { BackButton, PoDetailActions, PoDetailTable } from './PoDetailClient';

function formatDate(dateString: string) {
  if (!dateString) return '—';
  return new Date(dateString).toLocaleDateString('id-ID', {
    day: '2-digit', month: 'short', year: 'numeric'
  });
}

function getStatusBadge(status: string) {
  switch (status) {
    case 'draft': 
      return <span className="inline-flex rounded-md px-2 py-1 text-xs font-medium ring-1 ring-inset bg-[#9aa0a6]/10 text-[#9aa0a6] ring-[#9aa0a6]/20">Draft</span>;
    case 'selesai': 
      return <span className="inline-flex rounded-md px-2 py-1 text-xs font-medium ring-1 ring-inset bg-[color:var(--status-green)]/10 text-[color:var(--status-green)] ring-[color:var(--status-green)]/20">Selesai</span>;
    case 'dibatalkan': 
      return <span className="inline-flex rounded-md px-2 py-1 text-xs font-medium ring-1 ring-inset bg-[color:var(--status-red)]/10 text-[color:var(--status-red)] ring-[color:var(--status-red)]/20">Dibatalkan</span>;
    default: 
      return <span className="inline-flex rounded-md px-2 py-1 text-xs font-medium ring-1 ring-inset bg-[color:var(--status-yellow)]/10 text-[color:var(--status-yellow)] ring-[color:var(--status-yellow)]/20">Aktif</span>;
  }
}

export default async function PoDetailPage({ params }: { params: Promise<{ poNumber: string }> }) {
  const { poNumber } = await params;
  let detail;
  try {
    detail = await getPoDetail(poNumber);
  } catch (err) {
    notFound();
  }

  if (!detail) notFound();

  return (
    <PageWrapper
      title={`PO ${detail.no_po}`}
      subtitle={`Klien: ${detail.klien?.nama || '-'} · ${formatDate(detail.tanggal_order)}`}
      actions={
        <div className="flex items-center gap-3">
          <BackButton />
          <PoDetailActions po={detail} />
        </div>
      }
    >
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 bg-[#1A1D1F] p-5 rounded-xl border border-[#2A2D31] shadow-sm mb-6">
        <div className="space-y-4">
          <div>
            <div className="text-xs text-[#9aa0a6] font-medium tracking-wide mb-1 uppercase">No. PO</div>
            <div className="text-sm font-semibold text-[#e8eaed]">{detail.no_po}</div>
          </div>
          <div>
            <div className="text-xs text-[#9aa0a6] font-medium tracking-wide mb-1 uppercase">Tanggal Order</div>
            <div className="text-sm font-medium text-[#e8eaed]">{formatDate(detail.tanggal_order)}</div>
          </div>
        </div>
        <div className="space-y-4">
          <div>
            <div className="text-xs text-[#9aa0a6] font-medium tracking-wide mb-1 uppercase">Status</div>
            <div>{getStatusBadge(detail.status)}</div>
          </div>
          <div>
            <div className="text-xs text-[#9aa0a6] font-medium tracking-wide mb-1 uppercase">Deadline</div>
            <div className="text-sm font-medium text-[#e8eaed]">
              {detail.tanggal_target ? formatDate(detail.tanggal_target) : '—'}
            </div>
          </div>
        </div>
        <div className="col-span-1 md:col-span-2 pt-4 border-t border-[#2A2D31]">
          <div className="text-xs text-[#9aa0a6] font-medium tracking-wide mb-1 uppercase">Catatan</div>
          <div className="text-sm text-[#e8eaed] whitespace-pre-wrap leading-relaxed">{detail.catatan || '—'}</div>
        </div>
      </div>

      <PoDetailTable items={detail.po_item} />
    </PageWrapper>
  );
}
