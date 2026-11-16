'use client';

import React, { useState } from 'react';

/** Kelas di <html> yang memunculkan kolom harga di lembar cetak (lihat PrintSuratJalanLayout) */
const KELAS_CETAK_HARGA = 'sj-cetak-harga';

/**
 * Tombol cetak. `bisaCetakHarga` hanya true untuk owner & admin keuangan — dan hanya untuk mereka
 * server mengirim data harga, jadi role lain tidak punya angkanya sama sekali.
 */
export default function PrintButton({ bisaCetakHarga = false }: { bisaCetakHarga?: boolean }) {
  const [namaDriver, setNamaDriver] = useState('');

  const handlePrint = (denganHarga: boolean) => {
    const el = document.getElementById('sj-driver-name');
    if (el) el.textContent = namaDriver || '.....................';
    const root = document.documentElement;
    if (denganHarga) root.classList.add(KELAS_CETAK_HARGA);
    else root.classList.remove(KELAS_CETAK_HARGA);
    window.print();
    root.classList.remove(KELAS_CETAK_HARGA);
  };

  return (
    <div className="flex flex-wrap items-center gap-3 print:hidden">
      <input
        type="text"
        value={namaDriver}
        onChange={(e) => setNamaDriver(e.target.value)}
        placeholder="Nama Driver..."
        className="bg-[#1A1D1F] border border-[#2A2D31] text-[#e8eaed] placeholder:text-[#9aa0a6] rounded-md px-4 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#e5c17b] w-48"
      />
      <button
        onClick={() => handlePrint(false)}
        className="bg-[#e5c17b] text-[#0D0E10] px-6 py-2 rounded-md font-bold text-sm hover:bg-[#d4b06a] transition-colors uppercase tracking-wider"
      >
        🖨️ Cetak Surat Jalan
      </button>
      {bisaCetakHarga && (
        <button
          onClick={() => handlePrint(true)}
          title="Hanya owner & admin keuangan. Untuk arsip internal — jangan diberikan ke penerima barang."
          className="border border-[#e5c17b] text-[#e5c17b] px-4 py-2 rounded-md font-bold text-sm hover:bg-[#e5c17b]/10 transition-colors uppercase tracking-wider"
        >
          🖨️ Cetak + Nominal
        </button>
      )}
    </div>
  );
}
