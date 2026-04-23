'use client';

import React from 'react';
import type { AntrianBundle } from '@/lib/actions/produksi/antrian.actions';

interface Props {
  bundles: AntrianBundle[];
}

function formatDate(dateStr: string) {
  if (!dateStr) return '-';
  return new Date(dateStr).toLocaleDateString('id-ID', {
    day: '2-digit', month: 'long', year: 'numeric',
  });
}

// Generate ID dokumen dari tanggal
function generateDocId() {
  const now = new Date();
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `SPK-${pad(now.getDate())}${pad(now.getMonth() + 1)}${now.getFullYear().toString().slice(-2)}`;
}

export default function PrintSPKLayout({ bundles }: Props) {
  // Group bundle → per PO → per po_item_id
  const poGroups = bundles.reduce((acc, b) => {
    if (!acc[b.po_id]) {
      acc[b.po_id] = {
        no_po: b.no_po,
        klien_nama: b.klien_nama,
        tanggal_order: b.tanggal_order,
        tanggal_target: b.tanggal_target,
        itemGroups: {} as Record<string, AntrianBundle[]>,
      };
    }
    if (!acc[b.po_id].itemGroups[b.po_item_id]) {
      acc[b.po_id].itemGroups[b.po_item_id] = [];
    }
    acc[b.po_id].itemGroups[b.po_item_id].push(b);
    return acc;
  }, {} as Record<string, {
    no_po: string; klien_nama: string; tanggal_order: string;
    tanggal_target: string; itemGroups: Record<string, AntrianBundle[]>;
  }>);

  return (
    <div className="spk-print-root hidden print:block font-sans text-black bg-white">
      <style>{`
        @media print {
          @page { margin: 1.5cm; size: A4 portrait; }

          * {
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
            color-adjust: exact !important;
          }

          html, body {
            height: auto !important;
            overflow: visible !important;
          }

          /* Sembunyikan semua elemen halaman */
          body * { visibility: hidden; }

          /* Tampilkan hanya SPK */
          .spk-print-root,
          .spk-print-root * { visibility: visible; }

          .spk-print-root {
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
          }

          /* Table rules */
          table { border-collapse: collapse; width: 100%; }
          thead { display: table-header-group; }
          tfoot { display: table-footer-group; }
          tr { break-inside: avoid; page-break-inside: avoid; }
        }
      `}</style>
      {Object.entries(poGroups).map(([poId, group], poIndex) => {
        const itemRows = Object.values(group.itemGroups);
        const totalQty = itemRows.reduce((s, g) => s + g.reduce((ss, b) => ss + b.qty_per_bundle, 0), 0);
        const totalBundle = itemRows.reduce((s, g) => s + g.length, 0);

        return (
          <div key={poId} className="p-8" style={poIndex > 0 ? { breakBefore: 'page', pageBreakBefore: 'always' } : {}}>
            {/* Header */}
            <div className="flex justify-between items-start mb-6">
              <div>
                <p className="text-xs font-bold tracking-widest uppercase text-black">STITCHLYX.SYNCORE</p>
                <h1 className="text-2xl font-black uppercase tracking-tight mt-1">
                  Surat Perintah Kerja (SPK) Cutting
                </h1>
                <p className="text-xs text-black mt-1">Tanggal: {formatDate(new Date().toISOString())}</p>
              </div>
              <div className="text-right">
                <p className="text-xs text-black">ID Dokumen:</p>
                <p className="text-sm font-bold">{generateDocId()}</p>
              </div>
            </div>

            {/* Info PO */}
            <div className="grid grid-cols-3 gap-4 mb-4 text-sm">
              <div>
                <p className="text-[10px] uppercase font-bold text-black">Nomor PO</p>
                <p className="font-black text-base">{group.no_po}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase font-bold text-black">Klien</p>
                <p className="font-bold">{group.klien_nama}</p>
              </div>
              <div className="text-right">
                <p className="text-[10px] uppercase font-bold text-black">Target Selesai</p>
                <p className="font-black">{formatDate(group.tanggal_target)}</p>
              </div>
            </div>

            {/* Tabel SPK */}
            <table className="w-full border-collapse text-[10px] mb-8">
              <thead>
                <tr className="bg-black text-white">
                  <th className="border border-black p-2 text-center w-8" rowSpan={2}>NO</th>
                  <th className="border border-black p-2 text-left" rowSpan={2}>KODE BARCODE</th>
                  <th className="border border-black p-2 text-left" rowSpan={2}>ARTIKEL</th>
                  <th className="border border-black p-2 text-center w-10" rowSpan={2}>SIZE</th>
                  <th className="border border-black p-2 text-center w-16" rowSpan={2}>WARNA</th>
                  <th className="border border-black p-2 text-center" colSpan={2}>TARGET (GENERATE)</th>
                  <th className="border border-black p-2 text-center" colSpan={2}>AKTUAL (KOSONGKAN)</th>
                  <th className="border border-black p-2 text-center w-20" rowSpan={2}>PEMAKAIAN BAHAN</th>
                  <th className="border border-black p-2 text-center w-20" rowSpan={2}>KETERANGAN</th>
                </tr>
                <tr className="bg-black text-white text-[9px]">
                  <th className="border border-black p-1 text-center w-16">QTY ORDER</th>
                  <th className="border border-black p-1 text-center w-12">BUNDLE</th>
                  <th className="border border-black p-1 text-center w-16">QTY REAL</th>
                  <th className="border border-black p-1 text-center w-12">BUNDLE</th>
                </tr>
              </thead>
              <tbody>
                {itemRows.map((itemGroup, idx) => {
                  const first = itemGroup[0];
                  const qtyOrder = itemGroup.reduce((s, b) => s + b.qty_per_bundle, 0);
                  return (
                    <tr key={first.po_item_id} className="h-12 break-inside-avoid">
                      <td className="border border-black p-2 text-center font-bold">{idx + 1}</td>
                      <td className="border border-black p-2 font-mono text-[9px] truncate max-w-[120px]">
                        {first.barcode.split('-').slice(0, 3).join('-')}
                      </td>
                      <td className="border border-black p-2 font-medium">{first.model_nama ?? '-'}</td>
                      <td className="border border-black p-2 text-center font-bold">{first.size}</td>
                      <td className="border border-black p-2 text-center">{first.warna}</td>
                      <td className="border border-black p-2 text-center font-bold">{qtyOrder}</td>
                      <td className="border border-black p-2 text-center font-bold">{itemGroup.length}</td>
                      <td className="border border-black p-2"></td>
                      <td className="border border-black p-2"></td>
                      <td className="border border-black p-2"></td>
                      <td className="border border-black p-2"></td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="bg-white font-bold text-[10px]">
                  <td colSpan={5} className="border border-black p-2 text-right uppercase">Total</td>
                  <td className="border border-black p-2 text-center">{totalQty} pcs</td>
                  <td className="border border-black p-2 text-center">{totalBundle}</td>
                  <td colSpan={4} className="border border-black p-2"></td>
                </tr>
              </tfoot>
            </table>

            {/* Tanda Tangan */}
            <div className="grid grid-cols-3 gap-8 mt-12 text-center text-[10px]">
              {['Bagian Produksi / Admin', 'Kepala Tim Cutting', 'Mengetahui'].map((label) => (
                <div key={label}>
                  <p className="mb-16">{label}</p>
                  <div className="border-t border-black pt-1">
                    <p className="text-black font-mono">( _______________ )</p>
                  </div>
                </div>
              ))}
            </div>

            {/* Footer note */}
            <p className="text-[9px] text-black italic mt-8">
              Dicetak otomatis oleh Stitchlyx Syncore pada {new Date().toLocaleString('id-ID')}
            </p>
          </div>
        );
      })}
    </div>
  );
}
