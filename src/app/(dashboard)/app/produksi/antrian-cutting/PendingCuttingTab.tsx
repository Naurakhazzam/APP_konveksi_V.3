'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Loader2, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import {
  getPendingCuttingBundles,
  closeBundleCutting,
  type PendingBundle,
} from '@/lib/actions/produksi/cutting.actions';

export default function PendingCuttingTab() {
  const [bundles, setBundles] = useState<PendingBundle[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [confirmBundle, setConfirmBundle] = useState<PendingBundle | null>(null);
  const [closingId, setClosingId] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await getPendingCuttingBundles();
      setBundles(data);
    } catch (e: any) {
      toast.error('Gagal memuat data pending: ' + e.message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleClose = async (bundle: PendingBundle) => {
    setConfirmBundle(null);
    setClosingId(bundle.id);
    try {
      const result = await closeBundleCutting(bundle.id);
      if (result.success) {
        toast.success(`Bundle ${bundle.barcode} berhasil ditutup`);
        await fetchData();
      } else {
        toast.error(result.error ?? 'Gagal menutup bundle');
      }
    } catch (e: any) {
      toast.error(e.message ?? 'Terjadi kesalahan');
    } finally {
      setClosingId(null);
    }
  };

  // ─── Loading ─────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-[#9aa0a6] text-sm">
        <Loader2 className="w-5 h-5 animate-spin text-[#e5c17b]" />
        Memuat data pending cutting...
      </div>
    );
  }

  // ─── Empty ────────────────────────────────────────────────────────────────
  if (bundles.length === 0) {
    return (
      <div className="rounded-xl border border-[#2A2D31] bg-[#1A1D1F] px-4 py-16 text-center">
        <div className="text-[#9aa0a6] text-sm">Tidak ada bundle dengan status partial</div>
        <p className="text-[10px] text-[#9aa0a6]/50 mt-1">
          Bundle partial muncul ketika qty terpotong kurang dari qty order
        </p>
      </div>
    );
  }

  return (
    <>
      {/* Info bar */}
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs text-[#9aa0a6]">
          <span className="text-orange-400 font-bold">{bundles.length}</span> bundle dengan qty terpotong kurang dari target
        </p>
        <button
          onClick={fetchData}
          className="text-[10px] text-[#9aa0a6] hover:text-[#e5c17b] transition-colors underline underline-offset-2"
        >
          Refresh
        </button>
      </div>

      {/* Tabel */}
      <div className="rounded-xl border border-[#2A2D31] bg-[#1A1D1F] overflow-hidden">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-[#16181A] border-b border-[#2A2D31]">
              <th className="px-4 py-3 text-left text-[10px] uppercase tracking-widest text-[#9aa0a6] font-bold">No PO</th>
              <th className="px-4 py-3 text-left text-[10px] uppercase tracking-widest text-[#9aa0a6] font-bold">Barcode</th>
              <th className="px-4 py-3 text-left text-[10px] uppercase tracking-widest text-[#9aa0a6] font-bold">Klien</th>
              <th className="px-4 py-3 text-left text-[10px] uppercase tracking-widest text-[#9aa0a6] font-bold">Warna</th>
              <th className="px-4 py-3 text-left text-[10px] uppercase tracking-widest text-[#9aa0a6] font-bold">Size</th>
              <th className="px-4 py-3 text-center text-[10px] uppercase tracking-widest text-[#9aa0a6] font-bold">Qty Order</th>
              <th className="px-4 py-3 text-center text-[10px] uppercase tracking-widest text-[#9aa0a6] font-bold">Qty Terpotong</th>
              <th className="px-4 py-3 text-center text-[10px] uppercase tracking-widest text-[#9aa0a6] font-bold">Selisih</th>
              <th className="px-4 py-3 text-center text-[10px] uppercase tracking-widest text-[#9aa0a6] font-bold">Aksi</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#2A2D31]">
            {bundles.map(b => {
              const selisih = b.qty_order - b.qty_aktual;
              const pct = Math.round((b.qty_aktual / b.qty_order) * 100);
              const isClosing = closingId === b.id;

              return (
                <tr key={b.id} className="bg-[#1A1D1F] hover:bg-[#1E2124] transition-colors">
                  <td className="px-4 py-3 font-mono font-bold text-[#e5c17b]">{b.no_po}</td>
                  <td className="px-4 py-3 font-mono text-xs text-[#e8eaed]">{b.barcode}</td>
                  <td className="px-4 py-3 text-[#9aa0a6] text-xs">{b.klien_nama}</td>
                  <td className="px-4 py-3 text-[#9aa0a6]">{b.warna}</td>
                  <td className="px-4 py-3 text-[#9aa0a6]">{b.size}</td>
                  <td className="px-4 py-3 text-center text-[#e8eaed] font-semibold">{b.qty_order}</td>
                  <td className="px-4 py-3 text-center">
                    <span className="text-orange-400 font-bold">{b.qty_aktual}</span>
                    <span className="text-[#9aa0a6] text-xs ml-1">({pct}%)</span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-500/10 border border-red-500/20 text-red-400 text-[10px] font-bold">
                      Kurang {selisih} pcs
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    {isClosing ? (
                      <Loader2 className="w-4 h-4 animate-spin text-[#e5c17b] mx-auto" />
                    ) : (
                      <button
                        onClick={() => setConfirmBundle(b)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-orange-500/10 text-orange-400 border border-orange-500/20 text-xs font-semibold hover:bg-orange-500/20 transition-colors"
                      >
                        <XCircle className="w-3.5 h-3.5" />
                        Close Bundle
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Dialog Konfirmasi */}
      {confirmBundle && (
        <div className="fixed inset-0 bg-black/75 flex items-center justify-center z-50 p-4">
          <div className="bg-[#1A1D1F] border border-[#2A2D31] rounded-xl w-full max-w-md shadow-2xl">
            <div className="px-6 py-5">
              <div className="flex items-start gap-3 mb-4">
                <div className="w-9 h-9 rounded-lg bg-orange-500/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <XCircle className="w-5 h-5 text-orange-400" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-[#e8eaed]">Tutup Bundle Partial</h3>
                  <p className="text-xs text-[#9aa0a6] mt-1">Konfirmasi penutupan bundle</p>
                </div>
              </div>

              <div className="bg-[#16181A] border border-[#2A2D31] rounded-lg px-4 py-3 text-sm text-[#e8eaed] leading-relaxed">
                Bundle <span className="font-mono text-[#e5c17b] font-bold">{confirmBundle.barcode}</span> akan
                ditutup dengan qty{' '}
                <span className="text-orange-400 font-bold">{confirmBundle.qty_aktual} pcs</span>.{' '}
                Qty ini akan digunakan sebagai acuan tahap berikutnya. Lanjutkan?
              </div>

              <div className="flex items-center justify-end gap-3 mt-5">
                <button
                  onClick={() => setConfirmBundle(null)}
                  className="px-4 h-9 rounded-lg border border-[#2A2D31] text-[#e8eaed] text-sm hover:bg-[#2A2D31] transition-colors"
                >
                  Batal
                </button>
                <button
                  onClick={() => handleClose(confirmBundle)}
                  className="flex items-center gap-2 px-4 h-9 rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-sm font-bold transition-colors"
                >
                  <XCircle className="w-4 h-4" />
                  Ya, Tutup Bundle
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
