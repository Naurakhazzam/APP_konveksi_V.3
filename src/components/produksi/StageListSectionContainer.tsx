'use client';

import React from 'react';
import type { AntrianBundleItem, SelesaiBundleItem } from '@/lib/actions/produksi/stage-bundles.actions';
import StageListSection from './StageListSection';
import { type TahapKey } from '@/modules/produksi/constants/tahap';

interface Props {
  tahap: TahapKey;
  initialAntrian: { data: AntrianBundleItem[]; total: number };
  initialSelesai: { data: SelesaiBundleItem[]; total: number };
  pageSize?: number;
}

export function StageListSectionContainer({
  tahap,
  initialAntrian,
  initialSelesai,
  pageSize = 20
}: Props) {
  return (
    <div className="mt-8 pt-8 border-t border-[#2A2D31]">
      <div className="mb-6 px-1">
        <h2 className="text-xl font-bold text-[#e8eaed] flex items-center gap-3">
          Monitoring {tahap.replace('_', ' ')}
          <span className="text-[9px] uppercase font-black text-[#e5c17b] px-2 py-0.5 bg-[#e5c17b]/10 border border-[#e5c17b]/20 rounded tracking-[0.2em] shadow-[0_0_15px_rgba(229,193,123,0.1)]">
            Live Queue
          </span>
        </h2>
        <p className="text-[#9aa0a6] text-[13px] mt-1.5 leading-relaxed">
          Pantau antrean bundle dan hasil pengerjaan secara real-time di stasiun <span className="text-[#e8eaed] font-bold capitalize">{tahap.replace('_', ' ')}</span>.
        </p>
      </div>
      
      <StageListSection 
        tahap={tahap}
        antrianData={initialAntrian.data}
        antrianTotal={initialAntrian.total}
        selesaiData={initialSelesai.data}
        selesaiTotal={initialSelesai.total}
        pageSize={pageSize}
      />
    </div>
  );
}
