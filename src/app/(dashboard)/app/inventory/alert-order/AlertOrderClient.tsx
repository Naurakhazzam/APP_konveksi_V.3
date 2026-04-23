'use client';

import { useState } from 'react';
import { 
  AlertTriangle, 
  CheckCircle2, 
  ArrowRight, 
  TrendingUp,
  Package,
  Calendar,
  Tag
} from 'lucide-react';
import { toast } from 'sonner';
import { 
  InventoryOverviewItem, 
  StokMasukInput,
  addStokMasuk 
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

interface Props {
  items: InventoryOverviewItem[];
  kategoriTrxList: { id: string; nama: string }[];
}

export default function AlertOrderClient({ items, kategoriTrxList }: Props) {
  const [localItems, setLocalItems] = useState<InventoryOverviewItem[]>(items);
  const [selectedItem, setSelectedItem] = useState<InventoryOverviewItem | null>(null);
  const [showStokMasuk, setShowStokMasuk] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleStokMasuk = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!selectedItem) return;
    
    setLoading(true);
    const formData = new FormData(e.currentTarget);
    const qtyMasuk = Number(formData.get('qty'));
    const harga_satuan = Number(formData.get('harga_satuan'));

    const input: StokMasukInput = {
      inventory_item_id: selectedItem.id,
      qty: qtyMasuk,
      harga_satuan,
      tanggal_masuk: formData.get('tanggal_masuk') as string,
      no_faktur: formData.get('no_faktur') as string || undefined,
      kategori_trx_id: formData.get('kategori_trx_id') as string,
      keterangan: formData.get('keterangan') as string || undefined,
    };

    try {
      const result = await addStokMasuk(input);
      
      // Update optimistik & filter keluar jika sudah normal
      setLocalItems(prev => {
        const newStok = result.stok_baru;
        const newStatus = newStok < 0 ? 'minus' : (newStok <= selectedItem.stok_minimum ? 'low' : 'normal');
        
        if (newStatus === 'normal') {
          return prev.filter(i => i.id !== selectedItem.id);
        }
        
        return prev.map(item => 
          item.id === selectedItem.id 
            ? { ...item, stok_aktual: newStok, status: newStatus } 
            : item
        );
      });

      setShowStokMasuk(false);
      setSelectedItem(null);
      toast.success('Stok berhasil ditambahkan');
    } catch (err: any) {
      toast.error(err.message || 'Gagal mencatat stok');
    } finally {
      setLoading(false);
    }
  };

  if (localItems.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-4">
        <div className="h-20 w-20 rounded-full bg-green-500/10 flex items-center justify-center border border-green-500/20">
          <CheckCircle2 size={40} className="text-green-500" />
        </div>
        <div className="text-center">
          <h3 className="text-xl font-bold text-[#e8eaed]">Semua stok aman</h3>
          <p className="text-[#9aa0a6] mt-1">Tidak ada item yang berada di bawah batas minimum.</p>
        </div>
        <Button 
          variant="outline" 
          onClick={() => window.location.href = '/app/inventory/overview'}
          className="border-[#2A2D31] text-[#9aa0a6]"
        >
          Kembali ke Overview
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#e8eaed] flex items-center gap-3">
            <AlertTriangle className="text-red-500" />
            Alert Stok
          </h1>
          <p className="text-sm text-[#9aa0a6] mt-1">Item yang perlu segera di-restock</p>
        </div>
        <Badge className="bg-red-500/10 text-red-500 border-red-500/20 px-3 py-1 text-sm font-bold">
          {localItems.length} Item Perlu Perhatian
        </Badge>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {localItems.map((item) => {
          const progress = Math.max(0, Math.min(100, (item.stok_aktual / item.stok_minimum) * 100));
          const isMinus = item.status === 'minus';

          return (
            <div key={item.id} className="bg-[#1A1D1F] border border-[#2A2D31] rounded-2xl p-6 shadow-sm flex flex-col justify-between hover:border-[#e5c17b]/30 transition-all group">
              <div className="space-y-4">
                <div className="flex justify-between items-start">
                  <div>
                    <h3 className="text-lg font-bold text-[#e8eaed] group-hover:text-[#e5c17b] transition-colors">{item.nama}</h3>
                    <p className="text-xs text-[#9aa0a6] mt-0.5 uppercase tracking-widest">{item.satuan}</p>
                  </div>
                  <Badge className={
                    item.status === 'minus' ? 'bg-red-500/10 text-red-500 border-red-500/20' : 'bg-orange-500/10 text-orange-500 border-orange-500/20'
                  }>
                    {item.status === 'minus' ? 'Minus' : 'Stok Rendah'}
                  </Badge>
                </div>

                <div className="flex items-end gap-3">
                  <div className={`text-4xl font-black ${isMinus ? 'text-red-500' : 'text-orange-500'}`}>
                    {item.stok_aktual.toLocaleString('id-ID')}
                  </div>
                  <div className="mb-1">
                    <div className="text-[10px] text-[#9aa0a6] uppercase font-bold tracking-tighter">Min. Stok</div>
                    <div className="text-sm font-bold text-[#e8eaed]">{item.stok_minimum.toLocaleString('id-ID')}</div>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <div className="flex justify-between text-[10px] font-bold text-[#9aa0a6] uppercase tracking-wider">
                    <span>Ketersediaan</span>
                    <span>{isMinus ? '0%' : `${progress.toFixed(0)}%`}</span>
                  </div>
                  <div className="h-2 w-full bg-[#2A2D31] rounded-full overflow-hidden">
                    <div 
                      className={`h-full rounded-full transition-all duration-500 ${isMinus ? 'w-0 bg-red-500' : 'bg-orange-500'}`} 
                      style={{ width: isMinus ? '0%' : `${progress}%` }}
                    />
                  </div>
                </div>
              </div>

              <Button 
                onClick={() => { setSelectedItem(item); setShowStokMasuk(true); }}
                className="mt-6 bg-[#e5c17b] hover:bg-[#d4b06a] text-[#0D0E10] font-bold w-full gap-2 py-6 rounded-xl"
              >
                Input Stok Masuk
                <ArrowRight size={18} />
              </Button>
            </div>
          );
        })}
      </div>

      {/* Modal Stok Masuk (Reused Logic) */}
      <Dialog open={showStokMasuk} onOpenChange={(o) => { setShowStokMasuk(o); if (!o) setSelectedItem(null); }}>
        <DialogContent className="bg-[#1A1D1F] border-[#2A2D31] text-[#e8eaed] sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>Stok Masuk — {selectedItem?.nama}</DialogTitle>
            <DialogDescription className="text-[#9aa0a6]">
              Catat penambahan stok untuk mengatasi alert.
            </DialogDescription>
          </DialogHeader>
          
          {selectedItem && (
            <div className="bg-[#2A2D31]/30 rounded-xl p-4 flex justify-between items-center border border-[#2A2D31]">
              <div className="text-sm text-[#9aa0a6]">Stok Saat Ini</div>
              <div className={`font-bold ${selectedItem.status === 'minus' ? 'text-red-500' : 'text-orange-500'}`}>
                {selectedItem.stok_aktual.toLocaleString('id-ID')} {selectedItem.satuan}
              </div>
            </div>
          )}

          <form onSubmit={handleStokMasuk} className="space-y-4 pt-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="qty">Qty Masuk</Label>
                <Input id="qty" name="qty" type="number" step="0.001" required autoComplete="off" className="bg-[#16181A] border-[#2A2D31]" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="harga_satuan">Harga Satuan (Rp)</Label>
                <Input id="harga_satuan" name="harga_satuan" type="number" required autoComplete="off" className="bg-[#16181A] border-[#2A2D31]" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="tanggal_masuk">Tanggal Masuk</Label>
                <Input id="tanggal_masuk" name="tanggal_masuk" type="date" defaultValue={new Date().toISOString().split('T')[0]} required className="bg-[#16181A] border-[#2A2D31]" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="kategori_trx_id">Kategori Biaya</Label>
                <select id="kategori_trx_id" name="kategori_trx_id" required className="w-full h-10 px-3 rounded-md bg-[#16181A] border border-[#2A2D31] text-sm focus:ring-1 focus:ring-[#e5c17b] outline-none">
                  <option value="">Pilih Kategori</option>
                  {kategoriTrxList.map(k => <option key={k.id} value={k.id}>{k.nama}</option>)}
                </select>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="no_faktur">Nomor Faktur (Opsional)</Label>
              <Input id="no_faktur" name="no_faktur" autoComplete="off" className="bg-[#16181A] border-[#2A2D31]" placeholder="Contoh: INV/2024/001" />
            </div>

            <div className="space-y-2">
              <Label htmlFor="keterangan">Keterangan (Opsional)</Label>
              <textarea id="keterangan" name="keterangan" className="w-full min-h-[80px] p-3 rounded-md bg-[#16181A] border border-[#2A2D31] text-sm focus:ring-1 focus:ring-[#e5c17b] outline-none" placeholder="Catatan tambahan..." />
            </div>

            <DialogFooter className="pt-4 flex items-center justify-between">
              <div className="text-xs text-[#9aa0a6]">Total nilai akan tercatat di jurnal buku besar.</div>
              <div className="flex gap-2">
                <Button type="button" variant="ghost" onClick={() => setShowStokMasuk(false)} className="text-[#9aa0a6]">Batal</Button>
                <Button type="submit" disabled={loading} className="bg-[#e5c17b] hover:bg-[#d4b06a] text-[#0D0E10] font-bold">
                  {loading ? 'Menyimpan...' : 'Simpan Stok'}
                </Button>
              </div>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
