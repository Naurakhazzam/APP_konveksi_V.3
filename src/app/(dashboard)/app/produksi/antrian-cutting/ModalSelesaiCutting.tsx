'use client';

import React, { useState, useEffect } from 'react';
import { X, ChevronDown, ChevronRight, CheckCircle2, Loader2, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import {
  getBahanUntukCutting,
  selesaiCuttingBatch,
  type POBahanInfo,
  type PemakaianBahanItem,
  type StokWarning,
} from '@/lib/actions/produksi/cutting.actions';

// ─── PROPS ───────────────────────────────────────────────────────────────────

interface Props {
  poIds: string[];
  onSuccess: () => void;
  onClose: () => void;
}

// ─── COMPONENT ───────────────────────────────────────────────────────────────

export default function ModalSelesaiCutting({ poIds, onSuccess, onClose }: Props) {
  const [isLoading, setIsLoading]       = useState(true);
  const [poDataList, setPoDataList]     = useState<POBahanInfo[]>([]);
  const [openAccordion, setOpenAccordion] = useState<string | null>(null);
  // { [po_id]: { [inventory_item_id]: qty_pakai } }
  const [pemakaian, setPemakaian]       = useState<Record<string, Record<string, number>>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [stokWarnings, setStokWarnings] = useState<StokWarning[]>([]);

  // ─── FETCH BAHAN ────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    getBahanUntukCutting(poIds)
      .then((data) => {
        if (cancelled) return;
        setPoDataList(data);
        // Buka accordion pertama otomatis
        if (data.length > 0) setOpenAccordion(data[0].po_id);
        // Init pemakaian state: semua qty = 0
        const init: Record<string, Record<string, number>> = {};
        data.forEach(po => {
          init[po.po_id] = {};
          po.bahan.forEach(b => { init[po.po_id][b.inventory_item_id] = 0; });
        });
        setPemakaian(init);
      })
      .catch((e) => {
        if (!cancelled) toast.error('Gagal memuat data bahan: ' + e.message);
      })
      .finally(() => { if (!cancelled) setIsLoading(false); });
    return () => { cancelled = true; };
  }, [poIds]);

  // ─── INPUT HANDLER ──────────────────────────────────────────────────────
  const setQty = (po_id: string, inventory_item_id: string, value: string) => {
    const qty = parseFloat(value) || 0;
    setPemakaian(prev => ({
      ...prev,
      [po_id]: { ...(prev[po_id] ?? {}), [inventory_item_id]: qty },
    }));
  };

  // ─── SUBMIT ─────────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    setIsSubmitting(true);
    setStokWarnings([]);

    // Flatten pemakaian ke array
    const pemakaianArray: PemakaianBahanItem[] = [];
    for (const [po_id, bahanMap] of Object.entries(pemakaian)) {
      for (const [inventory_item_id, qty_pakai] of Object.entries(bahanMap)) {
        if (qty_pakai > 0) {
          pemakaianArray.push({ po_id, inventory_item_id, qty_pakai });
        }
      }
    }

    const result = await selesaiCuttingBatch(poIds, pemakaianArray);

    setIsSubmitting(false);

    if (result.stok_warnings && result.stok_warnings.length > 0) {
      setStokWarnings(result.stok_warnings);
      toast.warning(`${result.stok_warnings.length} item stok tidak mencukupi — produksi tetap dicatat`);
    }

    if (result.success) {
      toast.success(`Cutting selesai. Total ${result.total_qty} pcs.`);
      onSuccess();
    } else {
      toast.error(result.error || 'Gagal menyelesaikan cutting');
    }
  };

  // ─── STYLES ─────────────────────────────────────────────────────────────
  const inputCls = 'h-9 w-28 rounded-md border border-[#2A2D31] bg-[#1E2124] px-3 text-sm text-[#e8eaed] focus:outline-none focus:ring-1 focus:ring-[#e5c17b] disabled:opacity-50';

  // ─── RENDER ─────────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-[#1A1D1F] border border-[#2A2D31] rounded-xl w-full max-w-2xl max-h-[80vh] flex flex-col shadow-2xl">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#2A2D31] flex-shrink-0">
          <div>
            <h2 className="text-base font-bold text-[#e8eaed]">Selesai Cutting</h2>
            <p className="text-xs text-[#9aa0a6] mt-0.5">
              Isi pemakaian bahan per PO — kosongkan jika tidak ada pemakaian
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-[#9aa0a6] hover:text-[#e8eaed] hover:bg-[#2A2D31] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-[#9aa0a6]">
              <Loader2 className="w-8 h-8 animate-spin text-[#e5c17b]" />
              <span className="text-sm">Memuat data bahan...</span>
            </div>
          ) : poDataList.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-2 text-[#9aa0a6]">
              <span className="text-sm">Tidak ada data PO ditemukan.</span>
            </div>
          ) : (
            poDataList.map((po) => {
              const isOpen = openAccordion === po.po_id;
              return (
                <div key={po.po_id} className="rounded-lg border border-[#2A2D31] overflow-hidden">
                  {/* Accordion Header */}
                  <button
                    className="w-full flex items-center justify-between px-4 py-3 bg-[#16181A] hover:bg-[#1E2124] transition-colors"
                    onClick={() => setOpenAccordion(isOpen ? null : po.po_id)}
                  >
                    <div className="flex items-center gap-3">
                      {isOpen
                        ? <ChevronDown className="w-4 h-4 text-[#e5c17b]" />
                        : <ChevronRight className="w-4 h-4 text-[#9aa0a6]" />}
                      <div className="text-left">
                        <span className="text-sm font-bold text-[#e8eaed] font-mono">{po.no_po}</span>
                        {po.model_nama && (
                          <span className="ml-2 text-xs text-[#9aa0a6]">— {po.model_nama}</span>
                        )}
                      </div>
                    </div>
                    <span className="text-xs text-[#9aa0a6]">
                      {po.total_qty} pcs
                      {po.bahan.length > 0
                        ? ` · ${po.bahan.length} bahan`
                        : ' · tidak ada bahan cutting'}
                    </span>
                  </button>

                  {/* Accordion Body */}
                  {isOpen && (
                    <div className="px-4 py-4 bg-[#1A1D1F] space-y-3 border-t border-[#2A2D31]">
                      {po.bahan.length === 0 ? (
                        <p className="text-xs text-[#9aa0a6] italic">
                          Tidak ada konfigurasi aksesori cutting untuk model ini.
                          Kosongkan dan klik Selesai Cutting.
                        </p>
                      ) : (
                        <>
                          <div className="grid grid-cols-[1fr_auto_auto] gap-x-4 gap-y-2 items-center">
                            {/* Header row */}
                            <span className="text-[10px] uppercase tracking-widest text-[#9aa0a6] font-bold">Bahan</span>
                            <span className="text-[10px] uppercase tracking-widest text-[#9aa0a6] font-bold text-right">Qty Pakai</span>
                            <span className="text-[10px] uppercase tracking-widest text-[#9aa0a6] font-bold">Satuan</span>

                            {/* Divider */}
                            <div className="col-span-3 border-t border-[#2A2D31]" />

                            {/* Rows */}
                            {po.bahan.map((bahan) => {
                              const currentQty = pemakaian[po.po_id]?.[bahan.inventory_item_id] ?? 0;
                              return (
                                <React.Fragment key={bahan.inventory_item_id}>
                                  <div>
                                    <p className="text-sm text-[#e8eaed]">{bahan.nama}</p>
                                    <p className="text-[10px] text-[#9aa0a6]">
                                      Stok: {bahan.stok_aktual} {bahan.satuan}
                                    </p>
                                  </div>
                                  <input
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    placeholder="0"
                                    value={currentQty === 0 ? '' : currentQty}
                                    onChange={e => setQty(po.po_id, bahan.inventory_item_id, e.target.value)}
                                    className={inputCls}
                                    disabled={isSubmitting}
                                  />
                                  <span className="text-sm text-[#9aa0a6]">{bahan.satuan}</span>
                                </React.Fragment>
                              );
                            })}
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}

          {/* Stok Warnings */}
          {stokWarnings.length > 0 && (
            <div className="rounded-lg border border-[#e5c17b]/30 bg-[#e5c17b]/10 p-4 space-y-2">
              <div className="flex items-center gap-2 text-[#e5c17b] font-semibold text-sm">
                <AlertTriangle className="w-4 h-4" />
                Peringatan Stok Tidak Mencukupi
              </div>
              <ul className="space-y-1">
                {stokWarnings.map((w, i) => (
                  <li key={i} className="text-xs text-[#e5c17b]/80">
                    <span className="font-medium">{w.item_nama}</span>
                    {' '}— kekurangan <span className="font-bold">{w.qty_kurang}</span>
                    , sisa stok: {w.sisa_stok}
                  </li>
                ))}
              </ul>
              <p className="text-[10px] text-[#9aa0a6]">
                Produksi tetap dicatat. Segera lakukan pengadaan bahan.
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-[#2A2D31] flex-shrink-0">
          <button
            onClick={onClose}
            disabled={isSubmitting}
            className="px-5 h-9 rounded-lg border border-[#2A2D31] text-[#e8eaed] text-sm hover:bg-[#2A2D31] transition-colors disabled:opacity-40"
          >
            Batal
          </button>
          <button
            onClick={handleSubmit}
            disabled={isLoading || isSubmitting}
            className="flex items-center gap-2 px-5 h-9 rounded-lg bg-[#e5c17b] text-[#0D0E10] text-sm font-bold hover:bg-[#d4b06a] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isSubmitting
              ? <Loader2 className="w-4 h-4 animate-spin" />
              : <CheckCircle2 className="w-4 h-4" />}
            {isSubmitting ? 'Menyimpan...' : 'Selesai Cutting'}
          </button>
        </div>
      </div>
    </div>
  );
}
