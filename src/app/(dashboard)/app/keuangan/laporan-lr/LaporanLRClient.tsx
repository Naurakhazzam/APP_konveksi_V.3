'use client';

import React, { useState, useTransition } from 'react';
import { Loader2, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { toast } from 'sonner';
import {
  getLaporanLR,
  type LaporanLRData,
  type LaporanLRBulan,
} from '@/lib/actions/keuangan/laporan-lr.actions';

// ─── HELPERS ────────────────────────────────────────────────────────────────

const idr = (n: number) =>
  (n < 0 ? '-' : '') + 'Rp ' + Math.abs(n).toLocaleString('id-ID');

const pct = (n: number) =>
  (n >= 0 ? '+' : '') + n.toFixed(1) + '%';

function StatusBadge({ val }: { val: number }) {
  if (val > 0)  return <span className="text-xs font-bold text-green-400">▲ UNTUNG</span>;
  if (val < 0)  return <span className="text-xs font-bold text-red-400">▼ RUGI</span>;
  return             <span className="text-xs font-bold text-[#9aa0a6]">— BEP</span>;
}

// Bar sederhana untuk trend chart
function MiniBar({ val, max, positive }: { val: number; max: number; positive: boolean }) {
  const pct = max > 0 ? Math.min(Math.abs(val) / max * 100, 100) : 0;
  return (
    <div className="w-full h-2 bg-[#2A2D31] rounded-full overflow-hidden">
      <div
        className={`h-full rounded-full transition-all ${positive ? 'bg-green-500' : 'bg-red-500'}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

// ─── MAIN ───────────────────────────────────────────────────────────────────

interface Props {
  initialData: LaporanLRData;
  initialTahun: number;
}

export default function LaporanLRClient({ initialData, initialTahun }: Props) {
  const [data,   setData]   = useState<LaporanLRData>(initialData);
  const [tahun,  setTahun]  = useState(initialTahun);
  const [pending, startTransition] = useTransition();

  const TAHUN_OPTIONS = Array.from({ length: 5 }, (_, i) => initialTahun - i);

  function handleTahunChange(t: number) {
    setTahun(t);
    startTransition(async () => {
      try {
        const res = await getLaporanLR(t);
        setData(res);
      } catch {
        toast.error('Gagal memuat laporan');
      }
    });
  }

  const maxLaba = Math.max(...data.bulan_list.map(b => Math.abs(b.laba_bersih)), 1);

  // ── Summary cards ─────────────────────────────────────────────────────────
  const cards = [
    {
      label: 'Total Pendapatan',
      value: data.total_pendapatan,
      sub: 'dari invoice lunas',
      color: 'text-blue-400',
      border: 'border-blue-500/30',
    },
    {
      label: 'HPP',
      value: data.total_hpp,
      sub: 'bahan + upah produksi',
      color: 'text-orange-400',
      border: 'border-orange-500/30',
    },
    {
      label: 'Laba Kotor',
      value: data.total_laba_kotor,
      sub: 'pendapatan - HPP',
      color: data.total_laba_kotor >= 0 ? 'text-green-400' : 'text-red-400',
      border: data.total_laba_kotor >= 0 ? 'border-green-500/30' : 'border-red-500/30',
    },
    {
      label: 'Overhead & Ops',
      value: data.total_overhead + data.total_biaya_ops,
      sub: 'overhead + operasional',
      color: 'text-yellow-400',
      border: 'border-yellow-500/30',
    },
    {
      label: 'Laba Bersih',
      value: data.total_laba_bersih,
      sub: `Margin ${pct(data.margin_pct)}`,
      color: data.total_laba_bersih >= 0 ? 'text-green-400' : 'text-red-400',
      border: data.total_laba_bersih >= 0 ? 'border-green-500/30' : 'border-red-500/30',
      large: true,
    },
  ];

  return (
    <div className="p-6 space-y-6 text-white">
      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Laporan Laba Rugi</h1>
          <p className="text-[#9aa0a6] text-sm mt-0.5">
            Konsolidasi pendapatan, HPP, dan biaya operasional
          </p>
        </div>
        <div className="flex items-center gap-2">
          {pending && <Loader2 className="w-4 h-4 animate-spin text-[#9aa0a6]" />}
          <select
            value={tahun}
            onChange={(e) => handleTahunChange(Number(e.target.value))}
            className="bg-[#1E2124] border border-[#3A3D41] text-white rounded-md px-3 py-2 text-sm"
          >
            {TAHUN_OPTIONS.map(t => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>
      </div>

      {/* ── Summary Cards ── */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {cards.map((c) => (
          <div
            key={c.label}
            className={`bg-[#1E2124] border ${c.border} rounded-xl p-4 ${c.large ? 'col-span-2 lg:col-span-1' : ''}`}
          >
            <p className="text-[10px] font-bold text-[#9aa0a6] uppercase tracking-widest mb-1">{c.label}</p>
            <p className={`font-bold ${c.large ? 'text-lg' : 'text-sm'} ${c.color}`}>
              {idr(c.value)}
            </p>
            <p className="text-[10px] text-[#9aa0a6] mt-0.5">{c.sub}</p>
          </div>
        ))}
      </div>

      {/* ── Tabel per Bulan ── */}
      <div className="bg-[#1E2124] border border-[#2A2D31] rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-[#2A2D31]">
          <h2 className="text-sm font-bold">Breakdown per Bulan — {tahun}</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#2A2D31] text-[#9aa0a6] text-[11px] uppercase">
                <th className="text-left px-4 py-3">Bulan</th>
                <th className="text-right px-4 py-3">Pendapatan</th>
                <th className="text-right px-4 py-3">HPP</th>
                <th className="text-right px-4 py-3">Laba Kotor</th>
                <th className="text-right px-4 py-3">Overhead</th>
                <th className="text-right px-4 py-3">Ops</th>
                <th className="text-right px-4 py-3">Laba Bersih</th>
                <th className="text-right px-4 py-3">Margin</th>
                <th className="px-4 py-3 w-28">Trend</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {data.bulan_list.map((b) => {
                const ada = b.pendapatan > 0 || b.hpp > 0 || b.biaya_ops > 0;
                return (
                  <tr
                    key={b.bulan}
                    className={`border-b border-[#2A2D31] transition-colors ${
                      ada
                        ? b.laba_bersih >= 0
                          ? 'hover:bg-green-500/5'
                          : 'hover:bg-red-500/5'
                        : 'opacity-40'
                    }`}
                  >
                    <td className="px-4 py-3 font-medium">{b.label}</td>
                    <td className="px-4 py-3 text-right text-blue-400 font-mono text-xs">{idr(b.pendapatan)}</td>
                    <td className="px-4 py-3 text-right text-orange-400 font-mono text-xs">{idr(b.hpp)}</td>
                    <td className={`px-4 py-3 text-right font-mono text-xs ${b.laba_kotor >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {idr(b.laba_kotor)}
                    </td>
                    <td className="px-4 py-3 text-right text-yellow-400 font-mono text-xs">{idr(b.overhead)}</td>
                    <td className="px-4 py-3 text-right text-yellow-300 font-mono text-xs">{idr(b.biaya_ops)}</td>
                    <td className={`px-4 py-3 text-right font-bold font-mono text-xs ${b.laba_bersih >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {idr(b.laba_bersih)}
                    </td>
                    <td className={`px-4 py-3 text-right text-xs font-bold ${b.margin_pct >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {ada ? pct(b.margin_pct) : '—'}
                    </td>
                    <td className="px-4 py-3 w-28">
                      {ada && <MiniBar val={b.laba_bersih} max={maxLaba} positive={b.laba_bersih >= 0} />}
                    </td>
                    <td className="px-4 py-3">
                      {ada && <StatusBadge val={b.laba_bersih} />}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            {/* ── Total Row ── */}
            <tfoot>
              <tr className="bg-[#16181A] border-t-2 border-[#3A3D41] font-bold">
                <td className="px-4 py-3 text-sm uppercase tracking-wider text-[#9aa0a6]">TOTAL {tahun}</td>
                <td className="px-4 py-3 text-right text-blue-400 font-mono">{idr(data.total_pendapatan)}</td>
                <td className="px-4 py-3 text-right text-orange-400 font-mono">{idr(data.total_hpp)}</td>
                <td className={`px-4 py-3 text-right font-mono ${data.total_laba_kotor >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {idr(data.total_laba_kotor)}
                </td>
                <td className="px-4 py-3 text-right text-yellow-400 font-mono">{idr(data.total_overhead)}</td>
                <td className="px-4 py-3 text-right text-yellow-300 font-mono">{idr(data.total_biaya_ops)}</td>
                <td className={`px-4 py-3 text-right font-mono text-base ${data.total_laba_bersih >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {idr(data.total_laba_bersih)}
                </td>
                <td className={`px-4 py-3 text-right font-mono ${data.margin_pct >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {pct(data.margin_pct)}
                </td>
                <td className="px-4 py-3" colSpan={2}>
                  <StatusBadge val={data.total_laba_bersih} />
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* ── Catatan Metodologi ── */}
      <div className="bg-[#1A1C1E] border border-[#2A2D31] rounded-xl p-4 text-[11px] text-[#9aa0a6] space-y-1">
        <p className="font-bold text-white mb-2">📌 Metodologi Perhitungan</p>
        <p>• <span className="text-blue-400">Pendapatan</span> = pembayaran invoice yang diterima (berdasarkan tanggal bayar, bukan tanggal invoice)</p>
        <p>• <span className="text-orange-400">HPP</span> = jurnal produksi: pembelian bahan + upah produksi langsung</p>
        <p>• <span className="text-yellow-400">Overhead & Ops</span> = biaya overhead pabrik + buku kas keluar (operasional, bukan gaji)</p>
        <p>• <span className="text-green-400">Laba Bersih</span> = Pendapatan − HPP − Overhead − Biaya Operasional</p>
      </div>
    </div>
  );
}
