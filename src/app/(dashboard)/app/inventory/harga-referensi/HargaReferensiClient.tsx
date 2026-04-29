'use client';

import { useState, useMemo, useRef } from 'react';
import { Search, DollarSign, CheckCircle2, AlertCircle, Pencil, Check, X } from 'lucide-react';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { HargaReferensiItem, updateHargaReferensi } from '@/lib/actions/inventory/item.actions';

interface Props {
  items: HargaReferensiItem[];
}

export default function HargaReferensiClient({ items }: Props) {
  const [localItems, setLocalItems]   = useState<HargaReferensiItem[]>(items);
  const [searchQuery, setSearchQuery] = useState('');
  const [editingId,   setEditingId]   = useState<string | null>(null);
  const [editValue,   setEditValue]   = useState<string>('');
  const [savingId,    setSavingId]    = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const filteredItems = useMemo(() => {
    const q = searchQuery.toLowerCase();
    return localItems.filter(i => i.nama.toLowerCase().includes(q));
  }, [localItems, searchQuery]);

  const sudahDiisi  = localItems.filter(i => i.harga_referensi > 0).length;
  const belumDiisi  = localItems.length - sudahDiisi;
  const pctDiisi    = localItems.length > 0 ? Math.round((sudahDiisi / localItems.length) * 100) : 0;

  const startEdit = (item: HargaReferensiItem) => {
    setEditingId(item.id);
    setEditValue(item.harga_referensi > 0 ? String(item.harga_referensi) : '');
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditValue('');
  };

  const saveEdit = async (id: string) => {
    const harga = parseFloat(editValue.replace(/[^0-9.]/g, ''));
    if (isNaN(harga) || harga < 0) {
      toast.error('Harga tidak valid');
      return;
    }
    setSavingId(id);
    try {
      await updateHargaReferensi(id, harga);
      setLocalItems(prev =>
        prev.map(i => i.id === id ? { ...i, harga_referensi: harga } : i)
      );
      toast.success('Harga referensi diperbarui');
      setEditingId(null);
      setEditValue('');
    } catch (err: any) {
      toast.error(err.message || 'Gagal menyimpan');
    } finally {
      setSavingId(null);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent, id: string) => {
    if (e.key === 'Enter')  saveEdit(id);
    if (e.key === 'Escape') cancelEdit();
  };

  return (
    <div className="space-y-6">

      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[#e8eaed]">Harga Referensi Item</h1>
          <p className="text-sm text-[#9aa0a6] mt-1">
            Harga fallback untuk item yang stoknya nol — dipakai otomatis di laporan HPP produksi
          </p>
        </div>
        <div className="relative group">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#9aa0a6] group-focus-within:text-[#e5c17b] transition-colors" />
          <Input
            placeholder="Cari nama item..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 w-64 bg-[#1A1D1F] border-[#2A2D31] focus:border-[#e5c17b] focus:ring-[#e5c17b]/20"
          />
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-[#1A1D1F] border border-[#2A2D31] rounded-2xl p-5 shadow-sm">
          <div className="flex items-center gap-4">
            <div className="h-12 w-12 rounded-xl bg-[#2A2D31] flex items-center justify-center text-[#e5c17b]">
              <DollarSign size={24} />
            </div>
            <div>
              <p className="text-xs font-medium text-[#9aa0a6] uppercase tracking-wider">Total Item</p>
              <p className="text-2xl font-bold text-[#e8eaed]">{localItems.length}</p>
            </div>
          </div>
        </div>

        <div className="bg-[#1A1D1F] border border-green-500/20 rounded-2xl p-5 shadow-sm">
          <div className="flex items-center gap-4">
            <div className="h-12 w-12 rounded-xl bg-green-500/10 flex items-center justify-center text-green-500">
              <CheckCircle2 size={24} />
            </div>
            <div>
              <p className="text-xs font-medium text-[#9aa0a6] uppercase tracking-wider">Sudah Diisi</p>
              <p className="text-2xl font-bold text-green-500">{sudahDiisi}</p>
            </div>
          </div>
        </div>

        <div className={`bg-[#1A1D1F] border rounded-2xl p-5 shadow-sm transition-colors ${belumDiisi > 0 ? 'border-orange-500/30' : 'border-[#2A2D31]'}`}>
          <div className="flex items-center gap-4">
            <div className={`h-12 w-12 rounded-xl flex items-center justify-center ${belumDiisi > 0 ? 'bg-orange-500/10 text-orange-500' : 'bg-[#2A2D31] text-[#9aa0a6]'}`}>
              <AlertCircle size={24} />
            </div>
            <div>
              <p className="text-xs font-medium text-[#9aa0a6] uppercase tracking-wider">Belum Diisi</p>
              <p className={`text-2xl font-bold ${belumDiisi > 0 ? 'text-orange-500' : 'text-[#e8eaed]'}`}>
                {belumDiisi}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Progress bar */}
      <div className="bg-[#1A1D1F] border border-[#2A2D31] rounded-2xl p-4">
        <div className="flex justify-between items-center mb-2">
          <span className="text-sm text-[#9aa0a6]">Progress pengisian harga</span>
          <span className="text-sm font-bold text-[#e5c17b]">{pctDiisi}%</span>
        </div>
        <div className="w-full h-2 bg-[#2A2D31] rounded-full overflow-hidden">
          <div
            className="h-full bg-[#e5c17b] rounded-full transition-all duration-500"
            style={{ width: `${pctDiisi}%` }}
          />
        </div>
        {belumDiisi > 0 && (
          <p className="text-xs text-[#9aa0a6] mt-2">
            Item dengan harga 0 tidak akan tercatat di laporan HPP jika stok habis. Klik ✏️ untuk mengisi.
          </p>
        )}
      </div>

      {/* Table */}
      <div className="bg-[#1A1D1F] border border-[#2A2D31] rounded-2xl overflow-hidden shadow-sm">
        <Table>
          <TableHeader className="bg-[#1E2124]">
            <TableRow className="hover:bg-transparent border-[#2A2D31]">
              <TableHead className="text-[#9aa0a6] font-semibold">Nama Item</TableHead>
              <TableHead className="text-[#9aa0a6] font-semibold">Satuan</TableHead>
              <TableHead className="text-[#9aa0a6] font-semibold text-right">Stok Aktual</TableHead>
              <TableHead className="text-[#9aa0a6] font-semibold text-right">Harga Referensi</TableHead>
              <TableHead className="text-[#9aa0a6] font-semibold text-center">Status</TableHead>
              <TableHead className="text-[#9aa0a6] font-semibold text-center w-20">Aksi</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredItems.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="h-32 text-center text-[#9aa0a6]">
                  Tidak ada item ditemukan.
                </TableCell>
              </TableRow>
            ) : (
              filteredItems.map((item) => {
                const isEditing = editingId === item.id;
                const isSaving  = savingId  === item.id;
                const hasPriceSet = item.harga_referensi > 0;

                return (
                  <TableRow
                    key={item.id}
                    className="border-[#2A2D31] hover:bg-[#1E2124]/50 transition-colors"
                  >
                    {/* Nama */}
                    <TableCell className="font-semibold text-[#e8eaed]">{item.nama}</TableCell>

                    {/* Satuan */}
                    <TableCell className="text-[#9aa0a6] text-sm">{item.satuan}</TableCell>

                    {/* Stok */}
                    <TableCell className="text-right">
                      <span className={`font-mono font-medium ${
                        item.stok_aktual < 0  ? 'text-red-500' :
                        item.stok_aktual === 0 ? 'text-[#9aa0a6]' : 'text-[#e8eaed]'
                      }`}>
                        {item.stok_aktual.toLocaleString('id-ID')}
                      </span>
                    </TableCell>

                    {/* Harga — inline edit */}
                    <TableCell className="text-right">
                      {isEditing ? (
                        <div className="flex items-center justify-end gap-2">
                          <span className="text-[#9aa0a6] text-sm">Rp</span>
                          <Input
                            ref={inputRef}
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onKeyDown={(e) => handleKeyDown(e, item.id)}
                            type="number"
                            min={0}
                            className="w-36 h-8 text-right bg-[#16181A] border-[#e5c17b] focus:ring-[#e5c17b]/30 font-mono"
                            placeholder="0"
                          />
                        </div>
                      ) : (
                        <span className={`font-mono font-medium ${
                          hasPriceSet ? 'text-[#e8eaed]' : 'text-[#5f6368]'
                        }`}>
                          {hasPriceSet
                            ? `Rp ${item.harga_referensi.toLocaleString('id-ID')}`
                            : '—'}
                        </span>
                      )}
                    </TableCell>

                    {/* Status badge */}
                    <TableCell className="text-center">
                      {hasPriceSet ? (
                        <Badge className="bg-green-500/10 text-green-500 border-green-500/20 text-xs">
                          Terisi
                        </Badge>
                      ) : (
                        <Badge className="bg-orange-500/10 text-orange-500 border-orange-500/20 text-xs">
                          Belum diisi
                        </Badge>
                      )}
                    </TableCell>

                    {/* Aksi */}
                    <TableCell className="text-center">
                      {isEditing ? (
                        <div className="flex items-center justify-center gap-1">
                          <Button
                            size="sm"
                            onClick={() => saveEdit(item.id)}
                            disabled={isSaving}
                            className="h-7 w-7 p-0 bg-green-600 hover:bg-green-500 text-white rounded-lg"
                          >
                            <Check size={13} />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={cancelEdit}
                            disabled={isSaving}
                            className="h-7 w-7 p-0 text-[#9aa0a6] hover:text-red-400 hover:bg-red-400/10 rounded-lg"
                          >
                            <X size={13} />
                          </Button>
                        </div>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => startEdit(item)}
                          className="h-8 w-8 p-0 text-[#9aa0a6] hover:text-[#e5c17b] hover:bg-[#e5c17b]/10 rounded-lg"
                        >
                          <Pencil size={14} />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {/* Footer note */}
      <div className="bg-[#1A1D1F] border border-[#2A2D31] rounded-xl p-4 flex gap-3 items-start">
        <div className="text-[#e5c17b] mt-0.5 shrink-0">
          <DollarSign size={16} />
        </div>
        <div>
          <p className="text-sm font-medium text-[#e8eaed]">Cara kerja harga referensi</p>
          <p className="text-xs text-[#9aa0a6] mt-1 leading-relaxed">
            Saat produksi berjalan, jika stok habis (minus), sistem tetap mencatat pemakaian dan
            menghitung biaya berdasarkan harga referensi ini. Laporan HPP per PO akan otomatis
            menggunakan harga terbaru — update harga kapan saja, data lama ikut terhitung ulang.
          </p>
        </div>
      </div>
    </div>
  );
}
