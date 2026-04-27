'use client';

import React from 'react';
import Barcode from 'react-barcode';
import type { AntrianBundle } from '@/lib/actions/produksi/antrian.actions';

interface Props {
  bundles: AntrianBundle[];
}

export default function PrintLabelLayout({ bundles }: Props) {
  return (
    <div className="label-print-root hidden print:grid print:grid-cols-2 gap-4 p-4 bg-white text-black font-sans">
      <style>{`
        @media print {
          @page { margin: 1cm; size: A4 portrait; }

          * {
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
            color-adjust: exact !important;
          }

          html, body {
            height: auto !important;
            overflow: visible !important;
          }

          body * { visibility: hidden; }

          .label-print-root,
          .label-print-root * { visibility: visible; }

          .label-print-root {
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            display: grid !important;
            grid-template-columns: 1fr 1fr;
            gap: 1rem;
            padding: 1rem;
          }
        }
      `}</style>

      {bundles.map((bundle) => {
        // No urut global — dipakai sebagai value barcode dan ditampilkan
        const noUrut = bundle.barcode.split('-')[2] ?? String(bundle.no_urut).padStart(5, '0');
        const bundleCode = bundle.barcode.split('-')[3] ?? '-';

        return (
          <div
            key={bundle.id}
            className="border-2 border-black p-4 flex flex-col items-center justify-center break-inside-avoid min-h-[180px]"
          >
            {/* Barcode — hanya encode no urut global */}
            <div className="mb-2">
              <Barcode
                value={noUrut}
                format="CODE128"
                width={1.5}
                height={45}
                displayValue={false}
                background="transparent"
                lineColor="#000000"
                margin={0}
              />
              <p className="text-center text-[11px] font-mono font-bold tracking-widest text-black mt-0.5">
                {noUrut}
              </p>
            </div>

            {/* Info Section */}
            <div className="w-full mt-2 border-t border-black pt-2">

              {/* Baris 1: NO PO | BUNDLE | NO. URUT */}
              <div className="flex justify-between items-end mb-1.5">
                <div>
                  <p className="text-[9px] uppercase font-bold text-black leading-none">Nomor PO</p>
                  <p className="text-sm font-bold leading-tight">{bundle.no_po}</p>
                </div>
                <div className="text-center">
                  <p className="text-[9px] uppercase font-bold text-black leading-none">Bundle</p>
                  <p className="text-sm font-bold leading-tight font-mono">{bundleCode}</p>
                </div>
                <div className="text-right">
                  <p className="text-[9px] uppercase font-bold text-black leading-none">No. Urut Global</p>
                  <p className="text-lg font-black leading-none font-mono">{noUrut}</p>
                </div>
              </div>

              {/* Baris 2: MODEL */}
              {bundle.model_nama && (
                <div className="border-t border-dashed border-black pt-1 mt-1 mb-1">
                  <p className="text-[9px] uppercase font-bold text-black leading-none">Model</p>
                  <p className="text-xs font-semibold truncate">{bundle.model_nama}</p>
                </div>
              )}

              {/* Baris 3: WARNA / SIZE | QTY */}
              <div className="flex justify-between items-center border-t border-dashed border-black pt-1 mt-1">
                <div className="flex-1">
                  <p className="text-xs font-semibold">{bundle.warna} / {bundle.size}</p>
                </div>
                <div className="text-right shrink-0 ml-2">
                  <p className="text-xl font-black">
                    {bundle.qty_per_bundle}
                    <span className="text-[10px] font-normal uppercase ml-1">pcs</span>
                  </p>
                </div>
              </div>

            </div>
          </div>
        );
      })}
    </div>
  );
}
