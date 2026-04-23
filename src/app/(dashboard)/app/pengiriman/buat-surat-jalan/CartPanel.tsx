'use client';

import React from 'react';
import type { BundleReadyToShip } from '@/lib/actions/pengiriman/surat-jalan.actions';

interface CartPanelProps {
  selectedBundles: BundleReadyToShip[];
  onUpdateQty: (id: string, qty: number) => void;
  onRemove: (id: string) => void;
  tanggal: string;
  setTanggal: (t: string) => void;
  catatan: string;
  setCatatan: (c: string) => void;
  onFinalize: () => void;
  isSubmitting: boolean;
}

export default function CartPanel({
  selectedBundles,
  onUpdateQty,
  onRemove,
  tanggal,
  setTanggal,
  catatan,
  setCatatan,
  onFinalize,
  isSubmitting
}: CartPanelProps) {
  if (selectedBundles.length === 0) return null;

  const totalBundle = selectedBundles.length;
  const totalQty = selectedBundles.reduce((acc, curr) => acc + curr.qty_kirim, 0);
  const klienNama = selectedBundles[0]?.klien_nama || '-';

  return (
    <div className="bg-[#1A1D1F] border border-[#2A2D31] rounded-lg p-4 space-y-6">
      <div>
        <h3 className="text-lg font-medium text-[#e8eaed]">Draft Surat Jalan</h3>
        <p className="text-sm text-[#9aa0a6]">Klien: <span className="font-semibold text-[#e5c17b]">{klienNama}</span></p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-medium text-[#9aa0a6] mb-1">Tanggal Pengiriman</label>
          <input
            type="date"
            value={tanggal}
            onChange={(e) => setTanggal(e.target.value)}
            className="w-full bg-[#0D0E10] border border-[#2A2D31] text-[#e8eaed] rounded-md px-3 py-2 text-sm focus:outline-none focus:border-[#e5c17b]"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-[#9aa0a6] mb-1">Catatan / Pengirim</label>
          <input
            type="text"
            value={catatan}
            onChange={(e) => setCatatan(e.target.value)}
            placeholder="Nama driver, no kendaraan..."
            className="w-full bg-[#0D0E10] border border-[#2A2D31] text-[#e8eaed] rounded-md px-3 py-2 text-sm focus:outline-none focus:border-[#e5c17b]"
          />
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm text-left">
          <thead className="text-xs text-[#9aa0a6] uppercase bg-[#0D0E10] border-y border-[#2A2D31]">
            <tr>
              <th className="px-4 py-3">Barcode</th>
              <th className="px-4 py-3">Item</th>
              <th className="px-4 py-3 w-32">QTY Kirim</th>
              <th className="px-4 py-3 text-right">Aksi</th>
            </tr>
          </thead>
          <tbody>
            {selectedBundles.map(b => (
              <tr key={b.id} className="border-b border-[#2A2D31] hover:bg-[#0D0E10]/50 transition-colors">
                <td className="px-4 py-3 font-mono text-xs">{b.barcode}</td>
                <td className="px-4 py-3">
                  <div className="font-medium text-[#e8eaed]">{b.model_nama || 'Tanpa Model'}</div>
                  <div className="text-xs text-[#9aa0a6]">{b.warna} - {b.size} | Max: {b.qty_per_bundle}</div>
                </td>
                <td className="px-4 py-3">
                  <input
                    type="number"
                    min={1}
                    max={b.qty_per_bundle}
                    value={b.qty_kirim}
                    onChange={(e) => onUpdateQty(b.id, parseInt(e.target.value) || 1)}
                    className="w-20 bg-[#0D0E10] border border-[#2A2D31] text-[#e8eaed] rounded-md px-2 py-1 text-sm focus:outline-none focus:border-[#e5c17b]"
                  />
                </td>
                <td className="px-4 py-3 text-right">
                  <button onClick={() => onRemove(b.id)} className="text-red-400 hover:text-red-300 text-xs font-medium">Hapus</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex justify-between items-center bg-[#0D0E10] p-4 rounded-lg border border-[#2A2D31]">
        <div>
          <div className="text-sm text-[#9aa0a6]">Total Bundle: <span className="text-[#e8eaed] font-medium">{totalBundle}</span></div>
          <div className="text-sm text-[#9aa0a6]">Total QTY: <span className="text-[#e8eaed] font-medium">{totalQty}</span></div>
        </div>
        <button
          onClick={onFinalize}
          disabled={isSubmitting}
          className="bg-[#e5c17b] text-[#0D0E10] px-6 py-2 rounded-md font-bold text-sm hover:bg-[#d4b06a] disabled:opacity-50 transition-colors uppercase tracking-wider"
        >
          {isSubmitting ? 'Memproses...' : 'Finalisasi SJ'}
        </button>
      </div>
    </div>
  );
}
