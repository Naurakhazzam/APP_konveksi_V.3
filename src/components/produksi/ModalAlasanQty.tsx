'use client';

import React, { useState, useEffect } from 'react';
import { getAlasanQty, AlasanQty } from '@/lib/actions/produksi/qty-approval.actions';
import { Loader2, AlertTriangle } from 'lucide-react';

interface ModalAlasanQtyProps {
  isOpen: boolean;
  qtyTerima: number;
  qtyInput: number;
  onConfirm: (alasan_qty_id: string) => void;
  onCancel: () => void;
}

export default function ModalAlasanQty({
  isOpen,
  qtyTerima,
  qtyInput,
  onConfirm,
  onCancel,
}: ModalAlasanQtyProps) {
  const [alasanList, setAlasanList] = useState<AlasanQty[]>([]);
  const [selected, setSelected] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isOpen) {
      async function fetchAlasan() {
        setLoading(true);
        try {
          const list = await getAlasanQty();
          setAlasanList(list);
        } catch (error) {
          console.error('Failed to fetch alasan qty:', error);
        } finally {
          setLoading(false);
        }
      }
      fetchAlasan();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/70 z-[100] flex items-center justify-center backdrop-blur-sm p-4">
      <div className="bg-[#1A1D1F] border border-[#2A2D31] rounded-2xl p-6 max-w-sm w-full shadow-2xl animate-in fade-in zoom-in duration-200">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 rounded-full bg-[#e5c17b]/10 text-[#e5c17b]">
            <AlertTriangle size={24} />
          </div>
          <h3 className="text-xl font-bold text-[#e8eaed]">Qty Kurang — Pilih Alasan</h3>
        </div>

        <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3 mb-6">
          <p className="text-xs text-red-400 font-medium text-center">
            Qty diterima: <span className="font-bold">{qtyTerima} pcs</span> | Qty selesai: <span className="font-bold">{qtyInput} pcs</span>
          </p>
        </div>

        {loading ? (
          <div className="flex flex-col items-center justify-center py-8">
            <Loader2 className="h-8 w-8 animate-spin text-[#e5c17b] mb-2" />
            <p className="text-xs text-[#9aa0a6]">Memuat daftar alasan...</p>
          </div>
        ) : (
          <div className="space-y-2 mb-8 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
            {alasanList.map((item) => (
              <label
                key={item.id}
                className={`flex items-center gap-3 p-4 rounded-xl border transition-all cursor-pointer group ${
                  selected === item.id
                    ? 'bg-[#e5c17b]/10 border-[#e5c17b] text-[#e5c17b]'
                    : 'bg-[#0D0E10] border-[#2A2D31] text-[#9aa0a6] hover:border-[#2A2D31] hover:bg-[#1A1D1F]'
                }`}
              >
                <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${
                  selected === item.id ? 'border-[#e5c17b]' : 'border-[#2A2D31] group-hover:border-[#3A3D41]'
                }`}>
                  {selected === item.id && <div className="w-2.5 h-2.5 rounded-full bg-[#e5c17b]" />}
                </div>
                <input
                  type="radio"
                  className="hidden"
                  name="alasan"
                  value={item.id}
                  checked={selected === item.id}
                  onChange={() => setSelected(item.id)}
                />
                <span className="font-medium text-sm">{item.label}</span>
              </label>
            ))}
          </div>
        )}

        <div className="flex gap-3 mt-4">
          <button
            onClick={onCancel}
            className="flex-1 py-3 px-4 rounded-xl text-sm font-medium text-[#9aa0a6] bg-transparent border border-[#2A2D31] hover:bg-[#2A2D31] transition-colors"
          >
            Batal
          </button>
          <button
            disabled={!selected || loading}
            onClick={() => onConfirm(selected)}
            className="flex-1 py-3 px-4 rounded-xl text-sm font-bold text-black bg-[#e5c17b] hover:bg-[#d4b06a] disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-lg shadow-[#e5c17b]/10"
          >
            Konfirmasi
          </button>
        </div>
      </div>
    </div>
  );
}
