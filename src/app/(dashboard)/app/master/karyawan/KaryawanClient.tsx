'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm, type SubmitHandler } from 'react-hook-form';
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

import { KaryawanSchema, type KaryawanInput, TAHAP_PRODUKSI_OPTIONS } from '@/lib/validations/master.schemas';
import { createKaryawan, updateKaryawan, deleteKaryawan } from '@/lib/actions/master/karyawan.actions';

export function KaryawanFormModal({
  mode,
  initialData,
  karyawanId,
}: {
  mode: 'add' | 'edit';
  initialData?: KaryawanInput;
  karyawanId?: string;
}) {
  const [open, setOpen] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const router = useRouter();

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<KaryawanInput>({
    resolver: zodResolver(KaryawanSchema) as any,
    defaultValues: initialData || {
      nama: '',
      jabatan: '',
      gaji_pokok: 0,
      tahap_produksi: [],
      aktif: true,
    },
  });

  const onSubmit: SubmitHandler<KaryawanInput> = async (values) => {
    setServerError(null);
    try {
      if (mode === 'add') {
        await createKaryawan(values);
      } else if (mode === 'edit' && karyawanId) {
        await updateKaryawan(karyawanId, values);
      }
      setOpen(false);
      reset();
      router.refresh(); // Refresh data di page
    } catch (err: any) {
      setServerError(err.message || 'Terjadi kesalahan pada server');
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger 
        render={
          mode === 'add' ? (
            <Button className="bg-[color:var(--accent-gold)] text-[#2b2318] hover:bg-[color:var(--accent-gold)]/90">
              <Plus className="mr-2 h-4 w-4" /> Tambah Karyawan
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
            {mode === 'add' ? 'Tambah Master Karyawan' : 'Edit Karyawan'}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 mt-4">
          <div className="space-y-2">
            <Label htmlFor="nama" className="text-sm font-medium">Nama Karyawan</Label>
            <Input
              id="nama"
              placeholder="Contoh: Budi Santoso"
              disabled={isSubmitting}
              className="bg-[#1E2124] border-[#2A2D31] focus-visible:ring-[#e5c17b]"
              {...register('nama')}
            />
            {errors.nama && <p className="text-xs text-red-500">{errors.nama.message}</p>}
          </div>

          <div className="space-y-2">
            <Label htmlFor="jabatan" className="text-sm font-medium">Jabatan</Label>
            <Input
              id="jabatan"
              placeholder="Contoh: Penjahit Utama"
              disabled={isSubmitting}
              className="bg-[#1E2124] border-[#2A2D31] focus-visible:ring-[#e5c17b]"
              {...register('jabatan')}
            />
            {errors.jabatan && <p className="text-xs text-red-500">{errors.jabatan.message}</p>}
          </div>

          <div className="space-y-2">
            <Label className="text-[#e8eaed]">Tahap Produksi yang Ditangani</Label>
            <p className="text-xs text-[#9aa0a6]">
              Pilih semua station scan yang dikerjakan karyawan ini
            </p>
            <div className="grid grid-cols-2 gap-2">
              {TAHAP_PRODUKSI_OPTIONS.map((opt) => {
                const isChecked = watch('tahap_produksi')?.includes(opt.value) ?? false;
                return (
                  <label
                    key={opt.value}
                    className={`flex items-center gap-2 rounded-lg border p-2.5 cursor-pointer transition-colors
                      ${isChecked
                        ? 'border-[#e5c17b]/50 bg-[#e5c17b]/5 text-[#e5c17b]'
                        : 'border-[#2A2D31] bg-[#1A1D1F] text-[#9aa0a6] hover:border-[#3a3d41]'
                      }`}
                  >
                    <input
                      type="checkbox"
                      className="hidden"
                      checked={isChecked}
                      onChange={(e) => {
                        const current = watch('tahap_produksi') ?? [];
                        if (e.target.checked) {
                          setValue('tahap_produksi', [...current, opt.value]);
                        } else {
                          setValue('tahap_produksi', current.filter(v => v !== opt.value));
                        }
                      }}
                    />
                    <span className={`h-4 w-4 rounded border flex items-center justify-center shrink-0
                      ${isChecked ? 'bg-[#e5c17b] border-[#e5c17b]' : 'border-[#2A2D31] bg-[#0D0E10]'}`}
                    >
                      {isChecked && <span className="text-[#2b2318] text-xs font-bold">✓</span>}
                    </span>
                    <span className="text-sm font-medium">{opt.label}</span>
                  </label>
                );
              })}
            </div>
            {errors.tahap_produksi && <p className="text-xs text-red-500">{errors.tahap_produksi.message}</p>}
          </div>

          <div className="space-y-2">
            <Label htmlFor="gaji_pokok" className="text-sm font-medium">Gaji Pokok (Rp)</Label>
            <Input
              id="gaji_pokok"
              type="number"
              min={0}
              step={50000}
              placeholder="Contoh: 1500000"
              disabled={isSubmitting}
              className="bg-[#1E2124] border-[#2A2D31] focus-visible:ring-[#e5c17b]"
              {...register('gaji_pokok', { valueAsNumber: true })}
            />
            {errors.gaji_pokok && <p className="text-xs text-red-500">{errors.gaji_pokok.message}</p>}
          </div>

          {mode === 'edit' && (
            <div className="flex items-center justify-between pt-2">
              <Label htmlFor="aktif" className="text-sm font-medium">Status Aktif</Label>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="aktif"
                  className="w-4 h-4 rounded border-[#2A2D31] bg-[#1E2124] text-[#e5c17b] focus:ring-[#e5c17b]"
                  {...register('aktif')}
                  disabled={isSubmitting}
                />
                <span className="text-sm text-muted-foreground">Ya</span>
              </div>
            </div>
          )}

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
              {isSubmitting ? 'Menyimpan...' : 'Simpan Karyawan'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function KaryawanDeleteAction({ id }: { id: string }) {
  const router = useRouter();
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDelete = async () => {
    if (!confirm('Apakah Anda yakin ingin menonaktifkan karyawan ini?')) return;
    
    setIsDeleting(true);
    try {
      await deleteKaryawan(id);
      router.refresh();
    } catch (err: any) {
      alert(err.message || 'Gagal menghapus data');
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
      title="Nonaktifkan Karyawan"
    >
      <Trash2 className="h-4 w-4" />
    </Button>
  );
}
