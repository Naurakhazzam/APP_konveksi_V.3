'use client';

import React, { useEffect, useState, useMemo } from 'react';
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
  WarnaAksesori,
  addWarnaAksesori,
  deleteWarnaAksesori,
  getWarnaAksesori,
} from '@/lib/actions/produksi/model-aksesori.actions';
import { getInventoryItems, InventoryItem } from '@/lib/actions/inventory/item.actions';
import { getWarna } from '@/lib/actions/master/detail.actions';

interface AksesoriWarnaClientProps {
  initialData: WarnaAksesori[];
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


export default function AksesoriWarnaClient({ initialData }: AksesoriWarnaClientProps) {
  const [data, setData] = useState<WarnaAksesori[]>(initialData);
  const [inventoryItems, setInventoryItems] = useState<InventoryItem[]>([]);
  const [warnaList, setWarnaList] = useState<{ id: string; nama: string }[]>([]);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isLoadingItems, setIsLoadingItems] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Form state
  const [selectedWarnaId, setSelectedWarnaId] = useState('');
  const [selectedItemId, setSelectedItemId] = useState('');
  const [qtyPerPcs, setQtyPerPcs] = useState('1');
  const [tahapPakai, setTahapPakai] = useState('jahit');

  useEffect(() => {
    async function loadDeps() {
      setIsLoadingItems(true);
      try {
        const [items, warnas] = await Promise.all([
          getInventoryItems(),
          getWarna(),
        ]);
        setInventoryItems(items);
        setWarnaList(warnas);
      } catch (err) {
        console.error('Gagal memuat data:', err);
      } finally {
        setIsLoadingItems(false);
      }
    }
    loadDeps();
  }, []);

  const handleReload = async () => {
    try {
      const fresh = await getWarnaAksesori();
      setData(fresh);
    } catch (err) {
      console.error('Gagal reload:', err);
    }
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedWarnaId || !selectedItemId || !qtyPerPcs || !tahapPakai) {
      toast.error('Mohon lengkapi semua field');
      return;
    }
    setIsSubmitting(true);
    try {
      await addWarnaAksesori({
        warna_id: selectedWarnaId,
        inventory_item_id: selectedItemId,
        qty_per_pcs: parseFloat(qtyPerPcs),
        tahap_pakai: tahapPakai,
      });
      toast.success('Aksesori warna berhasil ditambahkan');
      setIsDialogOpen(false);
      setSelectedWarnaId('');
      setSelectedItemId('');
      setQtyPerPcs('1');
      setTahapPakai('jahit');
      await handleReload();
    } catch (err: any) {
      toast.error(err.message || 'Gagal menambahkan aksesori warna');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Hapus aksesori warna ini?')) return;
    try {
      await deleteWarnaAksesori(id);
      toast.success('Aksesori warna dihapus');
      await handleReload();
    } catch (err: any) {
      toast.error(err.message || 'Gagal menghapus');
    }
  };

  // Group by warna_nama
  const grouped = useMemo(() => {
    return data.reduce((acc, item) => {
      const key = item.warna_nama || 'Tanpa Warna';
      if (!acc[key]) acc[key] = [];
      acc[key].push(item);
      return acc;
    }, {} as Record<string, WarnaAksesori[]>);
  }, [data]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-[#9aa0a6]">
            Data aksesori yang berbeda per warna (contoh: benang jahit hitam untuk warna hitam).
          </p>
        </div>
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <Button
            onClick={() => setIsDialogOpen(true)}
            className="bg-[#e5c17b] hover:bg-[#d4b06a] text-black gap-2"
          >
            <Plus className="h-4 w-4" />
            Tambah Aksesori Warna
          </Button>
          <DialogContent className="bg-[#16181A] border-[#2A2D31] text-[#e8eaed] sm:max-w-[450px]">
            <DialogHeader>
              <DialogTitle>Tambah Aksesori Per Warna</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleAdd} className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="warna">Warna <span className="text-red-400">*</span></Label>
                <select
                  id="warna"
                  className={selectCls}
                  value={selectedWarnaId}
                  onChange={(e) => setSelectedWarnaId(e.target.value)}
                  disabled={isLoadingItems || isSubmitting}
                >
                  <option value="">-- Pilih Warna --</option>
                  {warnaList.map((w) => (
                    <option key={w.id} value={w.id}>{w.nama}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="item">Nama Barang Inventory <span className="text-red-400">*</span></Label>
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
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="rounded-md bg-[#e5c17b]/5 border border-[#e5c17b]/20 p-3 flex gap-3">
                <Info className="h-4 w-4 text-[#e5c17b] shrink-0 mt-0.5" />
                <p className="text-[10px] text-[#9aa0a6] leading-relaxed">
                  Data ini akan dipakai untuk aksesori yang spesifik per warna. Contoh: benang hitam untuk produk warna hitam.
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
                  disabled={isSubmitting || !selectedWarnaId || !selectedItemId}
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
              <TableHead className="text-[#9aa0a6]">Warna</TableHead>
              <TableHead className="text-[#9aa0a6]">Aksesori</TableHead>
              <TableHead className="text-[#9aa0a6]">Qty / Pcs</TableHead>
              <TableHead className="text-[#9aa0a6]">Satuan</TableHead>
              <TableHead className="text-[#9aa0a6]">Tahap</TableHead>
              <TableHead className="text-[#9aa0a6] w-[80px] text-right">Aksi</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.length === 0 ? (
              <TableRow className="hover:bg-transparent border-[#2A2D31]">
                <TableCell colSpan={6} className="h-32 text-center text-[#5f6368]">
                  Belum ada aksesori per warna. Klik &quot;Tambah Aksesori Warna&quot; untuk memulai.
                </TableCell>
              </TableRow>
            ) : (
              Object.entries(grouped).map(([warnaNama, items]) => (
                <React.Fragment key={`group-${warnaNama}`}>
                  <TableRow className="bg-[#1A1C1E] hover:bg-[#1A1C1E]">
                    <TableCell colSpan={6} className="py-1.5 px-4 border-b border-[#2A2D31]">
                      <span className="text-[10px] font-bold uppercase tracking-widest text-[#e5c17b]">
                        {warnaNama}
                      </span>
                    </TableCell>
                  </TableRow>
                  {items.map((item) => (
                    <TableRow key={item.id} className="border-[#2A2D31] hover:bg-[#1A1C1E]/50 group">
                      <TableCell className="text-[#9aa0a6] text-sm pl-8">
                        <span className="inline-flex items-center rounded-full bg-blue-500/10 px-2 py-0.5 text-xs text-blue-300">
                          {item.warna_nama}
                        </span>
                      </TableCell>
                      <TableCell className="font-medium text-[#e8eaed]">{item.inventory_item_nama}</TableCell>
                      <TableCell className="text-[#e8eaed]">{item.qty_per_pcs}</TableCell>
                      <TableCell className="text-[#9aa0a6]">{item.satuan}</TableCell>
                      <TableCell>
                        <span className="inline-flex items-center rounded-full bg-[#e5c17b]/10 px-2.5 py-0.5 text-xs font-medium text-[#e5c17b] capitalize">
                          {item.tahap_pakai.replace('_', ' ')}
                        </span>
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
                  ))}
                </React.Fragment>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
