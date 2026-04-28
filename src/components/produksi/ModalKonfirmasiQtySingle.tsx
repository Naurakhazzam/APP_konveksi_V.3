'use client';

import React, { useState, useEffect } from 'react';
import { getAlasanQty, AlasanQty } from '@/lib/actions/produksi/qty-approval.actions';
import { Loader2, CheckCircle2, AlertTriangle, Minus, Plus } from 'lucide-react';

interface ModalKonfirmasiQtySingleProps {
  isOpen: boolean;
  tahapLabel: string;
  qtyDefault: number;        // qty_per_bundle
  initialQty?: number;       // qty yang sudah di-set user di UI (opsional)
  onConfirm: (qty: number, alasan_qty_id: string | null) => void;
  onCancel: () => void;
}

export default function ModalKonfirmasiQtySingle({
  isOpen,
  tahapLabel,
  qtyDefault,
  initialQty,
  onConfirm,
  onCancel,
}: ModalKonfirmasiQtySingleProps) {
  const [qty, setQty]             = useState<number>(initialQty ?? qtyDefault);
  const [alasanList, setAlasanList] = useState<AlasanQty[]>([]);
  const [selectedAlasan, setSelectedAlasan] = useState('');
  const [loading, setLoading]     = useState(false);

  // Reset setiap kali modal dibuka
  useEffect(() => {
    if (isOpen) {
      setQty(initialQty ?? qtyDefault);
      setSelectedAlasan('');

      async function fetchAlasan() {
        setLoading(true);
        try {
          const list = await getAlasanQty();
          setAlasanList(list);
        } catch (e) {
          console.error('Gagal fetch alasan qty:', e);
        } finally {
          setLoading(false);
        }
      }
      fetchAlasan();
    }
  }, [isOpen, initialQty, qtyDefault]);

  if (!isOpen) return null;

  const isQtyKurang  = qty < qtyDefault;
  const isQtyLebih   = qty > qtyDefault;
  const canConfirm   = !loading && qty > 0 && (!isQtyKurang || selectedAlasan !== '');

  const handleQtyChange = (val: number) => {
    setQty(Math.max(1, val));
    if (val >= qtyDefault) setSelectedAlasan('');
  };

  const handleConfirm = () => {
    if (!canConfirm) return;
    onConfirm(qty, isQtyKurang ? selectedAlasan : null);
  };

  return (
    <div className="fixed inset-0 bg-black/70 z-[100] flex items-center justify-center backdrop-blur-sm p-4">
      <div className="bg-[#1A1D1F] border border-[#2A2D31] rounded-2xl p-6 max-w-sm w-full shadow-2xl animate-in fade-in zoom-in duration-200">

        {/* Header */}
        <div className="flex items-center gap-3 mb-5">
          <div className={`p-2 rounded-full ${isQtyKurang ? 'bg-[#e5c17b]/10 text-[#e5c17b]' : 'bg-emerald-500/10 text-emerald-400'}`}>
            {isQtyKurang ? <AlertTriangle size={22} /> : <CheckCircle2 size={22} />}
          </div>
          <div>
            <h3 className="text-lg font-bold text-[#e8eaed]">Konfirmasi QTY Selesai</h3>
            <p className="text-xs text-[#9aa0a6]">Tahap: <span className="font-bold text-[#e5c17b]">{tahapLabel}</span></p>
          </div>
        </div>

        {/* QTY Input */}
        <div className="bg-[#0D0E10] border border-[#2A2D31] rounded-xl p-4 mb-4">
          <div className="text-[10px] text-[#9aa0a6] font-bold uppercase tracking-wider mb-3 text-center">
            QTY Selesai
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => handleQtyChange(qty - 1)}
              disabled={qty <= 1}
              className="w-10 h-10 rounded-xl bg-[#2A2D31] hover:bg-[#32363a] disabled:opacity-30 flex items-center justify-center text-[#e8eaed] transition-colors"
            >
              <Minus size={16} />
            </button>
            <input
              type="number"
              value={qty}
              onChange={(e) => handleQtyChange(Number(e.target.value))}
              min={1}
              className="flex-1 bg-transparent border-0 text-center text-2xl font-black text-[#e8eaed] focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            />
            <button
              onClick={() => handleQtyChange(qty + 1)}
              className="w-10 h-10 rounded-xl bg-[#2A2D31] hover:bg-[#32363a] flex items-center justify-center text-[#e8eaed] transition-colors"
            >
              <Plus size={16} />
            </button>
          </div>
          <div className="text-center text-xs text-[#9aa0a6] mt-2">
            Target: <span className="font-bold text-[#e8eaed]">{qtyDefault} pcs</span>
          </div>
        </div>

        {/* Status badge */}
        {isQtyKurang && (
          <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl px-3 py-2 mb-4 text-center">
            <p className="text-xs text-amber-400 font-medium">
              ⚠ Kurang <span className="font-bold">{qtyDefault - qty} pcs</span> dari target — pilih alasan di bawah
            </p>
          </div>
        )}
        {isQtyLebih && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2 mb-4 text-center">
            <p className="text-xs text-red-400 font-medium">
              ⚠ QTY melebihi target ({qtyDefault} pcs) — periksa kembali
            </p>
          </div>
        )}
        {!isQtyKurang && !isQtyLebih && (
          <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl px-3 py-2 mb-4 text-center">
            <p className="text-xs text-emerald-400 font-medium">
              ✓ QTY sesuai target
            </p>
          </div>
        )}

        {/* Alasan — hanya muncul jika qty kurang */}
        {isQtyKurang && (
          <div className="mb-5">
            <div className="text-[10px] text-[#9aa0a6] font-bold uppercase tracking-wider mb-2">
              Alasan Qty Kurang <span className="text-red-400">*</span>
            </div>
            {loading ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="h-5 w-5 animate-spin text-[#e5c17b]" />
              </div>
            ) : (
              <div className="space-y-2 max-h-[160px] overflow-y-auto pr-1 custom-scrollbar">
                {alasanList.map((item) => (
                  <label
                    key={item.id}
                    className={`flex items-center gap-3 p-3 rounded-xl border transition-all cursor-pointer group ${
                      selectedAlasan === item.id
                        ? 'bg-[#e5c17b]/10 border-[#e5c17b] text-[#e5c17b]'
                        : 'bg-[#0D0E10] border-[#2A2D31] text-[#9aa0a6] hover:bg-[#1A1D1F]'
                    }`}
                  >
                    <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
                      selectedAlasan === item.id ? 'border-[#e5c17b]' : 'border-[#2A2D31]'
                    }`}>
                      {selectedAlasan === item.id && <div className="w-2 h-2 rounded-full bg-[#e5c17b]" />}
                    </div>
                    <input
                      type="radio"
                      className="hidden"
                      name="alasan_single"
                      value={item.id}
                      checked={selectedAlasan === item.id}
                      onChange={() => setSelectedAlasan(item.id)}
                    />
                    <span className="font-medium text-sm">{item.label}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 py-3 px-4 rounded-xl text-sm font-medium text-[#9aa0a6] bg-transparent border border-[#2A2D31] hover:bg-[#2A2D31] transition-colors"
          >
            Batal
          </button>
          <button
            disabled={!canConfirm}
            onClick={handleConfirm}
            className="flex-1 py-3 px-4 rounded-xl text-sm font-black text-black bg-[#e5c17b] hover:bg-[#d4b06a] disabled:opacity-40 disabled:cursor-not-allowed transition-colors shadow-lg shadow-[#e5c17b]/10"
          >
            Konfirmasi
          </button>
        </div>
      </div>
    </div>
  );
}
