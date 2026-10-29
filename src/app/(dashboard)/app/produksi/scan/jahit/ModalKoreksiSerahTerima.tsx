'use client';

import React, { useState } from 'react';
import { type AntrianJahitBundle } from '@/lib/actions/produksi/scan.actions';
import { koreksiSerahTerimaJahit } from '@/lib/actions/produksi/scan-mutations.actions';
import { X, Pencil, User, Loader2, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';

interface Props {
  bundle: AntrianJahitBundle;
  karyawanList: { id: string; nama: string }[];
  onSuccess: () => void;
  onClose: () => void;
}

export default function ModalKoreksiSerahTerima({ bundle, karyawanList, onSuccess, onClose }: Props) {
  const jahit = (bundle as any).status_tahap?.jahit;
  const karyawanLamaId: string = jahit?.karyawan_id ?? '';
  const qtyLama: number = jahit?.qty_terima ?? bundle.qty_per_bundle;
  // Batas atas = hasil cutting; server tetap memvalidasi ulang.
  const qtyMaks: number | null = (bundle as any).status_tahap?.cutting?.qty_aktual ?? null;

  const [karyawanId, setKaryawanId]     = useState(karyawanLamaId);
  const [qty, setQty]                   = useState<string>(String(qtyLama));
  const [alasan, setAlasan]             = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const qtyNum        = parseInt(qty) || 0;
  const gantiPenjahit = karyawanId !== karyawanLamaId;
  const gantiQty      = qtyNum !== qtyLama;
  const qtyValid      = qtyNum >= 1 && (qtyMaks === null || qtyNum <= qtyMaks);
  const isValid       = karyawanId !== '' && qtyValid && (gantiPenjahit || gantiQty);

  const namaLama = karyawanList.find(k => k.id === karyawanLamaId)?.nama ?? 'Belum ditentukan';
  const namaBaru = karyawanList.find(k => k.id === karyawanId)?.nama ?? '';

  const handleSubmit = async () => {
    if (!isValid) return;

    setIsSubmitting(true);
    try {
      const result = await koreksiSerahTerimaJahit({
        bundle_id:   bundle.id,
        karyawan_id: karyawanId,
        qty:         qtyNum,
        alasan,
      });

      if (result.stok_warnings.length > 0) {
        toast.warning(
          `Stok aksesori kurang: ${result.stok_warnings.map(w => `${w.item_nama} (${w.qty_kurang})`).join(', ')}`
        );
      }

      const perubahan = [
        gantiPenjahit && `penjahit → ${namaBaru}`,
        gantiQty && `qty ${result.qty_lama} → ${result.qty_baru} pcs`,
      ].filter(Boolean).join(', ');
      toast.success(
        `${bundle.barcode} dikoreksi: ${perubahan}` +
        (gantiPenjahit ? '. Jangan lupa Print Ulang kartu kerjanya.' : '')
      );
      onSuccess();
    } catch (err: any) {
      toast.error(err.message || 'Gagal mengoreksi serah terima');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/75 flex items-center justify-center z-50 p-4">
      <div className="bg-[#1A1D1F] border border-[#2A2D31] rounded-2xl w-full max-w-lg shadow-2xl flex flex-col max-h-[90vh]">

        {/* Header */}
        <div className="px-6 py-5 border-b border-[#2A2D31] flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-[#e8eaed] flex items-center gap-2">
              <Pencil className="w-5 h-5 text-[#e5c17b]" />
              Koreksi Serah Terima
            </h2>
            <p className="text-sm text-[#9aa0a6] mt-1 font-mono">{bundle.barcode}</p>
          </div>
          <button
            onClick={onClose}
            disabled={isSubmitting}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-[#9aa0a6] hover:text-[#e8eaed] hover:bg-[#2A2D31] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-5 overflow-y-auto">

          {/* Info bundle */}
          <div className="bg-[#16181A] border border-[#2A2D31] rounded-xl p-4 text-sm space-y-2">
            <div className="flex justify-between">
              <span className="text-[#9aa0a6]">Artikel</span>
              <span className="text-[#e8eaed] font-medium">{bundle.model_nama ?? '-'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[#9aa0a6]">Warna / Size</span>
              <span className="text-[#e8eaed]">{bundle.warna} / {bundle.size}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[#9aa0a6]">Penjahit sekarang</span>
              <span className="text-[#e8eaed]">{namaLama}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[#9aa0a6]">Qty sekarang</span>
              <span className="text-[#e5c17b] font-bold">{qtyLama} pcs</span>
            </div>
          </div>

          {/* Penjahit */}
          <div className="space-y-2">
            <label className="text-[10px] font-black uppercase tracking-[0.2em] text-[#e5c17b] flex items-center gap-2">
              <User size={14} /> Penjahit yang benar
            </label>
            <select
              value={karyawanId}
              onChange={e => setKaryawanId(e.target.value)}
              disabled={isSubmitting}
              className="w-full bg-[#16181A] border border-[#2A2D31] rounded-xl px-4 py-3 text-[#e8eaed] focus:ring-1 focus:ring-[#e5c17b] outline-none transition-all text-sm"
            >
              <option value="">-- Pilih Penjahit --</option>
              {karyawanList.map(k => (
                <option key={k.id} value={k.id}>{k.nama}</option>
              ))}
            </select>
          </div>

          {/* Qty */}
          <div className="space-y-2">
            <label className="text-[10px] font-black uppercase tracking-[0.2em] text-[#e5c17b] flex items-center gap-2">
              Qty yang benar
            </label>
            <div className="flex items-center gap-3">
              <input
                type="number"
                min={1}
                max={qtyMaks ?? undefined}
                value={qty}
                onChange={e => setQty(e.target.value)}
                disabled={isSubmitting}
                className="w-32 bg-[#16181A] border border-[#2A2D31] rounded-xl px-4 py-3 text-[#e8eaed] text-center text-lg font-bold focus:ring-1 focus:ring-[#e5c17b] outline-none"
              />
              <span className="text-[#9aa0a6] text-sm">
                pcs{qtyMaks !== null && <> · maks {qtyMaks} (hasil cutting)</>}
              </span>
            </div>
            {!qtyValid && qty !== '' && (
              <p className="text-xs text-red-400">
                Qty harus antara 1{qtyMaks !== null ? ` dan ${qtyMaks}` : ''} pcs
              </p>
            )}
          </div>

          {/* Alasan */}
          <div className="space-y-2">
            <label className="text-[10px] font-black uppercase tracking-[0.2em] text-[#e5c17b]">
              Alasan <span className="normal-case tracking-normal font-normal text-[#9aa0a6]">(opsional)</span>
            </label>
            <input
              type="text"
              value={alasan}
              onChange={e => setAlasan(e.target.value)}
              disabled={isSubmitting}
              placeholder="mis. salah pilih nama penjahit"
              className="w-full bg-[#16181A] border border-[#2A2D31] rounded-xl px-4 py-3 text-[#e8eaed] focus:ring-1 focus:ring-[#e5c17b] outline-none text-sm"
            />
          </div>

          {gantiQty && qtyValid && (
            <div className="flex items-start gap-2 bg-[#e5c17b]/5 border border-[#e5c17b]/20 rounded-xl p-3">
              <AlertTriangle className="w-4 h-4 text-[#e5c17b] shrink-0 mt-0.5" />
              <p className="text-xs text-[#9aa0a6]">
                Stok aksesori tahap jahit ikut disesuaikan:{' '}
                {qtyNum > qtyLama
                  ? <>dipotong tambahan untuk <span className="text-[#e8eaed] font-semibold">{qtyNum - qtyLama} pcs</span>.</>
                  : <>dikembalikan untuk <span className="text-[#e8eaed] font-semibold">{qtyLama - qtyNum} pcs</span>, biaya bahan PO ikut dikurangi.</>}
              </p>
            </div>
          )}

        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-[#2A2D31] flex justify-end gap-3 bg-[#16181A] rounded-b-2xl">
          <button
            onClick={onClose}
            disabled={isSubmitting}
            className="px-6 py-2.5 rounded-xl border border-[#2A2D31] text-sm font-bold text-[#e8eaed] hover:bg-[#2A2D31] transition-colors disabled:opacity-50"
          >
            Batal
          </button>
          <button
            onClick={handleSubmit}
            disabled={isSubmitting || !isValid}
            className="flex items-center gap-2 bg-[#e5c17b] hover:bg-[#d4b06a] text-[#0D0E10] px-6 py-2.5 rounded-xl text-sm font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSubmitting
              ? <><Loader2 className="w-4 h-4 animate-spin" /> Menyimpan...</>
              : <><Pencil className="w-4 h-4" /> Simpan Koreksi</>
            }
          </button>
        </div>
      </div>
    </div>
  );
}
