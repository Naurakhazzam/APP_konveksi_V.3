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

      {bundles.map((bundle) => (
        <div 
          key={bundle.id} 
          className="border-2 border-black p-4 flex flex-col items-center justify-center break-inside-avoid min-h-[180px]"
        >
          {/* Barcode Section */}
          <div className="mb-2">
            <Barcode
              value={bundle.barcode}
              format="CODE128"
              width={1}
              height={40}
              displayValue={false}
              fontSize={12}
              background="transparent"
              lineColor="#000000"
              margin={0}
            />
            <p className="text-center text-[10px] font-mono tracking-widest text-black mt-0.5">
              {bundle.barcode.split('-')[2]}
            </p>
          </div>

          {/* Info Section */}
          <div className="w-full mt-2 border-t border-black pt-2">
            <div className="flex justify-between items-end mb-1">
              <div>
                <p className="text-[10px] uppercase font-bold text-black leading-none">Nomor PO</p>
                <p className="text-sm font-bold leading-tight">{bundle.no_po}</p>
              </div>
              <div className="text-center">
                <p className="text-[10px] uppercase font-bold text-black leading-none">Bundle</p>
                <p className="text-sm font-bold leading-tight font-mono">{bundle.barcode.split('-')[3]}</p>
              </div>
              <div className="text-right">
                <p className="text-[10px] uppercase font-bold text-black leading-none">No. Urut Global</p>
                <p className="text-lg font-black leading-none font-mono">{bundle.barcode.split('-')[2]}</p>
              </div>
            </div>

            <div className="flex justify-between items-center border-t border-dashed border-black pt-1 mt-1">
              <div className="flex-1">
                <p className="text-[10px] uppercase font-bold text-black leading-none">Varian (Warna / Size)</p>
                <p className="text-xs font-medium truncate">{bundle.warna} / {bundle.size}</p>
              </div>
              <div className="text-right shrink-0 ml-2">
                <p className="text-xl font-black">{bundle.qty_per_bundle} <span className="text-[10px] font-normal uppercase">pcs</span></p>
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
