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
          @page { margin: 1.5cm; size: A4 portrait; }
          * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
          html, body { height: auto !important; overflow: visible !important; background: white !important; }
          body * { visibility: hidden; }
          .sj-print-root, .sj-print-root * { visibility: visible; }
          .sj-print-root { position: absolute; top: 0; left: 0; width: 100%; background: white !important; }
          table { border-collapse: collapse; width: 100%; }
        }
      `}</style>

      {/* Kop Surat Header (Opsional, disesuaikan) */}
      <div className="text-center border-b-2 border-black pb-4 mb-6">
        <h1 className="text-2xl font-bold tracking-wider uppercase">Surat Jalan</h1>
        <p className="text-sm">Stitchlyx Syncore</p>
      </div>

      {/* Info SJ */}
      <div className="flex justify-between mb-8 text-sm">
        <div>
          <table className="text-left">
            <tbody>
              <tr><td className="py-1 pr-4 font-semibold">Kepada</td><td className="py-1">: {detail.klien_nama}</td></tr>
              <tr><td className="py-1 pr-4 font-semibold">Alamat</td><td className="py-1 max-w-[300px] align-top">: {detail.klien_alamat || '-'}</td></tr>
            </tbody>
          </table>
        </div>
        <div>
          <table className="text-left">
            <tbody>
              <tr><td className="py-1 pr-4 font-semibold">No. Surat Jalan</td><td className="py-1">: {detail.nomor_sj}</td></tr>
              <tr><td className="py-1 pr-4 font-semibold">Tanggal</td><td className="py-1">: {new Date(detail.tanggal).toLocaleDateString('id-ID', { year: 'numeric', month: 'long', day: 'numeric' })}</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="mb-6">
        <p className="text-sm mb-2">Harap diterima dengan baik barang-barang berikut ini:</p>
        <table className="w-full text-sm border-2 border-black">
          <thead>
            <tr className="border-b-2 border-black">
              <th className="border-r border-black py-2 px-3 w-10 text-center">No</th>
              <th className="border-r border-black py-2 px-3">No PO</th>
              <th className="border-r border-black py-2 px-3">Deskripsi (Model)</th>
              <th className="border-r border-black py-2 px-3">Warna / Size</th>
              <th className="py-2 px-3 text-right w-24">QTY (Pcs)</th>
            </tr>
          </thead>
          <tbody>
            {groupedArray.map((item, idx) => (
              <tr key={idx} className="border-b border-black">
                <td className="border-r border-black py-2 px-3 text-center">{idx + 1}</td>
                <td className="border-r border-black py-2 px-3">{item.no_po}</td>
                <td className="border-r border-black py-2 px-3">{item.model_nama || '-'}</td>
                <td className="border-r border-black py-2 px-3">{item.warna} / {item.size}</td>
                <td className="py-2 px-3 text-right font-medium">{item.qty_kirim}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-black font-bold">
              <td colSpan={4} className="border-r border-black py-2 px-3 text-right">TOTAL</td>
              <td className="py-2 px-3 text-right">{totalQty}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {detail.catatan && (
        <div className="mb-8 text-sm border border-black p-3 min-h-[60px]">
          <strong>Catatan:</strong><br/>
          {detail.catatan}
        </div>
      )}

      {/* Tanda Tangan */}
      <div className="grid grid-cols-3 gap-8 text-center text-sm mt-12">
        <div>
          <p className="mb-20">Penerima,</p>
          <p className="font-semibold border-b border-black inline-block min-w-[150px]">( ................................ )</p>
        </div>
        <div>
          <p className="mb-20">Pengirim (Driver),</p>
          <p className="font-semibold border-b border-black inline-block min-w-[150px]">( ................................ )</p>
        </div>
        <div>
          <p className="mb-20">Hormat Kami,</p>
          <p className="font-semibold border-b border-black inline-block min-w-[150px]">( ................................ )</p>
        </div>
      </div>

      <div className="fixed bottom-0 right-0 p-4 text-[10px] text-gray-500 w-full text-right">
        Dicetak otomatis oleh Stitchlyx Syncore pada {new Date().toLocaleString('id-ID')}
      </div>
    </div>
  );
}
