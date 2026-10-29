'use client';

import React, { useState } from 'react';
import { type AntrianJahitBundle } from '@/lib/actions/produksi/scan.actions';
import { koreksiHasilCutting } from '@/lib/actions/produksi/scan-mutations.actions';
import { X, Pencil, Loader2, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';

interface Props {
  bundle: AntrianJahitBundle;
  onSuccess: () => void;
  onClose: () => void;
}

export default function ModalKoreksiCutting({ bundle, onSuccess, onClose }: Props) {
  const qtyLama = bundle.qty_per_bundle;

  const [qty, setQty]                   = useState<string>(String(qtyLama));
  const [alasan, setAlasan]             = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const qtyNum   = parseInt(qty) || 0;
  const selisih  = qtyNum - qtyLama;
  const isValid  = qtyNum >= 1 && selisih !== 0;

  const handleSubmit = async () => {
    if (!isValid) return;

    setIsSubmitting(true);
    try {
      const result = await koreksiHasilCutting({ bundle_id: bundle.id, qty: qtyNum, alasan });

      const upahInfo =
        result.upah_aksi === 'ditambah'   ? `, upah cutting +Rp${result.upah_selisih.toLocaleString('id-ID')}` :
        result.upah_aksi === 'dikurangi'  ? `, upah cutting -Rp${Math.abs(result.upah_selisih).toLocaleString('id-ID')}` :
        result.upah_aksi === 'entri_baru' ? `, kekurangan upah cutting Rp${result.upah_selisih.toLocaleString('id-ID')} dicatat (belum lunas)` :
        '';
      const statusInfo = result.status_baru === 'partial'
        ? '. Bundle masuk tab Pending Cutting karena di bawah rencana.'
        : '';

      toast.success(`${bundle.barcode}: hasil cutting ${result.qty_lama} → ${result.qty_baru} pcs${upahInfo}${statusInfo}`);
      onSuccess();
    } catch (err: any) {
      toast.error(err.message || 'Gagal mengoreksi hasil cutting');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/75 flex items-center justify-center z-50 p-4">
      <div className="bg-[#1A1D1F] border border-[#2A2D31] rounded-2xl w-full max-w-lg shadow-2xl flex flex-col max-h-[90vh]">

        {/* Header */}
        <div className="px-6 py-5 border-b border-[#2A2D31] flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-[#e8eaed] flex items-center gap-2">
              <Pencil className="w-5 h-5 text-[#e5c17b]" />
              Koreksi Hasil Cutting
            </h2>
            <p className="text-sm text-[#9aa0a6] mt-1 font-mono">{bundle.barcode}</p>
          </div>
          <button
            onClick={onClose}
            disabled={isSubmitting}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-[#9aa0a6] hover:text-[#e8eaed] hover:bg-[#2A2D31] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-5 overflow-y-auto">

          {/* Info bundle */}
          <div className="bg-[#16181A] border border-[#2A2D31] rounded-xl p-4 text-sm space-y-2">
            <div className="flex justify-between">
              <span className="text-[#9aa0a6]">Artikel</span>
              <span className="text-[#e8eaed] font-medium">{bundle.model_nama ?? '-'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[#9aa0a6]">Warna / Size</span>
              <span className="text-[#e8eaed]">{bundle.warna} / {bundle.size}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[#9aa0a6]">Rencana PO</span>
              <span className="text-[#e8eaed]">{bundle.qty_rencana} pcs</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[#9aa0a6]">Hasil cutting tercatat</span>
              <span className="text-[#e5c17b] font-bold">{qtyLama} pcs</span>
            </div>
          </div>

          {/* Qty */}
          <div className="space-y-2">
            <label className="text-[10px] font-black uppercase tracking-[0.2em] text-[#e5c17b]">
              Hasil cutting yang benar
            </label>
            <div className="flex items-center gap-3">
              <input
                type="number"
                min={1}
                value={qty}
                onChange={e => setQty(e.target.value)}
                disabled={isSubmitting}
                className="w-32 bg-[#16181A] border border-[#2A2D31] rounded-xl px-4 py-3 text-[#e8eaed] text-center text-lg font-bold focus:ring-1 focus:ring-[#e5c17b] outline-none"
              />
              <span className="text-[#9aa0a6] text-sm">pcs</span>
            </div>
            {qtyNum < 1 && qty !== '' && (
              <p className="text-xs text-red-400">Qty minimal 1 pcs</p>
            )}
          </div>

          {/* Alasan */}
          <div className="space-y-2">
            <label className="text-[10px] font-black uppercase tracking-[0.2em] text-[#e5c17b]">
              Alasan <span className="normal-case tracking-normal font-normal text-[#9aa0a6]">(opsional)</span>
            </label>
            <input
              type="text"
              value={alasan}
              onChange={e => setAlasan(e.target.value)}
              disabled={isSubmitting}
              placeholder="mis. salah ketik waktu input cutting"
              className="w-full bg-[#16181A] border border-[#2A2D31] rounded-xl px-4 py-3 text-[#e8eaed] focus:ring-1 focus:ring-[#e5c17b] outline-none text-sm"
            />
          </div>

          {isValid && (
            <div className="flex items-start gap-2 bg-[#e5c17b]/5 border border-[#e5c17b]/20 rounded-xl p-3">
              <AlertTriangle className="w-4 h-4 text-[#e5c17b] shrink-0 mt-0.5" />
              <div className="text-xs text-[#9aa0a6] space-y-1">
                <p>
                  Upah tukang potong ikut {selisih > 0 ? 'ditambah' : 'dikurangi'}{' '}
                  <span className="text-[#e8eaed] font-semibold">{Math.abs(selisih)} pcs</span>.
                  {selisih > 0
                    ? ' Kalau upahnya sudah dibayar, kekurangannya dicatat sebagai entri baru (belum lunas).'
                    : ' Kalau upahnya sudah dibayar, koreksi ditolak — bereskan kelebihan bayar di Penggajian dulu.'}
                </p>
                {bundle.qty_rencana > 0 && qtyNum < bundle.qty_rencana && (
                  <p className="text-orange-400">
                    Di bawah rencana ({bundle.qty_rencana} pcs) — sisa {bundle.qty_rencana - qtyNum} pcs akan muncul di tab Pending Cutting
                    (kecuali bundle ini sudah pernah di-Close).
                  </p>
                )}
                {bundle.qty_rencana > 0 && qtyNum > bundle.qty_rencana && (
                  <p className="text-orange-400">
                    Melebihi rencana PO ({bundle.qty_rencana} pcs). Pastikan memang hasil potongnya lebih.
                  </p>
                )}
              </div>
            </div>
          )}

        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-[#2A2D31] flex justify-end gap-3 bg-[#16181A] rounded-b-2xl">
          <button
            onClick={onClose}
            disabled={isSubmitting}
            className="px-6 py-2.5 rounded-xl border border-[#2A2D31] text-sm font-bold text-[#e8eaed] hover:bg-[#2A2D31] transition-colors disabled:opacity-50"
          >
            Batal
          </button>
          <button
            onClick={handleSubmit}
            disabled={isSubmitting || !isValid}
            className="flex items-center gap-2 bg-[#e5c17b] hover:bg-[#d4b06a] text-[#0D0E10] px-6 py-2.5 rounded-xl text-sm font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSubmitting
              ? <><Loader2 className="w-4 h-4 animate-spin" /> Menyimpan...</>
              : <><Pencil className="w-4 h-4" /> Simpan Koreksi</>
            }
          </button>
        </div>
      </div>
    </div>
  );
}
