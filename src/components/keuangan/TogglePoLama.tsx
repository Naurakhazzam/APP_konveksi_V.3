'use client';

import { PO_AWAL_PERIODE } from '@/lib/keuangan/periode-po';

/**
 * Centang "Tampilkan PO sebelum PO-0100". Default tidak dicentang —
 * menu keuangan hanya menampilkan angka PO periode baru.
 */
/**
 * 16 Nov 2026: user minta semua angka uang sebelum periode baru (14 Nov / PO-0099) disembunyikan
 * permanen — catatan lama tidak disiplin. Centang tidak ditampilkan lagi; komponen dibiarkan
 * supaya pemanggilnya tidak perlu diubah (state "lama" selalu false).
 */
const SEMBUNYIKAN_PERMANEN = true;

export default function TogglePoLama({ checked, onChange, info, className = '' }: {
  checked: boolean;
  onChange: (v: boolean) => void;
  /** Keterangan tambahan, mis. "(12 disembunyikan)" */
  info?: string;
  className?: string;
}) {
  if (SEMBUNYIKAN_PERMANEN) return null;
  return (
    <label className={`flex items-center gap-2 h-9 text-xs text-[#9aa0a6] cursor-pointer select-none ${className}`}
      title={`Default hanya PO-${String(PO_AWAL_PERIODE).padStart(4, '0')} ke atas`}>
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} className="accent-[#e5c17b]" />
      Tampilkan PO sebelum PO-{String(PO_AWAL_PERIODE).padStart(4, '0')}
      {info && <span className="text-[#5f6368]">{info}</span>}
    </label>
  );
}
