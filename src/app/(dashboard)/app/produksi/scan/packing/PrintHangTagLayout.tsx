'use client';

import React from 'react';
import Barcode from 'react-barcode';

interface HangTagBundle {
  noUrut: string;
  model_nama: string | null;
  warna: string;
  size: string;
  qty: number;
}

interface Props {
  bundles: HangTagBundle[];
}

export default function PrintHangTagLayout({ bundles }: Props) {
  // Expand bundles according to qty
  const expandedTags = bundles.flatMap(bundle => 
    Array.from({ length: bundle.qty }).map((_, i) => ({
      ...bundle,
      _printIndex: i
    }))
  );

  if (expandedTags.length === 0) return null;

  return (
    <div className="hidden print:grid hang-tag-print-root grid-cols-4 gap-4 bg-white text-black p-4">
      <style>{`
        @media print {
          @page { size: A4 portrait; margin: 0.5cm; }

          * {
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
            color-adjust: exact !important;
          }

          html, body {
            height: auto !important;
            overflow: visible !important;
            background: white !important;
          }

          body * { visibility: hidden; }

          .hang-tag-print-root,
          .hang-tag-print-root * { visibility: visible; }

          .hang-tag-print-root {
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            display: grid !important;
            grid-template-columns: repeat(4, 1fr);
            gap: 0.75rem;
            padding: 0.5rem;
          }
        }
      `}</style>

      {expandedTags.map((tag, idx) => (
        <div
          key={`${tag.noUrut}-${idx}`}
          className="border-2 border-black p-3 flex flex-col items-center justify-center break-inside-avoid min-h-[140px] w-full"
        >
          {/* Barcode Section */}
          <div className="mb-2">
            <Barcode
              value={tag.noUrut}
              format="CODE128"
              width={1.2}
              height={35}
              displayValue={false}
              background="transparent"
              lineColor="#000000"
              margin={0}
            />
            <p className="text-center text-[11px] font-mono font-bold tracking-widest text-black mt-0.5">
              {tag.noUrut}
            </p>
          </div>

          {/* Info Section */}
          <div className="w-full mt-1 border-t border-black pt-1.5 text-center">
            {tag.model_nama && (
              <p className="text-xs font-bold leading-tight uppercase mb-1">
                {tag.model_nama}
              </p>
            )}
            <div className="flex justify-between items-center border-t border-dashed border-black pt-1 mt-1">
              <p className="text-sm font-black">{tag.size}</p>
              <p className="text-[10px] font-bold uppercase">{tag.warna}</p>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
