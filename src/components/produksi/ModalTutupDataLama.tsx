'use client';

import React, { useState } from 'react';
import { toast } from 'sonner';
import { Archive, Loader2, X } from 'lucide-react';
import { tutupBundleDataLama } from '@/lib/actions/produksi/bundle-ditutup.actions';

export interface BundleUntukDitutup {
  id: string;
  barcode: string;
  no_po: string;
  model_nama: string | null;
  warna: string;
  size: string;
}

/**
 * Tutup bundle "data lama" — sudah beres di lapangan tapi menggantung di
 * sistem. Dipakai di Antrian Jahit dan Buat Surat Jalan.
 */
export default function ModalTutupDataLama({
  bundles, onClose, onSelesai,
}: {
  bundles: BundleUntukDitutup[];
  onClose: () => void;
  onSelesai: () => void;
}) {
  const [alasan, setAlasan] = useState('');
  const [proses, setProses] = useState(false);

  const simpan = async () => {
    if (!alasan.trim()) {
      toast.error('Alasan wajib diisi');
      return;
    }
    setProses(true);
    try {
      const hasil = await tutupBundleDataLama(bundles.map(b => b.id), alasan);
      toast.success(`${hasil.jumlah} bundle ditutup`);
      onSelesai();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Gagal menutup bundle');
    } finally {
      setProses(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/75 flex items-center justify-center z-50 p-4">
      <div className="bg-[#1A1D1F] border border-[#2A2D31] rounded-xl w-full max-w-lg shadow-2xl max-h-[90vh] flex flex-col">
        <div className="px-6 py-4 border-b border-[#2A2D31] flex items-start justify-between gap-4">
          <div>
            <h3 className="text-base font-bold text-[#e8eaed] flex items-center gap-2">
              <Archive className="w-4 h-4 text-[#e5c17b]" />
              Tutup Data Lama ({bundles.length} bundle)
            </h3>
            <p className="text-xs text-[#9aa0a6] mt-1">
              Untuk bundle yang sudah beres di lapangan tapi tertinggal di sistem.
            </p>
          </div>
          <button onClick={onClose} disabled={proses} className="text-[#9aa0a6] hover:text-[#e8eaed] transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 py-4 space-y-4 overflow-y-auto">
          <ul className="text-[11px] text-[#9aa0a6] space-y-1 list-disc pl-4">
            <li>Bundle hilang dari antrian ini dan dari Buat Surat Jalan.</li>
            <li><b className="text-[#e8eaed]">Tidak membuat upah apa pun</b> — tidak masuk gajian. Upah yang sudah tercatat sebelumnya tidak diubah.</li>
            <li>Bundle dikunci (tidak bisa discan) sampai dibuka lagi lewat tombol <b className="text-[#e8eaed]">Data Ditutup</b>.</li>
          </ul>

          <div className="rounded-lg border border-[#2A2D31] max-h-48 overflow-y-auto divide-y divide-[#2A2D31]">
            {bundles.map(b => (
              <div key={b.id} className="px-3 py-2 text-xs">
                <span className="font-mono text-[#e5c17b]">{b.barcode}</span>
                <span className="text-[#9aa0a6]"> · {b.no_po} · {b.model_nama ?? '-'} {b.warna} {b.size}</span>
              </div>
            ))}
          </div>

          <div>
            <label className="text-[10px] uppercase tracking-wider text-[#9aa0a6] font-bold">Alasan *</label>
            <textarea
              value={alasan}
              onChange={e => setAlasan(e.target.value)}
              rows={2}
              placeholder="mis. Sudah dikirim, lupa dibuatkan surat jalan (data lama)"
              className="mt-1 w-full rounded-lg bg-[#0D0E10] border border-[#2A2D31] px-3 py-2 text-sm text-[#e8eaed] focus:outline-none focus:border-[#e5c17b]/60"
            />
          </div>
        </div>

        <div className="px-6 py-3 border-t border-[#2A2D31] flex justify-end gap-3">
          <button
            onClick={onClose}
            disabled={proses}
            className="px-4 h-9 rounded-lg border border-[#2A2D31] text-[#e8eaed] text-sm hover:bg-[#2A2D31] transition-colors"
          >
            Batal
          </button>
          <button
            onClick={simpan}
            disabled={proses || !alasan.trim()}
            className="flex items-center gap-2 px-4 h-9 rounded-lg bg-[#e5c17b] hover:bg-[#f0d194] text-[#16181A] text-sm font-bold transition-colors disabled:opacity-50"
          >
            {proses ? <Loader2 className="w-4 h-4 animate-spin" /> : <Archive className="w-4 h-4" />}
            Tutup {bundles.length} Bundle
          </button>
        </div>
      </div>
    </div>
  );
}
