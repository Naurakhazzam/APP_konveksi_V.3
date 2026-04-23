'use client';

import React, { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Plus, Pencil, Trash2 } from 'lucide-react';

import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { EmptyState } from '@/components/ui/EmptyState';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';

import { KomponenHppSchema, type KomponenHppInput } from '@/lib/validations/master.schemas';
import { createKomponenHpp, updateKomponenHpp, deleteKomponenHpp } from '@/lib/actions/master/komponen-hpp.actions';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type KomponenData = {
  id: string;
  nama: string;
  kategori: string;
  satuan_id: string;
  track_inventory: boolean;
  inventory_item_id: string | null;
  deskripsi: string | null;
  aktif: boolean;
  satuan: { nama: string } | null;
};

type KomponenHppClientProps = {
  isOwner: boolean;
  listKomponen: KomponenData[];
  listSatuan: { id: string; nama: string }[];
  listInventoryItem: { id: string; nama: string; satuan: string }[];
};

// ─────────────────────────────────────────────────────────────────────────────
// Sub-component: Form Dialog
// ─────────────────────────────────────────────────────────────────────────────

function FormModal({
  open,
  onClose,
  mode,
  initialData,
  id,
  listSatuan,
  listInventoryItem
}: {
  open: boolean;
  onClose: () => void;
  mode: 'add' | 'edit';
  initialData?: KomponenHppInput;
  id?: string;
  listSatuan: KomponenHppClientProps['listSatuan'];
  listInventoryItem: KomponenHppClientProps['listInventoryItem'];
}) {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);

  const { register, handleSubmit, reset, watch, setValue, formState: { errors, isSubmitting } } = useForm<KomponenHppInput>({
    resolver: zodResolver(KomponenHppSchema),
    defaultValues: initialData || {
      nama: '',
      kategori: 'bahan_baku',
      satuan_id: '',
      track_inventory: false,
      inventory_item_id: null,
      deskripsi: '',
      aktif: true,
    },
  });

  const isTrack = watch('track_inventory');

  const onSubmit = async (values: KomponenHppInput) => {
    setServerError(null);
    try {
      // Jika tidak di-track, pastikan inventory_item null
      const payload = {
        ...values,
        deskripsi: values.deskripsi || null,
        inventory_item_id: values.track_inventory ? values.inventory_item_id : null,
      };

      if (mode === 'add') await createKomponenHpp(payload);
      else if (id) await updateKomponenHpp(id, payload);

      reset();
      router.refresh();
      onClose();
    } catch (err: any) {
      setServerError(err.message);
    }
  };

  const selectCls = "flex h-10 w-full rounded-md border border-[#2A2D31] bg-[#1E2124] px-3 py-2 text-sm text-[#e8eaed] focus:outline-none focus:ring-1 focus:ring-[#e5c17b] disabled:opacity-50 mt-1";

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-[480px] bg-[#16181A] border-[#2A2D31] text-[#e8eaed]">
        <DialogHeader>
          <DialogTitle>{mode === 'add' ? 'Tambah Komponen HPP' : 'Edit Komponen'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 mt-2">
          
          <div className="space-y-1">
            <Label htmlFor="nama" className="text-sm">Nama Komponen <span className="text-red-500">*</span></Label>
            <Input id="nama" disabled={isSubmitting} className="bg-[#1E2124] border-[#2A2D31]" {...register('nama')} />
            {errors.nama && <p className="text-xs text-red-500">{errors.nama.message}</p>}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
               <Label className="text-sm">Kategori Biaya <span className="text-red-500">*</span></Label>
               <select disabled={isSubmitting} className={selectCls} {...register('kategori')}>
                 <option value="bahan_baku">Bahan Baku (Raw)</option>
                 <option value="biaya_produksi">Biaya Produksi / Upah</option>
                 <option value="overhead">Overhead Pabrik</option>
               </select>
               {errors.kategori && <p className="text-xs text-red-500">{errors.kategori.message}</p>}
            </div>
            <div>
               <Label className="text-sm">Satuan <span className="text-red-500">*</span></Label>
               <select disabled={isSubmitting} className={selectCls} {...register('satuan_id')}>
                 <option value="">-- Pilih --</option>
                 {listSatuan.map(s => <option key={s.id} value={s.id}>{s.nama}</option>)}
               </select>
               {errors.satuan_id && <p className="text-xs text-red-500">{errors.satuan_id.message}</p>}
            </div>
          </div>

          <div className="flex items-center justify-between py-2 border-b border-[#2A2D31]">
            <Label className="text-sm">Lacak di Gudang (Inventory)?</Label>
            <input 
              type="checkbox" 
              disabled={isSubmitting}
              className="h-4 w-4 rounded border-[#2A2D31] bg-[#1E2124] text-[#e5c17b]" 
              {...register('track_inventory')} 
            />
          </div>

          {isTrack && (
             <div className="space-y-1 rounded-lg border border-[#e5c17b]/30 bg-[#e5c17b]/5 p-3">
               <Label className="text-sm text-[#e5c17b]">Link Data Gudang Fisik</Label>
               <select disabled={isSubmitting} className={selectCls} {...register('inventory_item_id')}>
                 <option value="">-- Pilih Item dari Gudang --</option>
                 {listInventoryItem.map(i => <option key={i.id} value={i.id}>{i.nama} ({i.satuan})</option>)}
               </select>
               <p className="text-xs text-[#9aa0a6] mt-1">Mengaitkan komponen ini akan otomatis memotong stok gudang aktual saat produksi.</p>
               {errors.inventory_item_id && <p className="text-xs text-red-500">{errors.inventory_item_id.message}</p>}
             </div>
          )}

          <div className="space-y-1">
            <Label htmlFor="deskripsi" className="text-sm">Deskripsi (Opsional)</Label>
            <Input id="deskripsi" placeholder="Catatan tambahan..." disabled={isSubmitting} className="bg-[#1E2124] border-[#2A2D31]" {...register('deskripsi')} />
          </div>

          <div className="flex items-center justify-between pt-2">
            <Label className="text-sm">Status Aktif</Label>
            <input 
              type="checkbox" 
              disabled={isSubmitting}
              className="h-4 w-4 rounded border-[#2A2D31] bg-[#1E2124] text-green-500" 
              {...register('aktif')} 
            />
          </div>

          {serverError && <div className="rounded border border-red-500/20 bg-red-500/10 p-3 text-xs text-red-500">{serverError}</div>}
          
          <div className="pt-4 flex justify-end gap-2">
            <Button type="button" variant="outline" disabled={isSubmitting} onClick={onClose} className="border-[#2A2D31] bg-transparent text-[#e8eaed]">Batal</Button>
            <Button type="submit" disabled={isSubmitting} className="bg-[color:var(--status-green)] text-white">Simpan</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Komponen Utama Client
// ─────────────────────────────────────────────────────────────────────────────

export function KomponenHppClient({ isOwner, listKomponen, listSatuan, listInventoryItem }: KomponenHppClientProps) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState('semua');
  
  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<'add'|'edit'>('add');
  const [selectedItem, setSelectedItem] = useState<KomponenData | null>(null);

  const filteredData = useMemo(() => {
    if (activeTab === 'semua') return listKomponen;
    return listKomponen.filter(item => item.kategori === activeTab);
  }, [listKomponen, activeTab]);

  const handleOpenAdd = () => {
    setModalMode('add');
    setSelectedItem(null);
    setModalOpen(true);
  };

  const handleOpenEdit = (item: KomponenData) => {
    setModalMode('edit');
    setSelectedItem(item);
    setModalOpen(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Hapus komponen master ini permanen?')) return;
    try {
      await deleteKomponenHpp(id);
      router.refresh();
    } catch (err: any) {
      alert(err.message);
    }
  };

  const renderBadgeKategori = (kat: string) => {
    if (kat === 'bahan_baku') return <span className="inline-flex rounded-md bg-green-500/10 px-2 py-1 text-xs font-semibold text-green-400">Bahan Baku</span>;
    if (kat === 'biaya_produksi') return <span className="inline-flex rounded-md bg-blue-500/10 px-2 py-1 text-xs font-semibold text-blue-400">Biaya Produksi</span>;
    if (kat === 'overhead') return <span className="inline-flex rounded-md bg-yellow-500/10 px-2 py-1 text-xs font-semibold text-yellow-400">Overhead</span>;
    return <span className="text-[#9aa0a6] text-xs">{kat}</span>;
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center justify-between">
        <Tabs defaultValue="semua" onValueChange={setActiveTab} className="w-full sm:w-auto">
          <TabsList className="bg-[#1A1D1F] border border-[#2A2D31]">
            <TabsTrigger value="semua" className="data-[state=active]:bg-[#2A2D31] data-[state=active]:text-[#e5c17b]">Semua</TabsTrigger>
            <TabsTrigger value="bahan_baku" className="data-[state=active]:bg-[#2A2D31] data-[state=active]:text-[#e5c17b]">Bahan Baku</TabsTrigger>
            <TabsTrigger value="biaya_produksi" className="data-[state=active]:bg-[#2A2D31] data-[state=active]:text-[#e5c17b]">Biaya Produksi</TabsTrigger>
            <TabsTrigger value="overhead" className="data-[state=active]:bg-[#2A2D31] data-[state=active]:text-[#e5c17b]">Overhead</TabsTrigger>
          </TabsList>
        </Tabs>
        
        {isOwner && (
          <Button onClick={handleOpenAdd} className="bg-[color:var(--accent-gold,#e5c17b)] text-[#2b2318] hover:bg-[#e5c17b]/90 whitespace-nowrap">
            <Plus className="mr-2 h-4 w-4" /> Komponen Baru
          </Button>
        )}
      </div>

      <div className="rounded-xl border border-[#2A2D31] bg-[#1A1D1F] overflow-hidden shadow-lg">
        {filteredData.length === 0 ? (
          <div className="h-48 flex items-center justify-center">
            <EmptyState icon={<Plus className="h-8 w-8"/>} title="Kosong" description="Belum ada data komponen di kategori ini."/>
          </div>
        ) : (
          <Table>
            <TableHeader className="bg-[#2A2D31]/30">
              <TableRow className="border-[#2A2D31] hover:bg-transparent">
                <TableHead className="text-[#9aa0a6] w-[25%]">Nama Komponen</TableHead>
                <TableHead className="text-[#9aa0a6]">Kategori</TableHead>
                <TableHead className="text-[#9aa0a6]">Satuan</TableHead>
                <TableHead className="text-[#9aa0a6]">Track Stok</TableHead>
                <TableHead className="text-[#9aa0a6]">Deskripsi</TableHead>
                {isOwner && <TableHead className="text-[#9aa0a6] text-right">Aksi</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredData.map((item) => (
                <TableRow key={item.id} className="border-[#2A2D31] transition-colors hover:bg-[#2A2D31]/20">
                  <TableCell>
                    <span className={`font-semibold ${item.aktif ? 'text-[#e8eaed]' : 'text-[#777e85] line-through decoration-[#777e85]'}`}>
                      {item.nama}
                    </span>
                  </TableCell>
                  <TableCell>{renderBadgeKategori(item.kategori)}</TableCell>
                  <TableCell>
                    <span className="inline-flex rounded-md bg-[#2A2D31] px-2 py-0.5 text-xs font-mono text-[#e8eaed]">
                      {item.satuan?.nama ?? '—'}
                    </span>
                  </TableCell>
                  <TableCell>
                    {item.track_inventory ? (
                      <span className="inline-flex rounded-full bg-green-500/10 px-2 py-0.5 text-[10px] font-bold text-green-400">YA</span>
                    ) : (
                      <span className="inline-flex rounded-full bg-[#3a3d41] px-2 py-0.5 text-[10px] font-bold text-[#9aa0a6]">TDK</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <span className="text-xs text-[#9aa0a6] max-w-[200px] truncate block" title={item.deskripsi || ''}>
                      {item.deskripsi || '—'}
                    </span>
                  </TableCell>
                  {isOwner && (
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button 
                          variant="ghost" size="icon" 
                          onClick={() => handleOpenEdit(item)} 
                          className="h-8 w-8 text-blue-500 hover:text-blue-600 hover:bg-blue-500/10"
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button 
                          variant="ghost" size="icon" 
                          onClick={() => handleDelete(item.id)} 
                          className="h-8 w-8 text-red-500 hover:bg-red-500/10"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      {/* Render Dialog Form */}
      {modalOpen && (
        <FormModal
          open={modalOpen}
          onClose={() => setModalOpen(false)}
          mode={modalMode}
          id={selectedItem?.id}
          initialData={selectedItem ? {
            nama: selectedItem.nama,
            kategori: selectedItem.kategori as any,
            satuan_id: selectedItem.satuan_id,
            track_inventory: selectedItem.track_inventory,
            inventory_item_id: selectedItem.inventory_item_id,
            deskripsi: selectedItem.deskripsi,
            aktif: selectedItem.aktif
          } : undefined}
          listSatuan={listSatuan}
          listInventoryItem={listInventoryItem}
        />
      )}
    </div>
  );
}
