'use client';

import React from 'react';
import Barcode from 'react-barcode';
import type { AntrianBundle } from '@/lib/actions/produksi/antrian.actions';

interface Props {
  bundles: AntrianBundle[];
}

/**
 * Tiket "Nomor Cutting" — penanda fisik yang diselipkan ke dalam bundle
 * setelah cutting, sebelum diserahkan ke tukang jahit. Tukang jahit
 * mengembalikan tiket ini ke admin untuk ditukar dengan SPK.
 *
 * Tata letak: 2 kolom × 4 baris = 8 tiket per lembar A4. Nomor cutting
 * = no. urut global (segmen ke-3 barcode), dicetak besar. Hanya artefak
 * cetak — tidak menyimpan apa pun ke database.
 */
export default function PrintCuttingTicketLayout({ bundles }: Props) {
  return (
    <div className="cutting-ticket-root hidden print:grid print:grid-cols-2 bg-white text-black font-sans">
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
            background: white !important;
          }

          body * { visibility: hidden; }

          .cutting-ticket-root,
          .cutting-ticket-root * { visibility: visible; }

          .cutting-ticket-root {
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            display: grid !important;
            grid-template-columns: 1fr 1fr;
            gap: 0.3cm;
          }

          /* 8 tiket per halaman A4 → tiap tiket ~6.5cm tinggi */
          .cutting-ticket {
            height: 6.5cm;
            break-inside: avoid;
            page-break-inside: avoid;
          }
        }
      `}</style>

      {bundles.map((bundle) => {
        // Nomor cutting = no. urut global (segmen ke-3 barcode). Fallback ke
        // no_urut bila format barcode tak terduga.
        const noCutting =
          bundle.barcode.split('-')[2] ?? String(bundle.no_urut).padStart(5, '0');

        return (
          <div
            key={bundle.id}
            className="cutting-ticket border border-black flex flex-col overflow-hidden"
          >
            {/* Judul + nomor cutting besar (satu baris hemat tempat) */}
            <div className="flex items-center justify-between border-b border-black px-2 py-1">
              <div className="leading-none">
                <p className="text-[7px] font-bold uppercase tracking-[0.15em]">Tiket Nomor Cutting</p>
                <p className="text-[6px] uppercase tracking-widest text-black/60 mt-0.5">Stitchlyx.Syncore</p>
              </div>
              <div className="text-right leading-none">
                <p className="text-[6px] uppercase font-bold tracking-widest text-black/60">No. Cutting</p>
                <p className="text-2xl font-black font-mono leading-none">{noCutting}</p>
              </div>
            </div>

            {/* Identitas barang */}
            <div className="px-2 py-1 flex-1 text-[9px] leading-snug space-y-0.5">
              <div className="flex justify-between gap-2">
                <span className="uppercase font-bold text-black/60">No PO</span>
                <span className="font-bold text-right">{bundle.no_po}</span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="uppercase font-bold text-black/60">Artikel</span>
                <span className="font-semibold text-right truncate max-w-[62%]">{bundle.model_nama ?? '-'}</span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="uppercase font-bold text-black/60">Warna / Size</span>
                <span className="font-semibold text-right">{bundle.warna} / {bundle.size}</span>
              </div>
              <div className="flex justify-between gap-2 border-t border-dashed border-black pt-0.5 mt-0.5">
                <span className="uppercase font-bold text-black/60">QTY Bundle</span>
                <span className="text-sm font-black leading-none">
                  {bundle.qty_per_bundle}
                  <span className="text-[7px] font-normal uppercase ml-0.5">pcs</span>
                </span>
              </div>
            </div>

            {/* Barcode kecil */}
            <div className="border-t border-black px-2 py-1 flex flex-col items-center">
              <Barcode
                value={noCutting}
                format="CODE128"
                width={1}
                height={22}
                displayValue={false}
                background="transparent"
                lineColor="#000000"
                margin={0}
              />
              <p className="text-center text-[7px] font-mono font-bold tracking-wider text-black mt-0.5">
                {bundle.barcode}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
