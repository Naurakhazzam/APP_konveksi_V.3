'use client';

import React, { useState } from 'react';
import { batalJahitBatch } from '@/lib/actions/produksi/jahit.actions';
import { X, Undo2, Loader2, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';

export interface BundleBatal {
  id: string;
  barcode: string;
  no_po: string;
  model_nama: string | null;
  warna: string;
  size: string;
  qty_per_bundle: number;
  karyawan_nama?: string;
}

interface Props {
  bundles: BundleBatal[];
  /** serah_terima: Sedang Dijahit → Antrian · selesai: Selesai → Sedang Dijahit */
  mode: 'serah_terima' | 'selesai';
  onSuccess: () => void;
  onClose: () => void;
}

const INFO = {
  serah_terima: {
    judul: 'Batalkan Serah Terima',
    arah: 'Sedang Dijahit → kembali ke Antrian',
    efek: [
      'Penjahit dilepas dari bundle — bundle muncul lagi di tab Antrian.',
      'Stok aksesori tahap jahit dikembalikan.',
      'Benang yang sudah diserahkan TIDAK otomatis kembali — hapus di menu Benang bila perlu.',
    ],
  },
  selesai: {
    judul: 'Batalkan Selesai Jahit',
    arah: 'Selesai → kembali ke Sedang Dijahit',
    efek: [
      'Bundle kembali ke tab Sedang Dijahit dengan penjahit yang sama.',
      'Upah jahit bundle ini dibatalkan (ditolak bila upahnya sudah dibayar).',
      'Tahap yang tadinya otomatis dilewati (Lubang Kancing / Steam) ikut dikembalikan.',
    ],
  },
};

export default function ModalBatalJahit({ bundles, mode, onSuccess, onClose }: Props) {
  const [alasan, setAlasan] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const info = INFO[mode];
  const totalPcs = bundles.reduce((s, b) => s + b.qty_per_bundle, 0);

  const handleSubmit = async () => {
    if (!alasan.trim()) return;
    setIsSubmitting(true);
    try {
      const res = await batalJahitBatch(bundles.map(b => b.id), mode, alasan.trim());
      toast.success(`${res.jumlah} bundle dibatalkan — ${info.arah.toLowerCase()}`);
      onSuccess();
    } catch (err: any) {
      toast.error(`Gagal, tidak ada yang berubah: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/75 flex items-center justify-center z-50 p-4">
      <div className="bg-[#1A1D1F] border border-[#2A2D31] rounded-2xl w-full max-w-lg shadow-2xl flex flex-col max-h-[90vh]">
        <div className="px-6 py-5 border-b border-[#2A2D31] flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-[#e8eaed] flex items-center gap-2">
              <Undo2 className="w-5 h-5 text-orange-400" /> {info.judul}
            </h2>
            <p className="text-sm text-[#9aa0a6] mt-1">
              {bundles.length} bundle · {totalPcs} pcs · {info.arah}
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={isSubmitting}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-[#9aa0a6] hover:text-[#e8eaed] hover:bg-[#2A2D31]"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          <div className="border border-[#2A2D31] rounded-xl overflow-hidden bg-[#16181A] max-h-48 overflow-y-auto">
            <table className="w-full text-sm">
              <tbody className="divide-y divide-[#2A2D31]">
                {bundles.map(b => (
                  <tr key={b.id}>
                    <td className="px-4 py-2 font-mono text-xs text-[#e5c17b]">{b.barcode}</td>
                    <td className="px-4 py-2 text-xs text-[#e8eaed]">{b.model_nama ?? '-'} · {b.warna}/{b.size}</td>
                    <td className="px-4 py-2 text-xs text-[#9aa0a6]">{b.karyawan_nama ?? ''}</td>
                    <td className="px-4 py-2 text-right text-xs font-bold text-[#e8eaed]">{b.qty_per_bundle}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="rounded-xl border border-orange-500/30 bg-orange-500/5 p-4 space-y-1.5">
            <p className="text-xs font-bold text-orange-400 flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5" /> Yang terjadi:
            </p>
            {info.efek.map(e => (
              <p key={e} className="text-xs text-[#e8eaed]">• {e}</p>
            ))}
          </div>

          <div className="space-y-2">
            <label className="text-[10px] font-black uppercase tracking-[0.2em] text-[#e5c17b]">Alasan *</label>
            <input
              type="text"
              value={alasan}
              onChange={e => setAlasan(e.target.value)}
              disabled={isSubmitting}
              autoFocus
              placeholder="mis. salah pilih bundle / salah penjahit"
              className="w-full bg-[#16181A] border border-[#2A2D31] rounded-xl px-4 py-3 text-sm text-[#e8eaed] outline-none focus:ring-1 focus:ring-[#e5c17b]"
            />
          </div>
        </div>

        <div className="px-6 py-4 border-t border-[#2A2D31] flex justify-end gap-3 bg-[#16181A] rounded-b-2xl">
          <button
            onClick={onClose}
            disabled={isSubmitting}
            className="px-5 py-2.5 rounded-xl border border-[#2A2D31] text-sm font-bold text-[#e8eaed] hover:bg-[#2A2D31]"
          >
            Tutup
          </button>
          <button
            onClick={handleSubmit}
            disabled={isSubmitting || !alasan.trim()}
            className="flex items-center gap-2 bg-orange-600 hover:bg-orange-500 text-white px-5 py-2.5 rounded-xl text-sm font-bold disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Undo2 className="w-4 h-4" />}
            {isSubmitting ? 'Memproses...' : `Batalkan ${bundles.length} Bundle`}
          </button>
        </div>
      </div>
    </div>
  );
}
