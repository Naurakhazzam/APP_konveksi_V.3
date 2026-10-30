'use client';

import React, { useState } from 'react';
import { History, ListOrdered, ChevronDown } from 'lucide-react';
import type { AlurQtyRow, RiwayatEvent } from '@/lib/actions/produksi/lacak-barcode.actions';

const NADA_DOT: Record<RiwayatEvent['nada'], string> = {
  normal: 'bg-[#e5c17b]',
  merah:  'bg-red-500',
  kuning: 'bg-amber-400',
  hijau:  'bg-emerald-400',
  abu:    'bg-[#5f6368]',
};

const NADA_TEKS: Record<RiwayatEvent['nada'], string> = {
  normal: 'text-[#e8eaed]',
  merah:  'text-red-400',
  kuning: 'text-amber-300',
  hijau:  'text-emerald-400',
  abu:    'text-[#9aa0a6]',
};

function formatWaktu(iso: string | null): string {
  if (!iso) return '-';
  return new Date(iso).toLocaleString('id-ID', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

export function AlurQty({ rows }: { rows: AlurQtyRow[] }) {
  const adaSelisih = rows.some(r => (r.selisih ?? 0) < 0);
  return (
    <div className="p-6 border-t border-[#2A2D31]">
      <div className="flex items-center gap-2 mb-3">
        <ListOrdered className="w-4 h-4 text-[#e5c17b]" />
        <h3 className="text-xs font-bold text-[#9aa0a6] uppercase tracking-wider">Alur Qty</h3>
        {adaSelisih && (
          <span className="text-[10px] font-bold text-red-400 bg-red-500/10 border border-red-500/20 px-1.5 py-0.5 rounded">
            ada qty berkurang
          </span>
        )}
      </div>
      <div className="rounded-2xl border border-[#2A2D31] overflow-hidden">
        {rows.map((r, i) => {
          const turun = (r.selisih ?? 0) < 0;
          return (
            <div
              key={i}
              className={`flex items-start justify-between gap-3 px-4 py-2.5 text-sm ${i > 0 ? 'border-t border-[#2A2D31]' : ''} ${turun ? 'bg-red-500/5' : 'bg-[#0D0E10]'}`}
            >
              <div className="min-w-0">
                <div className="text-[#e8eaed] font-medium">{r.label}</div>
                {r.catatan && <div className="text-[11px] text-[#9aa0a6] mt-0.5 break-words">{r.catatan}</div>}
              </div>
              <div className="text-right shrink-0">
                <div className="font-bold text-[#e8eaed]">{r.qty ?? '-'} <span className="text-[#9aa0a6] font-normal text-xs">pcs</span></div>
                {turun && <div className="text-[11px] font-bold text-red-400">{r.selisih}</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function TimelineRiwayat({ events }: { events: RiwayatEvent[] }) {
  // Entri upah banyak dan jarang dibutuhkan — disembunyikan dulu supaya
  // alur barangnya mudah dibaca.
  const [tampilUpah, setTampilUpah] = useState(false);
  const jumlahUpah = events.filter(e => e.jenis === 'upah').length;
  const tampil = tampilUpah ? events : events.filter(e => e.jenis !== 'upah');

  return (
    <div className="p-6 border-t border-[#2A2D31]">
      <div className="flex items-center justify-between gap-2 mb-4">
        <div className="flex items-center gap-2">
          <History className="w-4 h-4 text-[#e5c17b]" />
          <h3 className="text-xs font-bold text-[#9aa0a6] uppercase tracking-wider">Riwayat Lengkap</h3>
        </div>
        {jumlahUpah > 0 && (
          <button
            onClick={() => setTampilUpah(v => !v)}
            className="flex items-center gap-1 text-[11px] text-[#9aa0a6] hover:text-[#e5c17b]"
          >
            {tampilUpah ? 'Sembunyikan upah' : `Tampilkan upah (${jumlahUpah})`}
            <ChevronDown className={`w-3 h-3 transition-transform ${tampilUpah ? 'rotate-180' : ''}`} />
          </button>
        )}
      </div>

      <ol className="relative ml-1.5">
        {tampil.map((e, i) => (
          <li key={i} className="relative pl-6 pb-4 last:pb-0">
            {i < tampil.length - 1 && (
              <span className="absolute left-[4px] top-3 bottom-0 w-px bg-[#2A2D31]" aria-hidden />
            )}
            <span className={`absolute left-0 top-1.5 w-2.5 h-2.5 rounded-full ${NADA_DOT[e.nada]}`} aria-hidden />
            <div className="text-[10px] text-[#9aa0a6] font-mono">{formatWaktu(e.waktu)}</div>
            <div className={`text-sm font-bold ${NADA_TEKS[e.nada]}`}>{e.judul}</div>
            {e.detail && <div className="text-xs text-[#9aa0a6] mt-0.5 break-words">{e.detail}</div>}
            {e.oleh && <div className="text-[11px] text-[#5f6368] mt-0.5">{e.oleh}</div>}
          </li>
        ))}
      </ol>
    </div>
  );
}
