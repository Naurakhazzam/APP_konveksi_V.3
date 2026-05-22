'use client';

import React, { useState, useTransition } from 'react';
import { getPemakaianBahan, type PemakaianBahanSummary, type PemakaianBahanRow } from '@/lib/actions/inventory/pemakaian-bahan.actions';
import { Package, Wallet, Layers, CalendarDays, Loader2 } from 'lucide-react';

// ─── Constants & Helpers ─────────────────────────────────────────────────────

const BULAN_OPTIONS = [
  { value: '1',  label: 'Januari' },
  { value: '2',  label: 'Februari' },
  { value: '3',  label: 'Maret' },
  { value: '4',  label: 'April' },
  { value: '5',  label: 'Mei' },
  { value: '6',  label: 'Juni' },
  { value: '7',  label: 'Juli' },
  { value: '8',  label: 'Agustus' },
  { value: '9',  label: 'September' },
  { value: '10', label: 'Oktober' },
  { value: '11', label: 'November' },
  { value: '12', label: 'Desember' },
];

function formatRupiah(n: number): string {
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(n);
}

function formatDate(isoString: string): string {
  const d = new Date(isoString);
  return d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  initialData       : PemakaianBahanSummary;
  initialBulanDari  : string;
  initialTahunDari  : string;
  initialBulanSampai: string;
  initialTahunSampai: string;
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function PemakaianBahanClient({
  initialData,
  initialBulanDari,
  initialTahunDari,
  initialBulanSampai,
  initialTahunSampai,
}: Props) {
  const [data, setData] = useState<PemakaianBahanSummary>(initialData);
  const [bulanDari, setBulanDari] = useState(initialBulanDari);
  const [tahunDari, setTahunDari] = useState(initialTahunDari);
  const [bulanSampai, setBulanSampai] = useState(initialBulanSampai);
  const [tahunSampai, setTahunSampai] = useState(initialTahunSampai);
  const [isPending, startTransition] = useTransition();

  // ── Filter apply ────────────────────────────────────────────────────────────
  const handleTerapkan = () => {
    startTransition(async () => {
      try {
        const fresh = await getPemakaianBahan(bulanDari, tahunDari, bulanSampai, tahunSampai);
        setData(fresh);
      } catch (err) {
        console.error('Refresh error:', err);
      }
    });
  };

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-6">

      {/* ━━━ BAGIAN 1: FILTER BAR ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <div
        className="flex flex-wrap items-center gap-3 rounded-2xl px-5 py-4"
        style={{ background: '#16181A', border: '1px solid #2A2D31' }}
      >
        <div className="flex items-center gap-2 mr-1">
          <CalendarDays className="w-4 h-4 text-[#e5c17b]" />
          <span className="text-[13px] font-semibold text-[#e8eaed]">Periode</span>
        </div>

        <span className="text-[13px] text-[#9aa0a6] mr-1">Dari</span>
        
        {/* Dropdown Bulan Dari */}
        <select
          value={bulanDari}
          onChange={(e) => setBulanDari(e.target.value)}
          className="h-9 rounded-lg px-3 text-[13px] text-[#e8eaed] outline-none cursor-pointer transition-colors"
          style={{
            background  : '#0D0E10',
            border      : '1px solid #2A2D31',
            appearance  : 'none',
            paddingRight: '2rem',
          }}
        >
          {BULAN_OPTIONS.map((b) => (
            <option key={b.value} value={b.value}>{b.label}</option>
          ))}
        </select>

        {/* Input Tahun Dari */}
        <input
          type="number"
          min={2020}
          max={2099}
          value={tahunDari}
          onChange={(e) => setTahunDari(e.target.value)}
          className="h-9 w-20 rounded-lg px-3 text-[13px] text-[#e8eaed] outline-none transition-colors"
          style={{ background: '#0D0E10', border: '1px solid #2A2D31' }}
        />

        <span className="text-[13px] text-[#9aa0a6] mx-1">→</span>

        {/* Dropdown Bulan Sampai */}
        <select
          value={bulanSampai}
          onChange={(e) => setBulanSampai(e.target.value)}
          className="h-9 rounded-lg px-3 text-[13px] text-[#e8eaed] outline-none cursor-pointer transition-colors"
          style={{
            background  : '#0D0E10',
            border      : '1px solid #2A2D31',
            appearance  : 'none',
            paddingRight: '2rem',
          }}
        >
          {BULAN_OPTIONS.map((b) => (
            <option key={b.value} value={b.value}>{b.label}</option>
          ))}
        </select>

        {/* Input Tahun Sampai */}
        <input
          type="number"
          min={2020}
          max={2099}
          value={tahunSampai}
          onChange={(e) => setTahunSampai(e.target.value)}
          className="h-9 w-20 rounded-lg px-3 text-[13px] text-[#e8eaed] outline-none transition-colors"
          style={{ background: '#0D0E10', border: '1px solid #2A2D31' }}
        />

        {/* Tombol Terapkan */}
        <button
          onClick={handleTerapkan}
          disabled={isPending}
          className="flex items-center gap-2 h-9 px-5 rounded-lg text-[13px] font-bold transition-all disabled:opacity-60 disabled:cursor-not-allowed ml-2"
          style={{ background: '#e5c17b', color: '#0D0E10' }}
        >
          {isPending ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Memuat...
            </>
          ) : (
            'Terapkan'
          )}
        </button>

        {/* Active period label */}
        <span className="ml-auto text-[11px] text-[#9aa0a6]">
          Menampilkan:{' '}
          <span className="text-[#e5c17b] font-semibold">
            {BULAN_OPTIONS.find((b) => b.value === bulanDari)?.label} {tahunDari} → {BULAN_OPTIONS.find((b) => b.value === bulanSampai)?.label} {tahunSampai}
          </span>
        </span>
      </div>

      {/* ━━━ BAGIAN 2: 3 KPI CARDS ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Card 1: Total Pemakaian */}
        <div
          className="flex flex-col gap-3 rounded-2xl p-5"
          style={{ background: '#16181A', border: '1px solid #2A2D31' }}
        >
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[rgba(229,193,123,0.12)] border border-[rgba(229,193,123,0.2)]">
            <Package className="w-4 h-4 text-[#e5c17b]" />
          </div>
          <div>
            <p className="text-[26px] font-bold leading-none tracking-tight text-[#e8eaed]">
              {data.total_qty.toLocaleString('id-ID')} <span className="text-sm font-medium text-[#9aa0a6]">unit</span>
            </p>
            <p className="text-[12px] text-[#9aa0a6] mt-1.5">Total Pemakaian</p>
          </div>
          <p className="text-[11px] text-[#9aa0a6] border-t border-[#2A2D31] pt-2.5 mt-auto">
            Total qty bahan terpakai
          </p>
        </div>

        {/* Card 2: Estimasi Biaya Bahan */}
        <div
          className="flex flex-col gap-3 rounded-2xl p-5"
          style={{ background: '#16181A', border: '1px solid #2A2D31' }}
        >
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[rgba(229,193,123,0.12)] border border-[rgba(229,193,123,0.2)]">
            <Wallet className="w-4 h-4 text-[#e5c17b]" />
          </div>
          <div>
            <p className="text-[26px] font-bold leading-none tracking-tight text-[#e8eaed]">
              {formatRupiah(data.total_biaya)}
            </p>
            <p className="text-[12px] text-[#9aa0a6] mt-1.5">Estimasi Biaya Bahan</p>
          </div>
          <p className="text-[11px] text-[#9aa0a6] border-t border-[#2A2D31] pt-2.5 mt-auto">
            Berdasarkan harga referensi bahan
          </p>
        </div>

        {/* Card 3: Jenis Bahan */}
        <div
          className="flex flex-col gap-3 rounded-2xl p-5"
          style={{ background: '#16181A', border: '1px solid #2A2D31' }}
        >
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[rgba(229,193,123,0.12)] border border-[rgba(229,193,123,0.2)]">
            <Layers className="w-4 h-4 text-[#e5c17b]" />
          </div>
          <div>
            <p className="text-[26px] font-bold leading-none tracking-tight text-[#e8eaed]">
              {data.jumlah_bahan.toLocaleString('id-ID')} <span className="text-sm font-medium text-[#9aa0a6]">item</span>
            </p>
            <p className="text-[12px] text-[#9aa0a6] mt-1.5">Jenis Bahan</p>
          </div>
          <p className="text-[11px] text-[#9aa0a6] border-t border-[#2A2D31] pt-2.5 mt-auto">
            Bahan berbeda digunakan
          </p>
        </div>
      </div>

      {/* ━━━ BAGIAN 3: TABEL ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <div
        className="rounded-2xl overflow-hidden"
        style={{ background: '#16181A', border: '1px solid #2A2D31' }}
      >
        <div className="px-5 py-4 border-b border-[#2A2D31]">
          <h3 className="text-[14px] font-bold text-[#e8eaed]">Rincian Pemakaian Bahan</h3>
        </div>

        {data.rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
            <Package className="w-8 h-8 text-[#2A2D31]" />
            <p className="text-sm text-[#9aa0a6]">Belum ada data pemakaian bahan untuk periode ini.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-[#0D0E10] border-b border-[#2A2D31]">
                  <th className="px-5 py-3 text-[11px] font-semibold text-[#9aa0a6] uppercase tracking-wider">Tanggal</th>
                  <th className="px-5 py-3 text-[11px] font-semibold text-[#9aa0a6] uppercase tracking-wider">PO</th>
                  <th className="px-5 py-3 text-[11px] font-semibold text-[#9aa0a6] uppercase tracking-wider">Warna</th>
                  <th className="px-5 py-3 text-[11px] font-semibold text-[#9aa0a6] uppercase tracking-wider">Size</th>
                  <th className="px-5 py-3 text-[11px] font-semibold text-[#9aa0a6] uppercase tracking-wider">Nama Bahan</th>
                  <th className="px-5 py-3 text-[11px] font-semibold text-[#9aa0a6] uppercase tracking-wider">Qty Pakai</th>
                  <th className="px-5 py-3 text-[11px] font-semibold text-[#9aa0a6] uppercase tracking-wider">Satuan</th>
                  <th className="px-5 py-3 text-[11px] font-semibold text-[#9aa0a6] uppercase tracking-wider text-right">Harga/Unit</th>
                  <th className="px-5 py-3 text-[11px] font-semibold text-[#9aa0a6] uppercase tracking-wider text-right">Total Biaya</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row: PemakaianBahanRow) => (
                  <tr
                    key={row.id}
                    className="border-b border-[#2A2D31] hover:bg-[#1A1D1F] transition-colors"
                  >
                    <td className="px-5 py-3 text-[13px] text-[#e8eaed] whitespace-nowrap">
                      {formatDate(row.tanggal)}
                    </td>
                    <td className="px-5 py-3 text-[13px] font-medium text-[#e5c17b] whitespace-nowrap">
                      {row.no_po}
                    </td>
                    <td className="px-5 py-3 text-[13px] text-[#9aa0a6] whitespace-nowrap">
                      {row.warna}
                    </td>
                    <td className="px-5 py-3 text-[13px] text-[#9aa0a6] whitespace-nowrap">
                      {row.size}
                    </td>
                    <td className="px-5 py-3 text-[13px] text-[#e8eaed] whitespace-nowrap">
                      {row.nama_bahan}
                    </td>
                    <td className="px-5 py-3 text-[13px] font-medium text-[#e8eaed] whitespace-nowrap">
                      {row.qty_pakai.toLocaleString('id-ID')}
                    </td>
                    <td className="px-5 py-3 text-[13px] text-[#9aa0a6] whitespace-nowrap">
                      {row.satuan}
                    </td>
                    <td className="px-5 py-3 text-[13px] text-[#9aa0a6] text-right whitespace-nowrap">
                      {row.harga_per_unit > 0 ? formatRupiah(row.harga_per_unit) : '—'}
                    </td>
                    <td className="px-5 py-3 text-[13px] font-medium text-[#e8eaed] text-right whitespace-nowrap">
                      {row.harga_per_unit > 0 ? formatRupiah(row.total_biaya) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

    </div>
  );
}
