'use client';

import React, { useState, useEffect } from 'react';
import { type AntrianJahitBundle } from '@/lib/actions/produksi/scan.actions';
import { scanSplitBundle } from '@/lib/actions/produksi/scan-mutations.actions';
import { getAksesoriForKartuKerja, type ModelAksesori } from '@/lib/actions/produksi/model-aksesori.actions';
import PrintKartuKerjaLayout, { type KartuBundle, type AksesoriItem } from '@/app/(dashboard)/app/produksi/antrian-cutting/PrintKartuKerjaLayout';
import { X, Scissors, User, Printer, Loader2, ArrowRight } from 'lucide-react';
import { toast } from 'sonner';

interface Props {
  bundle: AntrianJahitBundle;
  karyawanList: { id: string; nama: string }[];
  onSuccess: () => void;
  onClose: () => void;
}

export default function ModalSplitBundle({ bundle, karyawanList, onSuccess, onClose }: Props) {
  const statusJahit    = (bundle as any).status_tahap?.['jahit'];
  const karyawanIdAsli = statusJahit?.karyawan_id ?? '';
  const qtyTerima      = statusJahit?.qty_terima ?? bundle.qty_per_bundle;

  const karyawanAsliNama = karyawanList.find(k => k.id === karyawanIdAsli)?.nama ?? '-';

  const [qtySelesei, setQtySelesai]       = useState<string>(String(Math.floor(qtyTerima / 2)));
  const [karyawanSisaId, setKaryawanSisaId] = useState('');
  const [isSubmitting, setIsSubmitting]   = useState(false);
  const [kartuData, setKartuData]         = useState<KartuBundle | null>(null);
  const [aksesoriMap, setAksesoriMap]     = useState<Record<string, ModelAksesori[]>>({});
  const [loadingAksesori, setLoadingAksesori] = useState(true);

  const qtySelesaiNum = parseInt(qtySelesei) || 0;
  const qtySisa       = qtyTerima - qtySelesaiNum;
  const isValid       = qtySelesaiNum > 0 && qtySelesaiNum < qtyTerima && karyawanSisaId !== '';

  useEffect(() => {
    getAksesoriForKartuKerja([bundle.po_item_id])
      .then(map => setAksesoriMap(map))
      .catch(() => setAksesoriMap({}))
      .finally(() => setLoadingAksesori(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSubmit = async () => {
    if (!isValid) return;
    if (!karyawanIdAsli) {
      toast.error('Bundle ini tidak memiliki karyawan asli — tidak bisa di-split');
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await scanSplitBundle({
        barcode:           bundle.barcode,
        tahap:             'jahit',
        qty_selesai:       qtySelesaiNum,
        karyawan_id_asli:  karyawanIdAsli,
        karyawan_id_sisa:  karyawanSisaId,
      });

      const karyawanSisaNama = karyawanList.find(k => k.id === karyawanSisaId)?.nama ?? '';
      const aks: AksesoriItem[] = (aksesoriMap[bundle.po_item_id] ?? []).map(item => ({
        nama:        item.inventory_item_nama,
        qty_per_pcs: item.qty_per_pcs,
        satuan:      item.satuan,
        tahap_pakai: item.tahap_pakai,
      }));

      const newKartu: KartuBundle = {
        id:             result.new_bundle_id,
        barcode:        result.new_bundle_barcode,
        no_urut:        0,
        po_id:          '',
        po_item_id:     bundle.po_item_id,
        no_po:          bundle.no_po,
        tanggal_order:  '',
        tanggal_target: '',
        po_catatan:     null,
        klien_nama:     bundle.klien_nama,
        model_nama:     bundle.model_nama,
        warna:          bundle.warna,
        size:           bundle.size,
        qty_per_bundle: result.new_bundle_qty,
        aksesori:       aks,
        nama_penjahit:  karyawanSisaNama,
      };

      setKartuData(newKartu);

      setTimeout(() => {
        window.print();
        toast.success(
          `Bundle di-split: ${qtySelesaiNum} pcs (${karyawanAsliNama}) + ` +
          `${result.new_bundle_qty} pcs (${karyawanSisaNama}) → ${result.new_bundle_barcode}`
        );
        onSuccess();
      }, 500);

    } catch (err: any) {
      toast.error(err.message || 'Gagal split bundle');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <div className="fixed inset-0 bg-black/75 flex items-center justify-center z-50 p-4 print:hidden">
        <div className="bg-[#1A1D1F] border border-[#2A2D31] rounded-2xl w-full max-w-lg shadow-2xl flex flex-col">

          {/* Header */}
          <div className="px-6 py-5 border-b border-[#2A2D31] flex items-center justify-between">
            <div>
              <h2 className="text-xl font-bold text-[#e8eaed] flex items-center gap-2">
                <Scissors className="w-5 h-5 text-[#e5c17b]" />
                Split Bundle
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
          <div className="p-6 space-y-5">

            {/* Info bundle */}
            <div className="bg-[#16181A] border border-[#2A2D31] rounded-xl p-4 text-sm space-y-2">
              <div className="flex justify-between">
                <span className="text-[#9aa0a6]">Model</span>
                <span className="text-[#e8eaed] font-medium">{bundle.model_nama ?? '-'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#9aa0a6]">Warna / Size</span>
                <span className="text-[#e8eaed]">{bundle.warna} / {bundle.size}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#9aa0a6]">Total QTY diterima</span>
                <span className="text-[#e5c17b] font-bold">{qtyTerima} pcs</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#9aa0a6]">Karyawan saat ini</span>
                <span className="text-[#e8eaed] font-medium">{karyawanAsliNama}</span>
              </div>
            </div>

            {/* Qty selesai karyawan asli */}
            <div className="space-y-2">
              <label className="text-[10px] font-black uppercase tracking-[0.2em] text-[#e5c17b] flex items-center gap-2">
                <User size={14} /> {karyawanAsliNama} menyelesaikan berapa pcs?
              </label>
              <div className="flex items-center gap-3">
                <input
                  type="number"
                  min={1}
                  max={qtyTerima - 1}
                  value={qtySelesei}
                  onChange={e => setQtySelesai(e.target.value)}
                  disabled={isSubmitting}
                  className="w-32 bg-[#16181A] border border-[#2A2D31] rounded-xl px-4 py-3 text-[#e8eaed] text-center text-lg font-bold focus:ring-1 focus:ring-[#e5c17b] outline-none"
                />
                <span className="text-[#9aa0a6] text-sm">pcs dari {qtyTerima} pcs</span>
              </div>
              {qtySelesaiNum > 0 && qtySelesaiNum < qtyTerima && (
                <p className="text-xs text-[#9aa0a6]">
                  Sisa <span className="text-[#e5c17b] font-bold">{qtySisa} pcs</span> akan dibuat bundle baru
                </p>
              )}
              {qtySelesaiNum >= qtyTerima && (
                <p className="text-xs text-red-400">Qty harus kurang dari {qtyTerima} pcs untuk bisa di-split</p>
              )}
              {qtySelesaiNum <= 0 && qtySelesei !== '' && (
                <p className="text-xs text-red-400">Qty harus lebih dari 0</p>
              )}
            </div>

            {/* Karyawan untuk sisa */}
            <div className="space-y-2">
              <label className="text-[10px] font-black uppercase tracking-[0.2em] text-[#e5c17b] flex items-center gap-2">
                <User size={14} /> Sisa {qtySisa > 0 ? qtySisa : '?'} pcs dikerjakan oleh?
              </label>
              <select
                value={karyawanSisaId}
                onChange={e => setKaryawanSisaId(e.target.value)}
                disabled={isSubmitting}
                className="w-full bg-[#16181A] border border-[#2A2D31] rounded-xl px-4 py-3 text-[#e8eaed] focus:ring-1 focus:ring-[#e5c17b] outline-none transition-all text-sm"
              >
                <option value="">-- Pilih Penjahit untuk Sisa --</option>
                {karyawanList
                  .filter(k => k.id !== karyawanIdAsli)
                  .map(k => (
                    <option key={k.id} value={k.id}>{k.nama}</option>
                  ))}
              </select>
            </div>

            {/* Preview hasil split */}
            {isValid && (
              <div className="bg-[#0D0E10] border border-[#e5c17b]/20 rounded-xl p-4">
                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-[#e5c17b] mb-3">Preview Hasil Split</p>
                <div className="flex items-center gap-3 text-sm">
                  <div className="flex-1 bg-[#16181A] rounded-lg p-3 text-center">
                    <p className="text-xs text-[#9aa0a6]">Bundle asli selesai</p>
                    <p className="text-xl font-bold text-[#e8eaed] mt-1">{qtySelesaiNum} pcs</p>
                    <p className="text-xs text-[#e5c17b] mt-1">{karyawanAsliNama}</p>
                  </div>
                  <ArrowRight className="w-4 h-4 text-[#9aa0a6] shrink-0" />
                  <div className="flex-1 bg-[#16181A] rounded-lg p-3 text-center">
                    <p className="text-xs text-[#9aa0a6]">Bundle baru (split)</p>
                    <p className="text-xl font-bold text-[#e8eaed] mt-1">{qtySisa} pcs</p>
                    <p className="text-xs text-[#e5c17b] mt-1">
                      {karyawanList.find(k => k.id === karyawanSisaId)?.nama}
                    </p>
                  </div>
                </div>
                <p className="text-[10px] text-[#9aa0a6] mt-3 text-center">
                  Kartu kerja untuk bundle baru akan otomatis tercetak
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
                ? <><Loader2 className="w-4 h-4 animate-spin" /> Memproses...</>
                : <><Printer className="w-4 h-4" /> Split & Print Kartu</>
              }
            </button>
          </div>
        </div>
      </div>

      {/* Print kartu kerja bundle baru — hidden kecuali saat print */}
      {kartuData && (
        <PrintKartuKerjaLayout
          bundles={[kartuData]}
          tglCetak={new Date().toLocaleString('id-ID', {
            day: '2-digit', month: 'short', year: 'numeric',
            hour: '2-digit', minute: '2-digit',
          })}
        />
      )}
    </>
  );
}
