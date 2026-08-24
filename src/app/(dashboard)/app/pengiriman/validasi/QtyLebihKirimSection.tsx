'use client';

import React, { useState } from 'react';
import { toast } from 'sonner';
import { AlertTriangle, Loader2, ShieldCheck, X, PackagePlus } from 'lucide-react';
import type { QtyLebihKirimPending } from '@/lib/actions/pengiriman/surat-jalan.actions';
import { resolveQtyLebihKirim } from '@/lib/actions/pengiriman/surat-jalan.actions';

interface Props {
  initialPending: QtyLebihKirimPending[];
}

function PinModal({
  item,
  action,
  onDone,
  onClose,
}: {
  item: QtyLebihKirimPending;
  action: 'approved' | 'rejected';
  onDone: () => void;
  onClose: () => void;
}) {
  const [pin, setPin] = useState('');
  const [catatan, setCatatan] = useState('');
  const [loading, setLoading] = useState(false);

  const isApprove = action === 'approved';

  const handleSubmit = async () => {
    if (!pin) { toast.error('Masukkan PIN terlebih dahulu'); return; }
    setLoading(true);
    try {
      await resolveQtyLebihKirim(item.approval_id, pin, action, catatan || undefined);
      toast.success(isApprove ? 'Kelebihan qty disetujui' : 'Kelebihan qty ditolak');
      onDone();
    } catch (err: any) {
      toast.error(err.message || 'Gagal memproses');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-[#1A1D1F] border border-[#2A2D31] rounded-2xl p-6 w-full max-w-sm shadow-2xl animate-in zoom-in-95 duration-200">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${isApprove ? 'bg-amber-900/30' : 'bg-red-900/30'}`}>
              <ShieldCheck className={`w-5 h-5 ${isApprove ? 'text-amber-400' : 'text-red-400'}`} />
            </div>
            <div>
              <div className="text-sm font-bold text-[#e8eaed]">
                {isApprove ? 'Setujui Kelebihan QTY' : 'Tolak Kelebihan QTY'}
              </div>
              <div className="text-[10px] text-[#9aa0a6] mt-0.5">Verifikasi PIN owner</div>
            </div>
          </div>
          <button onClick={onClose} className="text-[#9aa0a6] hover:text-[#e8eaed] transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="bg-[#0D0E10] rounded-xl p-3 mb-4 space-y-1 text-xs">
          <div className="text-[#9aa0a6]">Bundle: <span className="text-[#e8eaed] font-mono">{item.barcode}</span></div>
          <div className="text-[#9aa0a6]">
            Kelebihan: <span className="text-amber-400 font-bold">+{item.qty_lebih} pcs</span>
            <span className="text-[#9aa0a6]"> (rencana {item.qty_rencana} → kirim {item.qty_kirim})</span>
          </div>
          {item.alasan_pengajuan && (
            <div className="text-[#9aa0a6]">Alasan: <span className="text-[#e8eaed]">{item.alasan_pengajuan}</span></div>
          )}
        </div>

        <div className="mb-4">
          <label className="block text-[10px] font-bold uppercase tracking-widest text-[#9aa0a6] mb-1.5">
            PIN Owner
          </label>
          <input
            type="password"
            value={pin}
            onChange={e => setPin(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSubmit()}
            placeholder="••••••"
            className="w-full bg-[#0D0E10] border border-[#2A2D31] text-[#e8eaed] rounded-xl px-4 py-3 text-sm text-center tracking-[0.4em] focus:outline-none focus:border-[#e5c17b] transition-colors"
            autoFocus
          />
        </div>

        <div className="mb-4">
          <label className="block text-[10px] font-bold uppercase tracking-widest text-[#9aa0a6] mb-1.5">
            Catatan (opsional)
          </label>
          <input
            type="text"
            value={catatan}
            onChange={e => setCatatan(e.target.value)}
            placeholder="Catatan tambahan..."
            className="w-full bg-[#0D0E10] border border-[#2A2D31] text-[#e8eaed] rounded-xl px-3 py-2 text-xs focus:outline-none focus:border-[#e5c17b] transition-colors"
          />
        </div>

        <div className="flex gap-2">
          <button
            onClick={onClose}
            disabled={loading}
            className="flex-1 py-2.5 rounded-xl border border-[#2A2D31] text-xs font-semibold text-[#9aa0a6] hover:bg-[#2A2D31] transition-colors disabled:opacity-40"
          >
            Batal
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading || !pin}
            className={`flex-1 py-2.5 rounded-xl text-xs font-bold text-white transition-colors disabled:opacity-40 flex items-center justify-center gap-2 ${
              isApprove ? 'bg-amber-600 hover:bg-amber-500' : 'bg-red-600 hover:bg-red-500'
            }`}
          >
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ShieldCheck className="w-3.5 h-3.5" />}
            {isApprove ? 'Setujui' : 'Tolak'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function QtyLebihKirimSection({ initialPending }: Props) {
  const [items, setItems] = useState(initialPending);
  const [modalTarget, setModalTarget] = useState<{ item: QtyLebihKirimPending; action: 'approved' | 'rejected' } | null>(null);

  if (items.length === 0) return null;

  const handleDone = (approval_id: string) => {
    setItems(prev => prev.filter(i => i.approval_id !== approval_id));
    setModalTarget(null);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <PackagePlus className="w-4 h-4 text-amber-400" />
        <h2 className="text-sm font-bold text-[#e8eaed]">Qty Lebih Saat Kirim — Menunggu Approval</h2>
        <span className="text-[10px] font-bold text-amber-400 bg-amber-900/30 border border-amber-700/40 px-2 py-0.5 rounded-full">
          {items.length}
        </span>
      </div>
      <p className="text-xs text-[#9aa0a6]">
        Bundle-bundle ini dikirim dengan qty melebihi rencana awal (sudah tercatat di invoice) — tinggal dikonfirmasi Owner.
      </p>

      <div className="space-y-2">
        {items.map(item => (
          <div
            key={item.approval_id}
            className="bg-[#1A1D1F] border border-amber-800/30 rounded-xl px-4 py-3 flex items-center justify-between gap-4"
          >
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap text-xs">
                  <span className="font-mono text-[#e5c17b] font-bold">{item.barcode}</span>
                  <span className="text-[#9aa0a6]">·</span>
                  <span className="font-mono text-[10px] text-[#9aa0a6]">{item.no_po}</span>
                  <span className="text-[#e8eaed]">{item.model_nama ?? '-'}</span>
                  <span className="text-[#9aa0a6]">{item.warna} / {item.size}</span>
                </div>
                <div className="text-[10px] text-[#9aa0a6] mt-0.5">
                  {item.klien_nama} · Rencana <span className="text-[#e8eaed] font-semibold">{item.qty_rencana}</span> pcs → Kirim{' '}
                  <span className="text-amber-400 font-bold">{item.qty_kirim}</span> pcs
                  {item.alasan_pengajuan && <> · &quot;{item.alasan_pengajuan}&quot;</>}
                  {' · '}oleh {item.diajukan_oleh}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={() => setModalTarget({ item, action: 'rejected' })}
                className="px-3 py-1.5 rounded-lg border border-red-800/40 text-[10px] font-bold text-red-400 hover:bg-red-900/20 transition-colors"
              >
                Tolak
              </button>
              <button
                onClick={() => setModalTarget({ item, action: 'approved' })}
                className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-[10px] font-bold text-white transition-colors"
              >
                Setujui
              </button>
            </div>
          </div>
        ))}
      </div>

      {modalTarget && (
        <PinModal
          item={modalTarget.item}
          action={modalTarget.action}
          onDone={() => handleDone(modalTarget.item.approval_id)}
          onClose={() => setModalTarget(null)}
        />
      )}
    </div>
  );
}
