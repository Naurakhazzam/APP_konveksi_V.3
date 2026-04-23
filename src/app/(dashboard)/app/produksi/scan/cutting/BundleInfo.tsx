'use client';

import { TAHAP_ORDER, TAHAP_CONFIG } from '@/modules/produksi/constants/tahap';

interface TahapStatus {
  status: string | null;
  qty_terima: number | null;
  qty_selesai: number | null;
}

interface BundleInfoProps {
  bundle: {
    barcode: string;
    no_po: string;
    klien_nama: string;
    model_nama: string | null;
    warna: string;
    size: string;
    qty_order: number;
    qty_per_bundle: number;
    no_urut: number;
    status_tahap: Record<string, TahapStatus>;
  };
}

function TahapBadge({ tahap, info }: { tahap: string; info: TahapStatus | undefined }) {
  const status = info?.status ?? null;
  const isActive = status === 'terima';

  if (status === 'selesai') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium bg-[color:var(--status-green)]/15 text-[color:var(--status-green)] ring-1 ring-inset ring-[color:var(--status-green)]/25">
        ✓ Selesai
      </span>
    );
  }
  if (isActive) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium bg-[#e5c17b]/15 text-[#e5c17b] ring-1 ring-inset ring-[#e5c17b]/30 animate-pulse">
        ⟳ Proses
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium bg-[#2A2D31] text-[#9aa0a6] ring-1 ring-inset ring-[#2A2D31]">
      Belum
    </span>
  );
}

export function BundleInfo({ bundle }: BundleInfoProps) {
  const infoItems = [
    { label: 'Klien',      value: bundle.klien_nama },
    { label: 'Model',      value: bundle.model_nama ?? '-' },
    { label: 'Warna',      value: bundle.warna },
    { label: 'Size',       value: bundle.size },
    { label: 'QTY Bundle', value: `${bundle.qty_per_bundle} pcs` },
    { label: 'No. Urut',   value: `#${bundle.no_urut}` },
  ];

  return (
    <div className="rounded-xl border border-[#2A2D31] bg-[#1A1D1F] overflow-hidden shadow-lg">
      {/* Header */}
      <div className="p-4 border-b border-[#2A2D31] bg-[#16181A] flex items-start justify-between gap-4">
        <div>
          <p className="font-mono text-lg font-bold text-[#e5c17b] tracking-widest">
            {bundle.barcode}
          </p>
          <p className="text-sm text-[#9aa0a6] mt-0.5">{bundle.no_po}</p>
        </div>
        <span className="shrink-0 rounded-md bg-[#2A2D31] px-2 py-1 text-xs font-medium text-[#9aa0a6]">
          Bundle
        </span>
      </div>

      {/* Info grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-px bg-[#2A2D31]">
        {infoItems.map((item) => (
          <div key={item.label} className="bg-[#1A1D1F] p-3">
            <p className="text-[10px] uppercase tracking-wide text-[#9aa0a6] mb-0.5">{item.label}</p>
            <p className="text-sm font-medium text-[#e8eaed]">{item.value}</p>
          </div>
        ))}
      </div>

      {/* Stage progress */}
      <div className="p-4 border-t border-[#2A2D31]">
        <p className="text-[10px] uppercase tracking-wide text-[#9aa0a6] mb-3">Progress Tahap</p>
        <div className="flex flex-wrap gap-2">
          {TAHAP_ORDER.map((tahap) => {
            const info = bundle.status_tahap[tahap];
            const isActive = info?.status === 'terima';
            return (
              <div
                key={tahap}
                className={`flex flex-col items-center gap-1 rounded-lg px-3 py-2 transition-colors ${
                  isActive
                    ? 'bg-[#e5c17b]/10 ring-1 ring-[#e5c17b]/30'
                    : 'bg-[#16181A]'
                }`}
              >
                <span className="text-[10px] font-medium text-[#9aa0a6]">
                  {TAHAP_CONFIG[tahap].label}
                </span>
                <TahapBadge tahap={tahap} info={info} />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
