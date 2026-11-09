'use client';

import React from 'react';
import type { AntrianBundle } from '@/lib/actions/produksi/antrian.actions';

interface Props {
  bundles: AntrianBundle[];
}

// A4 portrait, margin 10mm → area cetak 190 × 277 mm.
// 4 kolom × 10 baris = 40 label/halaman, tiap label ±45.6 × 25 mm.
// Tanpa garis barcode: scan cukup dengan mengetik / membaca No. Urut Global.
const KOLOM = 4;
const BARIS = 10;
const PER_HALAMAN = KOLOM * BARIS;

export default function PrintLabelLayout({ bundles }: Props) {
  const halaman: AntrianBundle[][] = [];
  for (let i = 0; i < bundles.length; i += PER_HALAMAN) {
    halaman.push(bundles.slice(i, i + PER_HALAMAN));
  }

  return (
    <div className="label-print-root hidden bg-white text-black font-sans">
      <style>{`
        @media print {
          @page { margin: 10mm; size: A4 portrait; }

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
            display: block !important;
            position: absolute;
            top: 0;
            left: 0;
            width: 190mm;
          }

          .label-page {
            display: grid;
            grid-template-columns: repeat(${KOLOM}, 1fr);
            grid-auto-rows: 25mm;
            column-gap: 2.5mm;
            row-gap: 2mm;
            width: 190mm;
            break-after: page;
            page-break-after: always;
          }
          .label-page:last-child {
            break-after: auto;
            page-break-after: auto;
          }

          .label-item {
            box-sizing: border-box;
            height: 25mm;
            overflow: hidden;
            border: 1px solid #000;
            padding: 1.2mm 1.8mm;
            display: flex;
            flex-direction: column;
            justify-content: space-between;
            break-inside: avoid;
            page-break-inside: avoid;
          }
        }
      `}</style>

      {halaman.map((isi, idx) => (
        <div key={idx} className="label-page">
          {isi.map((bundle) => {
            const noUrut = bundle.barcode.split('-')[2] ?? String(bundle.no_urut).padStart(5, '0');
            const bundleCode = bundle.barcode.split('-')[3] ?? '-';

            return (
              <div key={bundle.id} className="label-item">
                {/* No. Urut Global — dipakai untuk scan */}
                <p className="text-center text-[20px] font-black font-mono tracking-widest leading-none">
                  {noUrut}
                </p>

                {/* PO · Bundle */}
                <div className="flex justify-between border-t border-black pt-0.5 text-[8px] font-bold leading-tight">
                  <span>{bundle.no_po}</span>
                  <span className="font-mono">{bundleCode}</span>
                </div>

                {/* Model, Warna / Size | Qty */}
                <div className="flex justify-between items-end border-t border-dashed border-black pt-0.5 gap-1">
                  <div className="min-w-0 flex-1">
                    {bundle.model_nama && (
                      <p className="text-[8px] font-bold leading-tight truncate">{bundle.model_nama}</p>
                    )}
                    <p className="text-[7.5px] font-semibold leading-tight truncate">
                      {bundle.warna} / {bundle.size}
                    </p>
                  </div>
                  <p className="text-[12px] font-black leading-none shrink-0">
                    {bundle.qty_per_bundle}
                    <span className="text-[6.5px] font-normal uppercase ml-0.5">pcs</span>
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
