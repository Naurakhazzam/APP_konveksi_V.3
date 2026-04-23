'use client';

import React, { useEffect, useState } from 'react';
import { Plus, Trash2, Loader2, Info } from 'lucide-react';
import { toast } from 'sonner';

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

import { 
  ModelAksesori, 
  addModelAksesori, 
  deleteModelAksesori,
  getModelAksesori
} from '@/lib/actions/produksi/model-aksesori.actions';
import { getInventoryItems, InventoryItem } from '@/lib/actions/inventory/item.actions';
import { getWarna } from '@/lib/actions/master/detail.actions';

interface AksesoriTabProps {
  modelId: string;
  initialData: ModelAksesori[];
}

const selectCls =
  'flex h-10 w-full rounded-md border border-[#2A2D31] bg-[#1E2124] px-3 py-2 text-sm text-[#e8eaed] focus:outline-none focus:ring-1 focus:ring-[#e5c17b] disabled:opacity-50';

const tahapPakaiOptions = [
  { value: 'cutting', label: 'Cutting' },
  { value: 'jahit', label: 'Sewing / Jahit' },
  { value: 'buang_benang', label: 'Buang Benang' },
  { value: 'lubang_kancing', label: 'Lubang Kancing' },
  { value: 'steam', label: 'Steam' },
  { value: 'packing', label: 'Packing' },
  { value: 'qc', label: 'QC' },
];


export default function AksesoriTab({ modelId, initialData }: AksesoriTabProps) {
  const [aksesoris, setAksesoris] = useState<ModelAksesori[]>(initialData);
  const [inventoryItems, setInventoryItems] = useState<InventoryItem[]>([]);
  const [warnaList, setWarnaList] = useState<{ id: string; nama: string }[]>([]);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isLoadingItems, setIsLoadingItems] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Form State
  const [selectedItemId, setSelectedItemId] = useState('');
  const [qtyPerPcs, setQtyPerPcs] = useState('1');
  const [tahapPakai, setTahapPakai] = useState('jahit');
  const [selectedWarnaId, setSelectedWarnaId] = useState('');

  useEffect(() => {
    async function loadItems() {
      setIsLoadingItems(true);
      try {
        const [items, warnas] = await Promise.all([
          getInventoryItems(),
          getWarna(),
        ]);
        setInventoryItems(items);
        setWarnaList(warnas);
      } catch (error) {
        console.error('Failed to load inventory items or warna:', error);
      } finally {
        setIsLoadingItems(false);
      }
    }
    loadItems();
  }, []);

  const handleReload = async () => {
    try {
      const data = await getModelAksesori(modelId);
      setAksesoris(data);
    } catch (error) {
      console.error('Failed to reload accessories:', error);
    }
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedItemId || !qtyPerPcs || !tahapPakai) {
      toast.error('Mohon lengkapi semua field');
      return;
    }

    setIsSubmitting(true);
    try {
      await addModelAksesori({
        model_id: modelId,
        inventory_item_id: selectedItemId,
        qty_per_pcs: parseFloat(qtyPerPcs),
        tahap_pakai: tahapPakai,
        warna_id: selectedWarnaId || null,
      });
      toast.success('Aksesori berhasil ditambahkan');
      setIsDialogOpen(false);
      setSelectedItemId('');
      setQtyPerPcs('1');
      setSelectedWarnaId('');
      await handleReload();
    } catch (error: any) {
      toast.error(error.message || 'Gagal menambahkan aksesori');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Hapus aksesori ini dari model?')) return;

    try {
      await deleteModelAksesori(id);
      toast.success('Aksesori dihapus');
      await handleReload();
    } catch (error: any) {
      toast.error(error.message || 'Gagal menghapus aksesori');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-medium text-[#e8eaed]">Daftar Aksesori Model</h3>
          <p className="text-xs text-[#9aa0a6] mt-1">
            Kebutuhan per 1 pcs produk. Stok akan dideduksi otomatis saat tahap produksi dicapai.
          </p>
        </div>

        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <Button
            onClick={() => setIsDialogOpen(true)}
            className="bg-[#e5c17b] hover:bg-[#d4b06a] text-black gap-2"
          >
            <Plus className="h-4 w-4" />
            Tambah Aksesori
          </Button>
          <DialogContent className="bg-[#16181A] border-[#2A2D31] text-[#e8eaed] sm:max-w-[425px]">
            <DialogHeader>
              <DialogTitle>Tambah Kebutuhan Aksesori</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleAdd} className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="item">Nama Barang Inventory</Label>
                <select
                  id="item"
                  className={selectCls}
                  value={selectedItemId}
                  onChange={(e) => setSelectedItemId(e.target.value)}
                  disabled={isLoadingItems || isSubmitting}
                >
                  <option value="">-- Pilih Barang --</option>
                  {inventoryItems.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.nama} ({item.satuan})
                    </option>
                  ))}
                </select>
                {isLoadingItems && <p className="text-[10px] text-[#e5c17b] animate-pulse">Memuat list inventory...</p>}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="qty">Qty per Pcs</Label>
                  <Input
                    id="qty"
                    type="number"
                    step="0.001"
                    min="0.001"
                    className="bg-[#1E2124] border-[#2A2D31]"
                    value={qtyPerPcs}
                    onChange={(e) => setQtyPerPcs(e.target.value)}
                    disabled={isSubmitting}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="tahap">Tahap Pakai</Label>
                  <select
                    id="tahap"
                    className={selectCls}
                    value={tahapPakai}
                    onChange={(e) => setTahapPakai(e.target.value)}
                    disabled={isSubmitting}
                  >
                    {tahapPakaiOptions.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="warna">Khusus Warna <span className="text-[#9aa0a6] font-normal">(opsional)</span></Label>
                <select
                  id="warna"
                  className={selectCls}
                  value={selectedWarnaId}
                  onChange={(e) => setSelectedWarnaId(e.target.value)}
                  disabled={isSubmitting}
                >
                  <option value="">-- Semua Warna --</option>
                  {warnaList.map((w) => (
                    <option key={w.id} value={w.id}>{w.nama}</option>
                  ))}
                </select>
                <p className="text-[10px] text-[#9aa0a6]">
                  Isi hanya jika aksesori ini berbeda tergantung warna produk (contoh: sleting saku Neck).
                </p>
              </div>

              <div className="rounded-md bg-[#e5c17b]/5 border border-[#e5c17b]/20 p-3 flex gap-3">
                <Info className="h-4 w-4 text-[#e5c17b] shrink-0 mt-0.5" />
                <p className="text-[10px] text-[#9aa0a6] leading-relaxed">
                  Contoh: Jika model butuh 5 kancing, isi 5. Jika butuh kain 0.8 meter, isi 0.8.
                  Sistem akan mengalikan nilai ini dengan jumlah bundle saat discan.
                </p>
              </div>

              <DialogFooter className="pt-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setIsDialogOpen(false)}
                  className="border-[#2A2D31] text-[#e8eaed] hover:bg-[#2A2D31]"
                  disabled={isSubmitting}
                >
                  Batal
                </Button>
                <Button
                  type="submit"
                  className="bg-[#e5c17b] hover:bg-[#d4b06a] text-black"
                  disabled={isSubmitting || !selectedItemId}
                >
                  {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Simpan'}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="rounded-lg border border-[#2A2D31] overflow-hidden">
        <Table>
          <TableHeader className="bg-[#1A1C1E]">
            <TableRow className="border-[#2A2D31] hover:bg-transparent">
              <TableHead className="text-[#9aa0a6]">Nama Aksesori</TableHead>
              <TableHead className="text-[#9aa0a6]">Qty / Pcs</TableHead>
              <TableHead className="text-[#9aa0a6]">Unit</TableHead>
              <TableHead className="text-[#9aa0a6]">Dipakai Pada Tahap</TableHead>
              <TableHead className="text-[#9aa0a6]">Warna</TableHead>
              <TableHead className="text-[#9aa0a6] w-[100px] text-right">Aksi</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {aksesoris.length === 0 ? (
              <TableRow className="hover:bg-transparent border-[#2A2D31]">
                <TableCell colSpan={6} className="h-32 text-center text-[#5f6368]">
                  Belum ada aksesori yang ditambahkan untuk model ini.
                </TableCell>
              </TableRow>
            ) : (
              aksesoris.map((item) => (
                <TableRow key={item.id} className="border-[#2A2D31] hover:bg-[#1A1C1E]/50 group">
                  <TableCell className="font-medium text-[#e8eaed]">{item.inventory_item_nama}</TableCell>
                  <TableCell className="text-[#e8eaed]">{item.qty_per_pcs}</TableCell>
                  <TableCell className="text-[#9aa0a6]">{item.satuan}</TableCell>
                  <TableCell>
                    <span className="inline-flex items-center rounded-full bg-[#e5c17b]/10 px-2.5 py-0.5 text-xs font-medium text-[#e5c17b] capitalize">
                      {item.tahap_pakai.replace('_', ' ')}
                    </span>
                  </TableCell>
                  <TableCell className="text-[#9aa0a6] text-sm">
                    {item.warna_nama ? (
                      <span className="inline-flex items-center rounded-full bg-blue-500/10 px-2 py-0.5 text-xs text-blue-300">
                        {item.warna_nama}
                      </span>
                    ) : (
                      <span className="text-[#5f6368] text-xs italic">Semua warna</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleDelete(item.id)}
                      className="text-[#9aa0a6] hover:text-red-400 hover:bg-red-400/10 transition-colors"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
