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
} from 'lucide-react';
import { toast } from 'sonner';
import type { POCuttingItem, BundleDetailItem } from '@/lib/actions/produksi/cutting.actions';
import { mulaiCuttingBatch, getBundlesForPO } from '@/lib/actions/produksi/cutting.actions';
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
}

type TabKey = 'menunggu' | 'progress' | 'pending' | 'selesai';

const TAB_LABELS: Record<TabKey, string> = {
  menunggu: 'Menunggu',
  progress: 'Sedang Dipotong',
  pending:  'Pending Cutting',
  selesai:  'Selesai',
};

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

export default function AntrianCuttingClient({ poList }: Props) {
  const router = useRouter();

  const [activeTab, setActiveTab]           = useState<TabKey>('menunggu');
  const [selectedPoIds, setSelectedPoIds]   = useState<Set<string>>(new Set());
  const [isLoadingMulai, setIsLoadingMulai] = useState(false);
  const [isLoadingPrint, setIsLoadingPrint] = useState(false);
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

  const handleExpandPO = async (po_id: string) => {
    if (expandedPoId === po_id) { setExpandedPoId(null); return; }
    setExpandedPoId(po_id);
    if (bundleCache[po_id]) return;
    setLoadingDetail(po_id);
    try {
      const bundles = await getBundlesForPO(po_id);
      setBundleCache(prev => ({ ...prev, [po_id]: bundles }));
    } finally {
      setLoadingDetail(null);
    }
  };

  // Bundle-level checkbox helpers
  const toggleBundle = (po_id: string, bundle_id: string) => {
    setSelectedBundleIds(prev => {
      const set = new Set(prev[po_id] ?? []);
      set.has(bundle_id) ? set.delete(bundle_id) : set.add(bundle_id);
      return { ...prev, [po_id]: set };
    });
  };

  const toggleAllBundlesForPO = (po_id: string) => {
    const all = bundleCache[po_id] ?? [];
    setSelectedBundleIds(prev => {
      const set = prev[po_id] ?? new Set();
      const next = set.size === all.length ? new Set<string>() : new Set(all.map(b => b.id));
      return { ...prev, [po_id]: next };
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
      setSelectedPoIds(new Set(tabData.map(p => p.po_id)));
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

  const handleCetakSPK = async () => {
    setIsLoadingPrint(true);
    try {
      const { antrian, dipotong } = await getAntrianData();
      const allBundles = [...antrian, ...dipotong];
      const filtered = allBundles.filter(b => selectedPoIds.has(b.po_id));
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
      const { antrian, dipotong } = await getAntrianData();
      const allBundles = [...antrian, ...dipotong];
      const filtered = allBundles.filter(b => selectedPoIds.has(b.po_id));
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
      const { antrian, dipotong } = await getAntrianData();
      const allBundles = [...antrian, ...dipotong];
      const filtered = allBundles.filter(b => selectedPoIds.has(b.po_id));
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

      {/* Toolbar */}
      <div className="print:hidden flex flex-col md:flex-row md:items-end justify-between gap-4 bg-[#1A1D1F] p-4 rounded-xl border border-[#2A2D31]">

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
            <button
              disabled={!hasBundleSel || isLoadingMulai}
              onClick={handleMulaiCutting}
              className="flex items-center gap-2 px-4 h-10 rounded-md bg-[#e5c17b] text-[#0D0E10] text-sm font-semibold hover:bg-[#d4b06a] disabled:opacity-30 disabled:cursor-not-allowed transition-all"
            >
              {isLoadingMulai ? <Loader2 className="w-4 h-4 animate-spin" /> : <Scissors className="w-4 h-4" />}
              {isLoadingMulai ? 'Memproses...' : `Mulai Cutting${hasBundleSel ? ` (${allSelectedBundleIds.length})` : ''}`}
            </button>
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

          {!isSelesaiTab && (
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
        <p className="print:hidden text-xs text-[#9aa0a6]">
          Bundle terpilih: <span className="text-[#e5c17b] font-bold">{allSelectedBundleIds.length}</span>
        </p>
      )}

      {/* Pending Tab */}
      {isPendingTab && <PendingCuttingTab />}

      {/* Tabel PO (semua tab kecuali pending) */}
      {!isPendingTab && (
      <div className="print:hidden rounded-xl border border-[#2A2D31] bg-[#1A1D1F] overflow-hidden">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-[#16181A] border-b border-[#2A2D31]">
              {!isSelesaiTab && (
                <th className="w-10 px-4 py-3 text-center">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleAll}
                    className="accent-[#e5c17b] w-4 h-4 cursor-pointer"
                  />
                </th>
              )}
              <th className="px-4 py-3 text-left text-[10px] uppercase tracking-widest text-[#9aa0a6] font-bold">No PO</th>
              <th className="px-4 py-3 text-left text-[10px] uppercase tracking-widest text-[#9aa0a6] font-bold">Klien</th>
              <th className="px-4 py-3 text-left text-[10px] uppercase tracking-widest text-[#9aa0a6] font-bold">Model</th>
              <th className="px-4 py-3 text-center text-[10px] uppercase tracking-widest text-[#9aa0a6] font-bold">Bundle</th>
              <th className="px-4 py-3 text-center text-[10px] uppercase tracking-widest text-[#9aa0a6] font-bold">Total QTY</th>
              <th className="px-4 py-3 text-left text-[10px] uppercase tracking-widest text-[#9aa0a6] font-bold">Status</th>
              {isProgressTab && (
                <th className="px-4 py-3 text-left text-[10px] uppercase tracking-widest text-[#9aa0a6] font-bold">Mulai</th>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-[#2A2D31]">
            {tabData.length === 0 ? (
              <tr>
                <td
                  colSpan={isSelesaiTab ? 6 : isProgressTab ? 8 : 7}
                  className="px-4 py-12 text-center text-[#9aa0a6] text-sm bg-[#1A1D1F]"
                >
                  Tidak ada data di tab ini
                </td>
              </tr>
            ) : (
              tabData.map(po => {
                const isSelected = selectedPoIds.has(po.po_id);
                return (
                  <React.Fragment key={po.po_id}>
                    <tr
                      onClick={() => !isSelesaiTab && togglePO(po.po_id)}
                    className={'transition-colors ' +
                      (!isSelesaiTab ? 'cursor-pointer ' : '') +
                      (isSelected ? 'bg-[#e5c17b]/5' : 'bg-[#1A1D1F] hover:bg-[#1E2124]')}
                  >
                    {!isSelesaiTab && (
                      <td className="px-4 py-3 text-center" onClick={e => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => togglePO(po.po_id)}
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
                        <button onClick={e => { e.stopPropagation(); handleExpandPO(po.po_id); }}
                          className="ml-2 text-[#9aa0a6] hover:text-[#e5c17b] transition-colors">
                          {expandedPoId === po.po_id
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
                  {expandedPoId === po.po_id && (
                    <tr key={`${po.po_id}-expanded`}>
                      <td colSpan={isSelesaiTab ? 6 : isProgressTab ? 8 : 7}
                          className="bg-[#16181A] px-4 py-4 border-b border-[#2A2D31]">

                        {loadingDetail === po.po_id && (
                          <div className="flex items-center gap-2 text-[#9aa0a6] text-sm py-2">
                            <Loader2 className="w-4 h-4 animate-spin" /> Memuat detail...
                          </div>
                        )}

                        {bundleCache[po.po_id] && (
                          <div>
                            {/* Header ringkasan + select all */}
                            <div className="flex items-center justify-between mb-3">
                              <p className="text-[10px] text-[#9aa0a6] uppercase font-bold tracking-widest">
                                {bundleCache[po.po_id].length} Bundle
                                · {[...new Set(bundleCache[po.po_id].map(b => b.warna))].length} Warna
                                · {[...new Set(bundleCache[po.po_id].map(b => b.size))].length} Size
                              </p>
                              {!isSelesaiTab && (
                                <label className="flex items-center gap-1.5 text-[10px] text-[#9aa0a6] cursor-pointer hover:text-[#e5c17b]">
                                  <input
                                    type="checkbox"
                                    className="accent-[#e5c17b] w-3.5 h-3.5"
                                    checked={(selectedBundleIds[po.po_id]?.size ?? 0) === bundleCache[po.po_id].length}
                                    onChange={() => toggleAllBundlesForPO(po.po_id)}
                                  />
                                  Pilih Semua
                                </label>
                              )}
                            </div>
                            {/* Tabel bundle dengan checkbox */}
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
                                {bundleCache[po.po_id].map(bundle => (
                                  <tr key={bundle.id} className="border-b border-[#2A2D31]/50 hover:bg-[#1A1D1F]">
                                    {!isSelesaiTab && (
                                      <td className="py-1.5 px-2">
                                        <input
                                          type="checkbox"
                                          className="accent-[#e5c17b] w-3.5 h-3.5 cursor-pointer"
                                          checked={selectedBundleIds[po.po_id]?.has(bundle.id) ?? false}
                                          onChange={() => toggleBundle(po.po_id, bundle.id)}
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
