'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm, Controller } from 'react-hook-form';
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

import { JabatanSchema, type JabatanInput } from '@/lib/validations/master.schemas';
import { createJabatan, updateJabatan, deleteJabatan } from '@/lib/actions/master/jabatan.actions';
import { TAHAP_LABELS } from '@/lib/constants/jabatan-mapping';

const TAHAP_OPTIONS = Object.entries(TAHAP_LABELS).map(([value, label]) => ({ value, label }));

// ─────────────────────────────────────────────
// FORM MODAL
// ─────────────────────────────────────────────
export function JabatanFormModal({
  mode,
  initialData,
  jabatanId,
}: {
  mode: 'add' | 'edit';
  initialData?: JabatanInput;
  jabatanId?: string;
}) {
  const [open, setOpen] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const router = useRouter();

  const {
    register,
    handleSubmit,
    reset,
    control,
    formState: { errors, isSubmitting },
  } = useForm<JabatanInput>({
    resolver: zodResolver(JabatanSchema),
    defaultValues: initialData || {
      nama: '',
      deskripsi: '',
      tahap_produksi: [],
      gaji_default: 0,
      aktif: true,
    },
  });

  const onSubmit = async (values: JabatanInput) => {
    setServerError(null);
    try {
      if (mode === 'add') {
        await createJabatan(values);
      } else if (mode === 'edit' && jabatanId) {
        await updateJabatan(jabatanId, values);
      }
      setOpen(false);
      reset();
      router.refresh();
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
              <Plus className="mr-2 h-4 w-4" /> Tambah Jabatan
            </Button>
          ) : (
            <Button variant="ghost" size="icon" className="h-8 w-8 text-blue-500 hover:text-blue-600 hover:bg-blue-500/10">
              <Pencil className="h-4 w-4" />
            </Button>
          )
        }
      />
      <DialogContent className="sm:max-w-[480px] bg-[#16181A] border-[#2A2D31] text-[#e8eaed]">
        <DialogHeader>
          <DialogTitle className="text-[#e8eaed]">
            {mode === 'add' ? 'Tambah Master Jabatan' : 'Edit Jabatan'}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 mt-4">

          {/* Nama */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">Nama Jabatan</Label>
            <Input
              placeholder="Contoh: Operator Cutting"
              disabled={isSubmitting}
              className="bg-[#1E2124] border-[#2A2D31] focus-visible:ring-[#e5c17b]"
              {...register('nama')}
            />
            {errors.nama && <p className="text-xs text-red-500">{errors.nama.message}</p>}
          </div>

          {/* Deskripsi */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">Deskripsi <span className="text-[#9aa0a6]">(opsional)</span></Label>
            <Input
              placeholder="Contoh: Bertugas memotong bahan sesuai pola"
              disabled={isSubmitting}
              className="bg-[#1E2124] border-[#2A2D31] focus-visible:ring-[#e5c17b]"
              {...register('deskripsi')}
            />
          </div>

          {/* Tahap Produksi — Multi Checkbox */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">Tahap Produksi yang Ditangani</Label>
            <div className="rounded-lg border border-[#2A2D31] bg-[#1E2124] p-3 space-y-2">
              <Controller
                control={control}
                name="tahap_produksi"
                render={({ field }) => (
                  <>
                    {TAHAP_OPTIONS.map(({ value, label }) => {
                      const checked = field.value.includes(value);
                      return (
                        <label
                          key={value}
                          className="flex items-center gap-3 cursor-pointer hover:bg-[#2A2D31]/40 rounded px-2 py-1.5 transition-colors"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => {
                              if (e.target.checked) {
                                field.onChange([...field.value, value]);
                              } else {
                                field.onChange(field.value.filter((v: string) => v !== value));
                              }
                            }}
                            className="w-4 h-4 rounded border-[#2A2D31] bg-[#111315] text-[#e5c17b] accent-[#e5c17b]"
                          />
                          <span className="text-sm text-[#e8eaed]">{label}</span>
                        </label>
                      );
                    })}
                  </>
                )}
              />
            </div>
            <p className="text-xs text-[#9aa0a6]">Centang tahap produksi yang menjadi tanggung jawab jabatan ini.</p>
          </div>

          {/* Gaji Default */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">Gaji Default (Rp)</Label>
            <Input
              type="number"
              min={0}
              step={100000}
              placeholder="Contoh: 2500000"
              disabled={isSubmitting}
              className="bg-[#1E2124] border-[#2A2D31] focus-visible:ring-[#e5c17b]"
              {...register('gaji_default', { valueAsNumber: true })}
            />
            {errors.gaji_default && <p className="text-xs text-red-500">{errors.gaji_default.message}</p>}
          </div>

          {/* Status Aktif (edit only) */}
          {mode === 'edit' && (
            <div className="flex items-center justify-between pt-1">
              <Label className="text-sm font-medium">Status Aktif</Label>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  className="w-4 h-4 rounded border-[#2A2D31] bg-[#1E2124] accent-[#e5c17b]"
                  {...register('aktif')}
                  disabled={isSubmitting}
                />
                <span className="text-sm text-[#9aa0a6]">Ya</span>
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
              onClick={() => { setOpen(false); reset(initialData); }}
              className="border-[#2A2D31] bg-transparent text-[#e8eaed] hover:bg-[#2A2D31]"
            >
              Batal
            </Button>
            <Button
              type="submit"
              disabled={isSubmitting}
              className="bg-[color:var(--status-green)] hover:bg-[color:var(--status-green)]/90 text-white"
            >
              {isSubmitting ? 'Menyimpan...' : 'Simpan Jabatan'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────
// DELETE ACTION
// ─────────────────────────────────────────────
export function JabatanDeleteAction({ id }: { id: string }) {
  const router = useRouter();
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDelete = async () => {
    if (!confirm('Nonaktifkan jabatan ini? Jabatan yang masih dipakai karyawan aktif tidak bisa dinonaktifkan.')) return;
    setIsDeleting(true);
    try {
      await deleteJabatan(id);
      router.refresh();
    } catch (err: any) {
      alert(err.message || 'Gagal menonaktifkan jabatan');
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
      title="Nonaktifkan Jabatan"
    >
      <Trash2 className="h-4 w-4" />
    </Button>
  );
}
