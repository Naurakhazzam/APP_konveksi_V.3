'use client';

import React, { useState } from 'react';
import { Loader2, Filter, Eye, AlertTriangle } from 'lucide-react';
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
  getPOHPPPerSizeResult,
  type POLaporanItem,
  type POHPPDetail,
  type HPPPerSizeResult,
  type BarisKomponen,
  type BarisQty,
  type KesimpulanPO,
  type GrupKomponen,
  type TandaBaris,
  type TandaPO,
} from '@/lib/actions/keuangan/laporan-po.actions';
import { poPeriodeBaru } from '@/lib/keuangan/periode-po';

// ─── CONSTANTS ──────────────────────────────────────────────────────────────

const BULAN = [
  'Januari','Februari','Maret','April','Mei','Juni',
  'Juli','Agustus','September','Oktober','November','Desember'
];

const idrFmt = (n: number) =>
  'Rp ' + Math.round(Math.abs(n)).toLocaleString('id-ID', { minimumFractionDigits: 0 });

/** Selisih biaya dalam kata: Boros (merah) = biaya lebih besar dari HPP, Hemat (hijau) = lebih kecil */
const selisihFmt = (n: number) => (Math.round(n) > 0 ? 'Boros ' : Math.round(n) < 0 ? 'Hemat ' : 'Sesuai') + (Math.round(n) ? idrFmt(n) : '');
const selisihCls = (n: number) =>
  Math.round(n) > 0 ? 'text-red-400' : Math.round(n) < 0 ? 'text-green-400' : 'text-[#9aa0a6]';

const dateFmt = (d: string) =>
  d ? new Date(d).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

const labelCls = 'block text-[10px] font-bold text-[#9aa0a6] uppercase tracking-widest mb-1';

const TANDA_PO: Record<TandaPO, { label: string; cls: string }> = {
  final:          { label: 'Final',          cls: 'bg-green-500/15 text-green-400 border border-green-500/30' },
  berjalan:       { label: 'Berjalan',       cls: 'bg-blue-500/15 text-blue-300 border border-blue-500/30' },
  menunggu_harga: { label: 'Menunggu harga', cls: 'bg-amber-500/15 text-amber-300 border border-amber-500/30' },
  belum_dipotong: { label: 'Belum dipotong', cls: 'bg-[#2A2D31] text-[#9aa0a6] border border-[#3A3D41]' },
};

const TANDA_BARIS: Record<TandaBaris, { label: string; cls: string }> = {
  final:          { label: 'Final',          cls: 'text-green-400' },
  berjalan:       { label: 'Berjalan',       cls: 'text-blue-300' },
  menunggu_harga: { label: 'Menunggu harga', cls: 'text-amber-300' },
  belum_tercatat: { label: 'Belum tercatat', cls: 'text-[#9aa0a6]' },
  sementara:      { label: 'Sementara',      cls: 'text-orange-300' },
};

const GRUP_LABEL: Record<GrupKomponen, string> = {
  bahan:    'Kain (modal FIFO)',
  aksesori: 'Aksesori (puring, sleting — modal FIFO)',
  pembantu: 'Bahan pembantu (Saldo Bahan Pembantu)',
  upah:     'Upah',
  lain:     'Biaya lain',
  overhead: 'Overhead produksi (pcs-hari)',
};

const JENIS_LABEL: Record<string, string> = {
  direct_bahan: 'Bahan',
  direct_upah:  'Upah',
  pembantu:     'Bahan pembantu',
  overhead:     'Overhead',
};

// ─── PROPS ──────────────────────────────────────────────────────────────────

type KunciUrut = Exclude<keyof POLaporanItem, 'kesimpulan'>;

interface Props {
  initialData: POLaporanItem[];
  defaultBulan: string;
  defaultTahun: string;
}

// ─── COMPONENT ───────────────────────────────────────────────────────────────

export default function LaporanPOClient({ initialData, defaultBulan, defaultTahun }: Props) {
  const [data, setData] = useState<POLaporanItem[]>(initialData);
  const [filterBulan, setFilterBulan] = useState(defaultBulan);
  const [filterTahun, setFilterTahun] = useState(defaultTahun);
  const [filtering, setFiltering] = useState(false);
  // PO sebelum periode baru disembunyikan permanen (permintaan user 16 Nov 2026)
  const visible = React.useMemo(() => data.filter(p => poPeriodeBaru(p.no_po)), [data]);

  // ─── SORT STATE ────────────────────────────────────────────────────────
  const [sortConfig, setSortConfig] = useState<{ key: KunciUrut; direction: 'asc' | 'desc' } | null>(null);

  const sortedData = React.useMemo(() => {
    const items = [...visible];
    if (sortConfig) {
      items.sort((a, b) => {
        if (a[sortConfig.key] < b[sortConfig.key]) return sortConfig.direction === 'asc' ? -1 : 1;
        if (a[sortConfig.key] > b[sortConfig.key]) return sortConfig.direction === 'asc' ? 1 : -1;
        return 0;
      });
    }
    return items;
  }, [visible, sortConfig]);

  const requestSort = (key: KunciUrut) => {
    if (sortConfig?.key === key && sortConfig.direction === 'desc') { setSortConfig(null); return; }
    setSortConfig({ key, direction: sortConfig?.key === key && sortConfig.direction === 'asc' ? 'desc' : 'asc' });
  };

  const kolomUrut = (label: string, sortKey: KunciUrut, align: "left" | "right" | "center" = "left") => {
    const isActive = sortConfig?.key === sortKey;
    return (
      <TableHead key={sortKey}
        className={`cursor-pointer select-none group transition-colors whitespace-nowrap ${
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
  const [activeDetailTab, setActiveDetailTab] = useState<'komponen' | 'qty' | 'jurnal' | 'hpp-size'>('komponen');
  const [hppPerSizeData, setHppPerSizeData] = useState<HPPPerSizeResult | null>(null);
  const [isLoadingHpp, setIsLoadingHpp] = useState(false);

  // ─── SUMMARY ───────────────────────────────────────────────────────────
  const jml = (f: (p: POLaporanItem) => number) => visible.reduce((s, p) => s + f(p), 0);
  const totalPerkiraan = jml(p => p.perkiraan);
  const totalAktual    = jml(p => p.aktual);
  const totalSisa      = jml(p => p.sisa);
  const totalSelisih   = jml(p => p.selisih);
  const totalLaba      = jml(p => p.profit_final);
  const adaSementara   = visible.some(p => p.overhead_sementara);
  const hitungTanda = (t: TandaPO) => visible.filter(p => p.tanda === t).length;
  const poPeringatan = visible.filter(p => p.kesimpulan?.peringatan);
  const totalBedaTarif = jml(p => p.beda_tarif);

  const summaryCards: { label: string; value: string; color: string; sub?: string }[] = [
    { label: 'Perkiraan (HPP × dipotong)', value: idrFmt(totalPerkiraan), color: 'text-[#e8eaed]' },
    { label: 'Aktual sejauh ini',          value: idrFmt(totalAktual),    color: 'text-[#e8eaed]' },
    { label: 'Sisa perkiraan',             value: idrFmt(totalSisa),      color: 'text-blue-300' },
    { label: 'Hemat / Boros biaya',        value: selisihFmt(totalSelisih), color: selisihCls(totalSelisih),
      sub: Math.round(totalBedaTarif) ? `${selisihFmt(totalBedaTarif)} beda tarif` : undefined },
    { label: 'Laba (Kinerja)',             value: (totalLaba < 0 ? '−' : '') + idrFmt(totalLaba),
      color: totalLaba > 0 ? 'text-green-400' : totalLaba < 0 ? 'text-red-400' : 'text-[#9aa0a6]' },
  ];

  // ─── FILTER ────────────────────────────────────────────────────────────
  const handleFilter = async (bulan = filterBulan, tahun = filterTahun) => {
    setFiltering(true);
    try {
      setData(await getLaporanPOList({ bulan: bulan || undefined, tahun: tahun || undefined }));
    } catch (e) {
      toast.error((e as Error).message || "Gagal memuat data");
    } finally {
      setFiltering(false);
    }
  };

  // ─── DETAIL MODAL ──────────────────────────────────────────────────────
  const handleOpenDetail = async (po: POLaporanItem) => {
    setDetailPO(po);
    setDetailData(null);
    setHppPerSizeData(null);
    setActiveDetailTab('komponen');
    setDetailOpen(true);
    setDetailLoading(true);
    try {
      setDetailData(await getPOHPPDetail(po.po_id));
    } catch (e) {
      toast.error("Gagal memuat detail: " + (e as Error).message);
      setDetailOpen(false);
    } finally {
      setDetailLoading(false);
    }
  };

  async function handleHppTabClick() {
    setActiveDetailTab('hpp-size');
    if (!hppPerSizeData && detailPO) {
      setIsLoadingHpp(true);
      try {
        setHppPerSizeData(await getPOHPPPerSizeResult(detailPO.po_id));
      } catch {
        toast.error('Gagal memuat HPP per size');
      } finally {
        setIsLoadingHpp(false);
      }
    }
  }

  // ─── RENDER ────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">

      {/* Info cara hitung */}
      <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs text-amber-300/90 leading-relaxed space-y-1">
        <p>
          <b className="text-amber-300">Perkiraan</b> = HPP di sheet × pcs yang <b>dipotong</b>.{' '}
          <b className="text-amber-300">Aktual sejauh ini</b> = kain, puring & sleting (modal FIFO) + bahan pembantu
          (Saldo Bahan Pembantu) + upah tercatat (lunas & terutang) + overhead produksi metode pcs-hari.{' '}
          <b className="text-amber-300">Sisa perkiraan</b> = bagian HPP untuk pcs yang biayanya belum tercatat
          (tahap belum selesai, aksesori menunggu harga).{' '}
          <b className="text-amber-300">Hemat / Boros</b> = (aktual + sisa) dibanding perkiraan:{' '}
          <span className="text-green-400">Hemat</span> = biaya lebih kecil dari patokan HPP, untung bertambah sebesar itu;{' '}
          <span className="text-red-400">Boros</span> = biaya lebih besar dari patokan HPP, untung berkurang sebesar itu.{' '}
          Upah yang sudah dibayar dibandingkan dengan tarif yang dibayar saat itu.
        </p>
        <p>Laba memakai angka yang sama dengan <b>Kinerja Keuangan</b>.</p>
        {adaSementara && (
          <p className="text-orange-300">
            ⚠ Overhead bulan berjalan masih <b>sementara</b>; angkanya final setelah bulan tutup.
          </p>
        )}
      </div>

      {poPeringatan.length > 0 && (
        <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/25 text-xs text-red-300 space-y-1">
          <p className="flex items-center gap-2 font-bold"><AlertTriangle className="h-4 w-4" /> {poPeringatan.length} PO perlu perhatian</p>
          {poPeringatan.map(p => (
            <p key={p.po_id}>
              <span className="font-mono text-[#e5c17b]">{p.no_po}</span> — {p.kesimpulan!.peringatan === 'rugi'
                ? `rugi ${idrFmt(p.kesimpulan!.margin_aktual)} (${p.kesimpulan!.margin_aktual_pct}%)`
                : `margin ${p.kesimpulan!.margin_aktual_pct}%, turun ${p.kesimpulan!.turun_pct}% dari perkiraan ${p.kesimpulan!.margin_perkiraan_pct}%`}
              {p.kesimpulan!.sementara && <span className="text-orange-300"> · sementara</span>}
            </p>
          ))}
        </div>
      )}

      {/* Summary Bar */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        {summaryCards.map(card => (
          <div key={card.label} className="p-4 rounded-xl bg-[#1A1D1F] border border-[#2A2D31]">
            <p className="text-[10px] uppercase tracking-widest text-[#9aa0a6] font-bold mb-1">{card.label}</p>
            <p className={`text-sm font-bold ${card.color}`}>{card.value}</p>
            {card.sub && <p className="text-[10px] text-[#9aa0a6] mt-0.5">{card.sub}</p>}
          </div>
        ))}
        <div className="p-4 rounded-xl bg-[#1A1D1F] border border-[#2A2D31]">
          <p className="text-[10px] uppercase tracking-widest text-[#9aa0a6] font-bold mb-1">Status PO</p>
          <div className="flex gap-1.5 flex-wrap">
            {(['final', 'berjalan', 'menunggu_harga'] as TandaPO[]).map(t => (
              <span key={t} className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${TANDA_PO[t].cls}`}>
                {hitungTanda(t)} {TANDA_PO[t].label}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="flex flex-wrap gap-3 items-end p-4 rounded-xl bg-[#1A1D1F] border border-[#2A2D31]">
        <div>
          <p className={labelCls}>Bulan order</p>
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
          onClick={() => handleFilter()}
          disabled={filtering}
          className="h-9 bg-[#2A2D31] text-[#e8eaed] hover:bg-[#3A3D41] text-xs"
        >
          {filtering ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Filter className="h-4 w-4 mr-1" />}
          Terapkan Filter
        </Button>
        <Button
          onClick={() => { setFilterBulan(defaultBulan); setFilterTahun(defaultTahun); handleFilter(defaultBulan, defaultTahun); }}
          variant="ghost"
          className="h-9 text-xs text-[#9aa0a6] hover:text-[#e8eaed]"
        >
          Reset
        </Button>
      </div>

      {/* Tabel */}
      <div className="rounded-xl border border-[#2A2D31] overflow-x-auto bg-[#16181A]">
        <Table>
          <TableHeader className="bg-[#1A1C1E]">
            <TableRow className="border-[#2A2D31] hover:bg-transparent">
              {kolomUrut("No. PO", "no_po")}
              <TableHead className="text-[#9aa0a6]">Klien</TableHead>
              {kolomUrut("Tanggal", "tanggal")}
              {kolomUrut("Order", "total_qty", "right")}
              {kolomUrut("Dipotong", "pcs_potong", "right")}
              {kolomUrut("Dikirim", "qty_shipped", "right")}
              {kolomUrut("Perkiraan", "perkiraan", "right")}
              {kolomUrut("Aktual", "aktual", "right")}
              {kolomUrut("Sisa", "sisa", "right")}
              {kolomUrut("Hemat / Boros", "selisih", "right")}
              {kolomUrut("Nilai Jual", "nilai_project", "right")}
              {kolomUrut("Laba", "profit_final", "right")}
              {kolomUrut("Margin", "margin_pct_final", "right")}
              <TableHead className="text-[#9aa0a6] text-center">Status</TableHead>
              <TableHead className="text-[#9aa0a6] w-20 text-center">Aksi</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedData.length === 0 ? (
              <TableRow className="hover:bg-transparent border-[#2A2D31]">
                <TableCell colSpan={15} className="h-32 text-center text-[#5f6368]">Belum ada data PO</TableCell>
              </TableRow>
            ) : sortedData.map(po => {
              const kosong = po.tanda === 'belum_dipotong';
              return (
                <TableRow key={po.po_id} className="border-[#2A2D31] bg-[#16181A] hover:bg-[#1A1C1E]">
                  <TableCell className="font-mono text-sm text-[#e5c17b] font-bold">{po.no_po}</TableCell>
                  <TableCell className="text-sm text-[#e8eaed]">{po.klien_nama}</TableCell>
                  <TableCell className="text-sm text-[#9aa0a6] whitespace-nowrap">{dateFmt(po.tanggal)}</TableCell>
                  <TableCell className="text-sm text-[#9aa0a6] text-right">{po.total_qty.toLocaleString('id-ID')}</TableCell>
                  <TableCell className="text-sm text-[#e8eaed] text-right">{po.pcs_potong > 0 ? po.pcs_potong.toLocaleString('id-ID') : '—'}</TableCell>
                  <TableCell className="text-sm text-[#e8eaed] text-right">{po.qty_shipped > 0 ? po.qty_shipped.toLocaleString('id-ID') : '—'}</TableCell>
                  <TableCell className="text-sm text-right text-[#e8eaed] whitespace-nowrap">{kosong ? '—' : idrFmt(po.perkiraan)}</TableCell>
                  <TableCell className="text-sm text-right text-[#e8eaed] whitespace-nowrap">
                    {kosong ? '—' : idrFmt(po.aktual)}
                    {po.overhead_sementara && <span className="block text-[10px] text-orange-300">overhead sementara</span>}
                  </TableCell>
                  <TableCell className="text-sm text-right text-blue-300 whitespace-nowrap">{kosong || Math.round(po.sisa) === 0 ? '—' : idrFmt(po.sisa)}</TableCell>
                  <TableCell className={`text-sm font-semibold text-right whitespace-nowrap ${selisihCls(po.selisih)}`}>
                    {kosong ? '—' : selisihFmt(po.selisih)}
                    {!kosong && Math.round(po.beda_tarif) !== 0 && (
                      <span className="block text-[10px] font-normal text-[#9aa0a6]">{selisihFmt(po.beda_tarif)} beda tarif</span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-right whitespace-nowrap">
                    {po.nilai_project === 0
                      ? <span className="text-orange-400 text-xs">Harga jual belum diset</span>
                      : <span className="text-[#e8eaed]">{idrFmt(po.nilai_project)}</span>}
                  </TableCell>
                  <TableCell className="text-sm font-semibold text-right whitespace-nowrap">
                    {po.nilai_project === 0 || kosong ? <span className="text-[#5f6368]">—</span> : (
                      <span className={po.profit_final > 0 ? 'text-green-400' : po.profit_final < 0 ? 'text-red-400' : 'text-[#9aa0a6]'}>
                        {po.profit_final < 0 ? '−' : ''}{idrFmt(po.profit_final)}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm font-bold text-right">
                    {po.nilai_project === 0 || kosong ? <span className="text-[#5f6368]">—</span> : (
                      <span className={po.margin_pct_final > 0 ? 'text-green-400' : po.margin_pct_final < 0 ? 'text-red-400' : 'text-[#9aa0a6]'}>
                        {po.margin_pct_final}%
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-center">
                    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider whitespace-nowrap ${TANDA_PO[po.tanda].cls}`}>
                      {TANDA_PO[po.tanda].label}
                    </span>
                    {po.kesimpulan?.peringatan && (
                      <span title={po.kesimpulan.kalimat.join(' ')}
                        className="block mt-1 text-[10px] font-bold text-red-400 whitespace-nowrap">
                        ⚠ {po.kesimpulan.peringatan === 'rugi' ? 'Rugi' : `Margin turun ${po.kesimpulan.turun_pct}%`}
                      </span>
                    )}
                    {(po.kesimpulan?.kurang_potong_pcs ?? 0) > 0 && (
                      <span className="block mt-0.5 text-[10px] text-amber-300 whitespace-nowrap">
                        kurang potong {po.kesimpulan!.kurang_potong_pcs} pcs
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-center">
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={kosong}
                      onClick={() => handleOpenDetail(po)}
                      className="h-7 px-2 text-xs text-[#9aa0a6] hover:text-[#e8eaed] hover:bg-[#2A2D31]"
                    >
                      <Eye className="h-3.5 w-3.5 mr-1" />
                      Detail
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {/* ─── MODAL DETAIL ──────────────────────────────────────────────────── */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="bg-[#16181A] border-[#2A2D31] text-[#e8eaed] sm:max-w-5xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 flex-wrap">
              <span className="font-mono text-[#e5c17b]">{detailPO?.no_po}</span>
              <span className="text-[#9aa0a6] font-normal text-sm">— {detailPO?.klien_nama}</span>
              {detailData && (
                <span className={`ml-2 rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${TANDA_PO[detailData.totals.tanda].cls}`}>
                  {TANDA_PO[detailData.totals.tanda].label}
                </span>
              )}
            </DialogTitle>
          </DialogHeader>

          {detailLoading ? (
            <div className="flex items-center justify-center h-40">
              <Loader2 className="h-6 w-6 animate-spin text-[#e5c17b]" />
              <span className="ml-2 text-sm text-[#9aa0a6]">Memuat detail...</span>
            </div>
          ) : detailData ? (
            <div className="space-y-4 py-2">

              {/* ── Tab Bar ── */}
              <div className="flex border-b border-[#3a3d41] mb-1">
                {[
                  { key: 'komponen', label: 'Per Komponen' },
                  { key: 'qty',      label: 'Qty Pesan vs Potong' },
                  { key: 'jurnal',   label: 'Rincian Aktual' },
                  { key: 'hpp-size', label: 'HPP per Size' },
                ].map(tab => (
                  <button
                    key={tab.key}
                    onClick={() => tab.key === 'hpp-size' ? handleHppTabClick() : setActiveDetailTab(tab.key as 'komponen' | 'qty' | 'jurnal')}
                    className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
                      activeDetailTab === tab.key
                        ? 'border-[#e5c17b] text-[#e5c17b]'
                        : 'border-transparent text-[#9aa0a6] hover:text-[#e8eaed]'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {/* ── TAB 1: PER KOMPONEN ── */}
              {activeDetailTab === 'komponen' && (
                <div className="space-y-4">
                  {detailData.kesimpulan && <KotakKesimpulan k={detailData.kesimpulan} />}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {[
                      { label: 'Perkiraan biaya',   value: idrFmt(detailData.totals.perkiraan), color: 'text-[#e8eaed]',
                        ket: 'Patokan HPP di sheet × pcs yang dipotong' },
                      { label: 'Aktual sejauh ini', value: idrFmt(detailData.totals.aktual),    color: 'text-[#e8eaed]',
                        ket: 'Biaya yang sudah benar-benar keluar / tercatat' },
                      { label: 'Sisa perkiraan',    value: idrFmt(detailData.totals.sisa),      color: 'text-blue-300',
                        ket: 'Biaya yang belum keluar (tahap belum selesai), dihitung dari HPP' },
                      { label: 'Hemat / Boros biaya', value: selisihFmt(detailData.totals.selisih), color: selisihCls(detailData.totals.selisih),
                        ket: Math.round(detailData.totals.selisih) < 0
                          ? 'Aktual + sisa lebih KECIL dari perkiraan → untung bertambah sebesar ini'
                          : Math.round(detailData.totals.selisih) > 0
                            ? 'Aktual + sisa lebih BESAR dari perkiraan → untung berkurang sebesar ini'
                            : 'Aktual + sisa sama dengan perkiraan' },
                    ].map(c => (
                      <div key={c.label} className="p-3 rounded-lg bg-[#1A1D1F] border border-[#2A2D31]">
                        <p className="text-[10px] uppercase tracking-widest text-[#9aa0a6] font-bold mb-1">{c.label}</p>
                        <p className={`text-sm font-bold ${c.color}`}>{c.value}</p>
                        <p className="text-[10px] text-[#9aa0a6] mt-1 leading-snug">{c.ket}</p>
                      </div>
                    ))}
                  </div>
                  {detailData.totals.overhead_sementara && (
                    <p className="text-xs text-orange-300">⚠ Overhead bulan berjalan masih sementara (final setelah bulan tutup).</p>
                  )}
                  <TabelKomponen baris={detailData.baris} />
                </div>
              )}

              {/* ── TAB: QTY PESAN VS POTONG ── */}
              {activeDetailTab === 'qty' && <TabelQty rows={detailData.qty} />}

              {/* ── TAB 2: RINCIAN AKTUAL ── */}
              {activeDetailTab === 'jurnal' && (
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
                            <th className="text-right p-2.5 text-[#9aa0a6] text-xs font-bold uppercase tracking-wider">Nominal</th>
                          </tr>
                        </thead>
                        <tbody>
                          {detailData.aktual_breakdown.map((row, i) => (
                            <tr key={i} className="border-t border-[#2A2D31] hover:bg-[#1A1C1E]/50">
                              <td className="p-2.5 text-[#9aa0a6] whitespace-nowrap text-xs">{dateFmt(row.tanggal)}</td>
                              <td className="p-2.5 text-[#e8eaed]">{row.keterangan}</td>
                              <td className="p-2.5">
                                <span className={`text-xs px-2 py-0.5 rounded border whitespace-nowrap ${
                                  row.jenis === 'overhead' || row.jenis === 'pembantu'
                                    ? 'bg-amber-500/15 text-amber-400 border-amber-500/30'
                                    : 'bg-[#2A2D31] text-[#9aa0a6] border-[#3A3D41]'
                                }`}>
                                  {JENIS_LABEL[row.jenis] ?? row.jenis}
                                </span>
                              </td>
                              <td className="p-2.5 text-right font-semibold text-[#e8eaed] whitespace-nowrap">{idrFmt(row.nominal)}</td>
                            </tr>
                          ))}
                          <tr className="border-t-2 border-[#2A2D31] bg-[#1A1C1E]">
                            <td colSpan={3} className="p-2.5 font-bold text-[#9aa0a6] text-xs uppercase">Total aktual sejauh ini</td>
                            <td className="p-2.5 text-right font-bold text-[#e5c17b]">
                              {idrFmt(detailData.aktual_breakdown.reduce((s, r) => s + r.nominal, 0))}
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {/* ── TAB 3: HPP PER SIZE ── */}
              {activeDetailTab === 'hpp-size' && (
                <div>
                  {isLoadingHpp ? (
                    <div className="flex justify-center py-12">
                      <span className="text-[#9aa0a6] text-sm">Memuat data HPP...</span>
                    </div>
                  ) : hppPerSizeData ? (
                    <>
                      <div className="mb-4 px-3 py-2 rounded-lg bg-[#2A2D31] border border-[#3a3d41] text-xs text-[#9aa0a6]">
                        Biaya aktual sejauh ini per warna & size (pcs dipotong). Overhead PO ini dibagi rata:{' '}
                        <span className="text-[#e5c17b] font-semibold">{idrFmt(hppPerSizeData.overhead_rate_per_pcs)}/pcs</span>
                        {hppPerSizeData.overhead_sementara && <span className="text-orange-300"> (sementara)</span>}.
                        Upah tahap yang belum dikerjakan belum termasuk.
                      </div>
                      <div className="overflow-x-auto rounded-xl border border-[#3a3d41]">
                        <table className="w-full text-[13px]">
                          <thead>
                            <tr className="bg-[#2A2D31]">
                              {['Warna', 'Size', 'Pcs', 'Perkiraan', 'Kain', 'Aksesori', 'Upah', 'Overhead', 'Total', 'HPP/pcs'].map((h, i) => (
                                <th key={h} className={`px-3 py-3 text-[11px] font-semibold uppercase ${i < 2 ? 'text-left' : 'text-right'} ${h === 'HPP/pcs' ? 'text-[#e5c17b]' : 'text-[#9aa0a6]'}`}>{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-[#3a3d41]">
                            {hppPerSizeData.rows.map((row, i) => (
                              <tr key={i} className="hover:bg-[#2A2D31]/50 transition-colors">
                                <td className="px-3 py-2.5 text-[#e8eaed] font-medium">{row.warna}</td>
                                <td className="px-3 py-2.5 text-[#e8eaed]">{row.size}</td>
                                <td className="px-3 py-2.5 text-right text-[#9aa0a6]">{row.qty.toLocaleString('id-ID')}</td>
                                <td className="px-3 py-2.5 text-right text-[#9aa0a6]">{idrFmt(row.perkiraan)}</td>
                                <td className="px-3 py-2.5 text-right text-[#e8eaed]">{idrFmt(row.biaya_kain)}</td>
                                <td className="px-3 py-2.5 text-right text-[#e8eaed]">{idrFmt(row.biaya_aksesori)}</td>
                                <td className="px-3 py-2.5 text-right text-[#e8eaed]">{idrFmt(row.biaya_upah)}</td>
                                <td className="px-3 py-2.5 text-right text-[#9aa0a6]">{idrFmt(row.overhead)}</td>
                                <td className="px-3 py-2.5 text-right font-semibold text-[#e8eaed]">{idrFmt(row.total_hpp)}</td>
                                <td className="px-3 py-2.5 text-right font-bold text-[#e5c17b]">{row.qty > 0 ? idrFmt(row.hpp_per_pcs) : '—'}</td>
                              </tr>
                            ))}
                          </tbody>
                          <tfoot>
                            <tr className="bg-[#2A2D31] border-t-2 border-[#3a3d41] text-[12px] font-bold">
                              <td colSpan={2} className="px-3 py-3 text-[#e8eaed]">TOTAL</td>
                              <td className="px-3 py-3 text-right text-[#e8eaed]">{hppPerSizeData.rows.reduce((s, r) => s + r.qty, 0).toLocaleString('id-ID')}</td>
                              {(['perkiraan', 'biaya_kain', 'biaya_aksesori', 'biaya_upah', 'overhead', 'total_hpp'] as const).map(k => (
                                <td key={k} className="px-3 py-3 text-right text-[#e8eaed]">
                                  {idrFmt(hppPerSizeData.rows.reduce((s, r) => s + r[k], 0))}
                                </td>
                              ))}
                              <td className="px-3 py-3 text-right text-[#e5c17b]">—</td>
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                    </>
                  ) : (
                    <p className="text-center text-[#9aa0a6] text-sm py-12">Tidak ada data HPP</p>
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

// ─── Tabel per komponen (dikelompokkan per grup) ─────────────────────────────

function TabelKomponen({ baris }: { baris: BarisKomponen[] }) {
  const grup = (Object.keys(GRUP_LABEL) as GrupKomponen[])
    .map(g => ({ g, rows: baris.filter(b => b.grup === g) }))
    .filter(x => x.rows.length > 0);
  const th = 'p-2.5 text-[#9aa0a6] text-[11px] font-bold uppercase tracking-wider';
  const sum = (rows: BarisKomponen[], k: 'perkiraan' | 'aktual' | 'sisa' | 'selisih') => rows.reduce((s, r) => s + r[k], 0);

  return (
    <div className="rounded-lg border border-[#2A2D31] overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-[#1A1C1E]">
          <tr>
            <th className={`${th} text-left`}>Komponen</th>
            <th className={`${th} text-right`}>Perkiraan</th>
            <th className={`${th} text-right`}>Aktual sejauh ini</th>
            <th className={`${th} text-right`}>Sisa perkiraan</th>
            <th className={`${th} text-right`}>Hemat / Boros</th>
            <th className={`${th} text-left`}>Status</th>
          </tr>
        </thead>
        <tbody>
          {grup.map(({ g, rows }) => (
            <React.Fragment key={g}>
              <tr className="border-t border-[#2A2D31] bg-[#1E2124]">
                <td className="p-2 pl-2.5 text-[11px] font-bold text-[#e5c17b] uppercase tracking-wider">{GRUP_LABEL[g]}</td>
                <td className="p-2 text-right text-xs text-[#9aa0a6]">{idrFmt(sum(rows, 'perkiraan'))}</td>
                <td className="p-2 text-right text-xs text-[#9aa0a6]">{idrFmt(sum(rows, 'aktual'))}</td>
                <td className="p-2 text-right text-xs text-[#9aa0a6]">{Math.round(sum(rows, 'sisa')) ? idrFmt(sum(rows, 'sisa')) : '—'}</td>
                <td className={`p-2 text-right text-xs font-semibold ${selisihCls(sum(rows, 'selisih'))}`}>{selisihFmt(sum(rows, 'selisih'))}</td>
                <td />
              </tr>
              {rows.map((r, i) => (
                <tr key={i} className="border-t border-[#2A2D31]/60 hover:bg-[#1A1C1E]/50">
                  <td className="p-2.5 pl-5 text-[#e8eaed]">
                    {r.nama}
                    {r.keterangan && <span className="block text-[10px] text-[#5f6368]">{r.keterangan}</span>}
                  </td>
                  <td className="p-2.5 text-right text-[#e8eaed] whitespace-nowrap">{r.perkiraan ? idrFmt(r.perkiraan) : '—'}</td>
                  <td className="p-2.5 text-right text-[#e8eaed] whitespace-nowrap">{r.aktual ? idrFmt(r.aktual) : '—'}</td>
                  <td className="p-2.5 text-right text-blue-300 whitespace-nowrap">{Math.round(r.sisa) ? idrFmt(r.sisa) : '—'}</td>
                  <td className={`p-2.5 text-right font-semibold whitespace-nowrap ${selisihCls(r.selisih)}`}>
                    {selisihFmt(r.selisih)}
                    {Math.round(r.beda_tarif) !== 0 && (
                      <span className="block text-[10px] font-normal text-[#9aa0a6]">{selisihFmt(r.beda_tarif)} beda tarif</span>
                    )}
                  </td>
                  <td className={`p-2.5 text-xs whitespace-nowrap ${TANDA_BARIS[r.tanda].cls}`}>{TANDA_BARIS[r.tanda].label}</td>
                </tr>
              ))}
            </React.Fragment>
          ))}
          <tr className="border-t-2 border-[#2A2D31] bg-[#1A1C1E] font-bold">
            <td className="p-2.5 text-[#9aa0a6] text-xs uppercase">Total</td>
            <td className="p-2.5 text-right text-[#e8eaed]">{idrFmt(sum(baris, 'perkiraan'))}</td>
            <td className="p-2.5 text-right text-[#e8eaed]">{idrFmt(sum(baris, 'aktual'))}</td>
            <td className="p-2.5 text-right text-blue-300">{idrFmt(sum(baris, 'sisa'))}</td>
            <td className={`p-2.5 text-right ${selisihCls(sum(baris, 'selisih'))}`}>{selisihFmt(sum(baris, 'selisih'))}</td>
            <td />
          </tr>
        </tbody>
      </table>
    </div>
  );
}

// ─── Kesimpulan margin ───────────────────────────────────────────────────────

function KotakKesimpulan({ k }: { k: KesimpulanPO }) {
  const warna = k.peringatan ? 'bg-red-500/10 border-red-500/25' : 'bg-green-500/5 border-green-500/20';
  return (
    <div className={`p-4 rounded-lg border ${warna}`}>
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <p className="text-[10px] uppercase tracking-widest text-[#9aa0a6] font-bold">Kesimpulan</p>
        {k.peringatan && (
          <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-red-500/15 text-red-300 border border-red-500/30">
            ⚠ {k.peringatan === 'rugi' ? 'Rugi' : `Margin turun ${k.turun_pct}%`}
          </span>
        )}
        {k.sementara && (
          <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-orange-500/15 text-orange-300 border border-orange-500/30">Sementara</span>
        )}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
        {[
          { label: 'Nilai jual', value: idrFmt(k.nilai_jual), cls: 'text-[#e8eaed]',
            ket: 'Harga jual × pcs yang dipotong' },
          { label: 'Untung menurut HPP', value: `${k.margin_perkiraan < 0 ? '−' : ''}${idrFmt(k.margin_perkiraan)} (${k.margin_perkiraan_pct}%)`, cls: 'text-[#e8eaed]',
            ket: 'Nilai jual − perkiraan biaya (patokan sheet HPP)' },
          { label: 'Untung sebenarnya', value: `${k.margin_aktual < 0 ? '−' : ''}${idrFmt(k.margin_aktual)} (${k.margin_aktual_pct}%)`,
            cls: k.margin_aktual < 0 ? 'text-red-400' : 'text-green-400',
            ket: 'Nilai jual − (biaya aktual + sisa perkiraan)' },
          { label: 'Dibanding HPP', value: Math.round(k.selisih_margin) > 0 ? `Lebih untung ${idrFmt(k.selisih_margin)}`
              : Math.round(k.selisih_margin) < 0 ? `Kurang untung ${idrFmt(k.selisih_margin)}` : 'Sesuai',
            cls: Math.round(k.selisih_margin) < 0 ? 'text-red-400' : Math.round(k.selisih_margin) > 0 ? 'text-green-400' : 'text-[#9aa0a6]',
            ket: 'Untung sebenarnya − untung menurut HPP' },
        ].map(c => (
          <div key={c.label}>
            <p className="text-[10px] text-[#9aa0a6]">{c.label}</p>
            <p className={`text-sm font-bold ${c.cls}`}>{c.value}</p>
            <p className="text-[10px] text-[#5f6368] mt-0.5 leading-snug">{c.ket}</p>
          </div>
        ))}
      </div>
      <ul className="text-xs text-[#c0c6cc] space-y-1 list-disc pl-4">
        {k.kalimat.map((t, i) => <li key={i}>{t}</li>)}
      </ul>
    </div>
  );
}

// ─── Qty pesan vs dipotong vs dikirim ────────────────────────────────────────

const TANDA_QTY: Record<BarisQty['tanda'], { label: string; cls: string }> = {
  pas:    { label: 'Pas',                  cls: 'text-[#9aa0a6]' },
  kurang: { label: 'Kurang potong',        cls: 'text-red-400' },
  lebih:  { label: 'Lebih potong',         cls: 'text-amber-300' },
  proses: { label: 'Belum semua dipotong', cls: 'text-blue-300' },
};

function TabelQty({ rows }: { rows: BarisQty[] }) {
  if (rows.length === 0) {
    return <div className="p-8 rounded-lg border border-[#2A2D31] text-center text-[#5f6368] text-sm">Tidak ada item PO</div>;
  }
  const th = 'p-2.5 text-[#9aa0a6] text-[11px] font-bold uppercase tracking-wider';
  const jml = (k: 'pesan' | 'potong' | 'selisih' | 'kirim') => rows.reduce((s, r) => s + r[k], 0);
  const sel = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : '0');
  const selCls = (n: number) => (n < 0 ? 'text-red-400' : n > 0 ? 'text-amber-300' : 'text-[#9aa0a6]');
  const kurang = rows.filter(r => r.tanda === 'kurang');
  return (
    <div className="space-y-3">
      {kurang.length > 0 && (
        <p className="text-xs text-red-300">
          ⚠ Kurang potong {kurang.reduce((s, r) => s - r.selisih, 0).toLocaleString('id-ID')} pcs di {kurang.length} baris —
          potensi nilai jual {idrFmt(kurang.reduce((s, r) => s - r.selisih * r.harga_jual, 0))}.
          Perkiraan biaya tetap dihitung dari pcs yang dipotong.
        </p>
      )}
      <div className="rounded-lg border border-[#2A2D31] overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-[#1A1C1E]">
            <tr>
              <th className={`${th} text-left`}>Artikel</th>
              <th className={`${th} text-left`}>Warna</th>
              <th className={`${th} text-left`}>Size</th>
              <th className={`${th} text-right`}>Pesan</th>
              <th className={`${th} text-right`}>Dipotong</th>
              <th className={`${th} text-right`}>Selisih</th>
              <th className={`${th} text-right`}>Dikirim</th>
              <th className={`${th} text-left`}>Tanda</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.po_item_id} className="border-t border-[#2A2D31]/60 hover:bg-[#1A1C1E]/50">
                <td className="p-2.5 text-[#e8eaed]">{r.artikel}</td>
                <td className="p-2.5 text-[#e8eaed]">{r.warna}</td>
                <td className="p-2.5 text-[#e8eaed]">{r.size}</td>
                <td className="p-2.5 text-right text-[#9aa0a6]">{r.pesan.toLocaleString('id-ID')}</td>
                <td className="p-2.5 text-right text-[#e8eaed]">{r.potong.toLocaleString('id-ID')}</td>
                <td className={`p-2.5 text-right font-semibold ${selCls(r.selisih)}`}>{sel(r.selisih)}</td>
                <td className="p-2.5 text-right text-[#e8eaed]">{r.kirim.toLocaleString('id-ID')}</td>
                <td className={`p-2.5 text-xs whitespace-nowrap ${TANDA_QTY[r.tanda].cls}`}>{TANDA_QTY[r.tanda].label}</td>
              </tr>
            ))}
            <tr className="border-t-2 border-[#2A2D31] bg-[#1A1C1E] font-bold">
              <td colSpan={3} className="p-2.5 text-[#9aa0a6] text-xs uppercase">Total</td>
              <td className="p-2.5 text-right text-[#e8eaed]">{jml('pesan').toLocaleString('id-ID')}</td>
              <td className="p-2.5 text-right text-[#e8eaed]">{jml('potong').toLocaleString('id-ID')}</td>
              <td className={`p-2.5 text-right ${selCls(jml('selisih'))}`}>{sel(jml('selisih'))}</td>
              <td className="p-2.5 text-right text-[#e8eaed]">{jml('kirim').toLocaleString('id-ID')}</td>
              <td />
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
