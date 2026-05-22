'use client';

import React, { useMemo } from 'react';
import type { BundleReadyToShip } from '@/lib/actions/pengiriman/surat-jalan.actions';
import { Package, X } from 'lucide-react';

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

interface CartGroup {
  key: string;
  model_nama: string | null;
  warna: string;
  size: string;
  no_po: string;
  bundles: BundleReadyToShip[];
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
  isSubmitting,
}: CartPanelProps) {
  if (selectedBundles.length === 0) return null;

  const totalBundle = selectedBundles.length;
  const totalQty = selectedBundles.reduce((acc, curr) => acc + curr.qty_kirim, 0);
  const klienNama = selectedBundles[0]?.klien_nama || '-';

  // ─── Group selected bundles by model+warna+size+no_po ────────────────────
  const cartGroups = useMemo((): CartGroup[] => {
    const map = new Map<string, CartGroup>();
    selectedBundles.forEach(b => {
      const key = `${b.model_nama}||${b.warna}||${b.size}||${b.no_po}`;
      if (!map.has(key)) {
        map.set(key, {
          key,
          model_nama: b.model_nama,
          warna: b.warna,
          size: b.size,
          no_po: b.no_po,
          bundles: [],
        });
      }
      map.get(key)!.bundles.push(b);
    });
    return Array.from(map.values());
  }, [selectedBundles]);

  return (
    <div className="bg-[#1A1D1F] border border-[#2A2D31] rounded-lg p-4 space-y-5 sticky top-4">

      {/* Header */}
      <div>
        <h3 className="text-lg font-medium text-[#e8eaed]">Draft Surat Jalan</h3>
        <p className="text-sm text-[#9aa0a6] mt-0.5">
          Klien: <span className="font-semibold text-[#e5c17b]">{klienNama}</span>
        </p>
      </div>

      {/* Form tanggal & catatan */}
      <div className="grid grid-cols-2 gap-3">
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

      {/* Grouped bundle list */}
      <div className="space-y-3 max-h-[420px] overflow-y-auto pr-0.5">
        {cartGroups.map(group => (
          <div
            key={group.key}
            className="border border-[#2A2D31] rounded-lg overflow-hidden"
          >
            {/* Group header */}
            <div className="bg-[#0D0E10] px-3 py-2 flex items-center gap-2 border-b border-[#2A2D31]">
              <Package className="w-3.5 h-3.5 text-[#e5c17b] shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-xs font-semibold text-[#e8eaed] truncate">
                  {group.model_nama || 'Tanpa Model'}
                </div>
                <div className="text-[10px] text-[#9aa0a6] mt-0.5">
                  {group.warna}
                  <span className="mx-1 text-[#2A2D31]">·</span>
                  {group.size}
                </div>
              </div>
              <span className="shrink-0 text-[10px] font-mono text-[#e5c17b] bg-[#e5c17b]/10 px-1.5 py-0.5 rounded">
                {group.no_po}
              </span>
            </div>

            {/* Sub-rows: satu per bundle */}
            <div className="divide-y divide-[#2A2D31]/60">
              {group.bundles.map(b => (
                <div
                  key={b.id}
                  className="flex items-center gap-2 px-3 py-2 bg-[#16181A] hover:bg-[#1A1D1F] transition-colors"
                >
                  {/* Barcode */}
                  <span className="flex-1 font-mono text-[10px] text-[#9aa0a6] truncate">
                    {b.barcode}
                  </span>

                  {/* QTY input */}
                  <div className="flex items-center gap-1 shrink-0">
                    <input
                      type="number"
                      min={1}
                      max={b.qty_per_bundle}
                      value={b.qty_kirim}
                      onChange={(e) => onUpdateQty(b.id, parseInt(e.target.value) || 1)}
                      className="w-14 bg-[#0D0E10] border border-[#2A2D31] text-[#e8eaed] rounded px-2 py-1 text-xs text-center focus:outline-none focus:border-[#e5c17b]"
                    />
                    <span className="text-[10px] text-[#9aa0a6]">/{b.qty_per_bundle}</span>
                  </div>

                  {/* Hapus */}
                  <button
                    onClick={() => onRemove(b.id)}
                    title="Hapus bundle ini"
                    className="shrink-0 w-5 h-5 flex items-center justify-center rounded hover:bg-red-900/30 text-[#9aa0a6] hover:text-red-400 transition-colors"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>

            {/* Group subtotal */}
            <div className="bg-[#0D0E10]/60 px-3 py-1.5 flex justify-between text-[10px] text-[#9aa0a6]">
              <span>{group.bundles.length} bundle</span>
              <span>
                {group.bundles.reduce((s, b) => s + b.qty_kirim, 0)} pcs kirim
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* Footer: total + finalisasi */}
      <div className="bg-[#0D0E10] p-3 rounded-lg border border-[#2A2D31] flex justify-between items-center gap-3">
        <div className="text-xs space-y-0.5">
          <div className="text-[#9aa0a6]">
            Total Bundle:{' '}
            <span className="text-[#e8eaed] font-semibold">{totalBundle}</span>
          </div>
          <div className="text-[#9aa0a6]">
            Total QTY:{' '}
            <span className="text-[#e8eaed] font-semibold">{totalQty} pcs</span>
          </div>
        </div>
        <button
          onClick={onFinalize}
          disabled={isSubmitting}
          className="bg-[#e5c17b] text-[#0D0E10] px-5 py-2 rounded-md font-bold text-xs hover:bg-[#d4b06a] disabled:opacity-50 transition-colors uppercase tracking-wider shrink-0"
        >
          {isSubmitting ? 'Memproses...' : 'Finalisasi SJ'}
        </button>
      </div>
    </div>
  );
}
