'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import {
  FileText, Barcode as BarcodeIcon, ClipboardList, Scissors, CheckCircle2,
  Loader2, Clock, ChevronDown, ChevronRight, Trash2, AlertTriangle, Ticket, Undo2, Archive,
} from 'lucide-react';
import { toast } from 'sonner';
import { deleteBundleMenunggu } from '@/lib/actions/produksi/cutting.actions';
import {
  getCuttingBundles, mulaiCuttingV2, getPrintBundlesByIds, batalMulaiCutting,
  type CuttingRow, type CuttingBundle, type CuttingStatus, type PemakaianCuttingRow,
} from '@/lib/actions/produksi/cutting-v2.actions';
import type { AntrianBundle } from '@/lib/actions/produksi/antrian.actions';
import { getAksesoriForKartuKerja } from '@/lib/actions/produksi/model-aksesori.actions';
import PrintCuttingTicketLayout from '../daftar-po/PrintCuttingTicketLayout';
import PrintSPKLayout from './PrintSPKLayout';
import PrintLabelLayout from './PrintLabelLayout';
import PrintKartuKerjaLayout from './PrintKartuKerjaLayout';
import type { AksesoriItem, KartuBundle } from './PrintKartuKerjaLayout';
import ModalMulaiCutting from './ModalMulaiCutting';
import ModalTutupDataLama, { type BundleUntukDitutup } from '@/components/produksi/ModalTutupDataLama';
import TombolDataDitutup from '@/components/produksi/TombolDataDitutup';
import ModalSelesaiCutting from './ModalSelesaiCutting';
import PemakaianBahanTab from './PemakaianBahanTab';

interface Props {
  poList: CuttingRow[];
  pemakaian: PemakaianCuttingRow[];
  role: string;
}

type PrintMode = 'tiket' | 'spk' | 'label' | 'kartu';

/** Tab tahap cutting + tab laporan pemakaian bahan */
type TabKey = CuttingStatus | 'pemakaian';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'menunggu',  label: 'Menunggu' },
  { key: 'progress',  label: 'Sedang Dipotong' },
  { key: 'selesai',   label: 'Selesai' },
  { key: 'pemakaian', label: 'Pemakaian Bahan' },
];

function formatTime(iso: string | null): string {
  if (!iso) return '-';
  return new Date(iso).toLocaleString('id-ID', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

export default function AntrianCuttingClient({ poList, pemakaian, role }: Props) {
  const router = useRouter();
  const isOwner = role === 'owner';

  const [tab, setTab] = useState<TabKey>('menunggu');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [cache, setCache] = useState<Record<string, CuttingBundle[]>>({});
  const [loadingRow, setLoadingRow] = useState<string | null>(null);
  /** row_id → bundle id terpilih. Satu-satunya sumber pilihan untuk semua tombol. */
  const [pilih, setPilih] = useState<Record<string, Set<string>>>({});

  const [showMulai, setShowMulai] = useState(false);
  const [showSelesai, setShowSelesai] = useState(false);
  const [showHapus, setShowHapus] = useState(false);
  const [showBatal, setShowBatal] = useState(false);
  const [showTutup, setShowTutup] = useState(false);
  const [busy, setBusy] = useState<null | 'mulai' | 'hapus' | 'print' | 'batal'>(null);

  const [printMode, setPrintMode] = useState<PrintMode | null>(null);
  const [printBundles, setPrintBundles] = useState<AntrianBundle[]>([]);
  const [kartuBundles, setKartuBundles] = useState<KartuBundle[]>([]);

  const rows = useMemo(() => poList.filter(r => r.status === tab), [poList, tab]);
  const counts = useMemo(() => ({
    ...Object.fromEntries(TABS.map(t => [t.key, poList.filter(r => r.status === t.key).length])),
    pemakaian: new Set(pemakaian.map(p => `${p.po_id}::${p.model_nama ?? ''}`)).size,
  }) as Record<TabKey, number>, [poList, pemakaian]);

  // Data server berubah (router.refresh) → buang cache & pilihan
  const [listSebelumnya, setListSebelumnya] = useState(poList);
  if (poList !== listSebelumnya) {
    setListSebelumnya(poList);
    setCache({}); setPilih({}); setExpanded(null);
  }

  const gantiTab = (t: TabKey) => { setTab(t); setPilih({}); setExpanded(null); };

  // Cetak: buka dialog print setelah layout ter-render
  useEffect(() => {
    if (!printMode) return;
    const t = setTimeout(() => window.print(), 200);
    return () => clearTimeout(t);
  }, [printMode]);
  useEffect(() => {
    const fn = () => { setPrintMode(null); setPrintBundles([]); setKartuBundles([]); };
    window.addEventListener('afterprint', fn);
    return () => window.removeEventListener('afterprint', fn);
  }, []);

  // ─── Bundle & pilihan ────────────────────────────────────────────────────
  const muatBundle = async (row: CuttingRow): Promise<CuttingBundle[]> => {
    if (cache[row.row_id]) return cache[row.row_id];
    setLoadingRow(row.row_id);
    try {
      const b = await getCuttingBundles(row.po_id, row.model_nama, row.status);
      setCache(p => ({ ...p, [row.row_id]: b }));
      return b;
    } catch (e) {
      toast.error('Gagal memuat bundle: ' + (e instanceof Error ? e.message : String(e)));
      return [];
    } finally {
      setLoadingRow(null);
    }
  };

  const toggleExpand = async (row: CuttingRow) => {
    if (expanded === row.row_id) { setExpanded(null); return; }
    setExpanded(row.row_id);
    await muatBundle(row);
  };

  /** Centang baris = pilih semua bundle di baris itu. */
  const toggleRow = async (row: CuttingRow) => {
    const sel = pilih[row.row_id];
    const bundles = await muatBundle(row);
    const penuh = sel && sel.size === bundles.length && bundles.length > 0;
    setPilih(p => ({ ...p, [row.row_id]: penuh ? new Set() : new Set(bundles.map(b => b.id)) }));
  };

  const toggleSemua = async () => {
    const semuaPenuh = rows.length > 0 && rows.every(r => {
      const s = pilih[r.row_id]; return s && s.size > 0 && s.size === (cache[r.row_id]?.length ?? -1);
    });
    if (semuaPenuh) { setPilih({}); return; }
    const next: Record<string, Set<string>> = {};
    for (const r of rows) next[r.row_id] = new Set((await muatBundle(r)).map(b => b.id));
    setPilih(next);
  };

  const toggleBundle = (rowIdKey: string, id: string) =>
    setPilih(p => {
      const s = new Set(p[rowIdKey] ?? []);
      if (s.has(id)) s.delete(id); else s.add(id);
      return { ...p, [rowIdKey]: s };
    });

  const terpilihIds = useMemo(() => Object.values(pilih).flatMap(s => [...s]), [pilih]);
  const terpilihBundles = useMemo(() => {
    const all = Object.values(cache).flat();
    const set = new Set(terpilihIds);
    return all.filter(b => set.has(b.id));
  }, [cache, terpilihIds]);
  const ada = terpilihIds.length > 0;

  /** Bundle terpilih + info PO/model untuk modal Tutup Data Lama */
  const terpilihUntukTutup = useMemo((): BundleUntukDitutup[] => {
    const set = new Set(terpilihIds);
    return Object.entries(cache).flatMap(([rid, list]) => {
      const row = poList.find(r => r.row_id === rid);
      return list.filter(b => set.has(b.id)).map(b => ({
        id: b.id, barcode: b.barcode, no_po: row?.no_po ?? '-',
        model_nama: row?.model_nama ?? null, warna: b.warna, size: b.size,
      }));
    });
  }, [cache, terpilihIds, poList]);

  const resetPilihan = () => { setPilih({}); };

  // ─── Aksi ────────────────────────────────────────────────────────────────
  const cetak = async (mode: PrintMode, ids: string[] = terpilihIds) => {
    if (!ids.length) return;
    setBusy('print');
    try {
      const data = await getPrintBundlesByIds(ids);
      if (!data.length) { toast.error('Bundle tidak ditemukan'); return; }
      if (mode === 'kartu') {
        const aks = await getAksesoriForKartuKerja([...new Set(data.map(b => b.po_item_id))]);
        setKartuBundles(data.map(b => ({
          ...b,
          aksesori: (aks[b.po_item_id] ?? []).map((i): AksesoriItem => ({
            nama: i.inventory_item_nama, qty_per_pcs: i.qty_per_pcs, satuan: i.satuan, tahap_pakai: i.tahap_pakai,
          })),
        })));
      } else {
        setPrintBundles(data);
      }
      setPrintMode(mode);
    } catch (e) {
      toast.error('Gagal menyiapkan cetak: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy(null);
    }
  };

  const mulai = async (items: { bundle_id: string; qty: number }[]) => {
    setBusy('mulai');
    const res = await mulaiCuttingV2(items);
    if (!res.success) {
      setBusy(null);
      toast.error(res.error ?? 'Gagal memulai cutting');
      return;
    }
    const sisa = res.sisa.reduce((s, x) => s + x.qty, 0);
    toast.success(`${res.jumlah_bundle} bundle mulai dipotong${sisa ? ` · sisa ${sisa} pcs tetap di Menunggu` : ''}`);
    setShowMulai(false);
    resetPilihan();
    setBusy(null);
    // Tiket Nomor Cutting otomatis untuk bundle yang baru dimulai
    await cetak('tiket', items.map(i => i.bundle_id));
    router.refresh();
  };

  const hapus = async () => {
    setShowHapus(false);
    setBusy('hapus');
    const res = await deleteBundleMenunggu(terpilihIds);
    setBusy(null);
    if (res.error) { toast.error(res.error); return; }
    toast.success(`${res.deleted} bundle dihapus`);
    resetPilihan();
    router.refresh();
  };

  const batal = async () => {
    setShowBatal(false);
    setBusy('batal');
    const res = await batalMulaiCutting(terpilihIds);
    setBusy(null);
    if (!res.success) { toast.error(res.error ?? 'Gagal membatalkan'); return; }
    toast.success(`${res.jumlah_bundle} bundle dikembalikan ke Menunggu` +
      (res.sisa_digabung ? ` · ${res.sisa_digabung} pcs sisa digabung kembali` : ''));
    resetPilihan();
    router.refresh();
  };

  // ─── Render ──────────────────────────────────────────────────────────────
  const btnSecondary = 'flex items-center gap-2 px-3 h-10 rounded-md border border-[#2A2D31] text-[#e8eaed] text-sm font-medium hover:bg-[#2A2D31] disabled:opacity-30 disabled:cursor-not-allowed';
  const btnPrimary = 'flex items-center gap-2 px-4 h-10 rounded-md bg-[#e5c17b] text-[#0D0E10] text-sm font-semibold hover:bg-[#d4b06a] disabled:opacity-30 disabled:cursor-not-allowed';
  const th = 'sticky top-0 z-10 px-4 py-3 text-[10px] uppercase tracking-widest text-[#9aa0a6] font-bold bg-[#16181A] border-b border-[#2A2D31]';
  const colCount = tab === 'menunggu' ? 7 : 8;

  return (
    <div className="space-y-6">
      {/* Toolbar */}
      <div className="print:hidden sticky top-0 z-20 bg-[#16181A] space-y-3 pb-3">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 bg-[#1A1D1F] p-4 rounded-xl border border-[#2A2D31]">
          <div className="flex p-1 bg-[#16181A] rounded-lg w-fit border border-[#2A2D31]">
            {TABS.map(t => (
              <button key={t.key} onClick={() => gantiTab(t.key)}
                className={'flex items-center gap-2 px-4 py-1.5 rounded-md text-sm font-medium transition-all ' +
                  (tab === t.key ? 'bg-[#e5c17b] text-[#0D0E10]' : 'text-[#9aa0a6] hover:text-[#e8eaed]')}>
                {t.label}
                <span className={'px-1.5 py-0.5 rounded-full text-[10px] ' + (tab === t.key ? 'bg-[#0D0E10]/10' : 'bg-[#2A2D31]')}>
                  {counts[t.key]}
                </span>
              </button>
            ))}
          </div>

          {tab !== 'pemakaian' && <div className="flex items-center gap-2 flex-wrap">
            <TombolDataDitutup onBerubah={() => router.refresh()} />
            {tab !== 'selesai' && (
              <button disabled={!ada || !!busy} onClick={() => setShowTutup(true)}
                title="PO/bundle yang sudah tidak akan dipotong — tutup tanpa upah, bisa dibuka lagi"
                className={btnSecondary}>
                <Archive className="w-4 h-4" /> Tutup Data Lama
              </button>
            )}
            {tab === 'menunggu' && (
              <>
                <button disabled={!ada || !!busy} onClick={() => setShowMulai(true)} className={btnPrimary}>
                  {busy === 'mulai' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Scissors className="w-4 h-4" />}
                  Mulai Cutting{ada ? ` (${terpilihIds.length})` : ''}
                </button>
                {isOwner && (
                  <button disabled={!ada || !!busy} onClick={() => setShowHapus(true)}
                    className="flex items-center gap-2 px-3 h-10 rounded-md border border-red-500/40 text-red-400 text-sm font-semibold hover:bg-red-500/10 disabled:opacity-30 disabled:cursor-not-allowed">
                    {busy === 'hapus' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />} Hapus
                  </button>
                )}
              </>
            )}
            {tab === 'progress' && (
              <button disabled={!ada || !!busy} onClick={() => setShowSelesai(true)} className={btnPrimary}>
                <CheckCircle2 className="w-4 h-4" /> Selesai Cutting{ada ? ` (${terpilihIds.length})` : ''}
              </button>
            )}
            {tab === 'progress' && (
              <button disabled={!ada || !!busy} onClick={() => setShowBatal(true)}
                className="flex items-center gap-2 px-3 h-10 rounded-md border border-orange-500/40 text-orange-400 text-sm font-semibold hover:bg-orange-500/10 disabled:opacity-30 disabled:cursor-not-allowed">
                {busy === 'batal' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Undo2 className="w-4 h-4" />} Batalkan
              </button>
            )}
            {tab !== 'menunggu' && (
              <button disabled={!ada || !!busy} onClick={() => cetak('tiket')} className={btnSecondary}>
                <Ticket className="w-4 h-4" /> Cetak Tiket
              </button>
            )}
            <button disabled={!ada || !!busy} onClick={() => cetak('kartu')} className={btnSecondary}>
              <ClipboardList className="w-4 h-4" /> Kartu
            </button>
            <button disabled={!ada || !!busy} onClick={() => cetak('spk')} className={btnSecondary}>
              <FileText className="w-4 h-4" /> SPK
            </button>
            <button disabled={!ada || !!busy} onClick={() => cetak('label')} className={btnSecondary}>
              <BarcodeIcon className="w-4 h-4" /> Label
            </button>
          </div>}
        </div>
        {ada && (
          <p className="text-xs text-[#9aa0a6]">
            Bundle terpilih: <span className="text-[#e5c17b] font-bold">{terpilihIds.length}</span>
            {' · '}{terpilihBundles.reduce((s, b) => s + (tab === 'selesai' ? (b.qty_aktual ?? b.qty_rencana) : b.qty_rencana), 0)} pcs
          </p>
        )}
      </div>

      {/* Tabel */}
      {tab === 'pemakaian' ? (
        <div className="print:hidden"><PemakaianBahanTab rows={pemakaian} isOwner={isOwner} onChanged={() => router.refresh()} /></div>
      ) : (
      <div className="print:hidden rounded-xl border border-[#2A2D31] bg-[#1A1D1F] overflow-hidden">
        <div className="overflow-auto max-h-[65vh]">
          <table className="w-full text-sm border-separate border-spacing-0">
            <thead>
              <tr>
                <th className={`${th} w-10 text-center`}>
                  <input type="checkbox" onChange={toggleSemua}
                    checked={rows.length > 0 && rows.every(r => (pilih[r.row_id]?.size ?? 0) > 0 && pilih[r.row_id]!.size === cache[r.row_id]?.length)}
                    className="accent-[#e5c17b] w-4 h-4 cursor-pointer" />
                </th>
                <th className={`${th} text-left`}>No PO</th>
                <th className={`${th} text-left`}>Klien</th>
                <th className={`${th} text-left`}>Artikel</th>
                <th className={`${th} text-center`}>Bundle</th>
                <th className={`${th} text-center`}>QTY</th>
                {tab !== 'menunggu' && <th className={`${th} text-left`}>{tab === 'progress' ? 'Mulai' : 'Selesai'}</th>}
                <th className={`${th} w-10`} />
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={colCount} className="px-4 py-12 text-center text-[#9aa0a6] text-sm">Tidak ada data di tab ini</td></tr>
              ) : rows.map(row => {
                const sel = pilih[row.row_id];
                const n = cache[row.row_id]?.length;
                const penuh = !!sel && sel.size > 0 && sel.size === n;
                const sebagian = !!sel && sel.size > 0 && !penuh;
                const bundles = cache[row.row_id];
                return (
                  <React.Fragment key={row.row_id}>
                    <tr onClick={() => toggleExpand(row)}
                      className={'cursor-pointer transition-colors ' + (sel?.size ? 'bg-[#e5c17b]/5' : 'hover:bg-[#1E2124]')}>
                      <td className="px-4 py-3 text-center border-b border-[#2A2D31]" onClick={e => e.stopPropagation()}>
                        {loadingRow === row.row_id
                          ? <Loader2 className="w-4 h-4 animate-spin text-[#e5c17b] mx-auto" />
                          : <input type="checkbox" checked={penuh}
                              ref={el => { if (el) el.indeterminate = sebagian; }}
                              onChange={() => toggleRow(row)} className="accent-[#e5c17b] w-4 h-4 cursor-pointer" />}
                      </td>
                      <td className="px-4 py-3 font-mono font-bold text-[#e5c17b] border-b border-[#2A2D31]">{row.no_po}</td>
                      <td className="px-4 py-3 text-[#9aa0a6] border-b border-[#2A2D31]">{row.klien_nama}</td>
                      <td className="px-4 py-3 text-[#e8eaed] border-b border-[#2A2D31]">{row.model_nama ?? '-'}</td>
                      <td className="px-4 py-3 text-center font-semibold text-[#e8eaed] border-b border-[#2A2D31]">
                        {sel?.size ? <><span className="text-[#e5c17b]">{sel.size}</span>/</> : null}{row.total_bundle}
                      </td>
                      <td className="px-4 py-3 text-center font-mono text-[#e8eaed] border-b border-[#2A2D31]">
                        {row.total_qty} <span className="text-[#9aa0a6] text-xs">pcs</span>
                        {row.qty_lebih > 0 && <span className="ml-1 text-[10px] text-sky-400 font-bold">+{row.qty_lebih}</span>}
                      </td>
                      {tab !== 'menunggu' && (
                        <td className="px-4 py-3 text-xs text-[#9aa0a6] border-b border-[#2A2D31]">
                          <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{formatTime(row.waktu)}</span>
                        </td>
                      )}
                      <td className="px-2 py-3 text-[#9aa0a6] border-b border-[#2A2D31]">
                        {expanded === row.row_id ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                      </td>
                    </tr>

                    {expanded === row.row_id && (
                      <tr>
                        <td colSpan={colCount} className="bg-[#16181A] px-4 py-3 border-b border-[#2A2D31]">
                          {!bundles ? (
                            <div className="flex items-center gap-2 text-[#9aa0a6] text-sm py-2"><Loader2 className="w-4 h-4 animate-spin" /> Memuat...</div>
                          ) : (
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="border-b border-[#2A2D31] text-[#9aa0a6] uppercase tracking-wider">
                                  <th className="w-8 py-1.5 px-2" />
                                  <th className="text-left py-1.5 px-2 font-bold">Barcode</th>
                                  <th className="text-left py-1.5 px-2 font-bold">Warna</th>
                                  <th className="text-left py-1.5 px-2 font-bold">Size</th>
                                  <th className="text-center py-1.5 px-2 font-bold">{tab === 'selesai' ? 'Hasil' : 'Isi'}</th>
                                </tr>
                              </thead>
                              <tbody>
                                {bundles.map(b => (
                                  <tr key={b.id} className="border-b border-[#2A2D31]/50 hover:bg-[#1A1D1F]">
                                    <td className="py-1.5 px-2">
                                      <input type="checkbox" checked={sel?.has(b.id) ?? false}
                                        onChange={() => toggleBundle(row.row_id, b.id)}
                                        className="accent-[#e5c17b] w-3.5 h-3.5 cursor-pointer" />
                                    </td>
                                    <td className="py-1.5 px-2 font-mono text-[#e5c17b]">{b.barcode}</td>
                                    <td className="py-1.5 px-2 text-[#e8eaed]">{b.warna}</td>
                                    <td className="py-1.5 px-2 text-[#e8eaed]">{b.size}</td>
                                    <td className="py-1.5 px-2 text-center text-[#e8eaed]">
                                      {tab === 'selesai' ? (b.qty_aktual ?? b.qty_rencana) : b.qty_rencana} pcs
                                      {b.qty_lebih > 0 && <span className="ml-1 text-sky-400 font-bold">+{b.qty_lebih}</span>}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      )}

      {/* Konfirmasi hapus */}
      {showHapus && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 print:hidden">
          <div className="bg-[#1A1D1F] border border-red-500/30 rounded-2xl p-6 w-full max-w-sm shadow-2xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-red-500/10 flex items-center justify-center"><AlertTriangle className="w-5 h-5 text-red-400" /></div>
              <div>
                <h3 className="font-bold text-[#e8eaed]">Hapus Bundle?</h3>
                <p className="text-xs text-[#9aa0a6] mt-0.5">Tindakan ini tidak bisa dibatalkan</p>
              </div>
            </div>
            <p className="text-sm text-[#9aa0a6] mb-6">
              Menghapus <span className="text-red-400 font-bold">{terpilihIds.length} bundle</span> yang masih Menunggu.
            </p>
            <div className="flex gap-3">
              <button onClick={() => setShowHapus(false)} className="flex-1 h-10 rounded-xl border border-[#2A2D31] text-[#9aa0a6] text-sm hover:bg-[#2A2D31]">Batal</button>
              <button onClick={hapus} className="flex-1 h-10 rounded-xl bg-red-500/20 border border-red-500/40 text-red-400 text-sm font-bold hover:bg-red-500/30">Ya, Hapus</button>
            </div>
          </div>
        </div>
      )}

      {/* Konfirmasi batalkan */}
      {showBatal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 print:hidden">
          <div className="bg-[#1A1D1F] border border-orange-500/30 rounded-2xl p-6 w-full max-w-sm shadow-2xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-orange-500/10 flex items-center justify-center"><Undo2 className="w-5 h-5 text-orange-400" /></div>
              <div>
                <h3 className="font-bold text-[#e8eaed]">Batalkan Cutting?</h3>
                <p className="text-xs text-[#9aa0a6] mt-0.5">Bundle kembali ke tab Menunggu</p>
              </div>
            </div>
            <p className="text-sm text-[#9aa0a6] mb-6">
              <span className="text-orange-400 font-bold">{terpilihIds.length} bundle</span> dikembalikan ke Menunggu.
              Kalau dulu dimulai sebagian, sisanya yang masih di Menunggu digabung kembali. Tiket cutting yang sudah tercetak tidak berlaku lagi.
            </p>
            <div className="flex gap-3">
              <button onClick={() => setShowBatal(false)} className="flex-1 h-10 rounded-xl border border-[#2A2D31] text-[#9aa0a6] text-sm hover:bg-[#2A2D31]">Tidak</button>
              <button onClick={batal} className="flex-1 h-10 rounded-xl bg-orange-500/20 border border-orange-500/40 text-orange-400 text-sm font-bold hover:bg-orange-500/30">Ya, Batalkan</button>
            </div>
          </div>
        </div>
      )}

      {showTutup && (
        <ModalTutupDataLama
          bundles={terpilihUntukTutup}
          onClose={() => setShowTutup(false)}
          onSelesai={() => { setShowTutup(false); resetPilihan(); router.refresh(); }}
        />
      )}

      {showMulai && (
        <ModalMulaiCutting
          bundles={terpilihBundles}
          isSubmitting={busy === 'mulai' || busy === 'print'}
          onSubmit={mulai}
          onClose={() => setShowMulai(false)}
        />
      )}

      {showSelesai && (
        <ModalSelesaiCutting
          selectedBundleIds={terpilihIds}
          onSuccess={() => { setShowSelesai(false); resetPilihan(); router.refresh(); }}
          onClose={() => setShowSelesai(false)}
        />
      )}

      {/* Layout cetak */}
      {printMode === 'tiket' && <PrintCuttingTicketLayout bundles={printBundles} />}
      {printMode === 'spk'   && <PrintSPKLayout bundles={printBundles} />}
      {printMode === 'label' && <PrintLabelLayout bundles={printBundles} />}
      {printMode === 'kartu' && (
        <PrintKartuKerjaLayout
          bundles={kartuBundles}
          tglCetak={new Date().toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' })}
        />
      )}
    </div>
  );
}
