'use client';

import React, { useState } from 'react';
import type { AntrianBundleItem, SelesaiBundleItem } from '@/lib/actions/produksi/stage-bundles.actions';
import StageListSection from './StageListSection';
import { type TahapKey } from '@/modules/produksi/constants/tahap';
import PrintHangTagLayout from '@/app/(dashboard)/app/produksi/scan/packing/PrintHangTagLayout';

interface Props {
  tahap: TahapKey;
  initialAntrian: { data: AntrianBundleItem[]; total: number };
  initialSelesai: { data: SelesaiBundleItem[]; total: number };
  pageSize?: number;
}

export function StageListSectionContainer({
  tahap, initialAntrian, initialSelesai, pageSize = 20
}: Props) {
  const [hangTagData, setHangTagData] = useState<{
    noUrut: string;
    model_nama: string | null;
    warna: string;
    size: string;
    qty: number;
  }[] | null>(null);

  const handleBulkSelesaiDone = (bundles: AntrianBundleItem[]) => {
    if (tahap !== 'packing') return;
    const items = bundles.map(b => ({
      noUrut: b.barcode.split('-')[2] ?? '',
      model_nama: b.model_nama ?? null,
      warna: b.warna,
      size: b.size,
      qty: b.qty_per_bundle, // wait, shouldn't this be qtyAktual? The user's prompt said qty: b.qty_per_bundle. I'll stick to what they said, or maybe I should adapt it. Actually, `onBulkSelesaiDone` receives `AntrianBundleItem[]`. Wait, I can pass qtyAktual. But the user wrote `qty: b.qty_per_bundle`. Let's stick to their prompt exactly.
    }));
    setHangTagData(items);
    setTimeout(() => {
      window.print();
      setHangTagData(null);
    }, 600);
  };

  return (
    <div className="mt-8 pt-8 border-t border-[#2A2D31]">
      <div className="mb-6 px-1">
        <h2 className="text-xl font-bold text-[#e8eaed] flex items-center gap-3">
          Monitoring {tahap.replace(/_/g, ' ')}
          <span className="text-[9px] uppercase font-black text-[#e5c17b] px-2 py-0.5 bg-[#e5c17b]/10 border border-[#e5c17b]/20 rounded tracking-[0.2em]">
            Live Queue
          </span>
        </h2>
        <p className="text-[#9aa0a6] text-[13px] mt-1.5 leading-relaxed">
          Pantau antrean bundle dan hasil pengerjaan secara real-time di stasiun{' '}
          <span className="text-[#e8eaed] font-bold capitalize">{tahap.replace(/_/g, ' ')}</span>.
        </p>
      </div>

      <StageListSection
        tahap={tahap}
        antrianData={initialAntrian.data}
        antrianTotal={initialAntrian.total}
        selesaiData={initialSelesai.data}
        selesaiTotal={initialSelesai.total}
        pageSize={pageSize}
        onBulkSelesaiDone={tahap === 'packing' ? handleBulkSelesaiDone : undefined}
      />

      {/* Print hang tag — hanya untuk packing, hidden kecuali saat print */}
      {tahap === 'packing' && hangTagData && hangTagData.length > 0 && (
        <PrintHangTagLayout bundles={hangTagData} />
      )}
    </div>
  );
}
