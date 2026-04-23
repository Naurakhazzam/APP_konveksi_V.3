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

import { 
  JenisRejectSchema, type JenisRejectInput,
  AlasanRejectSchema, type AlasanRejectInput 
} from '@/lib/validations/master.schemas';

import {
  createJenisReject, updateJenisReject, deleteJenisReject,
  createAlasanReject, updateAlasanReject, deleteAlasanReject
} from '@/lib/actions/master/reject.actions';

import { TAHAP_LABELS } from '@/lib/constants/jabatan-mapping';

// ============================================================================
// JENIS REJECT
// ============================================================================
export function JenisRejectFormModal({ mode, initialData, id }: { mode: 'add'|'edit', initialData?: JenisRejectInput, id?: string }) {
  const [open, setOpen] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const router = useRouter();

  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<JenisRejectInput>({
    resolver: zodResolver(JenisRejectSchema),
    defaultValues: initialData || { nama: '' },
  });

  const onSubmit = async (values: JenisRejectInput) => {
    setServerError(null);
    try {
      if (mode === 'add') await createJenisReject(values);
      else if (id) await updateJenisReject(id, values);
      setOpen(false); reset(); router.refresh();
    } catch (err: any) { setServerError(err.message); }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={
        mode === 'add' ? (
          <Button className="bg-[color:var(--accent-gold)] text-[#2b2318] hover:bg-[color:var(--accent-gold)]/90">
            <Plus className="mr-2 h-4 w-4" /> Jenis Baru
          </Button>
        ) : (
          <Button variant="ghost" size="icon" className="h-8 w-8 text-blue-500 hover:text-blue-600 hover:bg-blue-500/10"><Pencil className="h-4 w-4" /></Button>
        )
      }/>
      <DialogContent className="sm:max-w-[425px] bg-[#16181A] border-[#2A2D31] text-[#e8eaed]">
        <DialogHeader><DialogTitle className="text-[#e8eaed]">{mode === 'add' ? 'Tambah Jenis Reject' : 'Edit Jenis Reject'}</DialogTitle></DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="nama" className="text-sm">Kategori Jenis Cacat</Label>
            <Input id="nama" placeholder="Contoh: Kotor" disabled={isSubmitting} className="bg-[#1E2124] border-[#2A2D31]" {...register('nama')} />
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

export function JenisRejectDeleteAction({ id }: { id: string }) {
  const router = useRouter();
  const [isDeleting, setIsDeleting] = useState(false);
  const handleDelete = async () => {
    if (!confirm('Hapus jenis reject ini?')) return;
    setIsDeleting(true);
    try { await deleteJenisReject(id); router.refresh(); } 
    catch (err: any) { alert(err.message); setIsDeleting(false); }
  };
  return (
    <Button variant="ghost" size="icon" onClick={handleDelete} disabled={isDeleting} className="h-8 w-8 text-red-500 hover:bg-red-500/10"><Trash2 className="h-4 w-4" /></Button>
  );
}

// ============================================================================
// ALASAN REJECT
// ============================================================================
export function AlasanRejectFormModal({ mode, initialData, id, masterJenis }: { mode: 'add'|'edit', initialData?: AlasanRejectInput, id?: string, masterJenis: any[] }) {
  const [open, setOpen] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const router = useRouter();

  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<AlasanRejectInput>({
    resolver: zodResolver(AlasanRejectSchema),
    defaultValues: initialData || { 
      nama: '', 
      jenis_reject_id: '', 
      tahap_bertanggung_jawab: '', 
      bisa_diperbaiki: false, 
      dampak_potongan: null 
    },
  });

  const onSubmit = async (values: AlasanRejectInput) => {
    setServerError(null);
    try {
      if (mode === 'add') await createAlasanReject(values);
      else if (id) await updateAlasanReject(id, values);
      setOpen(false); reset(); router.refresh();
    } catch (err: any) { setServerError(err.message); }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={
        mode === 'add' ? (
          <Button className="bg-[color:var(--accent-gold)] text-[#2b2318] hover:bg-[color:var(--accent-gold)]/90">
            <Plus className="mr-2 h-4 w-4" /> Alasan Baru
          </Button>
        ) : (
          <Button variant="ghost" size="icon" className="h-8 w-8 text-blue-500 hover:text-blue-600 hover:bg-blue-500/10"><Pencil className="h-4 w-4" /></Button>
        )
      }/>
      <DialogContent className="sm:max-w-[425px] bg-[#16181A] border-[#2A2D31] text-[#e8eaed]">
        <DialogHeader><DialogTitle className="text-[#e8eaed]">{mode === 'add' ? 'Tambah Alasan Reject' : 'Edit Alasan Reject'}</DialogTitle></DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="nama" className="text-sm">Deskripsi Indikator / Alasan Cacat</Label>
            <Input id="nama" placeholder="Contoh: Jahitan melenceng/loncat" disabled={isSubmitting} className="bg-[#1E2124] border-[#2A2D31]" {...register('nama')} />
            {errors.nama && <p className="text-xs text-red-500">{errors.nama.message}</p>}
          </div>

          <div className="space-y-2">
            <Label className="text-sm">Kelompok Jenis Reject</Label>
            <select disabled={isSubmitting} className="flex h-10 w-full rounded-md border border-[#2A2D31] bg-[#1E2124] px-3 py-2 text-sm focus:ring-[#e5c17b]" {...register('jenis_reject_id')}>
              <option value="">-- Pilih Jenis Cacat --</option>
              {masterJenis.map(k => <option key={k.id} value={k.id}>{k.nama}</option>)}
            </select>
            {errors.jenis_reject_id && <p className="text-xs text-red-500">{errors.jenis_reject_id.message}</p>}
          </div>

          <div className="space-y-2">
            <Label className="text-sm">Tahap Target (Pihak yang bertanggung jawab)</Label>
            <select disabled={isSubmitting} className="flex h-10 w-full rounded-md border border-[#2A2D31] bg-[#1E2124] px-3 py-2 text-sm focus:ring-[#e5c17b]" {...register('tahap_bertanggung_jawab')}>
              <option value="">-- Pilih Tahap Workflow --</option>
              {Object.entries(TAHAP_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            {errors.tahap_bertanggung_jawab && <p className="text-xs text-red-500">{errors.tahap_bertanggung_jawab.message}</p>}
          </div>

          <div className="pt-2 flex items-center justify-between">
            <Label className="text-sm">Dapat Diperbaiki? (Bukan Afkir / Buang)</Label>
            <input type="checkbox" className="w-4 h-4 rounded border-[#2A2D31] bg-[#1E2124] text-[#e5c17b] focus:ring-[#e5c17b]" {...register('bisa_diperbaiki')} disabled={isSubmitting} />
          </div>

          <div className="space-y-2">
            <Label className="text-sm">Konsekuensi Potongan Biaya / Claim</Label>
            <select disabled={isSubmitting} className="flex h-10 w-full rounded-md border border-[#2A2D31] bg-[#1E2124] px-3 py-2 text-sm focus:ring-[#e5c17b]" {...register('dampak_potongan')}>
              <option value="">-- Tidak ada Potongan (Pilih) --</option>
              <option value="upah_tahap">Potong Biaya Upah Tukang</option>
              <option value="hpp_po">Potong di Tagihan Vendor HPP</option>
            </select>
            {errors.dampak_potongan && <p className="text-xs text-red-500">{errors.dampak_potongan.message}</p>}
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

export function AlasanRejectDeleteAction({ id }: { id: string }) {
  const router = useRouter();
  const [isDeleting, setIsDeleting] = useState(false);
  const handleDelete = async () => {
    if (!confirm('Hapus alasan reject ini dari kamus?')) return;
    setIsDeleting(true);
    try { await deleteAlasanReject(id); router.refresh(); } 
    catch (err: any) { alert(err.message); setIsDeleting(false); }
  };
  return (
    <Button variant="ghost" size="icon" onClick={handleDelete} disabled={isDeleting} className="h-8 w-8 text-red-500 hover:bg-red-500/10"><Trash2 className="h-4 w-4" /></Button>
  );
}
