'use client';

import React, { useState, useTransition } from 'react';
import { Loader2, TrendingUp } from 'lucide-react';
import { toast } from 'sonner';
import {
  getLaporanLR,
  type LaporanLRData,
  type LaporanLRBulan,
} from '@/lib/actions/keuangan/laporan-lr.actions';

// ─── HELPERS ────────────────────────────────────────────────────────────────

const idr = (n: number) =>
  (n < 0 ? '- ' : '') + 'Rp ' + Math.abs(n).toLocaleString('id-ID');

const pct = (n: number) =>
  (n >= 0 ? '+' : '') + n.toFixed(1) + '%';

function StatusBadge({ val }: { val: number }) {
  if (val > 0) return <span className="text-xs font-bold text-green-400">▲ UNTUNG</span>;
  if (val < 0) return <span className="text-xs font-bold text-red-400">▼ RUGI</span>;
  return <span className="text-xs font-bold text-[#9aa0a6]">— BEP</span>;
}

function MiniBar({ val, max }: { val: number; max: number }) {
  const p = max > 0 ? Math.min(Math.abs(val) / max * 100, 100) : 0;
  return (
    <div className="w-full h-1.5 bg-[#2A2D31] rounded-full overflow-hidden">
      <div
        className={`h-full rounded-full ${val >= 0 ? 'bg-green-500' : 'bg-red-500'}`}
        style={{ width: `${p}%` }}
      />
    </div>
  );
}

// ─── EXPENSE CONFIG — getter functions agar type-safe ───────────────────────

interface ExpenseRow {
  label    : string;
  desc     : string;
  color    : string;
  getTotal : (d: LaporanLRData)   => number;
  getVal   : (b: LaporanLRBulan)  => number;
}

const EXPENSE_ROWS: ExpenseRow[] = [
  {
    label    : 'Pembelian Bahan',
    desc     : 'kain, aksesori',
    color    : 'text-blue-300',
    getTotal : (d) => d.total_pembelian_bahan,
    getVal   : (b) => b.pembelian_bahan,
  },
  {
    label    : 'Pembayaran Gaji',
    desc     : 'upah karyawan',
    color    : 'text-purple-300',
    getTotal : (d) => d.total_pembayaran_gaji,
    getVal   : (b) => b.pembayaran_gaji,
  },
  {
    label    : 'Biaya Overhead',
    desc     : 'makan, galon, gas, listrik, dll',
    color    : 'text-orange-300',
    getTotal : (d) => d.total_biaya_overhead,
    getVal   : (b) => b.biaya_overhead,
  },
  {
    label    : 'Biaya Operasional',
    desc     : 'ongkir, service motor/mesin, dll',
    color    : 'text-yellow-300',
    getTotal : (d) => d.total_biaya_operasional,
    getVal   : (b) => b.biaya_operasional,
  },
  {
    label    : 'Lainnya',
    desc     : 'pengeluaran lain-lain',
    color    : 'text-[#9aa0a6]',
    getTotal : (d) => d.total_biaya_lainnya,
    getVal   : (b) => b.biaya_lainnya,
  },
];

// ─── MAIN ───────────────────────────────────────────────────────────────────

interface Props {
  initialData : LaporanLRData;
  initialTahun: number;
}

export default function LaporanLRClient({ initialData, initialTahun }: Props) {
  const [data,    setData]   = useState<LaporanLRData>(initialData);
  const [tahun,   setTahun]  = useState(initialTahun);
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

  // ─── RENDER ───────────────────────────────────────────────────────────────
  return (
    <div className="p-6 space-y-6 text-white">

      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Laporan Laba Rugi</h1>
          <p className="text-[#9aa0a6] text-sm mt-0.5">
            Kas masuk vs semua pengeluaran — rincian per kategori
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

      {/* ── Panel P&L Ringkasan ── */}
      <div className="bg-[#1E2124] border border-[#2A2D31] rounded-xl overflow-hidden">

        {/* Baris Pendapatan */}
        <div className="px-6 py-5 border-b border-[#2A2D31] flex items-center justify-between">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-[#9aa0a6] mb-1">
              Total Pendapatan {tahun}
            </p>
            <p className="text-2xl font-bold text-green-400">
              {idr(data.total_pendapatan)}
            </p>
            <p className="text-[10px] text-[#5f6368] mt-0.5">dari pembayaran invoice klien</p>
          </div>
          <TrendingUp className="w-10 h-10 text-green-400/20" />
        </div>

        {/* Subheader Pengeluaran */}
        <div className="px-6 py-2.5 bg-[#16181A]">
          <p className="text-[10px] font-bold uppercase tracking-widest text-[#5f6368]">
            Rincian Pengeluaran
          </p>
        </div>

        {/* Baris per Kategori */}
        {EXPENSE_ROWS.map((row) => {
          const val = row.getTotal(data);
          if (val === 0) return null;
          const porsi = data.total_pendapatan > 0
            ? (val / data.total_pendapatan * 100).toFixed(1)
            : '0.0';
          return (
            <div
              key={row.label}
              className="px-6 py-3 border-b border-[#2A2D31]/50 flex items-center justify-between hover:bg-[#1A1C1E]/50 transition-colors"
            >
              <div>
                <p className={`text-sm font-semibold ${row.color}`}>{row.label}</p>
                <p className="text-[10px] text-[#5f6368]">{row.desc}</p>
              </div>
              <div className="text-right">
                <p className={`text-sm font-semibold ${row.color}`}>
                  − {idr(val)}
                </p>
                <p className="text-[10px] text-[#5f6368]">{porsi}% dari pendapatan</p>
              </div>
            </div>
          );
        })}

        {/* Baris Total Pengeluaran */}
        <div className="px-6 py-3 bg-[#16181A] border-t border-[#3A3D41] flex items-center justify-between">
          <p className="text-sm font-bold text-[#9aa0a6] uppercase tracking-wider">
            Total Pengeluaran
          </p>
          <p className="text-sm font-bold text-red-400">
            − {idr(data.total_pengeluaran)}
          </p>
        </div>

        {/* Baris Laba Bersih */}
        <div className={`px-6 py-5 flex items-center justify-between ${
          data.total_laba_bersih >= 0 ? 'bg-green-500/10' : 'bg-red-500/10'
        }`}>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-[#9aa0a6] mb-1">
              Laba Bersih {tahun}
            </p>
            <p className={`text-2xl font-bold ${
              data.total_laba_bersih >= 0 ? 'text-green-400' : 'text-red-400'
            }`}>
              {idr(data.total_laba_bersih)}
            </p>
          </div>
          <div className="text-right space-y-1">
            <div><StatusBadge val={data.total_laba_bersih} /></div>
            <p className={`text-xl font-bold ${
              data.margin_pct >= 0 ? 'text-green-400' : 'text-red-400'
            }`}>
              {pct(data.margin_pct)}
            </p>
            <p className="text-[10px] text-[#9aa0a6]">margin</p>
          </div>
        </div>
      </div>

      {/* ── Tabel per Bulan ── */}
      <div className="bg-[#1E2124] border border-[#2A2D31] rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-[#2A2D31]">
          <h2 className="text-sm font-bold">Breakdown per Bulan — {tahun}</h2>
          <p className="text-[10px] text-[#5f6368] mt-0.5">Scroll kanan untuk lihat semua kolom</p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[960px]">
            <thead>
              <tr className="border-b border-[#2A2D31] text-[10px] uppercase tracking-wider">
                <th className="text-left px-4 py-3 text-[#9aa0a6] w-20">Bulan</th>
                <th className="text-right px-3 py-3 text-green-400">Pendapatan</th>
                <th className="text-right px-3 py-3 text-blue-300">Bahan</th>
                <th className="text-right px-3 py-3 text-purple-300">Gaji</th>
                <th className="text-right px-3 py-3 text-orange-300">Overhead</th>
                <th className="text-right px-3 py-3 text-yellow-300">Operasional</th>
                <th className="text-right px-3 py-3 text-[#9aa0a6]">Lainnya</th>
                <th className="text-right px-3 py-3 text-red-400">Total Keluar</th>
                <th className="text-right px-3 py-3 text-[#e8eaed]">Laba Bersih</th>
                <th className="text-right px-3 py-3 text-[#9aa0a6]">Margin</th>
                <th className="px-3 py-3 w-20 text-[#9aa0a6]">Trend</th>
                <th className="px-3 py-3 text-[#9aa0a6]">Status</th>
              </tr>
            </thead>
            <tbody>
              {data.bulan_list.map((b) => {
                const ada = b.pendapatan > 0 || b.total_pengeluaran > 0;
                return (
                  <tr
                    key={b.bulan}
                    className={`border-b border-[#2A2D31] transition-colors ${
                      !ada
                        ? 'opacity-30'
                        : b.laba_bersih >= 0
                        ? 'hover:bg-green-500/5'
                        : 'hover:bg-red-500/5'
                    }`}
                  >
                    <td className="px-4 py-2.5 font-medium text-[#e8eaed]">{b.label}</td>

                    <td className="px-3 py-2.5 text-right font-mono text-xs text-green-400">
                      {ada ? idr(b.pendapatan) : '—'}
                    </td>

                    {EXPENSE_ROWS.map((row) => {
                      const val = row.getVal(b);
                      return (
                        <td key={row.label} className={`px-3 py-2.5 text-right font-mono text-xs ${row.color}`}>
                          {val > 0 ? idr(val) : <span className="text-[#3a3d41]">-</span>}
                        </td>
                      );
                    })}

                    <td className="px-3 py-2.5 text-right font-mono text-xs font-semibold text-red-400">
                      {ada ? idr(b.total_pengeluaran) : '-'}
                    </td>

                    <td className={`px-3 py-2.5 text-right font-bold font-mono text-xs ${
                      b.laba_bersih >= 0 ? 'text-green-400' : 'text-red-400'
                    }`}>
                      {ada ? idr(b.laba_bersih) : '-'}
                    </td>

                    <td className={`px-3 py-2.5 text-right text-xs font-bold ${
                      b.margin_pct >= 0 ? 'text-green-400' : 'text-red-400'
                    }`}>
                      {ada ? pct(b.margin_pct) : '-'}
                    </td>

                    <td className="px-3 py-2.5 w-20">
                      {ada && <MiniBar val={b.laba_bersih} max={maxLaba} />}
                    </td>

                    <td className="px-3 py-2.5">
                      {ada && <StatusBadge val={b.laba_bersih} />}
                    </td>
                  </tr>
                );
              })}
            </tbody>

            <tfoot>
              <tr className="bg-[#16181A] border-t-2 border-[#3A3D41] font-bold text-xs">
                <td className="px-4 py-3 text-[11px] uppercase tracking-wider text-[#9aa0a6]">
                  TOTAL {tahun}
                </td>
                <td className="px-3 py-3 text-right font-mono text-green-400">
                  {idr(data.total_pendapatan)}
                </td>
                <td className="px-3 py-3 text-right font-mono text-blue-300">
                  {idr(data.total_pembelian_bahan)}
                </td>
                <td className="px-3 py-3 text-right font-mono text-purple-300">
                  {idr(data.total_pembayaran_gaji)}
                </td>
                <td className="px-3 py-3 text-right font-mono text-orange-300">
                  {idr(data.total_biaya_overhead)}
                </td>
                <td className="px-3 py-3 text-right font-mono text-yellow-300">
                  {idr(data.total_biaya_operasional)}
                </td>
                <td className="px-3 py-3 text-right font-mono text-[#9aa0a6]">
                  {idr(data.total_biaya_lainnya)}
                </td>
                <td className="px-3 py-3 text-right font-mono text-red-400">
                  {idr(data.total_pengeluaran)}
                </td>
                <td className={`px-3 py-3 text-right font-mono text-base ${
                  data.total_laba_bersih >= 0 ? 'text-green-400' : 'text-red-400'
                }`}>
                  {idr(data.total_laba_bersih)}
                </td>
                <td className={`px-3 py-3 text-right font-mono ${
                  data.margin_pct >= 0 ? 'text-green-400' : 'text-red-400'
                }`}>
                  {pct(data.margin_pct)}
                </td>
                <td className="px-3 py-3" colSpan={2}>
                  <StatusBadge val={data.total_laba_bersih} />
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* Catatan Metodologi */}
      <div className="bg-[#1A1C1E] border border-[#2A2D31] rounded-xl p-4 text-[11px] text-[#9aa0a6] space-y-1.5">
        <p className="font-bold text-white mb-2">Metodologi Perhitungan</p>
        <p><span className="text-green-400 font-semibold">Pendapatan</span>{' '}= pembayaran invoice yang diterima dari klien (berdasarkan tanggal bayar)</p>
        <p><span className="text-blue-300 font-semibold">Pembelian Bahan</span>{' '}= kas keluar untuk beli kain dan aksesori</p>
        <p><span className="text-purple-300 font-semibold">Pembayaran Gaji</span>{' '}= kas keluar untuk upah karyawan</p>
        <p><span className="text-orange-300 font-semibold">Biaya Overhead</span>{' '}= uang makan, galon, gas, listrik, internet, sampah</p>
        <p><span className="text-yellow-300 font-semibold">Biaya Operasional</span>{' '}= ongkos kirim, service motor/mesin, biaya sampel, dll</p>
        <p className="pt-1 border-t border-[#2A2D31]">
          <span className="text-white font-semibold">Laba Bersih</span>{' '}= Pendapatan - (Bahan + Gaji + Overhead + Operasional + Lainnya)
        </p>
      </div>

    </div>
  );
}
