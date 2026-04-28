'use client';

import React, { useState, useTransition } from 'react';
import Link from 'next/link';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from 'recharts';
import {
  ClipboardList,
  CheckCircle2,
  AlertTriangle,
  Layers,
  Wallet,
  TrendingDown,
  CreditCard,
  Package,
  ArrowUpRight,
  Loader2,
  CalendarDays,
} from 'lucide-react';

import { getDashboardKPI, type DashboardKPI } from '@/lib/actions/dashboard/dashboard.actions';

// ─── Constants ───────────────────────────────────────────────────────────────

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

const PIPELINE_COLORS = [
  '#e5c17b', '#60a5fa', '#34d399', '#f87171',
  '#a78bfa', '#fb923c', '#94a3b8', '#475569',
];

const PIPELINE_LABEL_MAP: Record<string, string> = {
  packing       : 'Packing',
  steam         : 'Steam',
  qc            : 'QC',
  lubang_kancing: 'Lubang Kancing',
  buang_benang  : 'Buang Benang',
  jahit         : 'Jahit',
  cutting       : 'Cutting',
  belum_mulai   : 'Belum Mulai',
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatRupiah(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)} jt`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(0)} rb`;
  return String(n);
}

function formatRupiahFull(n: number): string {
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(n);
}

// ─── Sub-components ───────────────────────────────────────────────────────────

interface KpiCardProps {
  title   : string;
  nilai   : React.ReactNode;
  subtext : React.ReactNode;
  icon    : React.ReactNode;
  link    : string;
  accent ?: 'red' | 'orange';
}

function KpiCard({ title, nilai, subtext, icon, link, accent }: KpiCardProps) {
  const accentColor =
    accent === 'red'    ? '#f87171' :
    accent === 'orange' ? '#fb923c' :
    '#e5c17b';

  return (
    <Link
      href={link}
      className="group relative flex flex-col gap-3 rounded-2xl p-5 transition-all duration-200"
      style={{
        background  : '#16181A',
        border      : '1px solid #2A2D31',
      }}
    >
      {/* Hover border overlay */}
      <span
        className="pointer-events-none absolute inset-0 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-200"
        style={{ border: `1px solid ${accentColor}`, borderRadius: 'inherit' }}
      />

      {/* Header */}
      <div className="flex items-center justify-between">
        <div
          className="flex h-9 w-9 items-center justify-center rounded-xl"
          style={{
            background: accent === 'red'
              ? 'rgba(248,113,113,0.12)'
              : accent === 'orange'
              ? 'rgba(251,146,60,0.12)'
              : 'rgba(229,193,123,0.12)',
            border: accent === 'red'
              ? '1px solid rgba(248,113,113,0.2)'
              : accent === 'orange'
              ? '1px solid rgba(251,146,60,0.2)'
              : '1px solid rgba(229,193,123,0.2)',
          }}
        >
          <span style={{ color: accentColor }}>{icon}</span>
        </div>
        <ArrowUpRight
          className="w-4 h-4 opacity-0 group-hover:opacity-100 transition-opacity duration-200"
          style={{ color: accentColor }}
        />
      </div>

      {/* Value */}
      <div>
        <p
          className="text-[26px] font-bold leading-none tracking-tight"
          style={{ color: accent ? accentColor : '#e8eaed' }}
        >
          {nilai}
        </p>
        <p className="text-[12px] text-[#9aa0a6] mt-1.5">{title}</p>
      </div>

      {/* Subtext */}
      <p className="text-[11px] text-[#9aa0a6] border-t border-[#2A2D31] pt-2.5 mt-auto">
        {subtext}
      </p>
    </Link>
  );
}

// Custom Tooltip for BarChart
function BarTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div
      className="rounded-xl px-3 py-2 text-[12px]"
      style={{ background: '#16181A', border: '1px solid #2A2D31' }}
    >
      <p className="text-[#9aa0a6] mb-0.5">{label}</p>
      <p className="font-bold text-[#e5c17b]">{payload[0].value} unit</p>
    </div>
  );
}

// Custom Tooltip for PieChart
function PieTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div
      className="rounded-xl px-3 py-2 text-[12px]"
      style={{ background: '#16181A', border: '1px solid #2A2D31' }}
    >
      <p className="text-[#9aa0a6] mb-0.5">{PIPELINE_LABEL_MAP[payload[0].name] ?? payload[0].name}</p>
      <p className="font-bold" style={{ color: payload[0].payload.fill }}>{payload[0].value} bundle</p>
    </div>
  );
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  initialData       : DashboardKPI;
  initialBulanDari  : string;
  initialTahunDari  : string;
  initialBulanSampai: string;
  initialTahunSampai: string;
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function DashboardClient({
  initialData,
  initialBulanDari,
  initialTahunDari,
  initialBulanSampai,
  initialTahunSampai,
}: Props) {
  const [data,  setData]  = useState<DashboardKPI>(initialData);
  const [bulanDari,   setBulanDari]   = useState(initialBulanDari);
  const [tahunDari,   setTahunDari]   = useState(initialTahunDari);
  const [bulanSampai, setBulanSampai] = useState(initialBulanSampai);
  const [tahunSampai, setTahunSampai] = useState(initialTahunSampai);
  const [isPending, startTransition] = useTransition();

  // ── Filter apply ────────────────────────────────────────────────────────────
  const handleTerapkan = () => {
    startTransition(async () => {
      try {
        const fresh = await getDashboardKPI(bulanDari, tahunDari, bulanSampai, tahunSampai);
        setData(fresh);
      } catch (err) {
        console.error('Dashboard refresh error:', err);
      }
    });
  };

  // ── Chart data transforms ───────────────────────────────────────────────────
  const pipelineChartData = data.chart_pipeline.map((d) => ({
    ...d,
    name : d.tahap,
    label: PIPELINE_LABEL_MAP[d.tahap] ?? d.tahap,
  }));

  // ── KPI Cards definition ────────────────────────────────────────────────────
  const kpiCards: KpiCardProps[] = [
    // ── Baris 1: Produksi ──────────────────────────────────────────────────
    {
      title  : 'PO Aktif',
      nilai  : data.po_aktif,
      subtext: 'Draft & Aktif',
      icon   : <ClipboardList className="w-4 h-4" />,
      link   : '/app/produksi/po',
    },
    {
      title  : 'Bundle Selesai',
      nilai  : data.bundle_selesai_bulan_ini,
      subtext: 'Bulan ini',
      icon   : <CheckCircle2 className="w-4 h-4" />,
      link   : '/app/produksi/monitoring',
    },
    {
      title  : 'Reject Bulan Ini',
      nilai  : data.reject_bulan_ini,
      subtext: 'Item reject',
      icon   : <AlertTriangle className="w-4 h-4" />,
      link   : '/app/keuangan/laporan-reject',
      accent : data.reject_bulan_ini > 0 ? 'red' : undefined,
    },
    {
      title  : 'Bundle Berjalan',
      nilai  : data.bundle_berjalan,
      subtext: 'Sedang proses',
      icon   : <Layers className="w-4 h-4" />,
      link   : '/app/produksi/monitoring',
    },

    // ── Baris 2: Keuangan ──────────────────────────────────────────────────
    {
      title  : 'Gaji Belum Dibayar',
      nilai  : `Rp ${formatRupiah(data.gaji_belum_bayar_nominal)}`,
      subtext: `${data.gaji_belum_bayar_karyawan} karyawan`,
      icon   : <Wallet className="w-4 h-4" />,
      link   : '/app/penggajian/rekap-gaji',
      accent : data.gaji_belum_bayar_nominal > 0 ? 'orange' : undefined,
    },
    {
      title  : 'Kasbon Outstanding',
      nilai  : `Rp ${formatRupiah(data.kasbon_outstanding)}`,
      subtext: 'Belum lunas',
      icon   : <TrendingDown className="w-4 h-4" />,
      link   : '/app/penggajian/kasbon',
    },
    {
      title  : 'Total Bayar Gaji',
      nilai  : `Rp ${formatRupiah(data.total_bayar_gaji_bulan_ini)}`,
      subtext: 'Bulan ini',
      icon   : <CreditCard className="w-4 h-4" />,
      link   : '/app/keuangan/laporan-gaji',
    },
    {
      title  : 'Inventory Kritis',
      nilai  : `${data.inventory_kritis} item`,
      subtext: 'Stok di bawah minimum',
      icon   : <Package className="w-4 h-4" />,
      link   : '/app/inventory/alert-order',
      accent : data.inventory_kritis > 0 ? 'red' : undefined,
    },
  ];

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
          id="filter-bulan-dari"
          value={bulanDari}
          onChange={(e) => setBulanDari(e.target.value)}
          className="h-9 rounded-lg px-3 text-[13px] text-[#e8eaed] outline-none cursor-pointer transition-colors"
          style={{
            background  : '#0D0E10',
            border      : '1px solid #2A2D31',
            appearance  : 'none',
            paddingRight : '2rem',
          }}
        >
          {BULAN_OPTIONS.map((b) => (
            <option key={b.value} value={b.value}>{b.label}</option>
          ))}
        </select>

        {/* Input Tahun Dari */}
        <input
          id="filter-tahun-dari"
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
          id="filter-bulan-sampai"
          value={bulanSampai}
          onChange={(e) => setBulanSampai(e.target.value)}
          className="h-9 rounded-lg px-3 text-[13px] text-[#e8eaed] outline-none cursor-pointer transition-colors"
          style={{
            background  : '#0D0E10',
            border      : '1px solid #2A2D31',
            appearance  : 'none',
            paddingRight : '2rem',
          }}
        >
          {BULAN_OPTIONS.map((b) => (
            <option key={b.value} value={b.value}>{b.label}</option>
          ))}
        </select>

        {/* Input Tahun Sampai */}
        <input
          id="filter-tahun-sampai"
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
          id="filter-terapkan"
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

      {/* ━━━ BAGIAN 2: 8 KPI CARDS ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <div className="grid grid-cols-4 gap-4">
        {kpiCards.map((card, i) => (
          <KpiCard key={i} {...card} />
        ))}
      </div>

      {/* ━━━ BAGIAN 3: CHARTS (60 / 40) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <div className="grid grid-cols-5 gap-4">

        {/* ── Chart Kiri: Bar Chart Output Mingguan (3/5 = 60%) ── */}
        <div
          className="col-span-3 rounded-2xl p-5"
          style={{ background: '#16181A', border: '1px solid #2A2D31' }}
        >
          <div className="mb-5">
            <h3 className="text-[14px] font-bold text-[#e8eaed]">Output Produksi per Minggu</h3>
            <p className="text-[11px] text-[#9aa0a6] mt-0.5">
              Berdasarkan scan selesai —{' '}
              {BULAN_OPTIONS.find((b) => b.value === bulanDari)?.label} {tahunDari} s/d {BULAN_OPTIONS.find((b) => b.value === bulanSampai)?.label} {tahunSampai}
            </p>
          </div>

          {data.chart_output_mingguan.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-52 gap-2">
              <BarChart2Placeholder />
              <p className="text-sm text-[#9aa0a6]">Tidak ada data output bulan ini</p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart
                data={data.chart_output_mingguan}
                barCategoryGap="30%"
                margin={{ top: 0, right: 8, left: -16, bottom: 0 }}
              >
                <XAxis
                  dataKey="label"
                  tick={{ fill: '#9aa0a6', fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fill: '#9aa0a6', fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  allowDecimals={false}
                />
                <Tooltip content={<BarTooltip />} cursor={{ fill: 'rgba(229,193,123,0.06)' }} />
                <Bar
                  dataKey="jumlah"
                  fill="#e5c17b"
                  radius={[6, 6, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* ── Chart Kanan: Donut Pipeline (2/5 = 40%) ── */}
        <div
          className="col-span-2 rounded-2xl p-5"
          style={{ background: '#16181A', border: '1px solid #2A2D31' }}
        >
          <div className="mb-4">
            <h3 className="text-[14px] font-bold text-[#e8eaed]">Pipeline Bundle Saat Ini</h3>
            <p className="text-[11px] text-[#9aa0a6] mt-0.5">
              Snapshot real-time — tidak ikut filter periode
            </p>
          </div>

          {data.chart_pipeline.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-52 gap-2">
              <p className="text-sm text-[#9aa0a6]">Tidak ada data bundle</p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie
                  data={pipelineChartData}
                  dataKey="jumlah"
                  nameKey="name"
                  cx="50%"
                  cy="45%"
                  innerRadius={55}
                  outerRadius={85}
                  paddingAngle={3}
                  strokeWidth={0}
                >
                  {pipelineChartData.map((_, index) => (
                    <Cell
                      key={index}
                      fill={PIPELINE_COLORS[index % PIPELINE_COLORS.length]}
                    />
                  ))}
                </Pie>
                <Tooltip content={<PieTooltip />} />
                <Legend
                  iconType="circle"
                  iconSize={7}
                  formatter={(value) => (
                    <span style={{ color: '#9aa0a6', fontSize: 11 }}>
                      {PIPELINE_LABEL_MAP[value] ?? value}
                    </span>
                  )}
                />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>

      </div>
    </div>
  );
}

// ─── Placeholder SVG untuk chart kosong ──────────────────────────────────────
function BarChart2Placeholder() {
  return (
    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#2A2D31" strokeWidth={1.5}>
      <rect x="3" y="12" width="4" height="9" rx="1" />
      <rect x="10" y="7"  width="4" height="14" rx="1" />
      <rect x="17" y="3"  width="4" height="18" rx="1" />
    </svg>
  );
}
