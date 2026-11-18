'use client';

import { batasMundurWib, hariIniWib, MAKS_MUNDUR_HARI } from '@/lib/produksi/tanggal-kejadian';

/**
 * Pilihan "Tanggal kejadian" untuk Selesai Cutting / Selesai Packing.
 * Default hari ini; boleh mundur maks 7 hari bila admin menginput belakangan.
 * Tanggal mundur dicatat di audit log & dipakai untuk pembagian overhead.
 */
export default function InputTanggalKejadian({
  value, onChange, disabled, className = '',
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  className?: string;
}) {
  const hariIni = hariIniWib();
  const mundur = value && value !== hariIni;
  return (
    <div className={className}>
      <label className="block text-[10px] uppercase tracking-widest text-[#9aa0a6] font-bold mb-2">
        Tanggal kejadian
      </label>
      <input
        type="date"
        value={value || hariIni}
        min={batasMundurWib()}
        max={hariIni}
        disabled={disabled}
        onChange={e => onChange(e.target.value || hariIni)}
        className={`w-full sm:w-56 rounded-lg border px-3 py-2 text-sm text-[#e8eaed] outline-none focus:border-[#e5c17b] [color-scheme:dark] ${
          mundur ? 'border-amber-500/70 bg-amber-500/10' : 'border-[#2A2D31] bg-[#16181A]'
        }`}
      />
      <p className={`mt-2 text-[10px] ${mundur ? 'text-amber-400' : 'text-[#9aa0a6]'}`}>
        {mundur
          ? 'Tanggal mundur — akan dicatat di audit log.'
          : `Ubah bila kejadiannya lebih awal (maks ${MAKS_MUNDUR_HARI} hari ke belakang).`}
      </p>
    </div>
  );
}
