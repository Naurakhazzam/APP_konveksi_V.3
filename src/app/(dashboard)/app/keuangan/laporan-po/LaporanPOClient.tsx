'use client';

import React, { useState } from 'react';
import { Loader2, Filter, TrendingUp, TrendingDown, Minus, Eye, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle
} from '@/components/ui/dialog';
import {
  getLaporanPOList,
  getPOHPPDetail,
  getPOHPPPerSize,
  type POLaporanItem,
  type POHPPDetail,
  type POHPPPerSizeRow,
} from '@/lib/actions/keuangan/laporan-po.actions';
import { type OverheadRateInfo } from '@/lib/actions/keuangan/overhead.actions';

// ─── CONSTANTS ──────────────────────────────────────────────────────────────

const BULAN = [
  'Januari','Februari','Maret','April','Mei','Juni',
  'Juli','Agustus','September','Oktober','November','Desember'
];

const idrFmt = (n: number) =>
  'Rp ' + Math.abs(n).toLocaleString('id-ID', { minimumFractionDigits: 0 });

const dateFmt = (d: string) =>
  new Date(d).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });

const labelCls = 'block text-[10px] font-bold text-[#9aa0a6] uppercase tracking-widest mb-1';

const STATUS_BADGE: Record<string, string> = {
  hemat:     'bg-green-500/15 text-green-400 border border-green-500/30',
  boncos:    'bg-red-500/15 text-red-400 border border-red-500/30',
  on_budget: 'bg-[#2A2D31] text-[#9aa0a6] border border-[#3A3D41]',
};

const STATUS_LABEL: Record<string, string> = {
  hemat:     'HEMAT',
  boncos:    'BONCOS',
  on_budget: 'ON BUDGET',
};

const ROW_BG: Record<string, string> = {
  hemat:     'bg-green-500/10 hover:bg-green-500/15',
  boncos:    'bg-red-500/10 hover:bg-red-500/15',
  on_budget: 'bg-[#16181A] hover:bg-[#1A1C1E]',
};

const JENIS_LABEL: Record<string, string> = {
  direct_bahan: 'Pembelian Bahan',
  direct_upah:  'Upah Produksi',
  overhead:     'Overhead',
  masuk:        'Pemasukan',
};

// ─── PROPS ──────────────────────────────────────────────────────────────────

interface Props {
  initialData: POLaporanItem[];
  overheadRateInfo: OverheadRateInfo;
}

// ─── COMPONENT ───────────────────────────────────────────────────────────────

export default function LaporanPOClient({ initialData, overheadRateInfo }: Props) {
  const [data, setData] = useState<POLaporanItem[]>(initialData);
  const [filterBulan, setFilterBulan] = useState('');
  const [filterTahun, setFilterTahun] = useState(String(new Date().getFullYear()));
  const [filtering, setFiltering] = useState(false);

  // ─── SORT STATE ────────────────────────────────────────────────────────
  const [sortConfig, setSortConfig] = useState<{ key: keyof POLaporanItem; direction: 'asc' | 'desc' } | null>(null);

  const sortedData = React.useMemo(() => {
    let sortableItems = [...data];
    if (sortConfig !== null) {
      sortableItems.sort((a, b) => {
        if (a[sortConfig.key] < b[sortConfig.key]) {
          return sortConfig.direction === 'asc' ? -1 : 1;
        }
        if (a[sortConfig.key] > b[sortConfig.key]) {
          return sortConfig.direction === 'asc' ? 1 : -1;
        }
        return 0;
      });
    }
    return sortableItems;
  }, [data, sortConfig]);

  const requestSort = (key: keyof POLaporanItem) => {
    let direction: 'asc' | 'desc' = 'asc';
    if (sortConfig && sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc';
    } else if (sortConfig && sortConfig.key === key && sortConfig.direction === 'desc') {
      setSortConfig(null);
      return;
    }
    setSortConfig({ key, direction });
  };

  const SortableHeader = ({ label, sortKey, align = 'left' }: { label: string, sortKey: keyof POLaporanItem, align?: 'left' | 'right' | 'center' }) => {
    const isActive = sortConfig?.key === sortKey;
    return (
      <TableHead 
        className={`cursor-pointer select-none group transition-colors ${
          isActive ? 'text-[#e8eaed]' : 'text-[#9aa0a6] hover:text-[#c0c6cc]'
        }`}
        onClick={() => requestSort(sortKey)}
      >
        <div className={`flex items-center gap-1 ${align === 'right' ? 'justify-end' : align === 'center' ? 'justify-center' : 'justify-start'}`}>
          {label}
          <span className={`text-[10px] font-mono ${isActive ? 'text-[#e5c17b]' : 'text-[#5f6368] group-hover:text-[#9aa0a6]'}`}>
            {isActive && sortConfig.direction === 'desc' ? '↓' : '↑'}
          </span>
        </div>
      </TableHead>
    );
  };

  // Detail modal state
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailData, setDetailData] = useState<POHPPDetail | null>(null);
  const [detailPO, setDetailPO] = useState<POLaporanItem | null>(null);
  const [activeTab, setActiveTab] = useState<'ringkasan' | 'aktual' | 'per_size'>('ringkasan');
  const [hppPerSizeData, setHppPerSizeData] = useState<POHPPPerSizeRow[]>([]);

  // ─── SUMMARY ───────────────────────────────────────────────────────────
  const totalEstimasi = data.reduce((s, p) => s + p.hpp_estimasi, 0);
  const totalAktual   = data.reduce((s, p) => s + p.hpp_aktual_final, 0);
  const totalGap      = data.reduce((s, p) => s + p.gap, 0);
  const totalProfit   = data.reduce((s, p) => s + p.profit_final, 0);
  const countBoncos   = data.filter(p => p.status === 'boncos').length;
  const countHemat    = data.filter(p => p.status === 'hemat').length;
  const countOnBudget = data.filter(p => p.status === 'on_budget').length;

  const summaryCards = [
    {
      label: 'Total HPP Estimasi',
      value: idrFmt(totalEstimasi),
      color: 'text-[#e8eaed]',
      icon: <Minus className="h-4 w-4 text-[#9aa0a6]" />
    },
    {
      label: 'Total HPP Aktual',
      value: idrFmt(totalAktual),
      color: totalAktual > totalEstimasi ? 'text-red-400' : 'text-green-400',
      icon: totalAktual > totalEstimasi
        ? <TrendingUp className="h-4 w-4 text-red-400" />
        : <TrendingDown className="h-4 w-4 text-green-400" />
    },
    {
      label: 'Total Gap',
      value: (totalGap > 0 ? '+' : '') + idrFmt(totalGap),
      color: totalGap > 0 ? 'text-red-400' : totalGap < 0 ? 'text-green-400' : 'text-[#9aa0a6]',
      icon: null
    },
    {
      label: 'Total Profit (incl. Overhead)',
      value: (totalProfit >= 0 ? '' : '-') + idrFmt(totalProfit),
      color: totalProfit > 0 ? 'text-green-400' : totalProfit < 0 ? 'text-red-400' : 'text-[#9aa0a6]',
      icon: totalProfit > 0
        ? <TrendingUp className="h-4 w-4 text-green-400" />
        : totalProfit < 0
          ? <TrendingDown className="h-4 w-4 text-red-400" />
          : null
    },
    {
      label: 'Distribusi Status',
      value: null,
      color: '',
      icon: null,
      custom: (
        <div className="flex gap-2 mt-1 flex-wrap">
          <span className="text-xs bg-red-500/15 text-red-400 border border-red-500/30 px-2 py-0.5 rounded-full font-bold">
            {countBoncos} Boncos
          </span>
          <span className="text-xs bg-[#2A2D31] text-[#9aa0a6] border border-[#3A3D41] px-2 py-0.5 rounded-full font-bold">
            {countOnBudget} On Budget
          </span>
          <span className="text-xs bg-green-500/15 text-green-400 border border-green-500/30 px-2 py-0.5 rounded-full font-bold">
            {countHemat} Hemat
          </span>
        </div>
      )
    },
  ];

  // ─── FILTER ────────────────────────────────────────────────────────────
  const handleFilter = async () => {
    setFiltering(true);
    try {
      const result = await getLaporanPOList({
        bulan: filterBulan || undefined,
        tahun: filterTahun || undefined,
      });
      setData(result);
    } catch (e: any) {
      toast.error(e.message || 'Gagal memuat data');
    } finally {
      setFiltering(false);
    }
  };

  // ─── DETAIL MODAL ──────────────────────────────────────────────────────
  const handleOpenDetail = async (po: POLaporanItem) => {
    setDetailPO(po);
    setDetailData(null);
    setHppPerSizeData([]);
    setActiveTab('ringkasan');
    setDetailOpen(true);
    setDetailLoading(true);
    try {
      const [result, sizeResult] = await Promise.all([
        getPOHPPDetail(po.po_id),
        getPOHPPPerSize(po.po_id),
      ]);
      setDetailData(result);
      setHppPerSizeData(sizeResult);
    } catch (e: any) {
      toast.error('Gagal memuat detail: ' + e.message);
      setDetailOpen(false);
    } finally {
      setDetailLoading(false);
    }
  };

  // ─── RENDER ────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">

      {/* Info Bar Overhead */}
      {overheadRateInfo.period ? (
        <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 flex flex-col md:flex-row md:items-center justify-between gap-2">
          <div>
            <p className="text-sm font-bold text-amber-400">
              Overhead Rate: {idrFmt(overheadRateInfo.overhead_rate)} / pcs
            </p>
            <p className="text-xs text-amber-400/80 mt-1">
              Periode: {overheadRateInfo.period.label} ({dateFmt(overheadRateInfo.period.tanggal_mulai)} s/d {dateFmt(overheadRateInfo.period.tanggal_akhir)})
            </p>
          </div>
          <div className="text-left md:text-right">
            <p className="text-xs font-mono text-amber-400/80">
              Total Overhead: {idrFmt(overheadRateInfo.total_overhead)}
            </p>
            <p className="text-xs font-mono text-amber-400/80">
              Total Shipped: {overheadRateInfo.total_qty_shipped.toLocaleString('id-ID')} pcs
            </p>
          </div>
        </div>
      ) : (
        <div className="p-4 rounded-xl bg-[#1A1D1F] border border-[#2A2D31]">
          <p className="text-sm font-bold text-orange-400">Overhead belum dikonfigurasi — profit belum include overhead</p>
        </div>
      )}

      {/* Summary Bar */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {summaryCards.map(card => (
          <div key={card.label} className="p-4 rounded-xl bg-[#1A1D1F] border border-[#2A2D31]">
            <div className="flex items-center justify-between mb-1">
              <p className="text-[10px] uppercase tracking-widest text-[#9aa0a6] font-bold">{card.label}</p>
              {card.icon}
            </div>
            {card.custom ? card.custom : (
              <p className={`text-sm font-bold ${card.color}`}>{card.value}</p>
            )}
          </div>
        ))}
      </div>

      {/* Filter Bar */}
      <div className="flex flex-wrap gap-3 items-end p-4 rounded-xl bg-[#1A1D1F] border border-[#2A2D31]">
        <div>
          <p className={labelCls}>Bulan</p>
          <select
            className="h-9 px-3 rounded-lg bg-[#1E2124] border border-[#2A2D31] text-sm text-[#e8eaed] outline-none focus:ring-1 focus:ring-[#e5c17b]"
            value={filterBulan}
            onChange={e => setFilterBulan(e.target.value)}
          >
            <option value="">Semua</option>
            {BULAN.map((b, i) => (
              <option key={i} value={String(i + 1).padStart(2, '0')}>{b}</option>
            ))}
          </select>
        </div>
        <div>
          <p className={labelCls}>Tahun</p>
          <input
            type="number"
            className="h-9 w-24 px-3 rounded-lg bg-[#1E2124] border border-[#2A2D31] text-sm text-[#e8eaed] outline-none focus:ring-1 focus:ring-[#e5c17b]"
            value={filterTahun}
            onChange={e => setFilterTahun(e.target.value)}
          />
        </div>
        <Button
          onClick={handleFilter}
          disabled={filtering}
          className="h-9 bg-[#2A2D31] text-[#e8eaed] hover:bg-[#3A3D41] text-xs"
        >
          {filtering
            ? <Loader2 className="h-4 w-4 animate-spin mr-1" />
            : <Filter className="h-4 w-4 mr-1" />}
          Terapkan Filter
        </Button>
        <Button
          onClick={() => { setFilterBulan(''); setFilterTahun(String(new Date().getFullYear())); handleFilter(); }}
          variant="ghost"
          className="h-9 text-xs text-[#9aa0a6] hover:text-[#e8eaed]"
        >
          Reset
        </Button>
      </div>

      {/* Tabel */}
      <div className="rounded-xl border border-[#2A2D31] overflow-hidden bg-[#16181A]">
        <Table>
          <TableHeader className="bg-[#1A1C1E]">
            <TableRow className="border-[#2A2D31] hover:bg-transparent">
              <SortableHeader label="No. PO" sortKey="no_po" />
              <TableHead className="text-[#9aa0a6]">Klien</TableHead>
              <SortableHeader label="Tanggal" sortKey="tanggal" />
              <SortableHeader label="QTY" sortKey="total_qty" align="right" />
              <SortableHeader label="Qty Shipped" sortKey="qty_shipped" align="right" />
              <SortableHeader label="HPP Estimasi" sortKey="hpp_estimasi" align="right" />
              <SortableHeader label="HPP Aktual" sortKey="hpp_aktual" align="right" />
              <SortableHeader label="Alokasi OH" sortKey="alokasi_overhead" align="right" />
              <SortableHeader label="Gap" sortKey="gap" align="right" />
              <SortableHeader label="Nilai Project" sortKey="nilai_project" align="right" />
              <SortableHeader label="Profit" sortKey="profit_final" align="right" />
              <SortableHeader label="Margin" sortKey="margin_pct_final" align="right" />
              <TableHead className="text-[#9aa0a6] text-center">Status</TableHead>
              <TableHead className="text-[#9aa0a6] w-20 text-center">Aksi</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedData.length === 0 ? (
              <TableRow className="hover:bg-transparent border-[#2A2D31]">
                <TableCell colSpan={14} className="h-32 text-center text-[#5f6368]">
                  Belum ada data PO
                </TableCell>
              </TableRow>
            ) : sortedData.map(po => (
              <TableRow
                key={po.po_id}
                className={`border-[#2A2D31] ${ROW_BG[po.status]}`}
              >
                {/* No. PO */}
                <TableCell className="font-mono text-sm text-[#e5c17b] font-bold">
                  {po.no_po}
                </TableCell>

                {/* Klien */}
                <TableCell className="text-sm text-[#e8eaed]">
                  {po.klien_nama}
                </TableCell>

                {/* Tanggal */}
                <TableCell className="text-sm text-[#9aa0a6] whitespace-nowrap">
                  {dateFmt(po.tanggal)}
                </TableCell>

                {/* QTY */}
                <TableCell className="text-sm text-[#e8eaed] text-right">
                  {po.total_qty.toLocaleString('id-ID')} pcs
                </TableCell>

                {/* QTY Shipped */}
                <TableCell className="text-sm text-[#e8eaed] text-right">
                  {po.qty_shipped > 0 ? (
                    <span>{po.qty_shipped.toLocaleString('id-ID')} pcs</span>
                  ) : (
                    <span className="text-[#5f6368]">-</span>
                  )}
                </TableCell>

                <TableCell className="text-sm text-right">
                  <span className="text-[#e8eaed]">{idrFmt(po.hpp_estimasi)}</span>
                </TableCell>

                {/* HPP Aktual */}
                <TableCell className="text-sm text-right">
                  {po.hpp_aktual === 0 ? (
                    <span className="text-[#5f6368] text-xs">Belum ada biaya tercatat</span>
                  ) : (
                    <span className="text-[#e8eaed]">{idrFmt(po.hpp_aktual)}</span>
                  )}
                </TableCell>

                {/* Alokasi OH */}
                <TableCell className="text-sm text-right">
                  {po.alokasi_overhead > 0 ? (
                    <span className="text-orange-400">{idrFmt(po.alokasi_overhead)}</span>
                  ) : (
                    <span className="text-[#5f6368]">-</span>
                  )}
                </TableCell>

                {/* Gap */}
                <TableCell className="text-sm font-semibold text-right">
                  {po.hpp_aktual === 0 ? (
                    <span className="text-[#5f6368]">-</span>
                  ) : (
                    <span className={po.gap > 0 ? 'text-red-400' : po.gap < 0 ? 'text-green-400' : 'text-[#9aa0a6]'}>
                      {po.gap > 0 ? '+' : ''}{idrFmt(po.gap)}
                    </span>
                  )}
                </TableCell>

                {/* Nilai Project */}
                <TableCell className="text-sm text-right">
                  {po.nilai_project === 0 ? (
                    <span className="text-orange-400 text-xs">Harga jual belum diset</span>
                  ) : (
                    <span className="text-[#e8eaed]">{idrFmt(po.nilai_project)}</span>
                  )}
                </TableCell>

                {/* Profit */}
                <TableCell className="text-sm font-semibold text-right">
                  {po.nilai_project === 0 ? (
                    <span className="text-[#5f6368]">-</span>
                  ) : (
                    <span className={po.profit_final > 0 ? 'text-green-400' : po.profit_final < 0 ? 'text-red-400' : 'text-[#9aa0a6]'}>
                      {po.profit_final > 0 ? '+' : po.profit_final < 0 ? '-' : ''}{idrFmt(po.profit_final)}
                    </span>
                  )}
                </TableCell>

                {/* Margin */}
                <TableCell className="text-sm font-bold text-right">
                  {po.nilai_project === 0 ? (
                    <span className="text-[#5f6368]">-</span>
                  ) : (
                    <span className={po.margin_pct_final > 0 ? 'text-green-400' : po.margin_pct_final < 0 ? 'text-red-400' : 'text-[#9aa0a6]'}>
                      {po.margin_pct_final}%
                    </span>
                  )}
                </TableCell>

                {/* Status Badge */}
                <TableCell className="text-center">
                  <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${STATUS_BADGE[po.status]}`}>
                    {STATUS_LABEL[po.status]}
                  </span>
                </TableCell>

                {/* Aksi */}
                <TableCell className="text-center">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleOpenDetail(po)}
                    className="h-7 px-2 text-xs text-[#9aa0a6] hover:text-[#e8eaed] hover:bg-[#2A2D31]"
                  >
                    <Eye className="h-3.5 w-3.5 mr-1" />
                    Detail
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* ─── MODAL DETAIL ──────────────────────────────────────────────────── */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="bg-[#16181A] border-[#2A2D31] text-[#e8eaed] sm:max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <span className="font-mono text-[#e5c17b]">{detailPO?.no_po}</span>
              <span className="text-[#9aa0a6] font-normal text-sm">— {detailPO?.klien_nama}</span>
            </DialogTitle>
          </DialogHeader>

          {detailLoading ? (
            <div className="flex items-center justify-center h-40">
              <Loader2 className="h-6 w-6 animate-spin text-[#e5c17b]" />
              <span className="ml-2 text-sm text-[#9aa0a6]">Memuat detail HPP...</span>
            </div>
          ) : detailData ? (
            <div className="space-y-4 py-2">

              {/* ── Tab Bar ── */}
              <div className="flex gap-1 p-1 rounded-xl bg-[#0D0E10] border border-[#2A2D31]">
                {([
                  { key: 'ringkasan', label: 'Ringkasan' },
                  { key: 'aktual',    label: 'Jurnal Aktual' },
                  { key: 'per_size',  label: 'HPP per Size' },
                ] as const).map(tab => (
                  <button
                    key={tab.key}
                    onClick={() => setActiveTab(tab.key)}
                    className={`flex-1 px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-all ${
                      activeTab === tab.key
                        ? 'bg-[#1A1D1F] text-[#e5c17b] shadow'
                        : 'text-[#9aa0a6] hover:text-[#e8eaed]'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {/* ── TAB 1: RINGKASAN ── */}
              {activeTab === 'ringkasan' && (
                <div className="space-y-4">
                  {/* Totals cards */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {[
                      { label: 'HPP Estimasi',       value: idrFmt(detailData.totals.hpp_estimasi),    color: 'text-[#e8eaed]' },
                      { label: 'Biaya Bahan',         value: idrFmt(detailData.totals.biaya_bahan),     color: 'text-blue-400' },
                      { label: 'Biaya Upah',           value: idrFmt(detailData.totals.biaya_upah),      color: 'text-purple-400' },
                      { label: 'Alokasi Overhead',    value: idrFmt(detailData.totals.alokasi_overhead),color: 'text-amber-400' },
                      { label: 'HPP Aktual (Direct)', value: idrFmt(detailData.totals.hpp_aktual),      color: 'text-[#e8eaed]' },
                      { label: 'HPP Aktual Final',    value: idrFmt(detailData.totals.hpp_aktual_final),color: 'text-[#e5c17b]' },
                      {
                        label: 'Gap',
                        value: (detailData.totals.gap > 0 ? '+' : '') + idrFmt(detailData.totals.gap),
                        color: detailData.totals.gap > 0 ? 'text-red-400' : detailData.totals.gap < 0 ? 'text-green-400' : 'text-[#9aa0a6]'
                      },
                    ].map(c => (
                      <div key={c.label} className="p-3 rounded-lg bg-[#1A1D1F] border border-[#2A2D31]">
                        <p className="text-[10px] uppercase tracking-widest text-[#9aa0a6] font-bold mb-1">{c.label}</p>
                        <p className={`text-sm font-bold ${c.color}`}>{c.value}</p>
                      </div>
                    ))}
                  </div>

                  {/* BOM Estimasi Breakdown */}
                  {detailData.estimasi_breakdown.length > 0 && (
                    <div>
                      <h3 className="text-xs font-bold text-[#9aa0a6] uppercase tracking-widest mb-2">Breakdown Estimasi (BOM)</h3>
                      <div className="rounded-lg border border-[#2A2D31] overflow-hidden">
                        <table className="w-full text-sm">
                          <thead className="bg-[#1A1C1E]">
                            <tr>
                              <th className="text-left p-2.5 text-[#9aa0a6] text-xs font-bold uppercase tracking-wider">Komponen</th>
                              <th className="text-left p-2.5 text-[#9aa0a6] text-xs font-bold uppercase tracking-wider">Kategori</th>
                              <th className="text-left p-2.5 text-[#9aa0a6] text-xs font-bold uppercase tracking-wider">Detail</th>
                              <th className="text-right p-2.5 text-[#9aa0a6] text-xs font-bold uppercase tracking-wider">Total</th>
                            </tr>
                          </thead>
                          <tbody>
                            {detailData.estimasi_breakdown.map((row, i) => (
                              <tr key={i} className="border-t border-[#2A2D31]">
                                <td className="p-2.5 text-[#e8eaed]">{row.nama_komponen}</td>
                                <td className="p-2.5 text-[#9aa0a6] text-xs capitalize">{row.kategori}</td>
                                <td className="p-2.5 text-[#9aa0a6] text-xs whitespace-nowrap">
                                  {row.qty_order} pcs × @{idrFmt(row.harga_per_unit)}
                                </td>
                                <td className="p-2.5 text-right text-[#e8eaed]">{idrFmt(row.total)}</td>
                              </tr>
                            ))}
                            <tr className="border-t-2 border-[#2A2D31] bg-[#1A1C1E]">
                              <td colSpan={3} className="p-2.5 font-bold text-[#9aa0a6] text-xs uppercase">Total Estimasi</td>
                              <td className="p-2.5 text-right font-bold text-[#e8eaed]">{idrFmt(detailData.totals.hpp_estimasi)}</td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* ── TAB 2: JURNAL AKTUAL ── */}
              {activeTab === 'aktual' && (
                <div>
                  {detailData.aktual_breakdown.length === 0 ? (
                    <div className="p-8 rounded-lg border border-[#2A2D31] text-center text-[#5f6368] text-sm">
                      Belum ada biaya tercatat untuk PO ini
                    </div>
                  ) : (
                    <div className="rounded-lg border border-[#2A2D31] overflow-hidden">
                      <table className="w-full text-sm">
                        <thead className="bg-[#1A1C1E]">
                          <tr>
                            <th className="text-left p-2.5 text-[#9aa0a6] text-xs font-bold uppercase tracking-wider">Tanggal</th>
                            <th className="text-left p-2.5 text-[#9aa0a6] text-xs font-bold uppercase tracking-wider">Keterangan</th>
                            <th className="text-left p-2.5 text-[#9aa0a6] text-xs font-bold uppercase tracking-wider">Jenis</th>
                            <th className="text-right p-2.5 text-[#9aa0a6] text-xs font-bold uppercase tracking-wider">Nominal (PO ini)</th>
                          </tr>
                        </thead>
                        <tbody>
                          {detailData.aktual_breakdown.map((row, i) => (
                            <tr key={i} className="border-t border-[#2A2D31] hover:bg-[#1A1C1E]/50">
                              <td className="p-2.5 text-[#9aa0a6] whitespace-nowrap text-xs">{dateFmt(row.tanggal)}</td>
                              <td className="p-2.5 text-[#e8eaed] max-w-[220px]">
                                <span className="truncate block">{row.keterangan}</span>
                                {row.nominal_penuh !== row.nominal_po && (
                                  <span className="text-[10px] text-[#5f6368] block">
                                    dari {idrFmt(row.nominal_penuh)} ÷ {Math.round(row.nominal_penuh / row.nominal_po)} PO
                                  </span>
                                )}
                              </td>
                              <td className="p-2.5">
                                <span className={`text-xs px-2 py-0.5 rounded border ${
                                  row.jenis === 'overhead'
                                    ? 'bg-amber-500/15 text-amber-400 border-amber-500/30'
                                    : 'bg-[#2A2D31] text-[#9aa0a6] border-[#3A3D41]'
                                }`}>
                                  {JENIS_LABEL[row.jenis] ?? row.jenis}
                                </span>
                              </td>
                              <td className="p-2.5 text-right font-semibold text-[#e8eaed]">
                                {idrFmt(row.nominal_po)}
                              </td>
                            </tr>
                          ))}
                          <tr className="border-t-2 border-[#2A2D31] bg-[#1A1C1E]">
                            <td colSpan={3} className="p-2.5 font-bold text-[#9aa0a6] text-xs uppercase">Total Aktual (incl. Overhead)</td>
                            <td className="p-2.5 text-right font-bold text-[#e5c17b]">{idrFmt(detailData.totals.hpp_aktual_final)}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {/* ── TAB 3: HPP PER SIZE ── */}
              {activeTab === 'per_size' && (
                <div>
                  {hppPerSizeData.length === 0 ? (
                    <div className="p-8 rounded-lg border border-[#2A2D31] text-center text-[#5f6368] text-sm">
                      Tidak ada data size untuk PO ini
                    </div>
                  ) : (
                    <div className="rounded-lg border border-[#2A2D31] overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="bg-[#1A1C1E]">
                          <tr>
                            <th className="text-left p-2.5 text-[#9aa0a6] text-xs font-bold uppercase tracking-wider whitespace-nowrap">Warna / Size</th>
                            <th className="text-right p-2.5 text-[#9aa0a6] text-xs font-bold uppercase tracking-wider">Qty</th>
                            <th className="text-right p-2.5 text-[#9aa0a6] text-xs font-bold uppercase tracking-wider">Est. HPP</th>
                            <th className="text-right p-2.5 text-[#9aa0a6] text-xs font-bold uppercase tracking-wider">Bahan</th>
                            <th className="text-right p-2.5 text-[#9aa0a6] text-xs font-bold uppercase tracking-wider">Upah</th>
                            <th className="text-right p-2.5 text-[#9aa0a6] text-xs font-bold uppercase tracking-wider">OH</th>
                            <th className="text-right p-2.5 text-[#9aa0a6] text-xs font-bold uppercase tracking-wider">HPP Final</th>
                            <th className="text-right p-2.5 text-[#9aa0a6] text-xs font-bold uppercase tracking-wider whitespace-nowrap">HPP/pcs</th>
                            <th className="text-right p-2.5 text-[#9aa0a6] text-xs font-bold uppercase tracking-wider">Nilai</th>
                            <th className="text-right p-2.5 text-[#9aa0a6] text-xs font-bold uppercase tracking-wider">Profit</th>
                            <th className="text-right p-2.5 text-[#9aa0a6] text-xs font-bold uppercase tracking-wider">Margin</th>
                          </tr>
                        </thead>
                        <tbody>
                          {hppPerSizeData.map((row, i) => {
                            const gapEst = row.hpp_aktual - row.hpp_estimasi;
                            return (
                              <tr key={i} className={`border-t border-[#2A2D31] ${
                                row.profit > 0 ? 'hover:bg-green-500/5' : row.profit < 0 ? 'hover:bg-red-500/5' : 'hover:bg-[#1A1C1E]/50'
                              }`}>
                                {/* Warna / Size */}
                                <td className="p-2.5">
                                  <div className="font-medium text-[#e8eaed] text-xs">{row.warna}</div>
                                  <div className="text-[10px] text-[#9aa0a6] font-mono">{row.size}</div>
                                </td>

                                {/* Qty */}
                                <td className="p-2.5 text-right text-xs text-[#e8eaed]">
                                  {row.qty_order.toLocaleString('id-ID')}
                                </td>

                                {/* HPP Estimasi */}
                                <td className="p-2.5 text-right text-xs text-[#9aa0a6]">
                                  {row.hpp_estimasi > 0 ? idrFmt(row.hpp_estimasi) : <span className="text-[#3A3D41]">—</span>}
                                </td>

                                {/* Biaya Bahan */}
                                <td className="p-2.5 text-right text-xs text-blue-400">
                                  {row.biaya_bahan > 0 ? idrFmt(row.biaya_bahan) : <span className="text-[#3A3D41]">—</span>}
                                </td>

                                {/* Biaya Upah */}
                                <td className="p-2.5 text-right text-xs text-purple-400">
                                  {row.biaya_upah > 0 ? idrFmt(row.biaya_upah) : <span className="text-[#3A3D41]">—</span>}
                                </td>

                                {/* Overhead */}
                                <td className="p-2.5 text-right text-xs text-amber-400">
                                  {row.alokasi_overhead > 0 ? idrFmt(row.alokasi_overhead) : <span className="text-[#3A3D41]">—</span>}
                                </td>

                                {/* HPP Aktual Final */}
                                <td className="p-2.5 text-right">
                                  <span className="text-xs font-bold text-[#e5c17b]">
                                    {row.hpp_aktual_final > 0 ? idrFmt(row.hpp_aktual_final) : <span className="text-[#3A3D41]">—</span>}
                                  </span>
                                  {row.hpp_estimasi > 0 && row.hpp_aktual > 0 && (
                                    <span className={`block text-[9px] font-mono ${
                                      gapEst > 0 ? 'text-red-400' : gapEst < 0 ? 'text-green-400' : 'text-[#5f6368]'
                                    }`}>
                                      {gapEst > 0 ? '+' : ''}{idrFmt(gapEst)}
                                    </span>
                                  )}
                                </td>

                                {/* HPP per pcs */}
                                <td className="p-2.5 text-right">
                                  <span className="text-xs font-mono text-[#e8eaed]">
                                    {row.hpp_per_pcs > 0 ? idrFmt(row.hpp_per_pcs) : <span className="text-[#3A3D41]">—</span>}
                                  </span>
                                </td>

                                {/* Nilai Project */}
                                <td className="p-2.5 text-right text-xs text-[#e8eaed]">
                                  {row.nilai_project > 0 ? idrFmt(row.nilai_project) : (
                                    <span className="text-orange-400 text-[10px]">Harga belum diset</span>
                                  )}
                                </td>

                                {/* Profit */}
                                <td className="p-2.5 text-right">
                                  {row.nilai_project === 0 ? (
                                    <span className="text-[#3A3D41] text-xs">—</span>
                                  ) : (
                                    <span className={`text-xs font-bold ${
                                      row.profit > 0 ? 'text-green-400' : row.profit < 0 ? 'text-red-400' : 'text-[#9aa0a6]'
                                    }`}>
                                      {row.profit > 0 ? '+' : ''}{idrFmt(row.profit)}
                                    </span>
                                  )}
                                </td>

                                {/* Margin */}
                                <td className="p-2.5 text-right">
                                  {row.nilai_project === 0 ? (
                                    <span className="text-[#3A3D41] text-xs">—</span>
                                  ) : (
                                    <span className={`text-xs font-bold ${
                                      row.margin_pct > 0 ? 'text-green-400' : row.margin_pct < 0 ? 'text-red-400' : 'text-[#9aa0a6]'
                                    }`}>
                                      {row.margin_pct}%
                                    </span>
                                  )}
                                </td>
                              </tr>
                            );
                          })}

                          {/* Footer total row */}
                          <tr className="border-t-2 border-[#2A2D31] bg-[#1A1C1E]">
                            <td className="p-2.5 text-xs font-bold text-[#9aa0a6] uppercase">Total</td>
                            <td className="p-2.5 text-right text-xs font-bold text-[#e8eaed]">
                              {hppPerSizeData.reduce((s, r) => s + r.qty_order, 0).toLocaleString('id-ID')}
                            </td>
                            <td className="p-2.5 text-right text-xs font-bold text-[#e8eaed]">
                              {idrFmt(hppPerSizeData.reduce((s, r) => s + r.hpp_estimasi, 0))}
                            </td>
                            <td className="p-2.5 text-right text-xs font-bold text-blue-400">
                              {idrFmt(hppPerSizeData.reduce((s, r) => s + r.biaya_bahan, 0))}
                            </td>
                            <td className="p-2.5 text-right text-xs font-bold text-purple-400">
                              {idrFmt(hppPerSizeData.reduce((s, r) => s + r.biaya_upah, 0))}
                            </td>
                            <td className="p-2.5 text-right text-xs font-bold text-amber-400">
                              {idrFmt(hppPerSizeData.reduce((s, r) => s + r.alokasi_overhead, 0))}
                            </td>
                            <td className="p-2.5 text-right text-xs font-bold text-[#e5c17b]">
                              {idrFmt(hppPerSizeData.reduce((s, r) => s + r.hpp_aktual_final, 0))}
                            </td>
                            <td className="p-2.5" />
                            <td className="p-2.5 text-right text-xs font-bold text-[#e8eaed]">
                              {idrFmt(hppPerSizeData.reduce((s, r) => s + r.nilai_project, 0))}
                            </td>
                            <td className="p-2.5 text-right text-xs font-bold">
                              {(() => {
                                const tot = hppPerSizeData.reduce((s, r) => s + r.profit, 0);
                                return <span className={tot > 0 ? 'text-green-400' : tot < 0 ? 'text-red-400' : 'text-[#9aa0a6]'}>{tot > 0 ? '+' : ''}{idrFmt(tot)}</span>;
                              })()}
                            </td>
                            <td className="p-2.5 text-right text-xs font-bold">
                              {(() => {
                                const totVal = hppPerSizeData.reduce((s, r) => s + r.nilai_project, 0);
                                const totPro = hppPerSizeData.reduce((s, r) => s + r.profit, 0);
                                const m = totVal > 0 ? Math.round((totPro / totVal) * 100) : 0;
                                return <span className={m > 0 ? 'text-green-400' : m < 0 ? 'text-red-400' : 'text-[#9aa0a6]'}>{m}%</span>;
                              })()}
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  )}

                  {/* Note jika RPC belum ada */}
                  {hppPerSizeData.length > 0 && hppPerSizeData.every(r => r.biaya_bahan === 0 && r.biaya_upah === 0) && (
                    <div className="mt-3 p-3 rounded-lg bg-amber-900/20 border border-amber-700/30 text-xs text-amber-300">
                      ⚠ Biaya bahan & upah per size masih 0 — RPC <code className="font-mono">get_biaya_pemakaian_per_po_item</code> dan <code className="font-mono">get_biaya_upah_per_po_item</code> belum dibuat di database.
                      Halaman ini menampilkan estimasi BOM saja.
                    </div>
                  )}
                </div>
              )}

            </div>
          ) : null}
        </DialogContent>
      </Dialog>

    </div>
  );
}
