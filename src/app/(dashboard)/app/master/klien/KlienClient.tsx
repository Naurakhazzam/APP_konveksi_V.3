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

import { KlienSchema, type KlienInput } from '@/lib/validations/master.schemas';
import { createKlien, updateKlien, deleteKlien } from '@/lib/actions/master/klien.actions';

export function KlienFormModal({
  mode,
  initialData,
  klienId,
}: {
  mode: 'add' | 'edit';
  initialData?: KlienInput;
  klienId?: string;
}) {
  const [open, setOpen] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const router = useRouter();

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<KlienInput>({
    resolver: zodResolver(KlienSchema),
    defaultValues: initialData || {
      nama: '',
      alamat: '',
      kontak: '',
    },
  });

  const onSubmit = async (values: KlienInput) => {
    setServerError(null);
    try {
      if (mode === 'add') {
        await createKlien(values);
      } else if (mode === 'edit' && klienId) {
        await updateKlien(klienId, values);
      }
      setOpen(false);
      reset();
      router.refresh(); // Segarkan data tabel Server Component
    } catch (err: any) {
      setServerError(err.message || 'Terjadi kesalahan saat memproses data klien');
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          mode === 'add' ? (
            <Button className="bg-[color:var(--accent-gold)] text-[#2b2318] hover:bg-[color:var(--accent-gold)]/90">
              <Plus className="mr-2 h-4 w-4" /> Tambah Klien
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
            {mode === 'add' ? 'Tambah Master Klien' : 'Edit Klien'}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 mt-4">
          <div className="space-y-2">
            <Label htmlFor="nama" className="text-sm font-medium">Nama Klien</Label>
            <Input
              id="nama"
              placeholder="Contoh: PT. Maju Bersama"
              disabled={isSubmitting}
              className="bg-[#1E2124] border-[#2A2D31] focus-visible:ring-[#e5c17b]"
              {...register('nama')}
            />
            {errors.nama && <p className="text-xs text-red-500">{errors.nama.message}</p>}
          </div>

          <div className="space-y-2">
            <Label htmlFor="kontak" className="text-sm font-medium">No. Kontak (Opsional)</Label>
            <Input
              id="kontak"
              placeholder="Contoh: 081234567890"
              disabled={isSubmitting}
              className="bg-[#1E2124] border-[#2A2D31] focus-visible:ring-[#e5c17b]"
              {...register('kontak')}
            />
            {errors.kontak && <p className="text-xs text-red-500">{errors.kontak.message}</p>}
          </div>

          <div className="space-y-2">
            <Label htmlFor="alamat" className="text-sm font-medium">Alamat Lengkap (Opsional)</Label>
            <Input
              id="alamat"
              placeholder="Contoh: Jl. Sudirman No 10"
              disabled={isSubmitting}
              className="bg-[#1E2124] border-[#2A2D31] focus-visible:ring-[#e5c17b]"
              {...register('alamat')}
            />
            {errors.alamat && <p className="text-xs text-red-500">{errors.alamat.message}</p>}
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
              {isSubmitting ? 'Menyimpan...' : 'Simpan Klien'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function KlienDeleteAction({ id }: { id: string }) {
  const router = useRouter();
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDelete = async () => {
    if (!confirm('Peringatan: Menghapus klien ini akan bersifat permanen. Lanjutkan?')) return;
    
    setIsDeleting(true);
    try {
      await deleteKlien(id);
      router.refresh();
    } catch (err: any) {
      alert(err.message || 'Gagal menghapus data klien.');
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
      title="Hapus Klien Secara Permanen"
    >
      <Trash2 className="h-4 w-4" />
    </Button>
  );
}
