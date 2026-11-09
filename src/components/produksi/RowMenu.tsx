'use client';

import React, { useState, useEffect, useRef } from 'react';
import { MoreHorizontal } from 'lucide-react';

// Menu ⋯ per baris (posisi fixed supaya tidak terpotong tabel yang scroll).
export interface MenuItem {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
  hint?: string;
}

export default function RowMenu({ items }: { items: MenuItem[] }) {
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!pos) return;
    const tutup = () => setPos(null);
    window.addEventListener('scroll', tutup, true);
    window.addEventListener('resize', tutup);
    return () => {
      window.removeEventListener('scroll', tutup, true);
      window.removeEventListener('resize', tutup);
    };
  }, [pos]);

  const buka = () => {
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    const tinggi = items.length * 36 + 8;
    const top = r.bottom + tinggi > window.innerHeight ? r.top - tinggi - 4 : r.bottom + 4;
    setPos({ top, right: window.innerWidth - r.right });
  };

  return (
    <>
      <button
        ref={btnRef}
        onClick={() => (pos ? setPos(null) : buka())}
        className="w-8 h-8 flex items-center justify-center rounded-lg border border-[#2A2D31] text-[#9aa0a6] hover:text-[#e8eaed] hover:bg-[#2A2D31] transition-colors"
        aria-label="Aksi lain"
      >
        <MoreHorizontal className="w-4 h-4" />
      </button>
      {pos && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setPos(null)} />
          <div
            className="fixed z-50 min-w-[220px] py-1 bg-[#1F2225] border border-[#2A2D31] rounded-xl shadow-2xl"
            style={{ top: pos.top, right: pos.right }}
          >
            {items.map(it => (
              <button
                key={it.label}
                disabled={it.disabled}
                title={it.hint}
                onClick={() => { setPos(null); it.onClick(); }}
                className={`w-full flex items-center gap-2.5 px-3.5 h-9 text-xs font-semibold text-left transition-colors disabled:opacity-35 disabled:cursor-not-allowed ${
                  it.danger ? 'text-orange-400 hover:bg-orange-500/10' : 'text-[#e8eaed] hover:bg-[#2A2D31]'
                }`}
              >
                {it.icon}
                {it.label}
              </button>
            ))}
          </div>
        </>
      )}
    </>
  );
}
