'use client';

import React from 'react';

export default function PrintButton() {
  return (
    <button 
      onClick={() => window.print()}
      className="bg-[#e5c17b] text-[#0D0E10] px-6 py-2 rounded-md font-bold text-sm hover:bg-[#d4b06a] transition-colors uppercase tracking-wider print:hidden"
    >
      🖨️ Cetak Surat Jalan
    </button>
  );
}
