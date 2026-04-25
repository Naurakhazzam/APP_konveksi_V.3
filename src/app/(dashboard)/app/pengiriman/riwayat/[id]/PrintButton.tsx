'use client';

import React, { useState } from 'react';

export default function PrintButton() {
  const [namaDriver, setNamaDriver] = useState('');

  const handlePrint = () => {
    const el = document.getElementById('sj-driver-name');
    if (el) el.textContent = namaDriver || '................................';
    window.print();
  };

  return (
    <div className="flex items-center gap-3 print:hidden">
      <input
        type="text"
        value={namaDriver}
        onChange={(e) => setNamaDriver(e.target.value)}
        placeholder="Nama Driver..."
        className="bg-[#1A1D1F] border border-[#2A2D31] text-[#e8eaed] placeholder:text-[#9aa0a6] rounded-md px-4 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#e5c17b] w-48"
      />
      <button
        onClick={handlePrint}
        className="bg-[#e5c17b] text-[#0D0E10] px-6 py-2 rounded-md font-bold text-sm hover:bg-[#d4b06a] transition-colors uppercase tracking-wider"
      >
        🖨️ Cetak Surat Jalan
      </button>
    </div>
  );
}
