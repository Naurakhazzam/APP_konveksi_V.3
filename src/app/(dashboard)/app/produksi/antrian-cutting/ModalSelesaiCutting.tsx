'use client';

import React, { useState, useEffect } from 'react';
import { X, CheckCircle2, Loader2, AlertTriangle, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  getInventoryItemsForCutting,
  selesaiCuttingBatch,
  type InventoryItemOption,
  type PemakaianBahanItem,
  type StokWarning,
} from '@/lib/actions/produksi/cutting.actions';

interface Props {
  poIds: string[];
  onSuccess: () => void;
  onClose: () => void;
}

interface PemakaianRow {
  rowId: string;
  inventory_item_id: string;
  qty: number;
}

export default function ModalSelesaiCutting({ poIds, onSuccess, onClose }: Props) {
  const [isLoading, setIsLoading]       = useState(true);
  const [inventoryItems, setInventoryItems] = useState<InventoryItemOption[]>([]);
  const [rows, setRows]                 = useState<PemakaianRow[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [stokWarnings, setStokWarnings] = useState<StokWarning[]>([]);

  // ─── FETCH INVENTORY ITEMS ──────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    getInventoryItemsForCutting()
      .then((data) => {
        if (!cancelled) setInventoryItems(data);
      })
      .catch((e) => {
        if (!cancelled) toast.error('Gagal memuat data inventory: ' + e.message);
      })
      .finally(() => { if (!cancelled) setIsLoading(false); });
    return () => { cancelled = true; };
  }, []);

  // ─── ROW HANDLERS ───────────────────────────────────────────────────────
  const addRow = () => {
    setRows(prev => [...prev, {
      rowId: crypto.randomUUID(),
      inventory_item_id: '',
      qty: 0,
    }]);
  };

  const removeRow = (rowId: string) => {
    setRows(prev => prev.filter(r => r.rowId !== rowId));
  };

  const updateRow = (rowId: string, field: 'inventory_item_id' | 'qty', value: string | number) => {
    setRows(prev => prev.map(r =>
      r.rowId === rowId ? { ...r, [field]: value } : r
    ));
  };

  // ─── SUBMIT ─────────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    setIsSubmitting(true);
    setStokWarnings([]);

    // Build pemakaian array — skip baris kosong atau qty = 0
    const pemakaianArray: PemakaianBahanItem[] = rows
      .filter(r => r.inventory_item_id && r.qty > 0)
      .map(r => ({
        po_id: poIds[0], // po_id dipakai sebagai referensi; SQL function memakai semua po_ids
        inventory_item_id: r.inventory_item_id,
        qty_pakai: r.qty,
      }));

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
  const inputCls    = 'h-9 w-28 rounded-md border border-[#2A2D31] bg-[#1E2124] px-3 text-sm text-[#e8eaed] focus:outline-none focus:ring-1 focus:ring-[#e5c17b] disabled:opacity-50';
  const selectCls   = 'h-9 flex-1 rounded-md border border-[#2A2D31] bg-[#1E2124] px-3 text-sm text-[#e8eaed] focus:outline-none focus:ring-1 focus:ring-[#e5c17b] disabled:opacity-50';

  // ─── RENDER ─────────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-[#1A1D1F] border border-[#2A2D31] rounded-xl w-full max-w-2xl max-h-[80vh] flex flex-col shadow-2xl">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#2A2D31] flex-shrink-0">
          <div>
            <h2 className="text-base font-bold text-[#e8eaed]">Selesai Cutting</h2>
            <p className="text-xs text-[#9aa0a6] mt-0.5">
              Input pemakaian bahan secara manual — kosongkan jika tidak ada pemakaian
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
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-[#9aa0a6]">
              <Loader2 className="w-8 h-8 animate-spin text-[#e5c17b]" />
              <span className="text-sm">Memuat data inventory...</span>
            </div>
          ) : (
            <>
              {/* Pemakaian Rows */}
              {rows.length > 0 && (
                <div className="space-y-2">
                  {/* Header */}
                  <div className="grid grid-cols-[1fr_auto_auto_auto] gap-3 items-center px-1">
                    <span className="text-[10px] uppercase tracking-widest text-[#9aa0a6] font-bold">Bahan</span>
                    <span className="text-[10px] uppercase tracking-widest text-[#9aa0a6] font-bold w-28 text-right">Qty Pakai</span>
                    <span className="text-[10px] uppercase tracking-widest text-[#9aa0a6] font-bold w-16">Satuan</span>
                    <span className="w-8" />
                  </div>

                  {rows.map((row) => {
                    const selectedItem = inventoryItems.find(i => i.id === row.inventory_item_id);
                    return (
                      <div key={row.rowId} className="grid grid-cols-[1fr_auto_auto_auto] gap-3 items-center">
                        {/* Pilih Bahan */}
                        <select
                          className={selectCls}
                          value={row.inventory_item_id}
                          onChange={e => updateRow(row.rowId, 'inventory_item_id', e.target.value)}
                          disabled={isSubmitting}
                        >
                          <option value="">— Pilih bahan —</option>
                          {inventoryItems.map(item => (
                            <option key={item.id} value={item.id}>
                              {item.nama} (stok: {item.stok_aktual} {item.satuan})
                            </option>
                          ))}
                        </select>

                        {/* Qty */}
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          placeholder="0"
                          value={row.qty === 0 ? '' : row.qty}
                          onChange={e => updateRow(row.rowId, 'qty', parseFloat(e.target.value) || 0)}
                          className={inputCls}
                          disabled={isSubmitting}
                        />

                        {/* Satuan */}
                        <span className="text-sm text-[#9aa0a6] w-16">
                          {selectedItem?.satuan ?? '—'}
                        </span>

                        {/* Hapus */}
                        <button
                          onClick={() => removeRow(row.rowId)}
                          disabled={isSubmitting}
                          className="w-8 h-8 flex items-center justify-center rounded-lg text-[#9aa0a6] hover:text-red-400 hover:bg-red-400/10 transition-colors disabled:opacity-40"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Tambah Bahan Button */}
              <button
                onClick={addRow}
                disabled={isSubmitting || isLoading}
                className="flex items-center gap-2 px-4 h-9 rounded-lg border border-dashed border-[#2A2D31] text-[#9aa0a6] text-sm hover:border-[#e5c17b] hover:text-[#e5c17b] transition-colors disabled:opacity-40"
              >
                <Plus className="w-4 h-4" />
                Tambah Bahan
              </button>

              {rows.length === 0 && (
                <p className="text-xs text-[#9aa0a6] italic">
                  Tidak ada pemakaian bahan? Langsung klik Selesai Cutting.
                </p>
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
            </>
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
