'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  FileText,
  Barcode as BarcodeIcon,
  ClipboardList,
  Scissors,
  CheckCircle2,
  Loader2,
  Clock,
} from 'lucide-react';
import { toast } from 'sonner';
import type { POCuttingItem } from '@/lib/actions/produksi/cutting.actions';
import { mulaiCuttingBatch } from '@/lib/actions/produksi/cutting.actions';
import { getAntrianData } from '@/lib/actions/produksi/antrian.actions';
import type { AntrianBundle } from '@/lib/actions/produksi/antrian.actions';
import { getAksesoriForBundle } from '@/lib/actions/produksi/model-aksesori.actions';
import PrintSPKLayout from './PrintSPKLayout';
import PrintLabelLayout from './PrintLabelLayout';
import PrintKartuKerjaLayout from './PrintKartuKerjaLayout';
import type { AksesoriItem, KartuBundle } from './PrintKartuKerjaLayout';
import ModalSelesaiCutting from './ModalSelesaiCutting';

// ─── PROPS ───────────────────────────────────────────────────────────────────

interface Props {
  poList: POCuttingItem[];
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

type TabKey = 'menunggu' | 'progress' | 'selesai';

const TAB_LABELS: Record<TabKey, string> = {
  menunggu: 'Menunggu',
  progress: 'Sedang Dipotong',
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

// ─── COMPONENT ───────────────────────────────────────────────────────────────

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

  // ─── DATA PER TAB ─────────────────────────────────────────────────────────
  const tabData = poList.filter(p => p.status === activeTab);

  // Reset selection ketika tab berganti
  useEffect(() => { setSelectedPoIds(new Set()); }, [activeTab]);

  // ─── AFTERPRINT ───────────────────────────────────────────────────────────
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

  // ─── SELECTION ────────────────────────────────────────────────────────────
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

  // ─── HANDLER: MULAI CUTTING ───────────────────────────────────────────────
  const handleMulaiCutting = async () => {
    setIsLoadingMulai(true);
    const result = await mulaiCuttingBatch(Array.from(selectedPoIds));
    setIsLoadingMulai(false);
    if (result.error) {
      toast.error(result.error);
    } else {
      toast.success(`${result.jumlah_bundle} bundle mulai dipotong`);
      setSelectedPoIds(new Set());
      router.refresh();
    }
  };

  // ─── HANDLER: CETAK SPK ──────────────────────────────────────────────────
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

  // ─── HANDLER: CETAK LABEL ────────────────────────────────────────────────
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

  // ─── HANDLER: CETAK KARTU KERJA ──────────────────────────────────────────
  const handleCetakKartu = async () => {
    setIsLoadingPrint(true);
    try {
      const { antrian, dipotong } = await getAntrianData();
      const allBundles = [...antrian, ...dipotong];
      const filtered = allBundles.filter(b => selectedPoIds.has(b.po_id));
      if (!filtered.length) { toast.error('Tidak ada bundle ditemukan untuk PO terpilih'); return; }

      const SEMUA_TAHAP = ['cutting', 'jahit', 'buang_benang', 'lubang_kancing', 'qc', 'steam', 'packing'];

      const kartuData: KartuBundle[] = await Promise.all(
        filtered.map(async (bundle) => {
          const results = await Promise.all(
            SEMUA_TAHAP.map(tahap => getAksesoriForBundle(bundle.po_item_id, tahap))
          );
          const flatResults = results.flat();
          const unikMap = new Map<string, typeof flatResults[0]>();
          flatResults.forEach(item => {
            unikMap.set(`${item.inventory_item_id}-${item.tahap_pakai}`, item);
          });
          const aksesori: AksesoriItem[] = Array.from(unikMap.values()).map(item => ({
            nama:        item.inventory_item_nama,
            qty_per_pcs: item.qty_per_pcs,
            satuan:      item.satuan,
            tahap_pakai: item.tahap_pakai,
          }));
          return { ...bundle, aksesori };
        })
      );

      setKartuBundles(kartuData);
      setPrintMode('kartu');
    } catch {
      toast.error('Gagal menyiapkan data kartu kerja');
    } finally {
      setIsLoadingPrint(false);
    }
  };

  const hasSelection    = selectedPoIds.size > 0;
  const printLoading    = isLoadingPrint;
  const isProgressTab   = activeTab === 'progress';
  const isMenungguTab   = activeTab === 'menunggu';
  const isSelesaiTab    = activeTab === 'selesai';

  // ─── RENDER ──────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">

      {/* Toolbar */}
      <div className="print:hidden flex flex-col md:flex-row md:items-end justify-between gap-4 bg-[#1A1D1F] p-4 rounded-xl border border-[#2A2D31]">

        {/* Tabs */}
        <div className="flex p-1 bg-[#16181A] rounded-lg w-fit border border-[#2A2D31]">
          {(['menunggu', 'progress', 'selesai'] as TabKey[]).map(tab => {
            const count = poList.filter(p => p.status === tab).length;
            const isActive = activeTab === tab;
            return (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={'flex items-center gap-2 px-4 py-1.5 rounded-md text-sm font-medium transition-all ' +
                  (isActive ? 'bg-[#e5c17b] text-[#0D0E10]' : 'text-[#9aa0a6] hover:text-[#e8eaed]')}
              >
                <span>{TAB_LABELS[tab]}</span>
                <span className={'px-1.5 py-0.5 rounded-full text-[10px] ' +
                  (isActive ? 'bg-[#0D0E10]/10' : 'bg-[#2A2D31]')}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Mulai Cutting — hanya tab Menunggu */}
          {isMenungguTab && (
            <button
              disabled={!hasSelection || isLoadingMulai}
              onClick={handleMulaiCutting}
              className="flex items-center gap-2 px-4 h-10 rounded-md bg-[#e5c17b] text-[#0D0E10] text-sm font-semibold hover:bg-[#d4b06a] disabled:opacity-30 disabled:cursor-not-allowed transition-all"
            >
              {isLoadingMulai
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : <Scissors className="w-4 h-4" />}
              {isLoadingMulai ? 'Memproses...' : 'Mulai Cutting'}
            </button>
          )}

          {/* Selesai Cutting — hanya tab Progress */}
          {isProgressTab && (
            <button
              disabled={!hasSelection}
              onClick={() => setShowModalSelesai(true)}
              className="flex items-center gap-2 px-4 h-10 rounded-md bg-[#e5c17b] text-[#0D0E10] text-sm font-semibold hover:bg-[#d4b06a] disabled:opacity-30 disabled:cursor-not-allowed transition-all"
            >
              <CheckCircle2 className="w-4 h-4" />
              Selesai Cutting
            </button>
          )}

          {/* Print buttons — Menunggu & Progress */}
          {!isSelesaiTab && (
            <>
              <button
                disabled={!hasSelection || printLoading}
                onClick={handleCetakKartu}
                className="flex items-center gap-2 px-4 h-10 rounded-md border border-[#2A2D31] text-[#e8eaed] text-sm font-medium hover:bg-[#2A2D31] disabled:opacity-30 disabled:cursor-not-allowed transition-all"
              >
                {printLoading && printMode === null ? <Loader2 className="w-4 h-4 animate-spin" /> : <ClipboardList className="w-4 h-4" />}
                Cetak Kartu
              </button>
              <button
                disabled={!hasSelection || printLoading}
                onClick={handleCetakSPK}
                className="flex items-center gap-2 px-4 h-10 rounded-md border border-[#2A2D31] text-[#e8eaed] text-sm font-medium hover:bg-[#2A2D31] disabled:opacity-30 disabled:cursor-not-allowed transition-all"
              >
                <FileText className="w-4 h-4" />
                Cetak SPK
              </button>
              <button
                disabled={!hasSelection || printLoading}
                onClick={handleCetakLabel}
                className="flex items-center gap-2 px-4 h-10 rounded-md border border-[#2A2D31] text-[#e8eaed] text-sm font-medium hover:bg-[#2A2D31] disabled:opacity-30 disabled:cursor-not-allowed transition-all"
              >
                <BarcodeIcon className="w-4 h-4" />
                Cetak Label
              </button>
            </>
          )}
        </div>
      </div>

      {/* Selection info */}
      {hasSelection && !isSelesaiTab && (
        <p className="print:hidden text-xs text-[#9aa0a6]">
          Terpilih: <span className="text-[#e5c17b] font-bold">{selectedPoIds.size}</span> PO
        </p>
      )}

      {/* Tabel */}
      <div className="print:hidden rounded-xl border border-[#2A2D31] overflow-hidden">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-[#1A1C1E] border-b border-[#2A2D31]">
              {/* Checkbox all — hanya tab bukan selesai */}
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
          <tbody>
            {tabData.length === 0 ? (
              <tr>
                <td
                  colSpan={isSelesaiTab ? 6 : isProgressTab ? 8 : 7}
                  className="px-4 py-12 text-center text-[#5f6368] text-sm"
                >
                  Tidak ada data
                </td>
              </tr>
            ) : (
              tabData.map(po => {
                const isSelected = selectedPoIds.has(po.po_id);
                return (
                  <tr
                    key={po.po_id}
                    className={'border-b border-[#2A2D31] transition-colors ' +
                      (isSelected ? 'bg-[#e5c17b]/5' : 'hover:bg-[#1A1C1E]/50')}
                  >
                    {/* Checkbox */}
                    {!isSelesaiTab && (
                      <td className="px-4 py-3 text-center">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => togglePO(po.po_id)}
                          className="accent-[#e5c17b] w-4 h-4 cursor-pointer"
                        />
                      </td>
                    )}
                    <td className="px-4 py-3 font-bold text-[#e8eaed] font-mono">{po.no_po}</td>
                    <td className="px-4 py-3 text-[#9aa0a6]">{po.klien_nama}</td>
                    <td className="px-4 py-3 text-[#e8eaed]">{po.model_nama ?? '-'}</td>
                    <td className="px-4 py-3 text-center font-semibold text-[#e8eaed]">{po.total_bundle}</td>
                    <td className="px-4 py-3 text-center font-semibold text-[#e8eaed]">{po.total_qty} <span className="text-[#9aa0a6] font-normal text-xs">pcs</span></td>
                    <td className="px-4 py-3"><StatusBadge status={po.status} /></td>
                    {isProgressTab && (
                      <td className="px-4 py-3 text-xs text-[#9aa0a6]">
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {formatTime(po.start_time)}
                        </span>
                      </td>
                    )}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Modal Selesai Cutting */}
      {showModalSelesai && (
        <ModalSelesaiCutting
          poIds={Array.from(selectedPoIds)}
          onSuccess={() => {
            setShowModalSelesai(false);
            setSelectedPoIds(new Set());
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
