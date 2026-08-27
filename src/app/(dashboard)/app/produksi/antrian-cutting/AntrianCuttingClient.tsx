'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  FileText,
  Barcode as BarcodeIcon,
  ClipboardList,
  Scissors,
  CheckCircle2,
  Loader2,
  Clock,
  ChevronDown,
  ChevronRight,
  Trash2,
  AlertTriangle,
} from 'lucide-react';
import { toast } from 'sonner';
import type { POCuttingItem, BundleDetailItem } from '@/lib/actions/produksi/cutting.actions';
import { mulaiCuttingBatch, getBundlesForPO, deleteBundleMenunggu } from '@/lib/actions/produksi/cutting.actions';
import { getAntrianData } from '@/lib/actions/produksi/antrian.actions';
import type { AntrianBundle } from '@/lib/actions/produksi/antrian.actions';
import { getAksesoriForKartuKerja } from '@/lib/actions/produksi/model-aksesori.actions';
import PrintSPKLayout from './PrintSPKLayout';
import PrintLabelLayout from './PrintLabelLayout';
import PrintKartuKerjaLayout from './PrintKartuKerjaLayout';
import type { AksesoriItem, KartuBundle } from './PrintKartuKerjaLayout';
import ModalSelesaiCutting from './ModalSelesaiCutting';
import PendingCuttingTab from './PendingCuttingTab';

interface Props {
  poList: POCuttingItem[];
  role: string;
}

type TabKey = 'menunggu' | 'progress' | 'pending' | 'selesai';

const TAB_LABELS: Record<TabKey, string> = {
  menunggu: 'Menunggu',
  progress: 'Sedang Dipotong',
  pending:  'Pending Cutting',
  selesai:  'Selesai',
};

// Kunci gabungan po_id + model — harus identik dengan makeRowId di cutting.actions.ts
function makeRowId(po_id: string, model_nama: string | null): string {
  return `${po_id}::${model_nama ?? ''}`;
}

function formatTime(iso: string | null): string {
  if (!iso) return '-';
  return new Date(iso).toLocaleString('id-ID', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

const StatusBadge = ({ status }: { status: POCuttingItem['status'] }) => {
  const cfg = {
    menunggu: 'bg-[#2A2D31] text-[#9aa0a6]',
    progress: 'bg-[#e5c17b]/10 text-[#e5c17b] border border-[#e5c17b]/30',
    selesai:  'bg-green-500/10 text-green-400 border border-green-500/20',
  }[status];
  const labels = { menunggu: 'Menunggu', progress: 'Dipotong', selesai: 'Selesai' };
  return (
    <span className={'inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-widest ' + cfg}>
      {labels[status]}
    </span>
  );
};

export default function AntrianCuttingClient({ poList, role }: Props) {
  const router = useRouter();
  const isOwner = role === 'owner';

  const [activeTab, setActiveTab]           = useState<TabKey>('menunggu');
  const [selectedPoIds, setSelectedPoIds]   = useState<Set<string>>(new Set());
  const [isLoadingMulai, setIsLoadingMulai] = useState(false);
  const [isLoadingPrint, setIsLoadingPrint] = useState(false);
  const [isLoadingHapus, setIsLoadingHapus] = useState(false);
  const [showConfirmHapus, setShowConfirmHapus] = useState(false);
  const [showModalSelesai, setShowModalSelesai] = useState(false);
  const [printMode, setPrintMode]           = useState<'spk' | 'label' | 'kartu' | null>(null);
  const [spkBundles, setSpkBundles]         = useState<AntrianBundle[]>([]);
  const [kartuBundles, setKartuBundles]     = useState<KartuBundle[]>([]);

  const [expandedPoId, setExpandedPoId] = useState<string | null>(null);
  const [bundleCache, setBundleCache] = useState<Record<string, BundleDetailItem[]>>({});
  const [loadingDetail, setLoadingDetail] = useState<string | null>(null);

  // Bundle-level selection: map po_id → Set<bundle_id>
  const [selectedBundleIds, setSelectedBundleIds] = useState<Record<string, Set<string>>>({});

  const tabData = poList.filter(p => p.status === (activeTab === 'pending' ? 'progress' : activeTab));

  useEffect(() => {
    setSelectedPoIds(new Set());
    setSelectedBundleIds({});
  }, [activeTab]);

  useEffect(() => {
    if (printMode !== null) {
      const t = setTimeout(() => window.print(), 200);
      return () => clearTimeout(t);
    }
  }, [printMode]);

  useEffect(() => {
    const fn = () => { setPrintMode(null); setSpkBundles([]); setKartuBundles([]); };
    window.addEventListener('afterprint', fn);
    return () => window.removeEventListener('afterprint', fn);
  }, []);

  const handleExpandPO = async (po: POCuttingItem) => {
    const { row_id, po_id, model_nama } = po;
    if (expandedPoId === row_id) { setExpandedPoId(null); return; }
    setExpandedPoId(row_id);
    if (bundleCache[row_id]) return;
    setLoadingDetail(row_id);
    try {
      const bundles = await getBundlesForPO(po_id, model_nama);
      setBundleCache(prev => ({ ...prev, [row_id]: bundles }));
    } finally {
      setLoadingDetail(null);
    }
  };

  // Bundle-level checkbox helpers (dikunci per row_id: po_id + model)
  const toggleBundle = (row_id: string, bundle_id: string) => {
    setSelectedBundleIds(prev => {
      const set = new Set(prev[row_id] ?? []);
      set.has(bundle_id) ? set.delete(bundle_id) : set.add(bundle_id);
      return { ...prev, [row_id]: set };
    });
  };

  // Bundle yang cutting-nya sudah diselesaikan tidak boleh dipilih lagi — kalau
  // diproses ulang lewat Selesai Cutting, pemakaian bahan bisa terpotong dua
  // kali untuk bundle yang sama (RPC di-database juga sudah menolaknya).
  //
  // 'partial' ikut dikunci: bundle itu SUDAH memotong stok bahan sekali, dan
  // Selesai Cutting menimpa qty_aktual (bukan menambah) — memprosesnya lagi
  // dari sini akan memotong stok dua kali sekaligus menghapus qty yang sudah
  // tercatat. Potongan susulannya dicatat lewat tab Pending.
  const getPilihableBundles = (row_id: string) =>
    (bundleCache[row_id] ?? []).filter(
      b => b.cutting_status !== 'selesai' && b.cutting_status !== 'partial'
    );

  const toggleAllBundlesForPO = (row_id: string) => {
    const all = getPilihableBundles(row_id);
    setSelectedBundleIds(prev => {
      const set = prev[row_id] ?? new Set();
      const next = set.size === all.length ? new Set<string>() : new Set(all.map(b => b.id));
      return { ...prev, [row_id]: next };
    });
  };

  // Flat list of all selected bundle ids across all POs
  const allSelectedBundleIds = Object.values(selectedBundleIds).flatMap(s => Array.from(s));

  const togglePO = (id: string) => {
    setSelectedPoIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selectedPoIds.size === tabData.length && tabData.length > 0) {
      setSelectedPoIds(new Set());
    } else {
      setSelectedPoIds(new Set(tabData.map(p => p.row_id)));
    }
  };

  const allSelected = tabData.length > 0 && selectedPoIds.size === tabData.length;

  const handleMulaiCutting = async () => {
    if (allSelectedBundleIds.length === 0) return;
    setIsLoadingMulai(true);
    const result = await mulaiCuttingBatch(allSelectedBundleIds);
    setIsLoadingMulai(false);
    if (result.error) {
      toast.error(result.error);
    } else {
      toast.success(`${result.jumlah_bundle} bundle mulai dipotong`);
      setSelectedPoIds(new Set());
      setSelectedBundleIds({});
      router.refresh();
    }
  };

  const handleHapusBundle = async () => {
    if (!allSelectedBundleIds.length) return;
    setIsLoadingHapus(true);
    setShowConfirmHapus(false);
    const result = await deleteBundleMenunggu(allSelectedBundleIds);
    setIsLoadingHapus(false);
    if (result.error) {
      toast.error(result.error);
    } else {
      toast.success(`${result.deleted} bundle berhasil dihapus`);
      setSelectedPoIds(new Set());
      setSelectedBundleIds({});
      setBundleCache({});
      router.refresh();
    }
  };

  const handleCetakSPK = async () => {
    setIsLoadingPrint(true);
    try {
      const { antrian, dipotong, selesai } = await getAntrianData();
      const allBundles = [...antrian, ...dipotong, ...selesai];
      // Gabungkan bundle dari checkbox baris utama (selectedPoIds) DAN checkbox
      // per-bundle di panel detail (allSelectedBundleIds) — sebelumnya cetak
      // hanya baca selectedPoIds, jadi bundle yang dicentang di detail terlewat.
      const selectedBundleIdSet = new Set(allSelectedBundleIds);
      const filtered = allBundles.filter(b =>
        selectedPoIds.has(makeRowId(b.po_id, b.model_nama)) || selectedBundleIdSet.has(b.id)
      );
      if (!filtered.length) { toast.error('Tidak ada bundle ditemukan untuk PO terpilih'); return; }
      setSpkBundles(filtered);
      setPrintMode('spk');
    } catch {
      toast.error('Gagal memuat data SPK');
    } finally {
      setIsLoadingPrint(false);
    }
  };

  const handleCetakLabel = async () => {
    setIsLoadingPrint(true);
    try {
      const { antrian, dipotong, selesai } = await getAntrianData();
      const allBundles = [...antrian, ...dipotong, ...selesai];
      const selectedBundleIdSet = new Set(allSelectedBundleIds);
      const filtered = allBundles.filter(b =>
        selectedPoIds.has(makeRowId(b.po_id, b.model_nama)) || selectedBundleIdSet.has(b.id)
      );
      if (!filtered.length) { toast.error('Tidak ada bundle ditemukan untuk PO terpilih'); return; }
      setSpkBundles(filtered);
      setPrintMode('label');
    } catch {
      toast.error('Gagal memuat data Label');
    } finally {
      setIsLoadingPrint(false);
    }
  };

  const handleCetakKartu = async () => {
    setIsLoadingPrint(true);
    try {
      const { antrian, dipotong, selesai } = await getAntrianData();
      const allBundles = [...antrian, ...dipotong, ...selesai];
      const selectedBundleIdSet = new Set(allSelectedBundleIds);
      const filtered = allBundles.filter(b =>
        selectedPoIds.has(makeRowId(b.po_id, b.model_nama)) || selectedBundleIdSet.has(b.id)
      );
      if (!filtered.length) { toast.error('Tidak ada bundle ditemukan untuk PO terpilih'); return; }

      // 1 call saja untuk semua po_item_id — drastis lebih cepat
      const poItemIds = [...new Set(filtered.map(b => b.po_item_id))];
      const aksesoriMap = await getAksesoriForKartuKerja(poItemIds);

      const kartuData: KartuBundle[] = filtered.map(bundle => {
        const aksesori: AksesoriItem[] = (aksesoriMap[bundle.po_item_id] ?? []).map(item => ({
          nama:        item.inventory_item_nama,
          qty_per_pcs: item.qty_per_pcs,
          satuan:      item.satuan,
          tahap_pakai: item.tahap_pakai,
        }));
        return { ...bundle, aksesori };
      });

      setKartuBundles(kartuData);
      setPrintMode('kartu');
    } catch {
      toast.error('Gagal menyiapkan data kartu kerja');
    } finally {
      setIsLoadingPrint(false);
    }
  };

  const hasSelection    = selectedPoIds.size > 0 || allSelectedBundleIds.length > 0;
  const hasBundleSel    = allSelectedBundleIds.length > 0;
  const isProgressTab   = activeTab === 'progress';
  const isMenungguTab   = activeTab === 'menunggu';
  const isSelesaiTab    = activeTab === 'selesai';
  const isPendingTab    = activeTab === 'pending';

  return (
    <div className="space-y-6">

      {/* Toolbar + info seleksi — freeze di atas saat scroll */}
      <div className="print:hidden sticky top-0 z-20 bg-[#16181A] space-y-3 pb-3">

      {/* Toolbar */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 bg-[#1A1D1F] p-4 rounded-xl border border-[#2A2D31]">

        {/* Tabs */}
        <div className="flex p-1 bg-[#16181A] rounded-lg w-fit border border-[#2A2D31]">
          {(['menunggu', 'progress', 'pending', 'selesai'] as TabKey[]).map(tab => {
            const count = tab === 'pending'
              ? '?' // self-fetching; count shown inside PendingCuttingTab
              : poList.filter(p => p.status === tab).length;
            const isActive = activeTab === tab;
            const isPendingWithData = false; // badge handled inside PendingCuttingTab
            return (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={'flex items-center gap-2 px-4 py-1.5 rounded-md text-sm font-medium transition-all ' +
                  (isActive ? 'bg-[#e5c17b] text-[#0D0E10]' : 'text-[#9aa0a6] hover:text-[#e8eaed]')}
              >
                <span>{TAB_LABELS[tab]}</span>
                <span className={'px-1.5 py-0.5 rounded-full text-[10px] ' +
                  (isActive ? 'bg-[#0D0E10]/10' : isPendingWithData ? 'bg-red-500/20 text-red-400' : 'bg-[#2A2D31]')}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2 flex-wrap">
          {isMenungguTab && (
            <>
              <button
                disabled={!hasBundleSel || isLoadingMulai}
                onClick={handleMulaiCutting}
                className="flex items-center gap-2 px-4 h-10 rounded-md bg-[#e5c17b] text-[#0D0E10] text-sm font-semibold hover:bg-[#d4b06a] disabled:opacity-30 disabled:cursor-not-allowed transition-all"
              >
                {isLoadingMulai ? <Loader2 className="w-4 h-4 animate-spin" /> : <Scissors className="w-4 h-4" />}
                {isLoadingMulai ? 'Memproses...' : `Mulai Cutting${hasBundleSel ? ` (${allSelectedBundleIds.length})` : ''}`}
              </button>

              {isOwner && (
                <button
                  disabled={!hasBundleSel || isLoadingHapus}
                  onClick={() => setShowConfirmHapus(true)}
                  className="flex items-center gap-2 px-4 h-10 rounded-md border border-red-500/40 text-red-400 text-sm font-semibold hover:bg-red-500/10 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                >
                  {isLoadingHapus ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                  {isLoadingHapus ? 'Menghapus...' : `Hapus${hasBundleSel ? ` (${allSelectedBundleIds.length})` : ''}`}
                </button>
              )}
            </>
          )}

          {isProgressTab && (
            <button
              disabled={!hasBundleSel}
              onClick={() => setShowModalSelesai(true)}
              className="flex items-center gap-2 px-4 h-10 rounded-md bg-[#e5c17b] text-[#0D0E10] text-sm font-semibold hover:bg-[#d4b06a] disabled:opacity-30 disabled:cursor-not-allowed transition-all"
            >
              <CheckCircle2 className="w-4 h-4" />
              {`Selesai Cutting${hasBundleSel ? ` (${allSelectedBundleIds.length})` : ''}`}
            </button>
          )}

          {!isPendingTab && (
            <>
              <button
                disabled={!hasSelection || isLoadingPrint}
                onClick={handleCetakKartu}
                className="flex items-center gap-2 px-4 h-10 rounded-md border border-[#2A2D31] text-[#e8eaed] text-sm font-medium hover:bg-[#2A2D31] disabled:opacity-30 disabled:cursor-not-allowed transition-all"
              >
                <ClipboardList className="w-4 h-4" /> Cetak Kartu
              </button>
              <button
                disabled={!hasSelection || isLoadingPrint}
                onClick={handleCetakSPK}
                className="flex items-center gap-2 px-4 h-10 rounded-md border border-[#2A2D31] text-[#e8eaed] text-sm font-medium hover:bg-[#2A2D31] disabled:opacity-30 disabled:cursor-not-allowed transition-all"
              >
                <FileText className="w-4 h-4" /> Cetak SPK
              </button>
              <button
                disabled={!hasSelection || isLoadingPrint}
                onClick={handleCetakLabel}
                className="flex items-center gap-2 px-4 h-10 rounded-md border border-[#2A2D31] text-[#e8eaed] text-sm font-medium hover:bg-[#2A2D31] disabled:opacity-30 disabled:cursor-not-allowed transition-all"
              >
                <BarcodeIcon className="w-4 h-4" /> Cetak Label
              </button>
            </>
          )}
        </div>
      </div>

      {/* Selection info */}
      {hasBundleSel && !isSelesaiTab && !isPendingTab && (
        <p className="text-xs text-[#9aa0a6]">
          Bundle terpilih: <span className="text-[#e5c17b] font-bold">{allSelectedBundleIds.length}</span>
        </p>
      )}
      </div>

      {/* Pending Tab */}
      {isPendingTab && <PendingCuttingTab />}

      {/* Tabel PO (semua tab kecuali pending) */}
      {!isPendingTab && (
      <div className="print:hidden rounded-xl border border-[#2A2D31] bg-[#1A1D1F] overflow-hidden">
        <div className="overflow-auto max-h-[65vh]">
        <table className="w-full text-sm border-separate border-spacing-0">
          <thead>
            <tr className="bg-[#16181A]">
              {!isPendingTab && (
                <th
                  className="sticky top-0 z-10 w-10 px-4 py-3 text-center bg-[#16181A] border-b border-[#2A2D31] first:rounded-tl-xl last:rounded-tr-xl"
                >
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleAll}
                    className="accent-[#e5c17b] w-4 h-4 cursor-pointer"
                  />
                </th>
              )}
              <th className="sticky top-0 z-10 px-4 py-3 text-left text-[10px] uppercase tracking-widest text-[#9aa0a6] font-bold bg-[#16181A] border-b border-[#2A2D31] first:rounded-tl-xl last:rounded-tr-xl">No PO</th>
              <th className="sticky top-0 z-10 px-4 py-3 text-left text-[10px] uppercase tracking-widest text-[#9aa0a6] font-bold bg-[#16181A] border-b border-[#2A2D31] first:rounded-tl-xl last:rounded-tr-xl">Klien</th>
              <th className="sticky top-0 z-10 px-4 py-3 text-left text-[10px] uppercase tracking-widest text-[#9aa0a6] font-bold bg-[#16181A] border-b border-[#2A2D31] first:rounded-tl-xl last:rounded-tr-xl">Model</th>
              <th className="sticky top-0 z-10 px-4 py-3 text-center text-[10px] uppercase tracking-widest text-[#9aa0a6] font-bold bg-[#16181A] border-b border-[#2A2D31] first:rounded-tl-xl last:rounded-tr-xl">Bundle</th>
              <th className="sticky top-0 z-10 px-4 py-3 text-center text-[10px] uppercase tracking-widest text-[#9aa0a6] font-bold bg-[#16181A] border-b border-[#2A2D31] first:rounded-tl-xl last:rounded-tr-xl">Total QTY</th>
              <th className="sticky top-0 z-10 px-4 py-3 text-left text-[10px] uppercase tracking-widest text-[#9aa0a6] font-bold bg-[#16181A] border-b border-[#2A2D31] first:rounded-tl-xl last:rounded-tr-xl">Status</th>
              {isProgressTab && (
                <th className="sticky top-0 z-10 px-4 py-3 text-left text-[10px] uppercase tracking-widest text-[#9aa0a6] font-bold bg-[#16181A] border-b border-[#2A2D31] first:rounded-tl-xl last:rounded-tr-xl">Mulai</th>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-[#2A2D31]">
            {tabData.length === 0 ? (
              <tr>
                <td
                  colSpan={isProgressTab ? 8 : 7}
                  className="px-4 py-12 text-center text-[#9aa0a6] text-sm bg-[#1A1D1F]"
                >
                  Tidak ada data di tab ini
                </td>
              </tr>
            ) : (
              tabData.map(po => {
                const isSelected = selectedPoIds.has(po.row_id);
                return (
                  <React.Fragment key={po.row_id}>
                    <tr
                      onClick={() => !isPendingTab && togglePO(po.row_id)}
                    className={'transition-colors ' +
                      (!isPendingTab ? 'cursor-pointer ' : '') +
                      (isSelected ? 'bg-[#e5c17b]/5' : 'bg-[#1A1D1F] hover:bg-[#1E2124]')}
                  >
                    {!isPendingTab && (
                      <td className="px-4 py-3 text-center" onClick={e => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => togglePO(po.row_id)}
                          className="accent-[#e5c17b] w-4 h-4 cursor-pointer"
                        />
                      </td>
                    )}
                    <td className="px-4 py-3 font-mono font-bold text-[#e5c17b]">{po.no_po}</td>
                    <td className="px-4 py-3 text-[#9aa0a6]">{po.klien_nama}</td>
                    <td className="px-4 py-3 text-[#e8eaed]">{po.model_nama ?? '-'}</td>
                    <td className="px-4 py-3 text-center font-semibold text-[#e8eaed]">{po.total_bundle}</td>
                    <td className="px-4 py-3 text-center font-mono text-[#e8eaed]">
                      {po.total_qty} <span className="text-[#9aa0a6] font-normal text-xs">pcs</span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center">
                        <StatusBadge status={po.status} />
                        <button onClick={e => { e.stopPropagation(); handleExpandPO(po); }}
                          className="ml-2 text-[#9aa0a6] hover:text-[#e5c17b] transition-colors">
                          {expandedPoId === po.row_id
                            ? <ChevronDown className="w-4 h-4" />
                            : <ChevronRight className="w-4 h-4" />}
                        </button>
                      </div>
                    </td>
                    {isProgressTab && (
                      <td className="px-4 py-3 text-xs text-[#9aa0a6]">
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {formatTime(po.start_time)}
                        </span>
                      </td>
                    )}
                  </tr>
                  {expandedPoId === po.row_id && (
                    <tr key={`${po.row_id}-expanded`}>
                      <td colSpan={isProgressTab ? 8 : 7}
                          className="bg-[#16181A] px-4 py-4 border-b border-[#2A2D31]">

                        {loadingDetail === po.row_id && (
                          <div className="flex items-center gap-2 text-[#9aa0a6] text-sm py-2">
                            <Loader2 className="w-4 h-4 animate-spin" /> Memuat detail...
                          </div>
                        )}

                        {bundleCache[po.row_id] && (
                          <div>
                            {/* Header ringkasan + select all */}
                            <div className="flex items-center justify-between mb-3">
                              {(() => {
                                const visibleBundles = isSelesaiTab
                                  ? bundleCache[po.row_id]
                                  : getPilihableBundles(po.row_id);
                                return (
                                  <p className="text-[10px] text-[#9aa0a6] uppercase font-bold tracking-widest">
                                    {visibleBundles.length} Bundle
                                    · {[...new Set(visibleBundles.map(b => b.warna))].length} Warna
                                    · {[...new Set(visibleBundles.map(b => b.size))].length} Size
                                  </p>
                                );
                              })()}
                              {!isSelesaiTab && (
                                <label className="flex items-center gap-1.5 text-[10px] text-[#9aa0a6] cursor-pointer hover:text-[#e5c17b]">
                                  <input
                                    type="checkbox"
                                    className="accent-[#e5c17b] w-3.5 h-3.5"
                                    checked={(selectedBundleIds[po.row_id]?.size ?? 0) === getPilihableBundles(po.row_id).length}
                                    onChange={() => toggleAllBundlesForPO(po.row_id)}
                                  />
                                  Pilih Semua
                                </label>
                              )}
                            </div>
                            {/* Tabel bundle dengan checkbox — bundle yang cutting-nya
                                sudah "selesai" disembunyikan dari tab selain Selesai,
                                supaya tidak bisa dipilih & diproses ulang. */}
                            <table className="w-full text-xs border-collapse">
                              <thead>
                                <tr className="border-b border-[#2A2D31]">
                                  {!isSelesaiTab && <th className="w-8 py-1.5 px-2" />}
                                  <th className="text-left py-1.5 px-2 text-[#9aa0a6] font-bold uppercase tracking-wider">Barcode</th>
                                  <th className="text-left py-1.5 px-2 text-[#9aa0a6] font-bold uppercase tracking-wider">Warna</th>
                                  <th className="text-left py-1.5 px-2 text-[#9aa0a6] font-bold uppercase tracking-wider">Size</th>
                                  <th className="text-center py-1.5 px-2 text-[#9aa0a6] font-bold uppercase tracking-wider">Qty Order</th>
                                  <th className="text-left py-1.5 px-2 text-[#9aa0a6] font-bold uppercase tracking-wider">Status Cutting</th>
                                </tr>
                              </thead>
                              <tbody>
                                {(isSelesaiTab ? bundleCache[po.row_id] : getPilihableBundles(po.row_id)).map(bundle => (
                                  <tr key={bundle.id} className="border-b border-[#2A2D31]/50 hover:bg-[#1A1D1F]">
                                    {!isSelesaiTab && (
                                      <td className="py-1.5 px-2">
                                        <input
                                          type="checkbox"
                                          className="accent-[#e5c17b] w-3.5 h-3.5 cursor-pointer"
                                          checked={selectedBundleIds[po.row_id]?.has(bundle.id) ?? false}
                                          onChange={() => toggleBundle(po.row_id, bundle.id)}
                                        />
                                      </td>
                                    )}
                                    <td className="py-1.5 px-2 font-mono text-[#e5c17b]">{bundle.barcode}</td>
                                    <td className="py-1.5 px-2 text-[#e8eaed]">{bundle.warna}</td>
                                    <td className="py-1.5 px-2 text-[#e8eaed]">{bundle.size}</td>
                                    <td className="py-1.5 px-2 text-center text-[#e8eaed]">{bundle.qty_per_bundle}</td>
                                    <td className="py-1.5 px-2">
                                      {bundle.cutting_status === 'selesai'
                                        ? <span className="text-green-400 font-bold">Selesai</span>
                                        : bundle.cutting_status === 'partial'
                                        ? <span className="text-orange-400 font-bold">Partial</span>
                                        : bundle.cutting_status === 'progress'
                                        ? <span className="text-[#e5c17b] font-bold">Dipotong</span>
                                        : <span className="text-[#9aa0a6]">Menunggu</span>}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })
            )}
          </tbody>
        </table>
        </div>
      </div>
      )}

      {/* Dialog Konfirmasi Hapus */}
      {showConfirmHapus && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-[#1A1D1F] border border-red-500/30 rounded-2xl p-6 w-full max-w-sm shadow-2xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-red-500/10 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5 text-red-400" />
              </div>
              <div>
                <h3 className="font-bold text-[#e8eaed]">Hapus Bundle?</h3>
                <p className="text-xs text-[#9aa0a6] mt-0.5">Tindakan ini tidak bisa dibatalkan</p>
              </div>
            </div>
            <p className="text-sm text-[#9aa0a6] mb-6">
              Anda akan menghapus <span className="text-red-400 font-bold">{allSelectedBundleIds.length} bundle</span> yang masih berstatus menunggu. Bundle yang sudah mulai proses cutting tidak akan terhapus.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowConfirmHapus(false)}
                className="flex-1 h-10 rounded-xl border border-[#2A2D31] text-[#9aa0a6] text-sm font-medium hover:bg-[#2A2D31] transition-colors"
              >
                Batal
              </button>
              <button
                onClick={handleHapusBundle}
                className="flex-1 h-10 rounded-xl bg-red-500/20 border border-red-500/40 text-red-400 text-sm font-bold hover:bg-red-500/30 transition-colors"
              >
                Ya, Hapus
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Selesai Cutting */}
      {showModalSelesai && (
        <ModalSelesaiCutting
          selectedBundleIds={allSelectedBundleIds}
          onSuccess={() => {
            setShowModalSelesai(false);
            setSelectedPoIds(new Set());
            setSelectedBundleIds({});
            router.refresh();
          }}
          onClose={() => setShowModalSelesai(false)}
        />
      )}

      {/* Print Layouts */}
      {printMode === 'spk'   && <PrintSPKLayout bundles={spkBundles} />}
      {printMode === 'label' && <PrintLabelLayout bundles={spkBundles} />}
      {printMode === 'kartu' && (
        <PrintKartuKerjaLayout
          bundles={kartuBundles}
          tglCetak={new Date().toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' })}
        />
      )}
    </div>
  );
}
