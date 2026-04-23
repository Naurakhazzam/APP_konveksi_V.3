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

import { 
  KategoriProdukSchema, type KategoriProdukInput,
  ModelProdukSchema, type ModelProdukInput,
  SizeSchema, type SizeInput,
  WarnaSchema, type WarnaInput
} from '@/lib/validations/master.schemas';

import {
  createKategoriProduk, updateKategoriProduk, deleteKategoriProduk,
  createModelProduk, updateModelProduk, deleteModelProduk,
  createSize, updateSize, deleteSize,
  createWarna, updateWarna, deleteWarna
} from '@/lib/actions/master/detail.actions';

// ============================================================================
// KATEGORI
// ============================================================================
export function KategoriFormModal({ mode, initialData, id }: { mode: 'add'|'edit', initialData?: KategoriProdukInput, id?: string }) {
  const [open, setOpen] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const router = useRouter();

  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<KategoriProdukInput>({
    resolver: zodResolver(KategoriProdukSchema),
    defaultValues: initialData || { nama: '' },
  });

  const onSubmit = async (values: KategoriProdukInput) => {
    setServerError(null);
    try {
      if (mode === 'add') await createKategoriProduk(values);
      else if (id) await updateKategoriProduk(id, values);
      setOpen(false); reset(); router.refresh();
    } catch (err: any) { setServerError(err.message); }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={
        mode === 'add' ? (
          <Button className="bg-[color:var(--accent-gold)] text-[#2b2318] hover:bg-[color:var(--accent-gold)]/90">
            <Plus className="mr-2 h-4 w-4" /> Kategori Baru
          </Button>
        ) : (
          <Button variant="ghost" size="icon" className="h-8 w-8 text-blue-500 hover:text-blue-600 hover:bg-blue-500/10"><Pencil className="h-4 w-4" /></Button>
        )
      }/>
      <DialogContent className="sm:max-w-[425px] bg-[#16181A] border-[#2A2D31] text-[#e8eaed]">
        <DialogHeader><DialogTitle className="text-[#e8eaed]">{mode === 'add' ? 'Tambah Kategori' : 'Edit Kategori'}</DialogTitle></DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="nama" className="text-sm">Nama Kategori</Label>
            <Input id="nama" disabled={isSubmitting} className="bg-[#1E2124] border-[#2A2D31]" {...register('nama')} />
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

export function KategoriDeleteAction({ id }: { id: string }) {
  const router = useRouter();
  const [isDeleting, setIsDeleting] = useState(false);
  const handleDelete = async () => {
    if (!confirm('Hapus kategori ini secara permanen?')) return;
    setIsDeleting(true);
    try { await deleteKategoriProduk(id); router.refresh(); } 
    catch (err: any) { alert(err.message); setIsDeleting(false); }
  };
  return (
    <Button variant="ghost" size="icon" onClick={handleDelete} disabled={isDeleting} className="h-8 w-8 text-red-500 hover:bg-red-500/10">
      <Trash2 className="h-4 w-4" />
    </Button>
  );
}

// ============================================================================
// MODEL
// ============================================================================
export function ModelFormModal({ mode, initialData, id, masterKategori }: { mode: 'add'|'edit', initialData?: ModelProdukInput, id?: string, masterKategori: any[] }) {
  const [open, setOpen] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const router = useRouter();

  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<ModelProdukInput>({
    resolver: zodResolver(ModelProdukSchema),
    defaultValues: initialData || { nama: '', kategori_id: '' },
  });

  const onSubmit = async (values: ModelProdukInput) => {
    setServerError(null);
    try {
      if (mode === 'add') await createModelProduk(values);
      else if (id) await updateModelProduk(id, values);
      setOpen(false); reset(); router.refresh();
    } catch (err: any) { setServerError(err.message); }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={
        mode === 'add' ? (
          <Button className="bg-[color:var(--accent-gold)] text-[#2b2318] hover:bg-[color:var(--accent-gold)]/90">
            <Plus className="mr-2 h-4 w-4" /> Model Baru
          </Button>
        ) : (
          <Button variant="ghost" size="icon" className="h-8 w-8 text-blue-500 hover:text-blue-600 hover:bg-blue-500/10"><Pencil className="h-4 w-4" /></Button>
        )
      }/>
      <DialogContent className="sm:max-w-[425px] bg-[#16181A] border-[#2A2D31] text-[#e8eaed]">
        <DialogHeader><DialogTitle className="text-[#e8eaed]">{mode === 'add' ? 'Tambah Model' : 'Edit Model'}</DialogTitle></DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="nama" className="text-sm">Nama Model</Label>
            <Input id="nama" disabled={isSubmitting} className="bg-[#1E2124] border-[#2A2D31]" {...register('nama')} />
            {errors.nama && <p className="text-xs text-red-500">{errors.nama.message}</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="kategori_id" className="text-sm">Kategori Induk</Label>
            <select
              id="kategori_id"
              disabled={isSubmitting}
              className="flex h-10 w-full rounded-md border border-[#2A2D31] bg-[#1E2124] px-3 py-2 text-sm focus-visible:outline-none focus:ring-1 focus:ring-[#e5c17b]"
              {...register('kategori_id')}
            >
              <option value="">-- Pilih Kategori --</option>
              {masterKategori.map(k => (
                <option key={k.id} value={k.id}>{k.nama}</option>
              ))}
            </select>
            {errors.kategori_id && <p className="text-xs text-red-500">{errors.kategori_id.message}</p>}
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

export function ModelDeleteAction({ id }: { id: string }) {
  const router = useRouter();
  const [isDeleting, setIsDeleting] = useState(false);
  const handleDelete = async () => {
    if (!confirm('Hapus model ini secara permanen?')) return;
    setIsDeleting(true);
    try { await deleteModelProduk(id); router.refresh(); } 
    catch (err: any) { alert(err.message); setIsDeleting(false); }
  };
  return (
    <Button variant="ghost" size="icon" onClick={handleDelete} disabled={isDeleting} className="h-8 w-8 text-red-500 hover:bg-red-500/10">
      <Trash2 className="h-4 w-4" />
    </Button>
  );
}

// ============================================================================
// SIZE
// ============================================================================
export function SizeFormModal({ mode, initialData, id }: { mode: 'add'|'edit', initialData?: SizeInput, id?: string }) {
  const [open, setOpen] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const router = useRouter();

  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<SizeInput>({
    resolver: zodResolver(SizeSchema),
    defaultValues: initialData || { nama: '', urutan: 0 },
  });

  const onSubmit = async (values: SizeInput) => {
    setServerError(null);
    try {
      if (mode === 'add') await createSize(values);
      else if (id) await updateSize(id, values);
      setOpen(false); reset(); router.refresh();
    } catch (err: any) { setServerError(err.message); }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={
        mode === 'add' ? (
          <Button className="bg-[color:var(--accent-gold)] text-[#2b2318] hover:bg-[color:var(--accent-gold)]/90">
            <Plus className="mr-2 h-4 w-4" /> Size Baru
          </Button>
        ) : (
          <Button variant="ghost" size="icon" className="h-8 w-8 text-blue-500 hover:text-blue-600 hover:bg-blue-500/10"><Pencil className="h-4 w-4" /></Button>
        )
      }/>
      <DialogContent className="sm:max-w-[425px] bg-[#16181A] border-[#2A2D31] text-[#e8eaed]">
        <DialogHeader><DialogTitle className="text-[#e8eaed]">{mode === 'add' ? 'Tambah Size' : 'Edit Size'}</DialogTitle></DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="nama" className="text-sm">Nama Size</Label>
            <Input id="nama" placeholder="S, M, L, XL" disabled={isSubmitting} className="bg-[#1E2124] border-[#2A2D31]" {...register('nama')} />
            {errors.nama && <p className="text-xs text-red-500">{errors.nama.message}</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="urutan" className="text-sm">Urutan</Label>
            <Input id="urutan" type="number" disabled={isSubmitting} className="bg-[#1E2124] border-[#2A2D31]" {...register('urutan', { valueAsNumber: true })} />
            {errors.urutan && <p className="text-xs text-red-500">{errors.urutan.message}</p>}
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

export function SizeDeleteAction({ id }: { id: string }) {
  const router = useRouter();
  const [isDeleting, setIsDeleting] = useState(false);
  const handleDelete = async () => {
    if (!confirm('Hapus master size ini secara permanen?')) return;
    setIsDeleting(true);
    try { await deleteSize(id); router.refresh(); } 
    catch (err: any) { alert(err.message); setIsDeleting(false); }
  };
  return (
    <Button variant="ghost" size="icon" onClick={handleDelete} disabled={isDeleting} className="h-8 w-8 text-red-500 hover:bg-red-500/10">
      <Trash2 className="h-4 w-4" />
    </Button>
  );
}

// ============================================================================
// WARNA
// ============================================================================
export function WarnaFormModal({ mode, initialData, id }: { mode: 'add'|'edit', initialData?: WarnaInput, id?: string }) {
  const [open, setOpen] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const router = useRouter();

  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<WarnaInput>({
    resolver: zodResolver(WarnaSchema),
    defaultValues: initialData || { nama: '', kode_hex: '' },
  });

  const onSubmit = async (values: WarnaInput) => {
    setServerError(null);
    try {
      if (mode === 'add') await createWarna(values);
      else if (id) await updateWarna(id, values);
      setOpen(false); reset(); router.refresh();
    } catch (err: any) { setServerError(err.message); }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={
        mode === 'add' ? (
          <Button className="bg-[color:var(--accent-gold)] text-[#2b2318] hover:bg-[color:var(--accent-gold)]/90">
            <Plus className="mr-2 h-4 w-4" /> Warna Baru
          </Button>
        ) : (
          <Button variant="ghost" size="icon" className="h-8 w-8 text-blue-500 hover:text-blue-600 hover:bg-blue-500/10"><Pencil className="h-4 w-4" /></Button>
        )
      }/>
      <DialogContent className="sm:max-w-[425px] bg-[#16181A] border-[#2A2D31] text-[#e8eaed]">
        <DialogHeader><DialogTitle className="text-[#e8eaed]">{mode === 'add' ? 'Tambah Master Warna' : 'Edit Warna'}</DialogTitle></DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="nama" className="text-sm">Nama Warna</Label>
            <Input id="nama" placeholder="Contoh: Merah Maroon" disabled={isSubmitting} className="bg-[#1E2124] border-[#2A2D31]" {...register('nama')} />
            {errors.nama && <p className="text-xs text-red-500">{errors.nama.message}</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="kode_hex" className="text-sm">Kode Hex / Tag ID (Opsional)</Label>
            <Input id="kode_hex" placeholder="#ff0000" disabled={isSubmitting} className="bg-[#1E2124] border-[#2A2D31]" {...register('kode_hex')} />
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

export function WarnaDeleteAction({ id }: { id: string }) {
  const router = useRouter();
  const [isDeleting, setIsDeleting] = useState(false);
  const handleDelete = async () => {
    if (!confirm('Hapus master warna ini secara permanen?')) return;
    setIsDeleting(true);
    try { await deleteWarna(id); router.refresh(); } 
    catch (err: any) { alert(err.message); setIsDeleting(false); }
  };
  return (
    <Button variant="ghost" size="icon" onClick={handleDelete} disabled={isDeleting} className="h-8 w-8 text-red-500 hover:bg-red-500/10">
      <Trash2 className="h-4 w-4" />
    </Button>
  );
}
