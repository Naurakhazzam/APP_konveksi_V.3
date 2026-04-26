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
  type POLaporanItem,
  type POHPPDetail,
} from '@/lib/actions/keuangan/laporan-po.actions';

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
  hemat:     'hover:bg-green-500/5 bg-green-500/5',
  boncos:    'hover:bg-red-500/5 bg-red-500/5',
  on_budget: 'hover:bg-[#1A1C1E]/50',
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
}

// ─── COMPONENT ───────────────────────────────────────────────────────────────

export default function LaporanPOClient({ initialData }: Props) {
  const [data, setData] = useState<POLaporanItem[]>(initialData);
  const [filterBulan, setFilterBulan] = useState('');
  const [filterTahun, setFilterTahun] = useState(String(new Date().getFullYear()));
  const [filtering, setFiltering] = useState(false);

  // Detail modal state
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailData, setDetailData] = useState<POHPPDetail | null>(null);
  const [detailPO, setDetailPO] = useState<POLaporanItem | null>(null);

  // ─── SUMMARY ───────────────────────────────────────────────────────────
  const totalEstimasi = data.reduce((s, p) => s + p.hpp_estimasi, 0);
  const totalAktual   = data.reduce((s, p) => s + p.hpp_aktual, 0);
  const totalGap      = data.reduce((s, p) => s + p.gap, 0);
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
    setDetailOpen(true);
    setDetailLoading(true);
    try {
      const result = await getPOHPPDetail(po.po_id);
      setDetailData(result);
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

      {/* Summary Bar */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
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
      <div className="rounded-xl border border-[#2A2D31] overflow-hidden">
        <Table>
          <TableHeader className="bg-[#1A1C1E]">
            <TableRow className="border-[#2A2D31] hover:bg-transparent">
              <TableHead className="text-[#9aa0a6]">No. PO</TableHead>
              <TableHead className="text-[#9aa0a6]">Klien</TableHead>
              <TableHead className="text-[#9aa0a6]">Tanggal</TableHead>
              <TableHead className="text-[#9aa0a6] text-right">QTY</TableHead>
              <TableHead className="text-[#9aa0a6] text-right">HPP Estimasi</TableHead>
              <TableHead className="text-[#9aa0a6] text-right">HPP Aktual</TableHead>
              <TableHead className="text-[#9aa0a6] text-right">Gap</TableHead>
              <TableHead className="text-[#9aa0a6] text-center">Status</TableHead>
              <TableHead className="text-[#9aa0a6] w-20 text-center">Aksi</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.length === 0 ? (
              <TableRow className="hover:bg-transparent border-[#2A2D31]">
                <TableCell colSpan={9} className="h-32 text-center text-[#5f6368]">
                  Belum ada data PO
                </TableCell>
              </TableRow>
            ) : data.map(po => (
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
        <DialogContent className="bg-[#16181A] border-[#2A2D31] text-[#e8eaed] sm:max-w-2xl max-h-[85vh] overflow-y-auto">
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
            <div className="space-y-6 py-2">

              {/* Totals Bar */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[
                  { label: 'HPP Estimasi', value: idrFmt(detailData.totals.hpp_estimasi), color: 'text-[#e8eaed]' },
                  { label: 'Biaya Bahan', value: idrFmt(detailData.totals.biaya_bahan), color: 'text-blue-400' },
                  { label: 'Biaya Upah', value: idrFmt(detailData.totals.biaya_upah), color: 'text-purple-400' },
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

              {/* Section 1: Estimasi Breakdown */}
              {detailData.estimasi_breakdown.length > 0 && (
                <div>
                  <h3 className="text-xs font-bold text-[#9aa0a6] uppercase tracking-widest mb-2">
                    Breakdown Estimasi (BOM)
                  </h3>
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

              {/* Section 2: Aktual Breakdown */}
              <div>
                <h3 className="text-xs font-bold text-[#9aa0a6] uppercase tracking-widest mb-2">
                  Jurnal Aktual yang Dibebankan
                </h3>
                {detailData.aktual_breakdown.length === 0 ? (
                  <div className="p-4 rounded-lg border border-[#2A2D31] text-center text-[#5f6368] text-sm">
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
                            <td className="p-2.5 text-[#e8eaed] max-w-[200px]">
                              <span className="truncate block">{row.keterangan}</span>
                              {row.nominal_penuh !== row.nominal_po && (
                                <span className="text-[10px] text-[#5f6368] block">
                                  dari {idrFmt(row.nominal_penuh)} ÷ {Math.round(row.nominal_penuh / row.nominal_po)} PO
                                </span>
                              )}
                            </td>
                            <td className="p-2.5">
                              <span className="text-xs bg-[#2A2D31] text-[#9aa0a6] px-2 py-0.5 rounded border border-[#3A3D41]">
                                {JENIS_LABEL[row.jenis] ?? row.jenis}
                              </span>
                            </td>
                            <td className="p-2.5 text-right font-semibold text-[#e8eaed]">
                              {idrFmt(row.nominal_po)}
                            </td>
                          </tr>
                        ))}
                        <tr className="border-t-2 border-[#2A2D31] bg-[#1A1C1E]">
                          <td colSpan={3} className="p-2.5 font-bold text-[#9aa0a6] text-xs uppercase">Total Aktual</td>
                          <td className="p-2.5 text-right font-bold text-[#e8eaed]">{idrFmt(detailData.totals.hpp_aktual)}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

            </div>
          ) : null}
        </DialogContent>
      </Dialog>

    </div>
  );
}
