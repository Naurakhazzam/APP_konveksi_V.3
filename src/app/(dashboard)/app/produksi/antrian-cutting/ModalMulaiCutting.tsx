'use client';

import React, { useMemo, useState } from 'react';
import { X, Scissors, Loader2, Info } from 'lucide-react';
import type { CuttingBundle } from '@/lib/actions/produksi/cutting-v2.actions';

interface Props {
  bundles: CuttingBundle[];
  isSubmitting: boolean;
  onSubmit: (items: { bundle_id: string; qty: number }[]) => void;
  onClose: () => void;
}

/**
 * Konfirmasi Mulai Cutting. Angka "Dipotong" default = isi bundle; kalau
 * diturunkan, sisanya otomatis jadi bundle baru di Menunggu.
 */
export default function ModalMulaiCutting({ bundles, isSubmitting, onSubmit, onClose }: Props) {
  const [qty, setQty] = useState<Record<string, number>>(
    () => Object.fromEntries(bundles.map(b => [b.id, b.qty_rencana])));

  const rows = useMemo(() => bundles.map(b => {
    const q = qty[b.id] ?? b.qty_rencana;
    const valid = Number.isInteger(q) && q >= 1 && q <= b.qty_rencana;
    return { ...b, q, valid, sisa: valid ? b.qty_rencana - q : 0 };
  }), [bundles, qty]);

  const totalPotong = rows.reduce((s, r) => s + (r.valid ? r.q : 0), 0);
  const totalSisa   = rows.reduce((s, r) => s + r.sisa, 0);
  const adaInvalid  = rows.some(r => !r.valid);

  const inputCls = 'h-8 w-20 rounded-md border bg-[#0D0E10] px-2 text-center text-sm text-[#e8eaed] focus:outline-none focus:ring-1 focus:ring-[#e5c17b]';

  return (
    <div className="fixed inset-0 bg-black/75 flex items-center justify-center z-50 p-4 print:hidden">
      <div className="bg-[#1A1D1F] border border-[#2A2D31] rounded-xl w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#2A2D31]">
          <div>
            <h2 className="text-base font-bold text-[#e8eaed]">Mulai Cutting — {bundles.length} bundle</h2>
            <p className="text-xs text-[#9aa0a6] mt-0.5">Turunkan angka &quot;Dipotong&quot; kalau hanya sebagian yang dipotong sekarang</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg text-[#9aa0a6] hover:text-[#e8eaed] hover:bg-[#2A2D31]">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[#2A2D31] text-[#9aa0a6] uppercase tracking-wider">
                <th className="text-left py-2 px-2 font-bold">Barcode</th>
                <th className="text-left py-2 px-2 font-bold">Warna / Size</th>
                <th className="text-center py-2 px-2 font-bold">Isi</th>
                <th className="text-center py-2 px-2 font-bold">Dipotong</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <React.Fragment key={r.id}>
                  <tr className="border-b border-[#2A2D31]/50">
                    <td className="py-2 px-2 font-mono text-[#e5c17b]">{r.barcode}</td>
                    <td className="py-2 px-2 text-[#e8eaed]">{r.warna} / {r.size}</td>
                    <td className="py-2 px-2 text-center text-[#9aa0a6]">{r.qty_rencana}</td>
                    <td className="py-2 px-2 text-center">
                      <input
                        type="number" min={1} max={r.qty_rencana} step={1}
                        value={Number.isNaN(r.q) ? '' : r.q}
                        onChange={e => setQty(p => ({ ...p, [r.id]: parseInt(e.target.value, 10) }))}
                        className={`${inputCls} ${r.valid ? 'border-[#2A2D31]' : 'border-red-500 text-red-400'}`}
                      />
                    </td>
                  </tr>
                  {(r.sisa > 0 || !r.valid) && (
                    <tr>
                      <td colSpan={4} className={`px-2 pb-2 text-[11px] ${r.valid ? 'text-[#9aa0a6]' : 'text-red-400'}`}>
                        {r.valid
                          ? <span className="flex items-center gap-1"><Info className="w-3 h-3 text-[#e5c17b]" />{r.q} pcs dipotong, sisa <b className="text-[#e5c17b]">{r.sisa} pcs</b> tetap di Menunggu (bundle baru)</span>
                          : `Isi antara 1 dan ${r.qty_rencana}`}
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between gap-3 px-6 py-4 border-t border-[#2A2D31]">
          <p className="text-xs text-[#9aa0a6]">
            Dipotong: <b className="text-[#e8eaed]">{totalPotong} pcs</b>
            {totalSisa > 0 && <> · sisa ke Menunggu: <b className="text-[#e5c17b]">{totalSisa} pcs</b></>}
          </p>
          <div className="flex gap-2">
            <button onClick={onClose} disabled={isSubmitting}
              className="px-4 h-9 rounded-lg border border-[#2A2D31] text-[#e8eaed] text-sm hover:bg-[#2A2D31] disabled:opacity-40">
              Batal
            </button>
            <button
              disabled={adaInvalid || isSubmitting}
              onClick={() => onSubmit(rows.map(r => ({ bundle_id: r.id, qty: r.q })))}
              className="flex items-center gap-2 px-4 h-9 rounded-lg bg-[#e5c17b] text-[#0D0E10] text-sm font-bold hover:bg-[#d4b06a] disabled:opacity-40 disabled:cursor-not-allowed">
              {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Scissors className="w-4 h-4" />}
              {isSubmitting ? 'Memproses...' : 'Mulai & Cetak Tiket'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
