'use client';

import React, { useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Plus } from 'lucide-react';
import { InputPoLineItem, type LineItemState } from './InputPoLineItem';
import { createPoWithBundles } from '@/lib/actions/produksi/po-mutations.actions';
import type { CreatePoInput } from '@/lib/validations/po.schemas';
import { toast } from 'sonner';

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
  const [tanggalOrder, setTanggalOrder] = useState(new Date().toISOString().split('T')[0]);
  const [tanggalTarget, setTanggalTarget] = useState('');
  const [catatan, setCatatan] = useState('');

  const [items, setItems] = useState<LineItemState[]>([
    { id: crypto.randomUUID(), model_id: '', warna_id: '', size_id: '', produk_id: null, warna_nama: '', size_nama: '', qty_order: 100, qty_per_bundle: 12 }
  ]);

  const handleItemChange = useCallback((index: number, updates: Partial<LineItemState>) => {
    setItems(prev => {
      const next = [...prev];
      next[index] = { ...next[index], ...updates };
      return next;
    });
  }, []);

  const handleAddItem = () => {
    setItems(prev => [...prev, {
      id: crypto.randomUUID(), model_id: '', warna_id: '', size_id: '', produk_id: null, warna_nama: '', size_nama: '', qty_order: 100, qty_per_bundle: 12
    }]);
  };

  const handleRemoveItem = (index: number) => {
    if (items.length > 1) {
      setItems(prev => prev.filter((_, i) => i !== index));
    }
  };

  const totalQty = items.reduce((sum, item) => sum + (item.qty_order || 0), 0);
  const totalBundle = items.reduce((sum, item) => sum + Math.ceil((item.qty_order || 0) / (item.qty_per_bundle || 12)), 0);

  const isFormValid = noPo.trim() !== '' && klienId !== '' && items.every(i => i.produk_id !== null && (i.qty_order || 0) > 0);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isFormValid) return;
    
    setIsLoading(true);
    try {
      const payload: CreatePoInput = {
        no_po: noPo,
        klien_id: klienId,
        tanggal_order: new Date(tanggalOrder).toISOString(),
        tanggal_target: tanggalTarget ? new Date(tanggalTarget).toISOString() : null,
        catatan: catatan || null,
        items: items.map(i => ({
          model_id: i.model_id,
          warna_id: i.warna_id,
          size_id: i.size_id,
          produk_id: i.produk_id!,
          warna: i.warna_nama,
          size: i.size_nama,
          qty_order: i.qty_order || 0,
          qty_per_bundle: i.qty_per_bundle || 12,
        })),
      };
      
      await createPoWithBundles(payload);
      toast.success('PO berhasil dibuat dan barcode telah digenerate');
      router.push('/app/produksi/monitoring');
      router.refresh();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Terjadi kesalahan saat menyimpan PO';
      toast.error(msg);
      setIsLoading(false);
    }
  };

  return (
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
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-[#9aa0a6]">
            <thead className="bg-[#1E2124]/50 border-b border-[#2A2D31]">
              <tr>
                <th className="p-3 font-semibold text-[#e8eaed]">MODEL</th>
                <th className="p-3 font-semibold text-[#e8eaed]">WARNA</th>
                <th className="p-3 font-semibold text-[#e8eaed]">SIZE</th>
                <th className="p-3 font-semibold text-[#e8eaed]">QTY ORDER</th>
                <th className="p-3 font-semibold text-[#e8eaed]">ISI/BUNDLE</th>
                <th className="p-3 font-semibold text-[#e8eaed] text-center">BUNDLE</th>
                <th className="p-3 w-16"></th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, index) => (
                <InputPoLineItem 
                  key={item.id} 
                  index={index} 
                  item={item} 
                  modelList={modelList} 
                  onChange={handleItemChange} 
                  onRemove={handleRemoveItem}
                  canRemove={items.length > 1}
                  disabled={isLoading}
                />
              ))}
            </tbody>
          </table>
        </div>
        <div className="p-3 border-t border-[#2A2D31] bg-[#1A1D1F]">
          <Button 
            type="button" 
            variant="outline" 
            onClick={handleAddItem}
            disabled={isLoading}
            className="border-dashed border-[#e5c17b]/40 text-[#e5c17b] hover:bg-[#e5c17b]/10 hover:border-[#e5c17b] w-full transition-all"
          >
            <Plus className="w-4 h-4 mr-2" />
            Tambah Artikel
          </Button>
        </div>
        <div className="p-4 bg-[#1E2124] border-t border-[#2A2D31] flex justify-end items-center text-sm">
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
  );
}
