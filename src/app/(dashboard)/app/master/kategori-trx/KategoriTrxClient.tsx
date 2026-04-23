'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Plus, Pencil, Trash2 } from 'lucide-react';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

import { KategoriTrxSchema, type KategoriTrxInput } from '@/lib/validations/master.schemas';
import { createKategoriTrx, updateKategoriTrx, deleteKategoriTrx } from '@/lib/actions/master/kategori-trx.actions';

export function KategoriTrxFormModal({
  mode,
  initialData,
  kategoriId,
}: {
  mode: 'add' | 'edit';
  initialData?: KategoriTrxInput;
  kategoriId?: string;
}) {
  const [open, setOpen] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const router = useRouter();

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<KategoriTrxInput>({
    resolver: zodResolver(KategoriTrxSchema),
    defaultValues: initialData || {
      nama: '',
      jenis: 'direct_bahan', 
      aktif: true,
    },
  });

  const onSubmit = async (values: KategoriTrxInput) => {
    setServerError(null);
    try {
      if (mode === 'add') {
        await createKategoriTrx(values);
      } else if (mode === 'edit' && kategoriId) {
        await updateKategoriTrx(kategoriId, values);
      }
      setOpen(false);
      reset();
      router.refresh();
    } catch (err: any) {
      setServerError(err.message || 'Terjadi kesalahan saat menyimpan kategori.');
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          mode === 'add' ? (
            <Button className="bg-[color:var(--accent-gold)] text-[#2b2318] hover:bg-[color:var(--accent-gold)]/90">
              <Plus className="mr-2 h-4 w-4" /> Kategori Baru
            </Button>
          ) : (
            <Button variant="ghost" size="icon" className="h-8 w-8 text-blue-500 hover:text-blue-600 hover:bg-blue-500/10">
              <Pencil className="h-4 w-4" />
            </Button>
          )
        }
      />
      <DialogContent className="sm:max-w-[425px] bg-[#16181A] border-[#2A2D31] text-[#e8eaed]">
        <DialogHeader>
          <DialogTitle className="text-[#e8eaed]">
            {mode === 'add' ? 'Tambah Master Kategori Transaksi' : 'Edit Kategori Transaksi'}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 mt-4">
          <div className="space-y-2">
            <Label htmlFor="nama" className="text-sm font-medium">Nama Kategori</Label>
            <Input
              id="nama"
              placeholder="Contoh: Pembelian Benang"
              disabled={isSubmitting}
              className="bg-[#1E2124] border-[#2A2D31] focus-visible:ring-[#e5c17b]"
              {...register('nama')}
            />
            {errors.nama && <p className="text-xs text-red-500">{errors.nama.message}</p>}
          </div>

          <div className="space-y-2">
            <Label htmlFor="jenis" className="text-sm font-medium">Jenis Alokasi (BR-11)</Label>
            <select
              id="jenis"
              disabled={mode === 'edit' || isSubmitting} // Tidak boleh menyeberang jenis setelah terbuat
              className="flex h-10 w-full rounded-md border border-[#2A2D31] bg-[#1E2124] px-3 py-2 text-sm ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#e5c17b]"
              {...register('jenis')}
            >
              <option value="direct_bahan">Biaya Langsung (Bahan Baku)</option>
              <option value="overhead">Overhead / Operasional Pabrik</option>
              <option value="masuk">Pemasukan / Pendapatan</option>
              {/* direct_upah sengaja tidak di-list manual karena strictly generate mesin */}
            </select>
            {mode === 'edit' && (
               <p className="text-xs text-[#5f6368] mt-1">Jenis kategori tidak dapat diubah setelah dibuat.</p>
            )}
            {errors.jenis && <p className="text-xs text-red-500">{errors.jenis.message}</p>}
          </div>

          <div className="pt-2 flex items-center justify-between">
            <Label htmlFor="aktif" className="text-sm font-medium">Kategori Aktif (Dapat dipilih)</Label>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="aktif"
                className="w-4 h-4 rounded border-[#2A2D31] bg-[#1E2124] text-[#e5c17b] focus:ring-[#e5c17b]"
                {...register('aktif')}
                disabled={isSubmitting}
              />
            </div>
          </div>

          {serverError && (
            <div className="p-3 rounded bg-red-500/10 border border-red-500/20 text-xs text-red-500">
              {serverError}
            </div>
          )}

          <div className="pt-4 flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={isSubmitting}
              onClick={() => {
                setOpen(false);
                reset(initialData); 
              }}
              className="border-[#2A2D31] bg-transparent text-[#e8eaed] hover:bg-[#2A2D31]"
            >
              Batal
            </Button>
            <Button
              type="submit"
              disabled={isSubmitting}
              className="bg-[color:var(--status-green)] hover:bg-[color:var(--status-green)]/90 text-white"
            >
              {isSubmitting ? 'Menyimpan...' : 'Simpan'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function KategoriTrxDeleteAction({ id }: { id: string }) {
  const router = useRouter();
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDelete = async () => {
    if (!confirm('Hapus kategori transaksi ini? Pastikan kategori ini belum pernah dipakai pada jurnal manapun.')) return;
    
    setIsDeleting(true);
    try {
      await deleteKategoriTrx(id);
      router.refresh();
    } catch (err: any) {
      alert(err.message || 'Penghapusan Firebase ditolak karena integritas referensi.');
      setIsDeleting(false);
    }
  };

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={handleDelete}
      disabled={isDeleting}
      className="h-8 w-8 text-red-500 hover:text-red-600 hover:bg-red-500/10"
      title="Hapus Master Kategori Permanen"
    >
      <Trash2 className="h-4 w-4" />
    </Button>
  );
}
