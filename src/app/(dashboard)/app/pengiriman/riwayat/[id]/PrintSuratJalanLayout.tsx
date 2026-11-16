import React from 'react';
import type { SuratJalanDetail, NilaiSuratJalan } from '@/lib/actions/pengiriman/surat-jalan.actions';

const rp = (n: number) => Math.round(n).toLocaleString('id-ID');

// Dicetak di kertas A6 (105 x 148 mm). Layout dipadatkan supaya ±15 baris
// tabel muat satu lembar; lebih dari itu otomatis lanjut ke lembar berikutnya
// (header tabel diulang, tanda tangan tidak terpotong).
// Kolom harga (kelas sj-harga) hanya ada bila `nilai` diisi — server hanya mengirimnya ke owner &
// admin keuangan — dan hanya tercetak lewat tombol "Cetak + Nominal" (kelas sj-cetak-harga di <html>).
export default function PrintSuratJalanLayout({ detail, nilai }: { detail: SuratJalanDetail; nilai?: NilaiSuratJalan | null }) {
  const adaHarga = !!nilai && detail.jenis !== 'kirim_ulang';
  // Grouping item by NO_PO + Warna + Size + Model
  const groupedItems = detail.items.reduce((acc, item) => {
    const key = `${item.no_po}-${item.model_nama}-${item.warna}-${item.size}`;
    if (!acc[key]) {
      acc[key] = {
        no_po: item.no_po,
        model_nama: item.model_nama,
        warna: item.warna,
        size: item.size,
        qty_kirim: 0,
        subtotal: 0,
      };
    }
    acc[key].qty_kirim += item.qty_kirim;
    acc[key].subtotal += item.qty_kirim * (nilai?.harga[item.surat_jalan_item_id] ?? 0);
    return acc;
  }, {} as Record<string, { no_po: string, model_nama: string | null, warna: string, size: string, qty_kirim: number, subtotal: number }>);

  const groupedArray = Object.values(groupedItems);
  const totalQty = groupedArray.reduce((sum, i) => sum + i.qty_kirim, 0);
  const totalNilai = groupedArray.reduce((sum, i) => sum + i.subtotal, 0);

  const cell = 'border border-black px-1 py-[1px]';

  return (
    <div className="sj-print-root hidden print:block font-sans text-black bg-white text-[9px] leading-tight">
      <style>{`
        @media print {
          @page { margin: 5mm; size: A6 portrait; }
          * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
          html, body { height: auto !important; overflow: visible !important; background: white !important; }
          body * { visibility: hidden; }
          .sj-print-root, .sj-print-root * { visibility: visible; }
          .sj-print-root { position: absolute; top: 0; left: 0; width: 100%; background: white !important; }
          .sj-print-root table { border-collapse: collapse; width: 100%; }
          .sj-print-root thead { display: table-header-group; }
          .sj-print-root tr, .sj-no-break { break-inside: avoid; page-break-inside: avoid; }
          .sj-print-root .sj-harga { display: none; }
          .sj-cetak-harga .sj-print-root .sj-harga { display: table-cell; }
          .sj-cetak-harga .sj-print-root div.sj-harga { display: block; }
        }
      `}</style>

      {/* Kop */}
      <div className="flex items-end justify-between border-b border-black pb-1 mb-1">
        <div>
          <h1 className="text-[12px] font-bold tracking-wide uppercase leading-none">Surat Jalan</h1>
          {detail.jenis === 'kirim_ulang' && (
            <p className="text-[8px] font-bold uppercase">Kirim Ulang Barang Reject</p>
          )}
          <p className="text-[8px]">Stitchlyx Syncore</p>
        </div>
        <div className="text-right">
          <p className="font-bold">{detail.nomor_sj}</p>
          <p>{new Date(detail.tanggal).toLocaleDateString('id-ID', { year: 'numeric', month: 'short', day: 'numeric' })}</p>
        </div>
      </div>

      {/* Kepada */}
      <div className="mb-1">
        <p><span className="font-semibold">Kepada:</span> {detail.klien_nama}</p>
        {detail.klien_alamat && <p><span className="font-semibold">Alamat:</span> {detail.klien_alamat}</p>}
      </div>

      <table>
        <thead>
          <tr>
            <th className={`${cell} w-[14px] text-center`}>No</th>
            <th className={`${cell} text-left`}>{detail.jenis === 'kirim_ulang' ? 'Reject / SJ Asal' : 'No PO'}</th>
            <th className={`${cell} text-left`}>Model</th>
            <th className={`${cell} text-left`}>Warna / Size</th>
            <th className={`${cell} text-right w-[32px]`}>Qty</th>
            {adaHarga && <th className={`${cell} sj-harga text-right`}>Harga</th>}
            {adaHarga && <th className={`${cell} sj-harga text-right`}>Jumlah</th>}
          </tr>
        </thead>
        <tbody>
          {groupedArray.map((item, idx) => (
            <tr key={idx}>
              <td className={`${cell} text-center`}>{idx + 1}</td>
              <td className={cell}>{item.no_po}</td>
              <td className={cell}>{item.model_nama || '-'}</td>
              <td className={cell}>{item.warna}{item.size ? ` / ${item.size}` : ''}</td>
              <td className={`${cell} text-right font-medium`}>{item.qty_kirim}</td>
              {adaHarga && (
                <td className={`${cell} sj-harga text-right`}>{item.qty_kirim ? rp(item.subtotal / item.qty_kirim) : '-'}</td>
              )}
              {adaHarga && <td className={`${cell} sj-harga text-right`}>{rp(item.subtotal)}</td>}
            </tr>
          ))}
          <tr className="font-bold">
            <td colSpan={4} className={`${cell} text-right`}>TOTAL (pcs)</td>
            <td className={`${cell} text-right`}>{totalQty}</td>
            {adaHarga && <td className={`${cell} sj-harga`} />}
            {adaHarga && <td className={`${cell} sj-harga text-right`}>Rp {rp(totalNilai)}</td>}
          </tr>
        </tbody>
      </table>

      {adaHarga && nilai && nilai.nilai_tagihan != null && Math.round(nilai.nilai_tagihan) !== Math.round(totalNilai) && (
        <div className="sj-harga mt-1 text-right">
          Nilai tagihan setelah validasi kantor: <strong>Rp {rp(nilai.nilai_tagihan)}</strong>
        </div>
      )}

      {detail.catatan && (
        <div className="mt-1 border border-black px-1 py-[2px] sj-no-break">
          <strong>Catatan:</strong> {detail.catatan}
        </div>
      )}

      {/* Tanda Tangan */}
      <div className="sj-no-break grid grid-cols-3 gap-1 text-center mt-2">
        <div>
          <p className="mb-5">Penerima,</p>
          <p>( ..................... )</p>
        </div>
        <div>
          <p className="mb-5">Driver,</p>
          <p>( <span id="sj-driver-name">.....................</span> )</p>
        </div>
        <div>
          <p className="mb-5">Hormat Kami,</p>
          <p className="font-bold">( FAUZAN )</p>
        </div>
      </div>

      <div className="mt-1 text-[6px] text-gray-500 text-right">
        Dicetak {new Date().toLocaleString('id-ID')}
      </div>
    </div>
  );
}
