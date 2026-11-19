'use client';

import React, { useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Plus } from 'lucide-react';
import { InputPoModelBlock, cellKey, type ModelBlockState } from './InputPoModelBlock';
import { createPoWithBundles, addItemsToExistingPo } from '@/lib/actions/produksi/po-mutations.actions';
import { checkPoExists } from '@/lib/actions/produksi/po.actions';
import type { CreatePoInput, AddItemsToPoInput } from '@/lib/validations/po.schemas';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import { tanggalWIB } from '@/lib/waktu';

interface Props {
  defaultPoNumber: string;
  klienList: { id: string; nama: string }[];
  modelList: { id: string; nama: string }[];
}

export function InputPoForm({ defaultPoNumber, klienList, modelList }: Props) {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  
  const [noPo, setNoPo] = useState(defaultPoNumber);
  const [klienId, setKlienId] = useState('');
  const [tanggalOrder, setTanggalOrder] = useState(tanggalWIB());
  const [tanggalTarget, setTanggalTarget] = useState('');
  const [catatan, setCatatan] = useState('');

  const newBlock = (): ModelBlockState => ({ id: crypto.randomUUID(), model_id: '', qty_per_bundle: 12, qty: {}, matrix: null });
  const [blocks, setBlocks] = useState<ModelBlockState[]>(() => [newBlock()]);

  // Konfirmasi tambah artikel ke PO yang sudah ada
  const [appendConfirm, setAppendConfirm] = useState<{
    payload: AddItemsToPoInput;
    klienNama: string | null;
    status: string | null;
  } | null>(null);

  const handleBlockChange = useCallback((id: string, updates: Partial<ModelBlockState>) => {
    setBlocks(prev => prev.map(b => (b.id === id ? { ...b, ...updates } : b)));
  }, []);

  const handleAddBlock = () => setBlocks(prev => [...prev, newBlock()]);

  const handleRemoveBlock = (id: string) => {
    setBlocks(prev => (prev.length > 1 ? prev.filter(b => b.id !== id) : prev));
  };

  // Ratakan tabel warna × size jadi daftar artikel (1 sel terisi = 1 artikel)
  const buildItems = () => blocks.flatMap(b => {
    const m = b.matrix;
    if (!b.model_id || !m) return [];
    const isi = b.qty_per_bundle || 12;
    return m.warna.flatMap(w => m.size.flatMap(sz => {
      const qty = b.qty[cellKey(w.id, sz.id)] || 0;
      const produk_id = m.produk[cellKey(w.id, sz.id)];
      if (qty <= 0 || !produk_id) return [];
      return [{
        model_id: b.model_id,
        warna_id: w.id,
        size_id: sz.id,
        produk_id,
        warna: w.nama,
        size: sz.nama,
        qty_order: qty,
        qty_per_bundle: isi,
      }];
    }));
  });

  const items = buildItems();
  const totalQty = items.reduce((sum, i) => sum + i.qty_order, 0);
  const totalBundle = items.reduce((sum, i) => sum + Math.ceil(i.qty_order / i.qty_per_bundle), 0);
  const usedModelIds = blocks.map(b => b.model_id).filter(Boolean);

  const isFormValid = noPo.trim() !== '' && klienId !== '' && items.length > 0;

  const goToMonitoring = () => {
    router.push('/app/produksi/monitoring');
    router.refresh();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isFormValid) return;

    setIsLoading(true);
    try {
      // Cek dulu apakah nomor PO sudah ada
      const check = await checkPoExists(noPo);

      if (check.exists) {
        if (!check.canAppend) {
          toast.error(`PO ${noPo} berstatus "${check.status}" — tidak bisa ditambah artikel.`);
          setIsLoading(false);
          return;
        }
        // PO aktif/selesai → minta konfirmasi tambah artikel
        setAppendConfirm({
          payload: { no_po: noPo, items },
          klienNama: check.klienNama,
          status: check.status,
        });
        setIsLoading(false);
        return;
      }

      // PO baru → buat seperti biasa
      const payload: CreatePoInput = {
        no_po: noPo,
        klien_id: klienId,
        tanggal_order: new Date(tanggalOrder).toISOString(),
        tanggal_target: tanggalTarget ? new Date(tanggalTarget).toISOString() : null,
        catatan: catatan || null,
        items,
      };

      await createPoWithBundles(payload);
      toast.success('PO berhasil dibuat dan barcode telah digenerate');
      goToMonitoring();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Terjadi kesalahan saat menyimpan PO';
      toast.error(msg);
      setIsLoading(false);
    }
  };

  const handleConfirmAppend = async () => {
    if (!appendConfirm) return;
    setIsLoading(true);
    try {
      await addItemsToExistingPo(appendConfirm.payload);
      toast.success(`${appendConfirm.payload.items.length} artikel ditambahkan ke ${appendConfirm.payload.no_po}`);
      setAppendConfirm(null);
      goToMonitoring();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Gagal menambah artikel ke PO';
      toast.error(msg);
      setAppendConfirm(null);
      setIsLoading(false);
    }
  };

  return (
    <>
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="rounded-xl border border-[#2A2D31] bg-[#1A1D1F] p-5 space-y-4 shadow-sm">
        <h3 className="text-sm font-semibold tracking-wide text-[#e5c17b]">INFO UTAMA PO</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label className="text-[#e8eaed] text-sm font-medium">No. PO</Label>
            <Input 
              required
              disabled={isLoading}
              className="bg-[#1E2124] border-[#2A2D31] text-[#e8eaed] focus-visible:ring-[#e5c17b] transition-all"
              value={noPo}
              onChange={e => setNoPo(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label className="text-[#e8eaed] text-sm font-medium">Klien</Label>
            <select 
              required
              disabled={isLoading}
              className="flex h-10 w-full rounded-md border border-[#2A2D31] bg-[#1E2124] px-3 py-2 text-sm text-[#e8eaed] focus:outline-none focus:ring-1 focus:ring-[#e5c17b] disabled:opacity-50 transition-all"
              value={klienId}
              onChange={e => setKlienId(e.target.value)}
            >
              <option value="">Pilih Klien...</option>
              {klienList.map(k => <option key={k.id} value={k.id}>{k.nama}</option>)}
            </select>
          </div>
          <div className="space-y-2">
            <Label className="text-[#e8eaed] text-sm font-medium">Tanggal Order</Label>
            <Input 
              type="date"
              required
              disabled={isLoading}
              className="bg-[#1E2124] border-[#2A2D31] text-[#e8eaed] focus-visible:ring-[#e5c17b] transition-all"
              value={tanggalOrder}
              onChange={e => setTanggalOrder(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label className="text-[#e8eaed] text-sm font-medium">Deadline (Opsional)</Label>
            <Input 
              type="date"
              disabled={isLoading}
              className="bg-[#1E2124] border-[#2A2D31] text-[#e8eaed] focus-visible:ring-[#e5c17b] transition-all"
              value={tanggalTarget}
              onChange={e => setTanggalTarget(e.target.value)}
            />
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label className="text-[#e8eaed] text-sm font-medium">Catatan (Opsional)</Label>
            <textarea 
              disabled={isLoading}
              className="flex w-full rounded-md border border-[#2A2D31] bg-[#1E2124] px-3 py-2 text-sm text-[#e8eaed] placeholder:text-[#9aa0a6] focus:outline-none focus:ring-1 focus:ring-[#e5c17b] disabled:cursor-not-allowed disabled:opacity-50 min-h-[80px] transition-all"
              value={catatan}
              onChange={(e) => setCatatan(e.target.value)}
              placeholder="Tambahkan instruksi khusus..."
              rows={2}
            />
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-[#2A2D31] bg-[#1A1D1F] overflow-hidden shadow-sm">
        <div className="p-4 bg-[#2A2D31]/20 border-b border-[#2A2D31]">
          <h3 className="text-sm font-semibold tracking-wide text-[#e5c17b]">DETAIL ARTIKEL</h3>
        </div>
        {blocks.map(block => (
          <InputPoModelBlock
            key={block.id}
            block={block}
            modelList={modelList}
            usedModelIds={usedModelIds.filter(id => id !== block.model_id)}
            onChange={handleBlockChange}
            onRemove={handleRemoveBlock}
            canRemove={blocks.length > 1}
            disabled={isLoading}
          />
        ))}
        <div className="p-3 border-t border-[#2A2D31] bg-[#1A1D1F]">
          <Button 
            type="button" 
            variant="outline" 
            onClick={handleAddBlock}
            disabled={isLoading}
            className="border-dashed border-[#e5c17b]/40 text-[#e5c17b] hover:bg-[#e5c17b]/10 hover:border-[#e5c17b] w-full transition-all"
          >
            <Plus className="w-4 h-4 mr-2" />
            Tambah Model
          </Button>
        </div>
        <div className="p-4 bg-[#1E2124] border-t border-[#2A2D31] flex justify-end items-center text-sm">
          <div className="text-[#9aa0a6] mr-4">Artikel: <span className="text-[#e8eaed] font-medium ml-1">{items.length}</span></div>
          <div className="text-[#9aa0a6] mr-4">Total QTY: <span className="text-[#e8eaed] font-medium ml-1">{totalQty} pcs</span></div>
          <div className="text-[#9aa0a6]">Total Bundle: <span className="text-[#e5c17b] font-bold ml-1">{totalBundle} tiket</span></div>
        </div>
      </div>

      <div className="flex justify-end items-center gap-4 pt-2">
        <Link 
          href="/app/produksi/monitoring" 
          className="text-[#9aa0a6] hover:text-[#e8eaed] text-sm font-medium transition-colors"
        >
          Batal
        </Link>
        <Button 
          type="submit" 
          disabled={isLoading || !isFormValid}
          className="bg-[color:var(--status-green)] hover:bg-[color:var(--status-green)]/90 text-white font-semibold transition-all px-6 disabled:opacity-50"
        >
          {isLoading ? 'Menyimpan...' : 'Simpan & Generate Barcode'}
        </Button>
      </div>
    </form>

    <Dialog open={appendConfirm !== null} onOpenChange={(o) => { if (!o) setAppendConfirm(null); }}>
      <DialogContent className="bg-[#1A1D1F] border-[#2A2D31] text-[#e8eaed]">
        <DialogHeader>
          <DialogTitle className="text-[#e5c17b]">PO sudah ada</DialogTitle>
          <DialogDescription className="text-[#9aa0a6]">
            Nomor <span className="font-semibold text-[#e8eaed]">{appendConfirm?.payload.no_po}</span>
            {appendConfirm?.klienNama ? <> (klien {appendConfirm.klienNama})</> : null} sudah terdaftar
            {appendConfirm?.status === 'selesai'
              ? <> dan sudah <span className="font-semibold text-[#e8eaed]">selesai</span> — PO akan dibuka lagi (status aktif).</>
              : <> dan masih aktif.</>}
            Tambahkan <span className="font-semibold text-[#e8eaed]">{appendConfirm?.payload.items.length} artikel</span> ke PO ini?
            Artikel baru beserta barcode bundle-nya akan ditambahkan ke PO tersebut.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => setAppendConfirm(null)}
            disabled={isLoading}
            className="border-[#2A2D31] text-[#e8eaed] hover:bg-[#2A2D31]"
          >
            Batal
          </Button>
          <Button
            type="button"
            onClick={handleConfirmAppend}
            disabled={isLoading}
            className="bg-[color:var(--status-green)] hover:bg-[color:var(--status-green)]/90 text-white font-semibold"
          >
            {isLoading ? 'Menambahkan...' : 'Ya, Tambahkan Artikel'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}
