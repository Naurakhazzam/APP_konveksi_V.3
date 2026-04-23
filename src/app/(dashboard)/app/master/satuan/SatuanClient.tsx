'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Plus, Pencil, Trash2 } from 'lucide-react';

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

import { SatuanSchema, type SatuanInput } from '@/lib/validations/master.schemas';
import { createSatuan, updateSatuan, deleteSatuan } from '@/lib/actions/master/satuan.actions';

export function SatuanFormModal({ mode, initialData, id }: { mode: 'add'|'edit', initialData?: SatuanInput, id?: string }) {
  const [open, setOpen] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const router = useRouter();

  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<SatuanInput>({
    resolver: zodResolver(SatuanSchema),
    defaultValues: initialData || { nama: '' },
  });

  const onSubmit = async (values: SatuanInput) => {
    setServerError(null);
    try {
      if (mode === 'add') await createSatuan(values);
      else if (id) await updateSatuan(id, values);
      setOpen(false); reset(); router.refresh();
    } catch (err: any) { setServerError(err.message); }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={
        mode === 'add' ? (
          <Button className="bg-[color:var(--accent-gold)] text-[#2b2318] hover:bg-[color:var(--accent-gold)]/90">
            <Plus className="mr-2 h-4 w-4" /> Satuan Baru
          </Button>
        ) : (
          <Button variant="ghost" size="icon" className="h-8 w-8 text-blue-500 hover:text-blue-600 hover:bg-blue-500/10"><Pencil className="h-4 w-4" /></Button>
        )
      }/>
      <DialogContent className="sm:max-w-[425px] bg-[#16181A] border-[#2A2D31] text-[#e8eaed]">
        <DialogHeader><DialogTitle className="text-[#e8eaed]">{mode === 'add' ? 'Tambah Satuan' : 'Edit Satuan'}</DialogTitle></DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 mt-2">
          <div className="space-y-2">
            <Label htmlFor="nama" className="text-sm">Nama Satuan (UOM)</Label>
            <Input id="nama" placeholder="Contoh: meter" disabled={isSubmitting} className="bg-[#1E2124] border-[#2A2D31]" {...register('nama')} />
            {errors.nama && <p className="text-xs text-red-500">{errors.nama.message}</p>}
          </div>
          {serverError && <div className="p-3 bg-red-500/10 text-xs text-red-500">{serverError}</div>}
          <div className="pt-4 flex justify-end gap-2">
            <Button type="button" variant="outline" disabled={isSubmitting} onClick={() => setOpen(false)} className="border-[#2A2D31] bg-transparent text-[#e8eaed]">Batal</Button>
            <Button type="submit" disabled={isSubmitting} className="bg-[color:var(--status-green)] text-white">Simpan</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function SatuanDeleteAction({ id }: { id: string }) {
  const router = useRouter();
  const [isDeleting, setIsDeleting] = useState(false);
  const handleDelete = async () => {
    if (!confirm('Hapus master satuan ini secara permanen?')) return;
    setIsDeleting(true);
    try { await deleteSatuan(id); router.refresh(); } 
    catch (err: any) { alert(err.message); setIsDeleting(false); }
  };
  return (
    <Button variant="ghost" size="icon" onClick={handleDelete} disabled={isDeleting} className="h-8 w-8 text-red-500 hover:bg-red-500/10">
      <Trash2 className="h-4 w-4" />
    </Button>
  );
}
