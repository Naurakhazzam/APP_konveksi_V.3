'use client';

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { type AntrianJahitBundle } from '@/lib/actions/produksi/scan.actions';
import { getRiwayatSelesaiJahit, type SelesaiJahitItem } from '@/lib/actions/produksi/jahit.actions';
import { matchesBundleQuery } from '@/lib/search/bundle-search';
import StagePagination from '@/components/produksi/StagePagination';
import ModalSerahTerimaJahit from './ModalSerahTerimaJahit';
import ModalSplitBundle from './ModalSplitBundle';
import ModalSplitAwalJahit from './ModalSplitAwalJahit';
import ModalBatchSelesaiJahit from './ModalBatchSelesaiJahit';
import ModalKoreksiSerahTerima from './ModalKoreksiSerahTerima';
import ModalKoreksiCutting from './ModalKoreksiCutting';
import ModalBatalJahit, { type BundleBatal } from './ModalBatalJahit';
import ModalTutupDataLama from '@/components/produksi/ModalTutupDataLama';
import TombolDataDitutup from '@/components/produksi/TombolDataDitutup';
import {
  Package, Clock, Loader2, Users, Printer, CheckCircle, AlertTriangle, Scissors,
  Pencil, Archive, MoreHorizontal, Search, Undo2, X, SkipForward,
} from 'lucide-react';
import { toast } from 'sonner';
import { getAksesoriForKartuKerja } from '@/lib/actions/produksi/model-aksesori.actions';
import PrintKartuKerjaLayout, { type KartuBundle, type AksesoriItem } from '@/app/(dashboard)/app/produksi/antrian-cutting/PrintKartuKerjaLayout';

interface Props {
  initialAntrian: AntrianJahitBundle[];
  initialSelesai: { data: SelesaiJahitItem[]; total: number };
  karyawanList: { id: string; nama: string }[];
}

type Tab = 'antrian' | 'proses' | 'selesai';

// ── Menu ⋯ per baris (posisi fixed supaya tidak terpotong tabel yang scroll) ──
interface MenuItem { label: string; icon: React.ReactNode; onClick: () => void; danger?: boolean; disabled?: boolean; hint?: string }

function RowMenu({ items }: { items: MenuItem[] }) {
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!pos) return;
    const tutup = () => setPos(null);
    window.addEventListener('scroll', tutup, true);
    window.addEventListener('resize', tutup);
    return () => {
      window.removeEventListener('scroll', tutup, true);
      window.removeEventListener('resize', tutup);
    };
  }, [pos]);

  const buka = () => {
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    const tinggi = items.length * 36 + 8;
    const top = r.bottom + tinggi > window.innerHeight ? r.top - tinggi - 4 : r.bottom + 4;
    setPos({ top, right: window.innerWidth - r.right });
  };

  return (
    <>
      <button
        ref={btnRef}
        onClick={() => (pos ? setPos(null) : buka())}
        className="w-8 h-8 flex items-center justify-center rounded-lg border border-[#2A2D31] text-[#9aa0a6] hover:text-[#e8eaed] hover:bg-[#2A2D31] transition-colors"
        aria-label="Aksi lain"
      >
        <MoreHorizontal className="w-4 h-4" />
      </button>
      {pos && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setPos(null)} />
          <div
            className="fixed z-50 min-w-[220px] py-1 bg-[#1F2225] border border-[#2A2D31] rounded-xl shadow-2xl"
            style={{ top: pos.top, right: pos.right }}
          >
            {items.map(it => (
              <button
                key={it.label}
                disabled={it.disabled}
                title={it.hint}
                onClick={() => { setPos(null); it.onClick(); }}
                className={`w-full flex items-center gap-2.5 px-3.5 h-9 text-xs font-semibold text-left transition-colors disabled:opacity-35 disabled:cursor-not-allowed ${
                  it.danger ? 'text-orange-400 hover:bg-orange-500/10' : 'text-[#e8eaed] hover:bg-[#2A2D31]'
                }`}
              >
                {it.icon}
                {it.label}
              </button>
            ))}
          </div>
        </>
      )}
    </>
  );
}

export default function JahitListClient({ initialAntrian, initialSelesai, karyawanList }: Props) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<Tab>('antrian');
  const [cari, setCari] = useState('');
  const [filterPenjahit, setFilterPenjahit] = useState('');

  const namaKaryawan = (id?: string | null) => karyawanList.find(k => k.id === id)?.nama ?? null;
  const karyawanIdJahit = (b: AntrianJahitBundle) => b.status_tahap?.['jahit']?.karyawan_id ?? null;

  // ── Data Antrian & Sedang Dijahit (dari props, ikut router.refresh()) ──
  const antrianSemua = initialAntrian.filter(b => !b.status_tahap?.['jahit']);
  const prosesSemua = initialAntrian.filter(b => b.status_tahap?.['jahit']?.status === 'terima');

  const cocok = (b: AntrianJahitBundle) => {
    if (!cari.trim()) return true;
    const nama = namaKaryawan(karyawanIdJahit(b)) ?? '';
    return matchesBundleQuery(b, cari) || nama.toLowerCase().includes(cari.trim().toLowerCase());
  };
  const antrianTampil = antrianSemua.filter(cocok);
  const prosesTampil = prosesSemua
    .filter(b => !filterPenjahit || karyawanIdJahit(b) === filterPenjahit)
    .filter(cocok);

  // Penjahit yang sedang memegang bundle, untuk filter
  const penjahitAktif = useMemo(() => {
    const hitung: Record<string, number> = {};
    prosesSemua.forEach(b => {
      const id = karyawanIdJahit(b);
      if (id) hitung[id] = (hitung[id] ?? 0) + 1;
    });
    return Object.entries(hitung)
      .map(([id, n]) => ({ id, nama: namaKaryawan(id) ?? '?', n }))
      .sort((a, b) => a.nama.localeCompare(b.nama));
  }, [initialAntrian, karyawanList]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Data Selesai (riwayat, paginasi & cari di server) ──
  const [selesaiData, setSelesaiData] = useState<SelesaiJahitItem[]>(initialSelesai.data);
  const [selesaiTotal, setSelesaiTotal] = useState(initialSelesai.total);
  const [selesaiPage, setSelesaiPage] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const pageSize = 20;

  const muatSelesai = async (page: number, q: string) => {
    setIsLoading(true);
    try {
      const res = await getRiwayatSelesaiJahit(page, pageSize, q || undefined);
      setSelesaiData(res.data);
      setSelesaiTotal(res.total);
      setSelesaiPage(page);
    } catch (error: any) {
      toast.error('Gagal mengambil data selesai: ' + error.message);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    setSelesaiData(initialSelesai.data);
    setSelesaiTotal(initialSelesai.total);
    setSelesaiPage(1);
  }, [initialSelesai]);

  // Cari di tab Selesai → ke server (debounce)
  useEffect(() => {
    if (activeTab !== 'selesai') return;
    const t = setTimeout(() => muatSelesai(1, cari.trim()), 350);
    return () => clearTimeout(t);
  }, [cari, activeTab]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Pilihan (per tab) ──
  const [pilihAntrian, setPilihAntrian] = useState<Set<string>>(new Set());
  const [pilihProses, setPilihProses] = useState<Set<string>>(new Set());
  const [pilihSelesai, setPilihSelesai] = useState<Map<string, SelesaiJahitItem>>(new Map());

  // Buang pilihan yang barisnya sudah tidak ada setelah refresh
  useEffect(() => {
    const idAntrian = new Set(antrianSemua.map(b => b.id));
    const idProses = new Set(prosesSemua.map(b => b.id));
    setPilihAntrian(p => new Set([...p].filter(id => idAntrian.has(id))));
    setPilihProses(p => new Set([...p].filter(id => idProses.has(id))));
  }, [initialAntrian]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (set: Set<string>, id: string) => {
    const s = new Set(set);
    if (s.has(id)) s.delete(id); else s.add(id);
    return s;
  };

  const toggleSelesai = (item: SelesaiJahitItem) => {
    setPilihSelesai(prev => {
      const m = new Map(prev);
      if (m.has(item.id)) m.delete(item.id); else m.set(item.id, item);
      return m;
    });
  };

  // ── Modal ──
  const [printUlangData, setPrintUlangData] = useState<KartuBundle[] | null>(null);
  const [showSerahTerima, setShowSerahTerima] = useState(false);
  const [showSelesai, setShowSelesai] = useState(false);
  const [showTutupDataLama, setShowTutupDataLama] = useState(false);
  const [batal, setBatal] = useState<{ mode: 'serah_terima' | 'selesai'; bundles: BundleBatal[] } | null>(null);
  const [splitBundle, setSplitBundle] = useState<AntrianJahitBundle | null>(null);
  const [splitAwalBundle, setSplitAwalBundle] = useState<AntrianJahitBundle | null>(null);
  const [koreksiBundle, setKoreksiBundle] = useState<AntrianJahitBundle | null>(null);
  const [koreksiCuttingBundle, setKoreksiCuttingBundle] = useState<AntrianJahitBundle | null>(null);

  const selesaiAksi = () => {
    setPilihAntrian(new Set());
    setPilihProses(new Set());
    setPilihSelesai(new Map());
    router.refresh();
  };

  const keBatal = (b: AntrianJahitBundle): BundleBatal => ({
    id: b.id, barcode: b.barcode, no_po: b.no_po, model_nama: b.model_nama,
    warna: b.warna, size: b.size, qty_per_bundle: b.qty_per_bundle,
    karyawan_nama: namaKaryawan(karyawanIdJahit(b)) ?? undefined,
  });
  const selesaiKeBatal = (b: SelesaiJahitItem): BundleBatal => ({
    id: b.id, barcode: b.barcode, no_po: b.no_po, model_nama: b.model_nama,
    warna: b.warna, size: b.size, qty_per_bundle: b.qty_per_bundle, karyawan_nama: b.karyawan_nama,
  });

  const handlePrintUlang = async (bundle: {
    id: string; barcode: string; po_item_id: string; no_po: string; klien_nama: string;
    model_nama: string | null; warna: string; size: string; qty_per_bundle: number;
  }, karyawanNama: string) => {
    const aksesoriMap = await getAksesoriForKartuKerja([bundle.po_item_id]);
    const aks: AksesoriItem[] = (aksesoriMap[bundle.po_item_id] ?? []).map((item: any) => ({
      nama: item.inventory_item_nama,
      qty_per_pcs: item.qty_per_pcs,
      satuan: item.satuan,
      tahap_pakai: item.tahap_pakai,
    }));
    let parsedUrut = 0;
    const bMatch = bundle.barcode.match(/bdl(\d+)$/i);
    if (bMatch) parsedUrut = parseInt(bMatch[1], 10);
    setPrintUlangData([{
      id: bundle.id, barcode: bundle.barcode, no_urut: parsedUrut,
      po_id: '', po_item_id: bundle.po_item_id, no_po: bundle.no_po,
      tanggal_order: '', tanggal_target: '', po_catatan: null,
      klien_nama: bundle.klien_nama, model_nama: bundle.model_nama,
      warna: bundle.warna, size: bundle.size,
      qty_per_bundle: bundle.qty_per_bundle,
      aksesori: aks, nama_penjahit: karyawanNama,
    }]);
    setTimeout(() => { window.print(); setPrintUlangData(null); }, 500);
  };

  // ── Scan / Enter di kolom cari: barcode persis → centang baris itu ──
  const handleCariEnter = () => {
    const kode = cari.trim().toLowerCase();
    if (!kode) return;
    if (activeTab === 'antrian') {
      const b = antrianSemua.find(x => x.barcode.toLowerCase() === kode);
      if (b) { setPilihAntrian(p => new Set(p).add(b.id)); setCari(''); toast.success(`${b.barcode} dipilih`); return; }
      if (prosesSemua.some(x => x.barcode.toLowerCase() === kode)) { toast.info('Bundle ini sudah di tab Sedang Dijahit'); return; }
    } else if (activeTab === 'proses') {
      const b = prosesSemua.find(x => x.barcode.toLowerCase() === kode);
      if (b) {
        if (filterPenjahit && karyawanIdJahit(b) !== filterPenjahit) setFilterPenjahit('');
        setPilihProses(p => new Set(p).add(b.id)); setCari(''); toast.success(`${b.barcode} dipilih`); return;
      }
      if (antrianSemua.some(x => x.barcode.toLowerCase() === kode)) { toast.info('Bundle ini masih di tab Antrian'); return; }
    }
  };

  const gantiTab = (t: Tab) => {
    setActiveTab(t);
    if (t !== 'selesai' && activeTab === 'selesai' && cari) muatSelesai(1, '');
  };

  const totalSelesaiPages = Math.ceil(selesaiTotal / pageSize);
  const pilihProsesTanpaKaryawan = [...pilihProses].some(id => {
    const b = prosesSemua.find(x => x.id === id);
    return b && !karyawanIdJahit(b);
  });

  const semuaTerpilih = (tampil: { id: string }[], set: Set<string>) =>
    tampil.length > 0 && tampil.every(b => set.has(b.id));
  const pilihSemua = (tampil: { id: string }[], set: Set<string>, setter: (s: Set<string>) => void) => {
    const s = new Set(set);
    if (semuaTerpilih(tampil, set)) tampil.forEach(b => s.delete(b.id));
    else tampil.forEach(b => s.add(b.id));
    setter(s);
  };

  const selesaiBisaBatal = selesaiData.filter(b => b.bisa_batal);
  const semuaSelesaiTerpilih = selesaiBisaBatal.length > 0 && selesaiBisaBatal.every(b => pilihSelesai.has(b.id));
  const pilihSemuaSelesai = () => {
    setPilihSelesai(prev => {
      const m = new Map(prev);
      if (semuaSelesaiTerpilih) selesaiBisaBatal.forEach(b => m.delete(b.id));
      else selesaiBisaBatal.forEach(b => m.set(b.id, b));
      return m;
    });
  };

  const TableHeader = ({ children, className = '' }: { children?: React.ReactNode; className?: string }) => (
    <th className={`sticky top-0 z-20 px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-[#9aa0a6] bg-[#16181A] border-b border-[#2A2D31] ${className}`}>
      {children}
    </th>
  );

  const Kotak = ({ checked, onChange, disabled }: { checked: boolean; onChange: () => void; disabled?: boolean }) => (
    <input
      type="checkbox"
      checked={checked}
      onChange={onChange}
      disabled={disabled}
      className="accent-[#e5c17b] w-4 h-4 rounded border-[#2A2D31] cursor-pointer disabled:opacity-25 disabled:cursor-not-allowed"
    />
  );

  const Kosong = ({ cols, teks }: { cols: number; teks: string }) => (
    <tr>
      <td colSpan={cols} className="px-4 py-12 text-center text-[#9aa0a6]">
        <Package className="w-8 h-8 mx-auto mb-2 opacity-20" />
        {cari ? `Tidak ada yang cocok dengan "${cari}"` : teks}
      </td>
    </tr>
  );

  const KolomBundle = ({ b }: { b: { no_po: string; klien_nama: string; model_nama: string | null; warna: string; size: string; barcode: string; qty_per_bundle: number } }) => (
    <>
      <td className="px-4 py-3">
        <span className="font-mono font-bold text-[#e5c17b]">{b.no_po}</span>
        <div className="text-[10px] text-[#9aa0a6]">{b.klien_nama}</div>
      </td>
      <td className="px-4 py-3 font-medium text-[#e8eaed]">{b.model_nama ?? '-'}</td>
      <td className="px-4 py-3 text-[#9aa0a6]">{b.warna} <span className="mx-1">/</span> {b.size}</td>
      <td className="px-4 py-3 font-mono text-xs text-[#9aa0a6]">{b.barcode}</td>
      <td className="px-4 py-3 font-mono text-[#e8eaed]">
        {b.qty_per_bundle} <span className="text-[10px] text-[#9aa0a6]">pcs</span>
      </td>
    </>
  );

  const formatDateTime = (s: string | null) =>
    !s ? '-' : new Date(s).toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

  const TabBtn = ({ t, label, n }: { t: Tab; label: string; n: number }) => (
    <button
      onClick={() => gantiTab(t)}
      className={`px-5 py-2 rounded-lg text-xs font-bold transition-all ${
        activeTab === t ? 'bg-[#e5c17b] text-[#0D0E10]' : 'text-[#9aa0a6] hover:text-[#e8eaed]'
      }`}
    >
      {label} <span className="ml-1 opacity-50">({n})</span>
    </button>
  );

  return (
    <div className="mt-2 pt-6 border-t border-[#2A2D31]">
      <div className="mb-5 px-1">
        <h2 className="text-xl font-bold text-[#e8eaed]">Monitoring Jahit</h2>
        <p className="text-[#9aa0a6] text-[13px] mt-1.5">
          Pilih bundle → Serah Terima → Selesaikan. Jacket & celana tertentu otomatis melewati Lubang Kancing / Steam
          (dibaca dari HPP).
        </p>
      </div>

      <div className="space-y-4">
        {/* Tab + Cari */}
        <div className="flex flex-col lg:flex-row lg:items-center gap-3">
          <div className="flex p-1 bg-[#1A1D1F] rounded-xl border border-[#2A2D31] w-fit">
            <TabBtn t="antrian" label="ANTRIAN" n={antrianSemua.length} />
            <TabBtn t="proses" label="SEDANG DIJAHIT" n={prosesSemua.length} />
            <TabBtn t="selesai" label="SELESAI" n={selesaiTotal} />
          </div>
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#9aa0a6]" />
            <input
              value={cari}
              onChange={e => setCari(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleCariEnter()}
              placeholder={activeTab === 'selesai' ? 'Cari PO, artikel, warna, penjahit…' : 'Scan barcode (langsung dicentang) atau cari…'}
              className="w-full h-10 bg-[#16181A] border border-[#2A2D31] rounded-xl pl-9 pr-9 text-sm text-[#e8eaed] outline-none focus:ring-1 focus:ring-[#e5c17b] placeholder:text-[#9aa0a6]"
            />
            {cari && (
              <button onClick={() => setCari('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#9aa0a6] hover:text-[#e8eaed]">
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
          {activeTab === 'proses' && (
            <select
              value={filterPenjahit}
              onChange={e => setFilterPenjahit(e.target.value)}
              className="h-10 bg-[#16181A] border border-[#2A2D31] rounded-xl px-3 text-sm text-[#e8eaed] outline-none focus:ring-1 focus:ring-[#e5c17b]"
            >
              <option value="">Semua penjahit</option>
              {penjahitAktif.map(p => (
                <option key={p.id} value={p.id}>{p.nama} ({p.n})</option>
              ))}
            </select>
          )}
        </div>

        {/* Toolbar aksi */}
        <div className="flex flex-wrap items-center justify-end gap-3 min-h-[36px]">
          {activeTab === 'antrian' && (
            <>
              <TombolDataDitutup onBerubah={() => router.refresh()} />
              {pilihAntrian.size > 0 && (
                <>
                  <button
                    onClick={() => setShowTutupDataLama(true)}
                    title="Bundle sudah beres di lapangan tapi tertinggal di sistem — tutup tanpa upah"
                    className="flex items-center gap-2 h-9 px-3 rounded-lg border border-[#2A2D31] text-[#9aa0a6] text-xs font-bold hover:bg-[#2A2D31] hover:text-[#e8eaed]"
                  >
                    <Archive className="w-4 h-4" /> Tutup Data Lama ({pilihAntrian.size})
                  </button>
                  <button
                    onClick={() => setShowSerahTerima(true)}
                    className="flex items-center gap-2 bg-[#e5c17b] hover:bg-[#d4b06a] text-[#0D0E10] h-9 px-4 rounded-lg text-sm font-bold shadow-lg"
                  >
                    <Users className="w-4 h-4" /> Serah Terima ({pilihAntrian.size})
                  </button>
                </>
              )}
            </>
          )}
          {activeTab === 'proses' && pilihProses.size > 0 && (
            <>
              {pilihProsesTanpaKaryawan && (
                <span className="flex items-center gap-1.5 text-xs font-semibold text-orange-400">
                  <AlertTriangle className="w-3.5 h-3.5" /> Ada bundle tanpa penjahit
                </span>
              )}
              <button
                onClick={() => setBatal({ mode: 'serah_terima', bundles: prosesSemua.filter(b => pilihProses.has(b.id)).map(keBatal) })}
                className="flex items-center gap-2 h-9 px-3 rounded-lg border border-orange-500/40 text-orange-400 text-xs font-bold hover:bg-orange-500/10"
              >
                <Undo2 className="w-4 h-4" /> Batalkan ({pilihProses.size})
              </button>
              <button
                onClick={() => setShowSelesai(true)}
                className="flex items-center gap-2 bg-green-600 hover:bg-green-500 text-white h-9 px-4 rounded-lg text-sm font-bold shadow-lg"
              >
                <CheckCircle className="w-4 h-4" /> Selesaikan ({pilihProses.size})
              </button>
            </>
          )}
          {activeTab === 'selesai' && pilihSelesai.size > 0 && (
            <button
              onClick={() => setBatal({ mode: 'selesai', bundles: [...pilihSelesai.values()].map(selesaiKeBatal) })}
              className="flex items-center gap-2 h-9 px-3 rounded-lg border border-orange-500/40 text-orange-400 text-xs font-bold hover:bg-orange-500/10"
            >
              <Undo2 className="w-4 h-4" /> Batalkan Selesai ({pilihSelesai.size})
            </button>
          )}
        </div>

        {/* Tabel */}
        <div className="bg-[#1A1D1F] border border-[#2A2D31] rounded-2xl overflow-hidden shadow-sm relative">
          {isLoading && (
            <div className="absolute inset-0 bg-[#0D0E10]/40 backdrop-blur-[1px] z-30 flex items-center justify-center">
              <Loader2 className="w-8 h-8 text-[#e5c17b] animate-spin" />
            </div>
          )}

          <div className="overflow-auto max-h-[65vh]">
            {activeTab === 'antrian' && (
              <table className="w-full text-sm border-separate border-spacing-0">
                <thead>
                  <tr>
                    <TableHeader className="w-12 text-center">
                      <Kotak checked={semuaTerpilih(antrianTampil, pilihAntrian)} onChange={() => pilihSemua(antrianTampil, pilihAntrian, setPilihAntrian)} />
                    </TableHeader>
                    <TableHeader>No.</TableHeader>
                    <TableHeader>No. PO</TableHeader>
                    <TableHeader>Artikel</TableHeader>
                    <TableHeader>Warna / Size</TableHeader>
                    <TableHeader>Barcode</TableHeader>
                    <TableHeader>QTY</TableHeader>
                    <TableHeader className="w-14" />
                  </tr>
                </thead>
                <tbody className="[&_td]:border-b [&_td]:border-[#2A2D31]">
                  {antrianTampil.length === 0 ? <Kosong cols={8} teks="Tidak ada antrian jahit" /> : antrianTampil.map((item, idx) => (
                    <tr key={item.id} className={`transition-colors ${pilihAntrian.has(item.id) ? 'bg-[#e5c17b]/5' : 'hover:bg-[#2A2D31]/40'}`}>
                      <td className="px-4 py-3 text-center">
                        <Kotak checked={pilihAntrian.has(item.id)} onChange={() => setPilihAntrian(toggle(pilihAntrian, item.id))} />
                      </td>
                      <td className="px-4 py-3 text-xs font-bold text-[#9aa0a6]">{idx + 1}</td>
                      <KolomBundle b={item} />
                      <td className="px-4 py-3">
                        <RowMenu items={[
                          {
                            label: 'Bagi ke 2 penjahit', icon: <Scissors className="w-3.5 h-3.5" />,
                            onClick: () => setSplitAwalBundle(item), disabled: item.qty_per_bundle <= 1,
                            hint: item.qty_per_bundle <= 1 ? 'Qty cuma 1 pcs' : 'Tugaskan sebagian qty ke satu penjahit, sisanya tetap di Antrian',
                          },
                          { label: 'Koreksi hasil cutting', icon: <Pencil className="w-3.5 h-3.5" />, onClick: () => setKoreksiCuttingBundle(item) },
                        ]} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {activeTab === 'proses' && (
              <table className="w-full text-sm border-separate border-spacing-0">
                <thead>
                  <tr>
                    <TableHeader className="w-12 text-center">
                      <Kotak checked={semuaTerpilih(prosesTampil, pilihProses)} onChange={() => pilihSemua(prosesTampil, pilihProses, setPilihProses)} />
                    </TableHeader>
                    <TableHeader>No.</TableHeader>
                    <TableHeader>No. PO</TableHeader>
                    <TableHeader>Artikel</TableHeader>
                    <TableHeader>Warna / Size</TableHeader>
                    <TableHeader>Barcode</TableHeader>
                    <TableHeader>QTY</TableHeader>
                    <TableHeader>Penjahit</TableHeader>
                    <TableHeader>Diterima</TableHeader>
                    <TableHeader className="w-14" />
                  </tr>
                </thead>
                <tbody className="[&_td]:border-b [&_td]:border-[#2A2D31]">
                  {prosesTampil.length === 0 ? <Kosong cols={10} teks="Tidak ada bundle yang sedang dijahit" /> : prosesTampil.map((item, idx) => {
                    const nama = namaKaryawan(karyawanIdJahit(item));
                    return (
                      <tr key={item.id} className={`transition-colors ${pilihProses.has(item.id) ? 'bg-green-500/5' : 'hover:bg-[#2A2D31]/40'}`}>
                        <td className="px-4 py-3 text-center">
                          <Kotak checked={pilihProses.has(item.id)} onChange={() => setPilihProses(toggle(pilihProses, item.id))} />
                        </td>
                        <td className="px-4 py-3 text-xs font-bold text-[#9aa0a6]">{idx + 1}</td>
                        <KolomBundle b={item} />
                        <td className="px-4 py-3 text-xs font-medium">
                          {nama ? <span className="text-[#e8eaed]">{nama}</span> : (
                            <span className="flex items-center gap-1 text-orange-400 font-semibold">
                              <AlertTriangle className="w-3 h-3" /> Belum ditentukan
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-xs text-[#9aa0a6] whitespace-nowrap">
                          {formatDateTime((item.status_tahap?.['jahit'] as any)?.waktu_terima ?? null)}
                        </td>
                        <td className="px-4 py-3">
                          <RowMenu items={[
                            { label: 'Ganti penjahit / qty', icon: <Pencil className="w-3.5 h-3.5" />, onClick: () => setKoreksiBundle(item) },
                            { label: 'Bagi sisa ke penjahit lain', icon: <Scissors className="w-3.5 h-3.5" />, onClick: () => setSplitBundle(item) },
                            { label: 'Print ulang kartu kerja', icon: <Printer className="w-3.5 h-3.5" />, onClick: () => handlePrintUlang(item, nama ?? '') },
                            { label: 'Batalkan serah terima', icon: <Undo2 className="w-3.5 h-3.5" />, danger: true, onClick: () => setBatal({ mode: 'serah_terima', bundles: [keBatal(item)] }) },
                          ]} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}

            {activeTab === 'selesai' && (
              <table className="w-full text-sm border-separate border-spacing-0">
                <thead>
                  <tr>
                    <TableHeader className="w-12 text-center">
                      <Kotak checked={semuaSelesaiTerpilih} onChange={pilihSemuaSelesai} disabled={selesaiBisaBatal.length === 0} />
                    </TableHeader>
                    <TableHeader>No.</TableHeader>
                    <TableHeader>No. PO</TableHeader>
                    <TableHeader>Artikel</TableHeader>
                    <TableHeader>Warna / Size</TableHeader>
                    <TableHeader>Barcode</TableHeader>
                    <TableHeader>QTY</TableHeader>
                    <TableHeader>Penjahit</TableHeader>
                    <TableHeader>Selesai</TableHeader>
                    <TableHeader>Posisi Sekarang</TableHeader>
                    <TableHeader className="w-14" />
                  </tr>
                </thead>
                <tbody className="[&_td]:border-b [&_td]:border-[#2A2D31]">
                  {selesaiData.length === 0 ? <Kosong cols={11} teks="Belum ada bundle yang selesai dijahit" /> : selesaiData.map((item, idx) => (
                    <tr key={item.id} className={`transition-colors ${pilihSelesai.has(item.id) ? 'bg-orange-500/5' : 'hover:bg-[#2A2D31]/40'}`}>
                      <td className="px-4 py-3 text-center">
                        <Kotak checked={pilihSelesai.has(item.id)} onChange={() => toggleSelesai(item)} disabled={!item.bisa_batal} />
                      </td>
                      <td className="px-4 py-3 text-xs font-bold text-[#9aa0a6]">{(selesaiPage - 1) * pageSize + idx + 1}</td>
                      <KolomBundle b={item} />
                      <td className="px-4 py-3 text-xs font-medium text-[#e8eaed]">{item.karyawan_nama}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5 text-[#9aa0a6] text-xs whitespace-nowrap">
                          <Clock size={12} /> {formatDateTime(item.waktu_selesai)}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs">
                        <div className="text-[#e8eaed] font-medium whitespace-nowrap">{item.posisi}</div>
                        {item.dilewati.length > 0 && (
                          <div className="flex items-center gap-1 text-[10px] text-sky-400 mt-0.5 whitespace-nowrap">
                            <SkipForward className="w-3 h-3" /> Lewati {item.dilewati.join(' & ')}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <RowMenu items={[
                          { label: 'Print ulang kartu kerja', icon: <Printer className="w-3.5 h-3.5" />, onClick: () => handlePrintUlang(item, item.karyawan_nama === '-' ? '' : item.karyawan_nama) },
                          {
                            label: 'Batalkan selesai', icon: <Undo2 className="w-3.5 h-3.5" />, danger: true,
                            disabled: !item.bisa_batal,
                            hint: item.bisa_batal ? undefined : 'Sudah masuk tahap berikutnya — batalkan dari menu tahap itu dulu',
                            onClick: () => setBatal({ mode: 'selesai', bundles: [selesaiKeBatal(item)] }),
                          },
                        ]} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {activeTab === 'selesai' && (
            <div className="p-4 border-t border-[#2A2D31]">
              <StagePagination page={selesaiPage} totalPages={totalSelesaiPages} onPageChange={p => muatSelesai(p, cari.trim())} />
            </div>
          )}
        </div>
      </div>

      {showTutupDataLama && (
        <ModalTutupDataLama
          bundles={antrianSemua.filter(b => pilihAntrian.has(b.id))}
          onClose={() => setShowTutupDataLama(false)}
          onSelesai={() => { setShowTutupDataLama(false); selesaiAksi(); }}
        />
      )}

      {showSerahTerima && (
        <ModalSerahTerimaJahit
          selectedBundles={antrianSemua.filter(b => pilihAntrian.has(b.id))}
          karyawanList={karyawanList}
          onSuccess={() => { setShowSerahTerima(false); selesaiAksi(); }}
          onClose={() => setShowSerahTerima(false)}
        />
      )}

      {showSelesai && (
        <ModalBatchSelesaiJahit
          bundles={prosesSemua.filter(b => pilihProses.has(b.id))}
          karyawanList={karyawanList}
          onSuccess={() => { setShowSelesai(false); selesaiAksi(); }}
          onClose={() => setShowSelesai(false)}
        />
      )}

      {batal && (
        <ModalBatalJahit
          mode={batal.mode}
          bundles={batal.bundles}
          onSuccess={() => { setBatal(null); selesaiAksi(); }}
          onClose={() => setBatal(null)}
        />
      )}

      {splitBundle && (
        <ModalSplitBundle
          bundle={splitBundle}
          karyawanList={karyawanList}
          onSuccess={() => { setSplitBundle(null); selesaiAksi(); }}
          onClose={() => setSplitBundle(null)}
        />
      )}

      {splitAwalBundle && (
        <ModalSplitAwalJahit
          bundle={splitAwalBundle}
          karyawanList={karyawanList}
          onSuccess={() => { setSplitAwalBundle(null); selesaiAksi(); }}
          onClose={() => setSplitAwalBundle(null)}
        />
      )}

      {koreksiBundle && (
        <ModalKoreksiSerahTerima
          bundle={koreksiBundle}
          karyawanList={karyawanList}
          onSuccess={() => { setKoreksiBundle(null); router.refresh(); }}
          onClose={() => setKoreksiBundle(null)}
        />
      )}

      {koreksiCuttingBundle && (
        <ModalKoreksiCutting
          bundle={koreksiCuttingBundle}
          onSuccess={() => { setKoreksiCuttingBundle(null); selesaiAksi(); }}
          onClose={() => setKoreksiCuttingBundle(null)}
        />
      )}

      {printUlangData && printUlangData.length > 0 && (
        <PrintKartuKerjaLayout
          bundles={printUlangData}
          tglCetak={new Date().toLocaleString('id-ID', {
            day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
          })}
        />
      )}
    </div>
  );
}
