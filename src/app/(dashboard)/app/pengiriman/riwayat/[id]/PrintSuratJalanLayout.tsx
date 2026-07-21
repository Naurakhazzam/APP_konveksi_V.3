import React from 'react';
import type { SuratJalanDetail } from '@/lib/actions/pengiriman/surat-jalan.actions';

export default function PrintSuratJalanLayout({ detail }: { detail: SuratJalanDetail }) {
  // Grouping item by NO_PO + Warna + Size + Model
  const groupedItems = detail.items.reduce((acc, item) => {
    const key = `${item.no_po}-${item.model_nama}-${item.warna}-${item.size}`;
    if (!acc[key]) {
      acc[key] = {
        no_po: item.no_po,
        model_nama: item.model_nama,
        warna: item.warna,
        size: item.size,
        qty_kirim: 0
      };
    }
    acc[key].qty_kirim += item.qty_kirim;
    return acc;
  }, {} as Record<string, { no_po: string, model_nama: string | null, warna: string, size: string, qty_kirim: number }>);

  const groupedArray = Object.values(groupedItems);
  const totalQty = groupedArray.reduce((sum, i) => sum + i.qty_kirim, 0);

  return (
    <div className="sj-print-root hidden print:block font-sans text-black bg-white">
      <style>{`
        @media print {
          @page { margin: 1cm; size: A4 portrait; }
          * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
          html, body { height: auto !important; overflow: visible !important; background: white !important; }
          body * { visibility: hidden; }
          .sj-print-root, .sj-print-root * { visibility: visible; }
          .sj-print-root { position: absolute; top: 0; left: 0; width: 100%; background: white !important; }
          table { border-collapse: collapse; width: 100%; }
        }
      `}</style>

      {/* Kop Surat Header (Opsional, disesuaikan) */}
      <div className="text-center border-b-2 border-black pb-2 mb-3">
        <h1 className="text-lg font-bold tracking-wide uppercase">Surat Jalan</h1>
        <p className="text-xs">Stitchlyx Syncore</p>
      </div>

      {/* Info SJ */}
      <div className="flex justify-between mb-4 text-xs">
        <div>
          <table className="text-left">
            <tbody>
              <tr><td className="py-0.5 pr-3 font-semibold">Kepada</td><td className="py-0.5">: {detail.klien_nama}</td></tr>
              <tr><td className="py-0.5 pr-3 font-semibold align-top">Alamat</td><td className="py-0.5 max-w-[280px] align-top">: {detail.klien_alamat || '-'}</td></tr>
            </tbody>
          </table>
        </div>
        <div>
          <table className="text-left">
            <tbody>
              <tr><td className="py-0.5 pr-3 font-semibold">No. Surat Jalan</td><td className="py-0.5">: {detail.nomor_sj}</td></tr>
              <tr><td className="py-0.5 pr-3 font-semibold">Tanggal</td><td className="py-0.5">: {new Date(detail.tanggal).toLocaleDateString('id-ID', { year: 'numeric', month: 'long', day: 'numeric' })}</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="mb-3">
        <p className="text-xs mb-1">Harap diterima dengan baik barang-barang berikut ini:</p>
        <table className="w-full text-xs border border-black">
          <thead>
            <tr className="border-b border-black">
              <th className="border-r border-black py-1 px-2 w-8 text-center">No</th>
              <th className="border-r border-black py-1 px-2">No PO</th>
              <th className="border-r border-black py-1 px-2">Deskripsi (Model)</th>
              <th className="border-r border-black py-1 px-2">Warna / Size</th>
              <th className="py-1 px-2 text-right w-20">QTY (Pcs)</th>
            </tr>
          </thead>
          <tbody>
            {groupedArray.map((item, idx) => (
              <tr key={idx} className="border-b border-black">
                <td className="border-r border-black py-1 px-2 text-center">{idx + 1}</td>
                <td className="border-r border-black py-1 px-2">{item.no_po}</td>
                <td className="border-r border-black py-1 px-2">{item.model_nama || '-'}</td>
                <td className="border-r border-black py-1 px-2">{item.warna} / {item.size}</td>
                <td className="py-1 px-2 text-right font-medium">{item.qty_kirim}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-black font-bold">
              <td colSpan={4} className="border-r border-black py-1 px-2 text-right">TOTAL</td>
              <td className="py-1 px-2 text-right">{totalQty}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {detail.catatan && (
        <div className="mb-3 text-xs border border-black p-2 min-h-[28px]">
          <strong>Catatan:</strong><br/>
          {detail.catatan}
        </div>
      )}

      {/* Tanda Tangan */}
      <div className="grid grid-cols-3 gap-4 text-center text-xs mt-5">
        <div>
          <p className="mb-8">Penerima,</p>
          <p className="font-semibold border-b border-black inline-block min-w-[110px]">( ................................ )</p>
        </div>
        <div>
          <p className="mb-8">Pengirim (Driver),</p>
          <p className="font-semibold border-b border-black inline-block min-w-[110px]">( <span id="sj-driver-name">................................</span> )</p>
        </div>
        <div>
          <p className="mb-6">Hormat Kami,</p>
          <p className="font-bold text-xs mb-1">FAUZAN</p>
          <p className="font-semibold border-b border-black inline-block min-w-[110px]">( ................................ )</p>
        </div>
      </div>

      <div className="mt-4 text-[9px] text-gray-500 text-right">
        Dicetak otomatis oleh Stitchlyx Syncore pada {new Date().toLocaleString('id-ID')}
      </div>
    </div>
  );
}
