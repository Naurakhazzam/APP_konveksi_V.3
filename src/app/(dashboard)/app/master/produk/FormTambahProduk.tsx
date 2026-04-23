'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2 } from 'lucide-react';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

import { ProdukSchema, type ProdukInput } from '@/lib/validations/master.schemas';
import { createProduk } from '@/lib/actions/master/produk.actions';

import type { ModelItem, SizeItem, WarnaItem } from './ProdukClient';

// ─────────────────────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────────────────────

interface FormTambahProdukProps {
  open: boolean;
  onClose: () => void;
  modelList: ModelItem[];
  sizeList: SizeItem[];
  warnaList: WarnaItem[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Select style helper (reuse konsisten dengan halaman master lain)
// ─────────────────────────────────────────────────────────────────────────────

const selectCls =
  'flex h-10 w-full rounded-md border border-[#2A2D31] bg-[#1E2124] px-3 py-2 text-sm text-[#e8eaed] focus:outline-none focus:ring-1 focus:ring-[#e5c17b] disabled:opacity-50';

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export function FormTambahProduk({
  open,
  onClose,
  modelList,
  sizeList,
  warnaList,
}: FormTambahProdukProps) {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const [generatedSku, setGeneratedSku] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<ProdukInput>({
    resolver: zodResolver(ProdukSchema),
    defaultValues: {
      model_id: '',
      size_id: '',
      warna_id: '',
      sku_klien: '',
      harga_jual: 0,
    },
  });

  // Preview SKU generasi otomatis dari pilihan model / warna / size
  const watchedModelId = watch('model_id');
  const watchedWarnaId = watch('warna_id');
  const watchedSizeId  = watch('size_id');

  const previewSku = React.useMemo(() => {
    const model = modelList.find((m) => m.id === watchedModelId);
    const warna = warnaList.find((w) => w.id === watchedWarnaId);
    const size  = sizeList.find((s) => s.id === watchedSizeId);
    if (!model || !warna || !size) return null;
    const m = model.nama.replace(/\s+/g, '').substring(0, 3).toUpperCase();
    const w = warna.nama.replace(/\s+/g, '').substring(0, 3).toUpperCase();
    const s = size.nama.toUpperCase();
    return `LYX-${m}-${w}-${s}`;
  }, [watchedModelId, watchedWarnaId, watchedSizeId, modelList, warnaList, sizeList]);

  const onSubmit = async (values: ProdukInput) => {
    setServerError(null);
    try {
      const result = await createProduk({
        ...values,
        sku_klien: values.sku_klien || undefined,
      });
      setGeneratedSku(result.sku_internal);
      router.refresh();
      // Tampilkan SKU sebentar lalu tutup
      setTimeout(() => {
        reset();
        setGeneratedSku(null);
        onClose();
      }, 1500);
    } catch (err: any) {
      setServerError(err.message);
    }
  };

  const handleClose = () => {
    if (isSubmitting) return;
    reset();
    setServerError(null);
    setGeneratedSku(null);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[520px] bg-[#16181A] border-[#2A2D31] text-[#e8eaed]">
        <DialogHeader>
          <DialogTitle className="text-[#e8eaed] text-lg">Tambah SKU Produk Baru</DialogTitle>
          <p className="text-xs text-[#9aa0a6] mt-1">
            SKU Internal digenerate otomatis dari kombinasi Model + Warna + Size.
          </p>
        </DialogHeader>

        {/* Sukses state */}
        {generatedSku ? (
          <div className="flex flex-col items-center gap-3 py-6">
            <div className="h-12 w-12 rounded-full bg-green-500/10 flex items-center justify-center text-2xl">✅</div>
            <p className="text-sm text-[#9aa0a6]">SKU berhasil dibuat:</p>
            <p className="font-mono text-xl font-bold text-[#e5c17b]">{generatedSku}</p>
            <p className="text-xs text-[#5f6368]">Menutup otomatis...</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 mt-2">

            {/* 1. Model */}
            <div className="space-y-2">
              <Label htmlFor="model_id" className="text-sm text-[#e8eaed]">
                Model Produk <span className="text-red-500">*</span>
              </Label>
              <select id="model_id" disabled={isSubmitting} className={selectCls} {...register('model_id')}>
                <option value="">-- Pilih Model --</option>
                {modelList.map((m) => (
                  <option key={m.id} value={m.id}>{m.nama}</option>
                ))}
              </select>
              {errors.model_id && <p className="text-xs text-red-500">{errors.model_id.message}</p>}
            </div>

            {/* 2. Size */}
            <div className="space-y-2">
              <Label htmlFor="size_id" className="text-sm text-[#e8eaed]">
                Ukuran / Size <span className="text-red-500">*</span>
              </Label>
              <select id="size_id" disabled={isSubmitting} className={selectCls} {...register('size_id')}>
                <option value="">-- Pilih Size --</option>
                {sizeList
                  .slice()
                  .sort((a, b) => a.urutan - b.urutan)
                  .map((s) => (
                    <option key={s.id} value={s.id}>{s.nama}</option>
                  ))}
              </select>
              {errors.size_id && <p className="text-xs text-red-500">{errors.size_id.message}</p>}
            </div>

            {/* 3. Warna — dengan dot-color preview */}
            <div className="space-y-2">
              <Label htmlFor="warna_id" className="text-sm text-[#e8eaed]">
                Warna <span className="text-red-500">*</span>
              </Label>
              <select id="warna_id" disabled={isSubmitting} className={selectCls} {...register('warna_id')}>
                <option value="">-- Pilih Warna --</option>
                {warnaList.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.kode_hex ? `⬤ ` : '○ '}{w.nama}{w.kode_hex ? ` (${w.kode_hex})` : ''}
                  </option>
                ))}
              </select>
              {errors.warna_id && <p className="text-xs text-red-500">{errors.warna_id.message}</p>}

              {/* Warna preview dot */}
              {watchedWarnaId && (() => {
                const warna = warnaList.find((w) => w.id === watchedWarnaId);
                if (!warna?.kode_hex) return null;
                return (
                  <div className="flex items-center gap-2 text-xs text-[#9aa0a6]">
                    <span className="h-4 w-4 rounded-full border border-white/10" style={{ backgroundColor: warna.kode_hex }} />
                    Preview warna: <span className="font-medium text-[#e8eaed]">{warna.nama}</span> ({warna.kode_hex})
                  </div>
                );
              })()}
            </div>

            {/* Preview SKU otomatis */}
            {previewSku && (
              <div className="rounded-lg border border-[#e5c17b]/20 bg-[#e5c17b]/5 px-4 py-3">
                <p className="text-xs text-[#9aa0a6] mb-1">Preview SKU Internal yang akan digenerate:</p>
                <p className="font-mono text-lg font-bold text-[#e5c17b] tracking-wider">{previewSku}</p>
              </div>
            )}

            {/* 4. SKU Klien */}
            <div className="space-y-2">
              <Label htmlFor="sku_klien" className="text-sm text-[#e8eaed]">
                SKU Klien <span className="text-[#5f6368] text-xs font-normal">(opsional)</span>
              </Label>
              <Input
                id="sku_klien"
                placeholder="Contoh: AIR-BLK-S"
                disabled={isSubmitting}
                className="bg-[#1E2124] border-[#2A2D31] text-[#e8eaed] placeholder:text-[#5f6368]"
                {...register('sku_klien')}
              />
            </div>

            {/* 5. Harga Jual */}
            <div className="space-y-2">
              <Label htmlFor="harga_jual" className="text-sm text-[#e8eaed]">
                Harga Jual (Rp) <span className="text-red-500">*</span>
              </Label>
              <Input
                id="harga_jual"
                type="number"
                min={0}
                placeholder="0"
                disabled={isSubmitting}
                className="bg-[#1E2124] border-[#2A2D31] text-[#e8eaed] placeholder:text-[#5f6368]"
                {...register('harga_jual', { valueAsNumber: true })}
              />
              {errors.harga_jual && <p className="text-xs text-red-500">{errors.harga_jual.message}</p>}
            </div>

            {/* Server error */}
            {serverError && (
              <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-xs text-red-400">
                {serverError}
              </div>
            )}

            {/* Actions */}
            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                disabled={isSubmitting}
                onClick={handleClose}
                className="border-[#2A2D31] bg-transparent text-[#e8eaed] hover:bg-[#2A2D31]"
              >
                Batal
              </Button>
              <Button
                type="submit"
                disabled={isSubmitting}
                className="bg-green-600 hover:bg-green-700 text-white min-w-[100px]"
              >
                {isSubmitting ? (
                  <span className="flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" /> Menyimpan...
                  </span>
                ) : (
                  'Simpan SKU'
                )}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
