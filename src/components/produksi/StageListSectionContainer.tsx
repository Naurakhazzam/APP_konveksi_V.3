'use client';

import React, { useState } from 'react';
import type { AntrianBundleItem, SelesaiBundleItem } from '@/lib/actions/produksi/stage-bundles.actions';
import StageListSection from './StageListSection';
import { type TahapKey } from '@/modules/produksi/constants/tahap';
import { scanLanjutTahap, scanSelesai } from '@/lib/actions/produksi/scan-mutations.actions';
import PrintHangTagLayout from '@/app/(dashboard)/app/produksi/scan/packing/PrintHangTagLayout';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';

interface Props {
  tahap: TahapKey;
  initialAntrian: { data: AntrianBundleItem[]; total: number };
  initialSelesai: { data: SelesaiBundleItem[]; total: number };
  pageSize?: number;
}

export function StageListSectionContainer({
  tahap, initialAntrian, initialSelesai, pageSize = 20
}: Props) {
  const router = useRouter();
  const [hangTagData, setHangTagData] = useState<{
    noUrut: string;
    model_nama: string | null;
    warna: string;
    size: string;
    qty: number;
  }[] | null>(null);

  const handlePackingBulkSelesai = async (bundles: AntrianBundleItem[]) => {
    let berhasil = 0;
    const printItems: typeof hangTagData = [];

    for (const bundle of bundles) {
      try {
        await scanLanjutTahap({
          barcode: bundle.barcode,
          tahap_baru: 'packing',
          karyawan_id: '',
          qty: bundle.qty_per_bundle,
        });
        await scanSelesai({
          barcode: bundle.barcode,
          tahap: 'packing',
          karyawan_id: null,
          qty: bundle.qty_per_bundle,
          catatan: undefined,
          alasan_qty_id: null,
          tenant_id: 'STX-001',
        });
        printItems!.push({
          noUrut: bundle.barcode.split('-')[2] ?? '',
          model_nama: bundle.model_nama ?? null,
          warna: bundle.warna,
          size: bundle.size,
          qty: bundle.qty_per_bundle,
        });
        berhasil++;
      } catch (err: any) {
        toast.error(`Gagal: ${bundle.barcode} — ${err.message}`);
      }
    }

    if (berhasil > 0) {
      toast.success(`${berhasil} bundle berhasil diselesaikan`);
      setHangTagData(printItems);
      // Tunda print agar layout render dulu
      setTimeout(() => {
        window.print();
        setHangTagData(null);
      }, 600);
    }
    router.refresh();
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
        onBulkSelesai={tahap === 'packing' ? handlePackingBulkSelesai : undefined}
      />

      {/* Print hang tag — hanya untuk packing, hidden kecuali saat print */}
      {tahap === 'packing' && hangTagData && hangTagData.length > 0 && (
        <PrintHangTagLayout bundles={hangTagData} />
      )}
    </div>
  );
}
