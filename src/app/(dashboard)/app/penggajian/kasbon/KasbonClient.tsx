'use client';

import { useState } from 'react';
import { 
  addKasbon, 
  updateKasbonStatus, 
  type KasbonItem 
} from '@/lib/actions/penggajian/penggajian.actions';
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle, 
  DialogFooter 
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Plus, CheckCircle, XCircle, Search, User, CreditCard } from 'lucide-react';
import { toast } from 'sonner';

interface Props {
  initialData: KasbonItem[];
  karyawanList: { id: string; nama: string; gaji_pokok: number }[];
}

export default function KasbonClient({ initialData, karyawanList }: Props) {
  const [data, setData] = useState<KasbonItem[]>(initialData);
  const [filterKaryawanId, setFilterKaryawanId] = useState('all');
  const [showAddModal, setShowAddModal] = useState(false);
  const [loading, setLoading] = useState(false);

  // Filter logic
  const filteredData = filterKaryawanId === 'all' 
    ? data 
    : data.filter(d => d.karyawan_id === filterKaryawanId);

  const handleToggleStatus = async (item: KasbonItem) => {
    const newStatus = item.status === 'belum_lunas' ? 'lunas' : 'belum_lunas';
    
    // Optimistic Update
    const oldData = [...data];
    setData(prev => prev.map(d => d.id === item.id ? { ...d, status: newStatus } : d));

    try {
      await updateKasbonStatus(item.id, newStatus);
      toast.success(`Status kasbon berhasil diubah`);
    } catch (err: any) {
      setData(oldData);
      toast.error(err.message || 'Gagal mengubah status');
    }
  };

  const handleAddKasbon = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    const formData = new FormData(e.currentTarget);
    
    const input = {
      karyawan_id: formData.get('karyawan_id') as string,
      jumlah: Number(formData.get('jumlah')),
      tanggal: formData.get('tanggal') as string,
      keterangan: formData.get('keterangan') as string,
    };

    try {
      await addKasbon(input);
      // Sederhananya refresh data (bisa panggil server action lagi atau update manual)
      // Di sini kita update manual untuk responsivitas
      const karyawan = karyawanList.find(k => k.id === input.karyawan_id);
      const newItem: KasbonItem = {
        id: Math.random().toString(), // temporary id
        ...input,
        karyawan_nama: karyawan?.nama || '',
        status: 'belum_lunas',
        created_at: new Date().toISOString()
      };
      setData(prev => [newItem, ...prev]);
      setShowAddModal(false);
      toast.success('Kasbon berhasil ditambahkan');
    } catch (err: any) {
      toast.error(err.message || 'Gagal menambah kasbon');
    } finally {
      setLoading(false);
    }
  };

  const formatIDR = (val: number) => val.toLocaleString('id-ID');

  return (
    <div className="space-y-6">
      {/* Action Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#9aa0a6]" />
            <select
              value={filterKaryawanId}
              onChange={(e) => setFilterKaryawanId(e.target.value)}
              className="h-10 pl-9 pr-4 rounded-lg bg-[#1A1D1F] border border-[#2A2D31] text-sm text-[#e8eaed] focus:ring-1 focus:ring-[#e5c17b] outline-none min-w-[200px]"
            >
              <option value="all">Semua Karyawan</option>
              {karyawanList.map(k => (
                <option key={k.id} value={k.id}>{k.nama}</option>
              ))}
            </select>
          </div>
        </div>

        <Button 
          onClick={() => setShowAddModal(true)}
          className="bg-[#e5c17b] hover:bg-[#d4b06a] text-[#0D0E10] font-bold rounded-lg"
        >
          <Plus className="w-4 h-4 mr-2" />
          Tambah Kasbon
        </Button>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-[#2A2D31] bg-[#1A1D1F] overflow-hidden">
        <Table>
          <TableHeader className="bg-[#16181A]">
            <TableRow className="hover:bg-transparent border-[#2A2D31]">
              <TableHead className="text-[#9aa0a6] font-semibold w-[120px]">Tanggal</TableHead>
              <TableHead className="text-[#9aa0a6] font-semibold">Karyawan</TableHead>
              <TableHead className="text-[#9aa0a6] font-semibold text-right">Jumlah</TableHead>
              <TableHead className="text-[#9aa0a6] font-semibold">Keterangan</TableHead>
              <TableHead className="text-[#9aa0a6] font-semibold text-center">Status</TableHead>
              <TableHead className="text-[#9aa0a6] font-semibold text-right">Aksi</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredData.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="h-48 text-center text-[#9aa0a6]">
                  Tidak ada data kasbon.
                </TableCell>
              </TableRow>
            ) : (
              filteredData.map((item) => (
                <TableRow key={item.id} className="border-[#2A2D31] hover:bg-[#1E2124] transition-colors">
                  <TableCell className="text-sm font-medium">
                    {new Date(item.tanggal).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' })}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-full bg-[#2A2D31] flex items-center justify-center text-[10px] font-bold text-[#e5c17b]">
                        {item.karyawan_nama.substring(0, 2).toUpperCase()}
                      </div>
                      <span className="font-semibold text-[#e8eaed]">{item.karyawan_nama}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-right font-bold text-[#e8eaed]">
                    Rp {formatIDR(item.jumlah)}
                  </TableCell>
                  <TableCell className="text-sm text-[#9aa0a6] max-w-[200px] truncate">
                    {item.keterangan || <span className="text-[#3A3D41] italic">Tidak ada keterangan</span>}
                  </TableCell>
                  <TableCell className="text-center">
                    {item.status === 'lunas' ? (
                      <Badge className="bg-green-500/10 text-green-500 border-green-500/20 hover:bg-green-500/10">
                        Lunas
                      </Badge>
                    ) : (
                      <Badge className="bg-orange-500/10 text-orange-500 border-orange-500/20 hover:bg-orange-500/10">
                        Belum Lunas
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleToggleStatus(item)}
                      className={`h-8 px-3 rounded-lg transition-all ${
                        item.status === 'belum_lunas' 
                        ? 'text-green-500 hover:bg-green-500/10' 
                        : 'text-orange-500 hover:bg-orange-500/10'
                      }`}
                    >
                      {item.status === 'belum_lunas' ? (
                        <>
                          <CheckCircle className="w-3.5 h-3.5 mr-1.5" />
                          Tandai Lunas
                        </>
                      ) : (
                        <>
                          <XCircle className="w-3.5 h-3.5 mr-1.5" />
                          Batalkan
                        </>
                      )}
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Modal Tambah Kasbon */}
      <Dialog open={showAddModal} onOpenChange={setShowAddModal}>
        <DialogContent className="bg-[#1A1D1F] border-[#2A2D31] text-[#e8eaed] sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CreditCard className="w-5 h-5 text-[#e5c17b]" />
              Tambah Kasbon Baru
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleAddKasbon} className="space-y-4 pt-4">
            <div className="space-y-2">
              <Label htmlFor="karyawan_id">Karyawan</Label>
              <select
                id="karyawan_id"
                name="karyawan_id"
                required
                className="w-full h-11 px-3 rounded-lg bg-[#16181A] border border-[#2A2D31] text-sm text-[#e8eaed] focus:ring-1 focus:ring-[#e5c17b] outline-none"
              >
                <option value="">-- Pilih Karyawan --</option>
                {karyawanList.map(k => (
                  <option key={k.id} value={k.id}>{k.nama}</option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="jumlah">Jumlah (Rp)</Label>
                <Input 
                  id="jumlah"
                  name="jumlah"
                  type="number"
                  required
                  min="1000"
                  placeholder="0"
                  className="bg-[#16181A] border-[#2A2D31] focus:ring-[#e5c17b]"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="tanggal">Tanggal</Label>
                <Input 
                  id="tanggal"
                  name="tanggal"
                  type="date"
                  required
                  defaultValue={new Date().toISOString().split('T')[0]}
                  className="bg-[#16181A] border-[#2A2D31] focus:ring-[#e5c17b]"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="keterangan">Keterangan (Opsional)</Label>
              <textarea
                id="keterangan"
                name="keterangan"
                placeholder="Keperluan kasbon..."
                rows={4}
                className="w-full rounded-md border border-[#2A2D31] bg-[#16181A] px-3 py-2 text-sm text-[#e8eaed] focus:outline-none focus:ring-1 focus:ring-[#e5c17b] resize-none"
              />
            </div>

            <DialogFooter className="pt-4">
              <Button 
                type="button" 
                variant="ghost" 
                onClick={() => setShowAddModal(false)}
                className="text-[#9aa0a6] hover:bg-[#2A2D31]"
              >
                Batal
              </Button>
              <Button 
                type="submit" 
                disabled={loading}
                className="bg-[#e5c17b] hover:bg-[#d4b06a] text-[#0D0E10] font-bold min-w-[120px]"
              >
                {loading ? 'Menyimpan...' : 'Simpan Kasbon'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
