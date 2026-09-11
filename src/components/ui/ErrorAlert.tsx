'use client';

import { AlertTriangle, X } from 'lucide-react';

/**
 * Kotak error yang TIDAK hilang sendiri — beda dari toast yang cuma tampil
 * sebentar lalu menghilang. Dipakai untuk error dari server yang perlu
 * benar-benar dibaca (mis. kode error surat jalan seperti
 * "[SUDAH TERKIRIM] PO-0083 — ..."), bukan validasi ringan di form.
 * Tetap di layar sampai ditutup manual lewat tombol X.
 */
export function ErrorAlert({ pesan, onClose }: { pesan: string; onClose: () => void }) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3">
      <AlertTriangle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
      <p className="flex-1 min-w-0 text-sm text-red-200 whitespace-pre-wrap leading-relaxed break-words">
        {pesan}
      </p>
      <button
        onClick={onClose}
        title="Tutup"
        className="shrink-0 text-red-300 hover:text-red-100 transition-colors"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
