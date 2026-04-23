'use client';

import { useState, useMemo } from 'react';
import { 
  Plus, 
  Search, 
  Package, 
  AlertTriangle, 
  TrendingUp, 
  ArrowRight, 
  History,
  MoreVertical,
  ChevronRight,
  Hash,
  Pencil,
  PlusCircle
} from 'lucide-react';
import { toast } from 'sonner';
import { 
  InventoryOverviewItem, 
  StokMasukInput, 
  TambahItemInput,
  UpdateItemInput,
  tambahInventoryItem,
  addStokMasuk,
  updateInventoryItem
} from '@/lib/actions/inventory/inventory.actions';
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle, 
  DialogFooter,
  DialogDescription
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

interface Props {
  items: InventoryOverviewItem[];
  kategoriTrxList: { id: string; nama: string }[];
  warnaList: { id: string; nama: string }[];
}

export default function InventoryOverviewClient({ items, kategoriTrxList, warnaList }: Props) {
  const [localItems, setLocalItems] = useState<InventoryOverviewItem[]>(items);
  const [searchQuery, setSearchQuery] = useState('');
  const [showTambahItem, setShowTambahItem] = useState(false);
  const [showStokMasuk, setShowStokMasuk] = useState(false);
  const [selectedItem, setSelectedItem] = useState<InventoryOverviewItem | null>(null);
  const [tambahWarnaId, setTambahWarnaId] = useState<string>('');

  const [showEditItem, setShowEditItem] = useState(false);
  const [editingItem, setEditingItem] = useState<InventoryOverviewItem | null>(null);
  const [editWarnaId, setEditWarnaId] = useState<string>('');
  const [editLoading, setEditLoading] = useState(false);

  // Form states
  const [tambahLoading, setTambahLoading] = useState(false);
  const [stokMasukLoading, setStokMasukLoading] = useState(false);

  // Filter items
  const filteredItems = useMemo(() => {
    return localItems.filter(item => 
      item.nama.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [localItems, searchQuery]);

  // Summary counts
  const totalItems = localItems.length;
  const lowStockCount = localItems.filter(i => i.status === 'low' || i.status === 'minus').length;

  // --- Handlers ---

  const handleTambahItem = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setTambahLoading(true);
    const formData = new FormData(e.currentTarget);
    
    const input: TambahItemInput = {
      nama: formData.get('nama') as string,
      satuan: formData.get('satuan') as string,
      stok_minimum: Number(formData.get('stok_minimum')) || 0,
      warna_id: tambahWarnaId || null,
    };

    try {
      const newId = await tambahInventoryItem(input);
      const selectedWarna = warnaList.find(w => w.id === tambahWarnaId);
      const newItem: InventoryOverviewItem = {
        id: newId,
        ...input,
        stok_aktual: 0,
        status: 'low', // Karena stok 0 dan min >= 0
        batch_count: 0,
        warna_nama: selectedWarna?.nama ?? null,
      };
      setLocalItems(prev => [...prev, newItem].sort((a, b) => a.nama.localeCompare(b.nama)));
      setShowTambahItem(false);
      setTambahWarnaId('');
      toast.success('Item baru berhasil ditambahkan');
    } catch (err: any) {
      toast.error(err.message || 'Gagal menambahkan item');
    } finally {
      setTambahLoading(false);
    }
  };

  const handleStokMasuk = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!selectedItem) return;
    
    setStokMasukLoading(true);
    const formData = new FormData(e.currentTarget);
    
    const qty = Number(formData.get('qty'));
    const harga_satuan = Number(formData.get('harga_satuan'));

    const input: StokMasukInput = {
      inventory_item_id: selectedItem.id,
      qty,
      harga_satuan,
      tanggal_masuk: formData.get('tanggal_masuk') as string,
      no_faktur: formData.get('no_faktur') as string || undefined,
      kategori_trx_id: formData.get('kategori_trx_id') as string,
      keterangan: formData.get('keterangan') as string || undefined,
    };

    try {
      const result = await addStokMasuk(input);
      
      // Update optimistik
      setLocalItems(prev => prev.map(item => {
        if (item.id === selectedItem.id) {
          const newStok = result.stok_baru;
          const newStatus = newStok < 0 ? 'minus' : (newStok <= item.stok_minimum ? 'low' : 'normal');
          return {
            ...item,
            stok_aktual: newStok,
            status: newStatus,
            batch_count: item.batch_count + 1
          };
        }
        return item;
      }));

      setShowStokMasuk(false);
      setSelectedItem(null);
      toast.success('Stok masuk berhasil dicatat');
    } catch (err: any) {
      toast.error(err.message || 'Gagal mencatat stok masuk');
    } finally {
      setStokMasukLoading(false);
    }
  };

  const handleEditItem = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!editingItem) return;
    setEditLoading(true);
    const formData = new FormData(e.currentTarget);

    const input: UpdateItemInput = {
      nama: formData.get('nama') as string,
      satuan: formData.get('satuan') as string,
      stok_minimum: Number(formData.get('stok_minimum')) || 0,
      warna_id: editWarnaId || null,
    };

    try {
      await updateInventoryItem(editingItem.id, input);
      const selectedWarna = warnaList.find(w => w.id === editWarnaId);
      setLocalItems(prev => prev.map(item =>
        item.id === editingItem.id
          ? { ...item, ...input, warna_nama: selectedWarna?.nama ?? null }
          : item
      ));
      setShowEditItem(false);
      setEditingItem(null);
      toast.success('Item berhasil diperbarui');
    } catch (err: any) {
      toast.error(err.message || 'Gagal memperbarui item');
    } finally {
      setEditLoading(false);
    }
  };

  const openEditModal = (item: InventoryOverviewItem) => {
    setEditingItem(item);
    setEditWarnaId(item.warna_id ?? '');
    setShowEditItem(true);
  };

  return (
    <div className="space-y-6">
      {/* Header & Actions */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[#e8eaed]">Overview Stok Inventory</h1>
          <p className="text-sm text-[#9aa0a6] mt-1">Pantau dan kelola stok bahan baku serta aksesori</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative group">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#9aa0a6] group-focus-within:text-[#e5c17b] transition-colors" />
            <Input 
              placeholder="Cari item..." 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 w-64 bg-[#1A1D1F] border-[#2A2D31] focus:border-[#e5c17b] focus:ring-[#e5c17b]/20"
            />
          </div>
          <Button 
            onClick={() => setShowTambahItem(true)}
            className="bg-[#e5c17b] hover:bg-[#d4b06a] text-[#0D0E10] font-semibold gap-2"
          >
            <Plus className="h-4 w-4" />
            Tambah Item
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-[#1A1D1F] border border-[#2A2D31] rounded-2xl p-5 shadow-sm">
          <div className="flex items-center gap-4">
            <div className="h-12 w-12 rounded-xl bg-[#2A2D31] flex items-center justify-center text-[#e5c17b]">
              <Package size={24} />
            </div>
            <div>
              <p className="text-xs font-medium text-[#9aa0a6] uppercase tracking-wider">Total Items</p>
              <p className="text-2xl font-bold text-[#e8eaed]">{totalItems}</p>
            </div>
          </div>
        </div>

        <div className={`bg-[#1A1D1F] border rounded-2xl p-5 shadow-sm transition-colors ${lowStockCount > 0 ? 'border-orange-500/30' : 'border-[#2A2D31]'}`}>
          <div className="flex items-center gap-4">
            <div className={`h-12 w-12 rounded-xl flex items-center justify-center ${lowStockCount > 0 ? 'bg-orange-500/10 text-orange-500' : 'bg-[#2A2D31] text-[#9aa0a6]'}`}>
              <AlertTriangle size={24} />
            </div>
            <div>
              <p className="text-xs font-medium text-[#9aa0a6] uppercase tracking-wider">Stok Rendah / Minus</p>
              <p className={`text-2xl font-bold ${lowStockCount > 0 ? 'text-orange-500' : 'text-[#e8eaed]'}`}>{lowStockCount}</p>
            </div>
          </div>
        </div>

        <div className="bg-[#1A1D1F] border border-[#2A2D31] rounded-2xl p-5 shadow-sm">
          <div className="flex items-center gap-4">
            <div className="h-12 w-12 rounded-xl bg-[#2A2D31] flex items-center justify-center text-[#e5c17b]">
              <TrendingUp size={24} />
            </div>
            <div>
              <p className="text-xs font-medium text-[#9aa0a6] uppercase tracking-wider">Total Nilai Stok</p>
              <p className="text-2xl font-bold text-[#e8eaed]">Lihat Jurnal</p>
            </div>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="bg-[#1A1D1F] border border-[#2A2D31] rounded-2xl overflow-hidden shadow-sm">
        <Table>
          <TableHeader className="bg-[#1E2124]">
            <TableRow className="hover:bg-transparent border-[#2A2D31]">
              <TableHead className="text-[#9aa0a6] font-semibold">Nama Item</TableHead>
              <TableHead className="text-[#9aa0a6] font-semibold">Satuan</TableHead>
              <TableHead className="text-[#9aa0a6] font-semibold">Warna</TableHead>
              <TableHead className="text-[#9aa0a6] font-semibold text-center">Stok Aktual</TableHead>
              <TableHead className="text-[#9aa0a6] font-semibold text-center">Min. Stok</TableHead>
              <TableHead className="text-[#9aa0a6] font-semibold">Status</TableHead>
              <TableHead className="text-[#9aa0a6] font-semibold text-center">Batch Aktif</TableHead>
              <TableHead className="text-[#9aa0a6] font-semibold text-right">Aksi</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredItems.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="h-32 text-center text-[#9aa0a6]">
                  Tidak ada data inventory ditemukan.
                </TableCell>
              </TableRow>
            ) : (
              filteredItems.map((item) => (
                <TableRow key={item.id} className="border-[#2A2D31] hover:bg-[#1E2124]/50 transition-colors">
                  <TableCell className="font-semibold text-[#e8eaed]">{item.nama}</TableCell>
                  <TableCell className="text-[#9aa0a6]">{item.satuan}</TableCell>
                  <TableCell>
                    {item.warna_nama ? (
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-[#e5c17b]/10 text-[#e5c17b] border border-[#e5c17b]/20">
                        {item.warna_nama}
                      </span>
                    ) : (
                      <span className="text-[#5f6368] text-xs">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-center font-bold">
                    <span className={
                      item.status === 'minus' ? 'text-red-500' : 
                      item.status === 'low' ? 'text-orange-500' : 'text-[#e8eaed]'
                    }>
                      {item.stok_aktual.toLocaleString('id-ID')}
                    </span>
                  </TableCell>
                  <TableCell className="text-center text-[#9aa0a6]">{item.stok_minimum}</TableCell>
                  <TableCell>
                    <Badge className={
                      item.status === 'minus' ? 'bg-red-500/10 text-red-500 border-red-500/20' :
                      item.status === 'low' ? 'bg-orange-500/10 text-orange-500 border-orange-500/20' :
                      'bg-green-500/10 text-green-500 border-green-500/20'
                    }>
                      {item.status === 'minus' ? 'Minus' : item.status === 'low' ? 'Stok Rendah' : 'Normal'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-center">
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-[#2A2D31] text-[#e8eaed] text-xs font-medium">
                      <Hash size={10} className="text-[#e5c17b]" />
                      {item.batch_count}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button 
                      variant="ghost" 
                      size="sm"
                      onClick={() => openEditModal(item)}
                      className="text-[#9aa0a6] hover:text-[#e5c17b] hover:bg-[#e5c17b]/10 h-8 w-8 p-0 rounded-lg mr-1"
                    >
                      <Pencil size={14} />
                    </Button>
                    <Button 
                      variant="ghost" 
                      size="sm"
                      onClick={() => { setSelectedItem(item); setShowStokMasuk(true); }}
                      className="text-[#9aa0a6] hover:text-[#e5c17b] hover:bg-[#e5c17b]/10 h-8 w-8 p-0 rounded-lg"
                    >
                      <PlusCircle size={14} />
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Modal Tambah Item */}
      <Dialog open={showTambahItem} onOpenChange={setShowTambahItem}>
        <DialogContent className="bg-[#1A1D1F] border-[#2A2D31] text-[#e8eaed] sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Tambah Item Inventory</DialogTitle>
            <DialogDescription className="text-[#9aa0a6]">
              Daftarkan bahan baku atau aksesori baru ke dalam sistem.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleTambahItem} className="space-y-4 pt-4">
            <div className="space-y-2">
              <Label htmlFor="nama">Nama Item</Label>
              <Input 
                id="nama" 
                name="nama" 
                required 
                autoComplete="off"
                className="bg-[#16181A] border-[#2A2D31] focus:ring-[#e5c17b]"
                placeholder="Contoh: Kain Combed 30s Hitam"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="satuan">Satuan</Label>
                <Input 
                  id="satuan" 
                  name="satuan" 
                  required 
                  autoComplete="off"
                  className="bg-[#16181A] border-[#2A2D31] focus:ring-[#e5c17b]"
                  placeholder="pcs / meter / kg"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="stok_minimum">Stok Minimum</Label>
                <Input 
                  id="stok_minimum" 
                  name="stok_minimum" 
                  type="number" 
                  autoComplete="off"
                  defaultValue={0} 
                  min={0}
                  className="bg-[#16181A] border-[#2A2D31] focus:ring-[#e5c17b]"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="warna_id">Warna (Opsional)</Label>
              <select
                id="warna_id"
                value={tambahWarnaId}
                onChange={(e) => setTambahWarnaId(e.target.value)}
                className="w-full h-10 px-3 rounded-md bg-[#16181A] border border-[#2A2D31] text-sm focus:ring-1 focus:ring-[#e5c17b] outline-none"
              >
                <option value="">— Tanpa Warna Spesifik —</option>
                {warnaList.map(w => (
                  <option key={w.id} value={w.id}>{w.nama}</option>
                ))}
              </select>
            </div>
            <DialogFooter className="pt-4">
              <Button 
                type="button" 
                variant="ghost" 
                onClick={() => setShowTambahItem(false)}
                className="text-[#9aa0a6] hover:text-[#e8eaed]"
              >
                Batal
              </Button>
              <Button 
                type="submit" 
                disabled={tambahLoading}
                className="bg-[#e5c17b] hover:bg-[#d4b06a] text-[#0D0E10] font-semibold min-w-[100px]"
              >
                {tambahLoading ? 'Menyimpan...' : 'Simpan Item'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Modal Stok Masuk */}
      <Dialog open={showStokMasuk} onOpenChange={(o) => { setShowStokMasuk(o); if (!o) setSelectedItem(null); }}>
        <DialogContent className="bg-[#1A1D1F] border-[#2A2D31] text-[#e8eaed] sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>Stok Masuk — {selectedItem?.nama}</DialogTitle>
            <DialogDescription className="text-[#9aa0a6]">
              Catat penambahan stok baru ke dalam gudang.
            </DialogDescription>
          </DialogHeader>
          
          {selectedItem && (
            <div className="bg-[#2A2D31]/30 rounded-xl p-4 flex justify-between items-center border border-[#2A2D31]">
              <div className="text-sm text-[#9aa0a6]">Stok Saat Ini</div>
              <div className="font-bold text-[#e8eaed]">{selectedItem.stok_aktual.toLocaleString('id-ID')} {selectedItem.satuan}</div>
            </div>
          )}

          <form onSubmit={handleStokMasuk} className="space-y-4 pt-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="qty">Qty Masuk</Label>
                <Input 
                  id="qty" 
                  name="qty" 
                  type="number" 
                  step="0.001" 
                  required 
                  autoComplete="off"
                  className="bg-[#16181A] border-[#2A2D31]"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="harga_satuan">Harga Satuan (Rp)</Label>
                <Input 
                  id="harga_satuan" 
                  name="harga_satuan" 
                  type="number" 
                  required 
                  autoComplete="off"
                  className="bg-[#16181A] border-[#2A2D31]"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="tanggal_masuk">Tanggal Masuk</Label>
                <Input 
                  id="tanggal_masuk" 
                  name="tanggal_masuk" 
                  type="date" 
                  defaultValue={new Date().toISOString().split('T')[0]} 
                  required 
                  className="bg-[#16181A] border-[#2A2D31]"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="kategori_trx_id">Kategori Biaya</Label>
                <select 
                  id="kategori_trx_id" 
                  name="kategori_trx_id" 
                  required
                  className="w-full h-10 px-3 rounded-md bg-[#16181A] border border-[#2A2D31] text-sm focus:ring-1 focus:ring-[#e5c17b] outline-none"
                >
                  <option value="">Pilih Kategori</option>
                  {kategoriTrxList.map(k => (
                    <option key={k.id} value={k.id}>{k.nama}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="no_faktur">Nomor Faktur (Opsional)</Label>
              <Input 
                id="no_faktur" 
                name="no_faktur" 
                autoComplete="off"
                className="bg-[#16181A] border-[#2A2D31]" 
                placeholder="Contoh: INV/2024/001"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="keterangan">Keterangan (Opsional)</Label>
              <textarea 
                id="keterangan" 
                name="keterangan" 
                className="w-full min-h-[80px] p-3 rounded-md bg-[#16181A] border border-[#2A2D31] text-sm focus:ring-1 focus:ring-[#e5c17b] outline-none"
                placeholder="Catatan tambahan..."
              />
            </div>

            <DialogFooter className="pt-4 flex flex-col sm:flex-row gap-4 sm:gap-0 items-center justify-between">
              <div className="text-sm font-medium text-[#e5c17b] bg-[#e5c17b]/10 px-3 py-1.5 rounded-lg border border-[#e5c17b]/20">
                Preview Total Nilai: Rp — (Update Realtime)
              </div>
              <div className="flex gap-2">
                <Button 
                  type="button" 
                  variant="ghost" 
                  onClick={() => setShowStokMasuk(false)}
                  className="text-[#9aa0a6]"
                >
                  Batal
                </Button>
                <Button 
                  type="submit" 
                  disabled={stokMasukLoading}
                  className="bg-[#e5c17b] hover:bg-[#d4b06a] text-[#0D0E10] font-semibold"
                >
                  {stokMasukLoading ? 'Menyimpan...' : 'Simpan Stok'}
                </Button>
              </div>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Modal Edit Item */}
      <Dialog open={showEditItem} onOpenChange={(o) => { setShowEditItem(o); if (!o) setEditingItem(null); }}>
        <DialogContent className="bg-[#1A1D1F] border-[#2A2D31] text-[#e8eaed] sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Edit Item Inventory</DialogTitle>
            <DialogDescription className="text-[#9aa0a6]">
              Perbarui informasi item inventory.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleEditItem} className="space-y-4 pt-4">
            <div className="space-y-2">
              <Label htmlFor="edit_nama">Nama Item</Label>
              <Input
                id="edit_nama"
                name="nama"
                required
                autoComplete="off"
                defaultValue={editingItem?.nama ?? ''}
                key={editingItem?.id + '_nama'}
                className="bg-[#16181A] border-[#2A2D31] focus:ring-[#e5c17b]"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="edit_satuan">Satuan</Label>
                <Input
                  id="edit_satuan"
                  name="satuan"
                  required
                  autoComplete="off"
                  defaultValue={editingItem?.satuan ?? ''}
                  key={editingItem?.id + '_satuan'}
                  className="bg-[#16181A] border-[#2A2D31] focus:ring-[#e5c17b]"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit_stok_minimum">Stok Minimum</Label>
                <Input
                  id="edit_stok_minimum"
                  name="stok_minimum"
                  type="number"
                  autoComplete="off"
                  defaultValue={editingItem?.stok_minimum ?? 0}
                  key={editingItem?.id + '_min'}
                  min={0}
                  className="bg-[#16181A] border-[#2A2D31] focus:ring-[#e5c17b]"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit_warna_id">Warna (Opsional)</Label>
              <select
                id="edit_warna_id"
                value={editWarnaId}
                onChange={(e) => setEditWarnaId(e.target.value)}
                className="w-full h-10 px-3 rounded-md bg-[#16181A] border border-[#2A2D31] text-sm focus:ring-1 focus:ring-[#e5c17b] outline-none"
              >
                <option value="">— Tanpa Warna Spesifik —</option>
                {warnaList.map(w => (
                  <option key={w.id} value={w.id}>{w.nama}</option>
                ))}
              </select>
            </div>
            <DialogFooter className="pt-4">
              <Button type="button" variant="ghost" onClick={() => setShowEditItem(false)} className="text-[#9aa0a6]">
                Batal
              </Button>
              <Button type="submit" disabled={editLoading} className="bg-[#e5c17b] hover:bg-[#d4b06a] text-[#0D0E10] font-semibold min-w-[100px]">
                {editLoading ? 'Menyimpan...' : 'Simpan Perubahan'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
