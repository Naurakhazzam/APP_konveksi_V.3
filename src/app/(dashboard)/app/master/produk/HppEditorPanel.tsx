'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Minus, Plus, Trash2, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

import { 
  getHppItems, 
  upsertHppItem, 
  deleteHppItem, 
  copyHppToAllSizes 
} from '@/lib/actions/master/produk.actions';
import type { KomponenItem } from './ProdukClient';

// ─────────────────────────────────────────────────────────────────────────────
// Format helper
// ─────────────────────────────────────────────────────────────────────────────

function formatRupiah(n: number) {
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(n);
}

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type HppItemRowType = {
  id: string; // id pivot hpp_item
  produk_id: string;
  komponen_id: string;
  qty: number;
  harga_satuan: number;
  qty_fisik?: number;
  hpp_komponen: {
    id: string;
    nama: string;
    kategori: string;
    satuan: { nama: string } | null;
  } | null;
};

// ─────────────────────────────────────────────────────────────────────────────
// Component: HppItemRow
// ─────────────────────────────────────────────────────────────────────────────

function HppItemRow({
  item,
  onUpdate,
  onRemove,
}: {
  item: HppItemRowType;
  onUpdate: (id: string, qty: number, harga_satuan: number, qty_fisik?: number) => void;
  onRemove: (id: string) => void;
}) {
  const [qty, setQty] = useState(item.qty);
  const [harga, setHarga] = useState(item.harga_satuan);
  const [qtyFisik, setQtyFisik] = useState(item.qty_fisik ?? 1);

  // Debounce effect untuk otomatis menyimpan update ke DB tiap 600ms tanpa tombol save
  useEffect(() => {
    if (qty === item.qty && harga === item.harga_satuan && qtyFisik === (item.qty_fisik ?? 1)) return;
    const timer = setTimeout(() => {
      onUpdate(item.komponen_id, qty, harga, qtyFisik);
    }, 600);
    return () => clearTimeout(timer);
  }, [qty, harga, qtyFisik, item, onUpdate]);

  const subtotal = qty * harga;
  const komponenNama = item.hpp_komponen?.nama ?? 'Komponen Dihapus';
  const satuanNama = item.hpp_komponen?.satuan?.nama ?? 'unit';

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-[#2A2D31] bg-[#1E2124] p-3 text-sm">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => onRemove(item.id)}
            className="flex h-6 w-6 items-center justify-center rounded bg-transparent text-[#5f6368] transition-colors hover:bg-red-500/10 hover:text-red-500 focus:outline-none"
            title="Hapus Komponen"
          >
            ×
          </button>
          <span className="font-semibold text-[#e8eaed]">{komponenNama}</span>
        </div>
        <div className="font-mono text-[#e8eaed] font-medium">{formatRupiah(subtotal)}</div>
      </div>
      
      <div className="ml-9 flex flex-wrap items-center gap-2">
        <input
          type="number"
          min={0}
          step="any"
          value={qty}
          onChange={(e) => setQty(parseFloat(e.target.value) || 0)}
          className="h-7 w-20 rounded border border-[#2A2D31] bg-[#16181A] px-2 py-1 text-center text-[#e8eaed] focus:outline-none focus:ring-1 focus:ring-[#e5c17b]"
        />
        <span className="text-[#5f6368] text-xs font-mono">{satuanNama}</span>
        <span className="text-[#5f6368] text-xs">×</span>
        <span className="text-[#5f6368] text-xs font-mono">Rp</span>
        <input
          type="number"
          min={0}
          value={harga}
          onChange={(e) => setHarga(Number(e.target.value) || 0)}
          className="h-7 w-28 rounded border border-[#2A2D31] bg-[#16181A] px-2 py-1 text-right text-[#e8eaed] focus:outline-none focus:ring-1 focus:ring-[#e5c17b]"
        />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Component: AddKomponenModal
// ─────────────────────────────────────────────────────────────────────────────

function AddKomponenModal({
  open,
  onClose,
  produkId,
  hppKomponenList,
  existingKomponenIds,
}: {
  open: boolean;
  onClose: () => void;
  produkId: string;
  hppKomponenList: KomponenItem[];
  existingKomponenIds: Set<string>;
}) {
  const queryClient = useQueryClient();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isSubmitting, setIsSubmitting] = useState(false);

  const availableList = hppKomponenList.filter(
    (k) => !existingKomponenIds.has(k.id)
  );

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleAdd = async () => {
    if (selectedIds.size === 0) return;
    setIsSubmitting(true);
    try {
      // Upsert semua id terpilih (qty=1, harga=0)
      for (const komId of selectedIds) {
        await upsertHppItem(produkId, komId, 1, 0);
      }
      queryClient.invalidateQueries({ queryKey: ['hpp-items', produkId] });
      setSelectedIds(new Set());
      onClose();
    } catch (err: any) {
      alert('Gagal menambah komponen: ' + err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-[480px] bg-[#16181A] border-[#2A2D31] text-[#e8eaed]">
        <DialogHeader>
          <DialogTitle>Tambah Komponen ke Produk</DialogTitle>
        </DialogHeader>

        {availableList.length === 0 ? (
          <div className="py-6 text-center text-sm text-[#9aa0a6]">
            Semua komponen master sudah ditambahkan ke produk ini.
          </div>
        ) : (
          <div className="mt-2 flex max-h-[300px] flex-col gap-2 overflow-y-auto pr-1">
            {availableList.map((k) => (
              <label
                key={k.id}
                className="flex cursor-pointer items-center justify-between rounded-md border border-[#2A2D31] p-3 transition-colors hover:bg-[#2A2D31]/30"
              >
                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={selectedIds.has(k.id)}
                    onChange={() => toggleSelect(k.id)}
                    className="h-4 w-4 rounded border-[#2A2D31] bg-[#1E2124] text-[#e5c17b] focus:ring-[#e5c17b]"
                  />
                  <div>
                    <p className="text-sm font-medium text-[#e8eaed]">{k.nama}</p>
                    <p className="text-xs text-[#5f6368]">
                      Kategori: {k.kategori.replace('_', ' ')} • Satuan: {k.satuan?.nama ?? '-'}
                    </p>
                  </div>
                </div>
              </label>
            ))}
          </div>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} className="border-[#2A2D31] bg-transparent text-[#e8eaed]">
            Batal
          </Button>
          <Button
            onClick={handleAdd}
            disabled={selectedIds.size === 0 || isSubmitting}
            className="bg-[#e5c17b] text-[#2b2318] hover:bg-[#e5c17b]/90"
          >
            Tambahkan ({selectedIds.size})
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Editor Panel Component
// ─────────────────────────────────────────────────────────────────────────────

export interface HppEditorPanelProps {
  produkId: string;
  produkInfo: { sku_internal: string; sku_klien: string | null; harga_jual: number };
  hppKomponenList: KomponenItem[];
  canSeeFinance: boolean;
}

export function HppEditorPanel({
  produkId,
  produkInfo,
  hppKomponenList,
  canSeeFinance,
}: HppEditorPanelProps) {
  const queryClient = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [copyingStatus, setCopyingStatus] = useState(false);

  const { data: hppItems = [], isLoading, isError } = useQuery({
    queryKey: ['hpp-items', produkId],
    queryFn: () => getHppItems(produkId),
    enabled: canSeeFinance && !!produkId,
  });

  // ── Mutators — HARUS di atas early return (Rules of Hooks) ───────────────
  const handleUpdateItem = useCallback(
    async (komponenId: string, qty: number, harga: number) => {
      try {
        await upsertHppItem(produkId, komponenId, qty, harga);
        queryClient.invalidateQueries({ queryKey: ['hpp-items', produkId] });
      } catch (err: any) {
        console.error('Failed to autosave HPP item:', err);
      }
    },
    [produkId, queryClient]
  );

  const handleRemoveItem = useCallback(
    async (id: string) => {
      if (!confirm('Hapus komponen ini dari HPP?')) return;
      try {
        await deleteHppItem(id);
        queryClient.invalidateQueries({ queryKey: ['hpp-items', produkId] });
      } catch (err: any) {
        alert(err.message);
      }
    },
    [produkId, queryClient]
  );

  if (!canSeeFinance) {
    return (
      <div className="flex h-full flex-col p-6 items-center justify-center text-center">
         <div className="h-12 w-12 rounded-full bg-red-500/10 text-red-400 flex items-center justify-center mb-4">
           🔒
         </div>
         <p className="text-[#9aa0a6] text-sm">
           Anda tidak memiliki akses untuk melihat atau mengubah data Harga Pokok Penjualan (HPP). <br/>Hubungi Owner untuk akses lebih lanjut.
         </p>
      </div>
    );
  }

  const handleCopyHpp = async () => {
    if (!confirm('Terapkan komposisi HPP ini (beserta nilainya) ke semua Size lain dalam Model ini? Resep komponen yang sudah ada tidak akan ditimpa.')) return;
    setCopyingStatus(true);
    try {
      const { copied } = await copyHppToAllSizes(produkId);
      alert(`Berhasil menyalin HPP ke ${copied} produk target (size lain).`);
    } catch (err: any) {
      alert(err.message);
    } finally {
      setCopyingStatus(false);
    }
  };

  // ── Stats Calculation ─────────────────────────────────────────────────────

  let subBahanBaku = 0;
  let subBiayaProduksi = 0;
  let subOverhead = 0;

  for (const item of hppItems as HppItemRowType[]) {
    const sum = item.qty * item.harga_satuan;
    const cat = item.hpp_komponen?.kategori;
    if (cat === 'bahan_baku') subBahanBaku += sum;
    else if (cat === 'biaya_produksi') subBiayaProduksi += sum;
    else if (cat === 'overhead') subOverhead += sum;
  }

  const totalHpp = subBahanBaku + subBiayaProduksi + subOverhead;
  const margin = produkInfo.harga_jual - totalHpp;
  const marginPersen = produkInfo.harga_jual > 0 ? ((margin / produkInfo.harga_jual) * 100).toFixed(1) : '-';

  // ── Sections Rendering ────────────────────────────────────────────────────
  const renderSection = (title: string, kategori: string) => {
    const items = (hppItems as HppItemRowType[]).filter(
      (item) => item.hpp_komponen?.kategori === kategori
    );

    if (items.length === 0) return null;

    return (
      <div className="space-y-3 mt-6">
        <div className="flex items-center gap-3">
          <h4 className="text-sm font-semibold text-[#e8eaed] uppercase tracking-wider">{title}</h4>
          <div className="h-px flex-1 bg-[#2A2D31]" />
        </div>
        <div className="flex flex-col gap-2">
          {items.map((item) => (
            <HppItemRow
              key={item.id}
              item={item}
              onUpdate={handleUpdateItem}
              onRemove={handleRemoveItem}
            />
          ))}
        </div>
      </div>
    );
  };

  const existingKomponenIds = new Set((hppItems as HppItemRowType[]).map((i) => i.komponen_id));

  return (
    <div className="flex h-full flex-col bg-[#16181A]">
      {/* HEADER */}
      <div className="flex flex-col gap-3 border-b border-[#2A2D31] p-5 lg:flex-row lg:items-center lg:justify-between bg-[#1A1D1F]">
        <div>
          <h3 className="text-lg font-bold text-[#e5c17b]">Editor BOM & HPP</h3>
          <p className="text-sm font-mono text-[#9aa0a6] mt-0.5">
            {produkInfo.sku_internal} {produkInfo.sku_klien ? `• ${produkInfo.sku_klien}` : ''}
          </p>
        </div>
        <Button
          variant="outline"
          onClick={handleCopyHpp}
          disabled={copyingStatus || hppItems.length === 0}
          className="border-[#e5c17b]/30 bg-transparent text-[#e5c17b] hover:bg-[#e5c17b]/10 hover:border-[#e5c17b] h-8 text-xs"
        >
          {copyingStatus ? 'Menyalin...' : 'Terapkan ke Semua Size'}
        </Button>
      </div>

      {/* BODY SCROLL */}
      <div className="flex-1 overflow-y-auto px-5 pb-8 pt-2 relative">
        {isLoading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-[#16181A]/50 backdrop-blur-sm">
             <div className="h-6 w-6 animate-spin rounded-full border-2 border-[#e5c17b] border-t-transparent" />
          </div>
        )}

        {renderSection('Bahan Baku Utama', 'bahan_baku')}
        {renderSection('Biaya Produksi & Upah', 'biaya_produksi')}
        {renderSection('Overhead & Lainnya', 'overhead')}

        <div className="mt-6 flex justify-center">
          <Button
            variant="outline"
            className="w-full max-w-[240px] border-dashed border-[#2A2D31] bg-transparent text-[#9aa0a6] hover:border-[#e5c17b] hover:bg-[#e5c17b]/5 hover:text-[#e5c17b]"
            onClick={() => setModalOpen(true)}
          >
            <Plus className="mr-2 h-4 w-4" /> Tambah Komponen
          </Button>
        </div>
      </div>

      {/* FOOTER SUMMARY */}
      <div className="border-t border-[#2A2D31] bg-[#1A1D1F] p-5">
        <div className="space-y-1.5 text-sm">
          <div className="flex justify-between text-[#9aa0a6]">
            <span>Sub Bahan Baku</span>
            <span className="font-mono">{formatRupiah(subBahanBaku)}</span>
          </div>
          <div className="flex justify-between text-[#9aa0a6]">
            <span>Sub Biaya Produksi</span>
            <span className="font-mono">{formatRupiah(subBiayaProduksi)}</span>
          </div>
          <div className="flex justify-between text-[#9aa0a6]">
            <span>Sub Overhead</span>
            <span className="font-mono">{formatRupiah(subOverhead)}</span>
          </div>
        </div>

        <div className="my-3 h-px w-full bg-[#2A2D31] border-dashed border-b border-[#2A2D31]" />

        <div className="flex items-end justify-between">
          <div className="space-y-1">
             <span className="text-xs font-semibold text-[#5f6368] uppercase tracking-widest block">Total HPP</span>
             <span className="text-2xl font-bold font-mono text-[#e8eaed]">{formatRupiah(totalHpp)}</span>
          </div>
          <div className="text-right space-y-1">
             <span className="text-xs font-semibold text-[#5f6368] block">Harga Jual / PO</span>
             <span className="text-sm font-medium font-mono text-[#e8eaed]">{formatRupiah(produkInfo.harga_jual)}</span>
          </div>
        </div>

        <div className={`mt-4 rounded-lg p-3 flex justify-between items-center bg-[#1A1D1F] border ${margin >= 0 ? 'border-green-500/20 bg-green-500/5' : 'border-red-500/20 bg-red-500/5'}`}>
           <span className={`text-sm font-semibold ${margin >= 0 ? 'text-green-400' : 'text-red-400'}`}>Margin Profit</span>
           <div className="text-right flex flex-col items-end">
             <span className={`font-mono font-bold ${margin >= 0 ? 'text-green-400' : 'text-red-400'}`}>
               {margin >= 0 ? '+' : ''}{formatRupiah(margin)}
             </span>
             <span className={`text-xs ${margin >= 0 ? 'text-green-500/70' : 'text-red-500/70'}`}>
               {marginPersen === '-' ? '-' : `(${marginPersen}%)`}
             </span>
           </div>
        </div>
      </div>

      {/* Modal Tambah */}
      <AddKomponenModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        produkId={produkId}
        hppKomponenList={hppKomponenList}
        existingKomponenIds={existingKomponenIds}
      />
    </div>
  );
}
