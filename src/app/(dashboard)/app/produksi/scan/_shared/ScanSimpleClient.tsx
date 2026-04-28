'use client';

import React, { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { 
    getBundleForScan, 
    searchBundlesByBarcode,
    type BundleForScan,
    type BundleSearchResult
} from '@/lib/actions/produksi/scan.actions';
import { 
    scanTerimaGeneric, 
    scanSelesai,
    scanLanjutTahap 
} from '@/lib/actions/produksi/scan-mutations.actions';
import {
    Search,
    Loader2,
    Hash,
    ChevronRight,
    CheckCircle2,
    RefreshCcw,
    Info,
    ArrowRight,
    Package,
    History,
    CheckCircle
} from 'lucide-react';
import { TAHAP_CONFIG, getPrevTahap, type TahapKey } from '@/modules/produksi/constants/tahap';
import ModalAlasanQty from '@/components/produksi/ModalAlasanQty';
import ModalKonfirmasiQtySingle from '@/components/produksi/ModalKonfirmasiQtySingle';
import ToastQtyLebih from '@/components/produksi/ToastQtyLebih';
import RejectSection from '@/components/produksi/RejectSection';
import PrintHangTagLayout from '../packing/PrintHangTagLayout';
import {
  buatReject,
  getAlasanRejectList,
  type AlasanRejectOption,
} from '@/lib/actions/produksi/reject.actions';

type ScanState =
  | { phase: 'IDLE' }
  | { phase: 'LOADING' }
  | { phase: 'SEARCH_RESULTS'; results: BundleSearchResult[] }
  | { phase: 'LOADED'; bundle: BundleForScan }
  | { phase: 'CONFIRM_TERIMA'; bundle: BundleForScan }
  | { phase: 'CONFIRM_LANJUT'; bundle: BundleForScan }
  | { phase: 'SUBMITTING'; bundle: BundleForScan }
  | { phase: 'RESULT'; gajiLedgerId: string | null; upah: number };

interface Props {
  tahap: TahapKey;
  tahapLabel: string;
  mode?: 'lanjut' | 'standard' | 'single';
  karyawanId?: string;
}

export default function ScanSimpleClient({ tahap, tahapLabel, mode = 'lanjut', karyawanId }: Props) {
  const router = useRouter();
  const isLanjutMode = mode === 'lanjut';
  const isStandardMode = mode === 'standard';
  const isSingleMode = mode === 'single';
  const [state, setState] = useState<ScanState>({ phase: 'IDLE' });
  const [barcode, setBarcode] = useState('');
  const [qty, setQty] = useState(0);
  const [showModalAlasan, setShowModalAlasan] = useState(false);
  const [showModalSingle, setShowModalSingle] = useState(false);
  const [showToastQtyLebih, setShowToastQtyLebih] = useState(false);
  // ── Reject prompt state ─────────────────────────────────────────────────
  const [showRejectPrompt, setShowRejectPrompt] = useState(false);
  const [alasanList, setAlasanList] = useState<AlasanRejectOption[]>([]);
  const [selectedAlasanId, setSelectedAlasanId] = useState('');
  const [qtyReject, setQtyReject] = useState(0);
  // ───────────────────────────────────────────────────────────────────────
  const [printData, setPrintData] = useState<{
    noUrut: string;
    model_nama: string | null;
    warna: string;
    size: string;
    qty: number;
  } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-focus input on mount and after reset
  useEffect(() => {
    if (state.phase === 'IDLE' || state.phase === 'RESULT') {
        inputRef.current?.focus();
    }
  }, [state.phase]);

  const resetToIdle = () => {
    setState({ phase: 'IDLE' });
    setBarcode('');
    setQty(0);
    setPrintData(null);
  };
  
  const checkPrerequisite = (bundle: BundleForScan): boolean => {
    const prevTahap = getPrevTahap(tahap);
    if (!prevTahap) return true; // Cutting — tidak ada prasyarat
    // Mode lanjut: prev tahap cukup status 'terima' (akan di-close otomatis oleh RPC)
    if (isLanjutMode) {
      const prevStatus = bundle.status_tahap?.[prevTahap]?.status;
      if (!prevStatus || (prevStatus !== 'selesai' && prevStatus !== 'terima')) {
        const prevLabel = TAHAP_CONFIG[prevTahap].label;
        toast.error(`Bundle belum diterima di tahap ${prevLabel}`);
        setState({ phase: 'IDLE' });
        return false;
      }
      return true;
    }
    const prevStatusVal = bundle.status_tahap?.[prevTahap]?.status;
    if (!prevStatusVal || (prevStatusVal !== 'selesai' && prevStatusVal !== 'terima')) {
      const prevLabel = TAHAP_CONFIG[prevTahap].label;
      toast.error(`Bundle belum selesai di tahap ${prevLabel}`);
      setState({ phase: 'IDLE' });
      return false;
    }
    return true;
  };

  const handleScan = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!barcode.trim()) return;
    
    setState({ phase: 'LOADING' });
    try {
      const exact = await getBundleForScan(barcode.trim());
      if (exact) {
        if (exact.status_tahap?.[tahap]?.status === 'selesai') {
          toast.error(`Bundle ini sudah selesai di tahap ${tahapLabel}`);
          setState({ phase: 'IDLE' });
          return;
        }
        if (!checkPrerequisite(exact)) return;
        setQty(exact.qty_per_bundle);
        setState({ phase: 'LOADED', bundle: exact });
        return;
      }
      
      const results = await searchBundlesByBarcode(barcode.trim(), tahap);
      if (results.length === 0) {
        toast.error('Barcode tidak ditemukan');
        setState({ phase: 'IDLE' });
      } else if (results.length === 1) {
        const bundle = await getBundleForScan(results[0].barcode);
        if (bundle) {
          if (bundle.status_tahap?.[tahap]?.status === 'selesai') {
            toast.error(`Bundle ini sudah selesai di tahap ${tahapLabel}`);
            setState({ phase: 'IDLE' });
            return;
          }
          if (!checkPrerequisite(bundle)) return;
          setQty(bundle.qty_per_bundle);
          setState({ phase: 'LOADED', bundle });
        } else {
            setState({ phase: 'IDLE' });
        }
      } else {
        setState({ phase: 'SEARCH_RESULTS', results });
      }
    } catch (err: any) {
      toast.error(err.message || 'Gagal scan barcode');
      setState({ phase: 'IDLE' });
    }
  };

  const handleSelectBundle = async (itemBarcode: string) => {
    setState({ phase: 'LOADING' });
    try {
      const bundle = await getBundleForScan(itemBarcode);
      if (bundle) {
        if (bundle.status_tahap?.[tahap]?.status === 'selesai') {
          toast.error(`Bundle ini sudah selesai di tahap ${tahapLabel}`);
          setState({ phase: 'IDLE' });
          return;
        }
        if (!checkPrerequisite(bundle)) return;
        setQty(bundle.qty_per_bundle);
        setState({ phase: 'LOADED', bundle });
      } else {
        toast.error('Gagal memuat bundle');
        setState({ phase: 'IDLE' });
      }
    } catch (err: any) {
      toast.error(err.message || 'Error loading bundle');
      setState({ phase: 'IDLE' });
    }
  };

  const reloadBundle = async (itemBarcode: string) => {
    try {
      const bundle = await getBundleForScan(itemBarcode);
      if (bundle) {
        setQty(bundle.qty_per_bundle);
        setState({ phase: 'LOADED', bundle });
      }
    } catch (e) {
        resetToIdle();
    }
  };

  const handleTerima = async () => {
    if (state.phase !== 'LOADED') return;
    const bundle = state.bundle;
    setState({ phase: 'SUBMITTING', bundle });
    try {
      // Packing standard mode: terima via scanLanjutTahap (auto-tutup Steam)
      if (isStandardMode) {
        await scanLanjutTahap({
          barcode: bundle.barcode,
          tahap_baru: tahap,
          karyawan_id: '',
          qty: qty,
        });
      } else {
        await scanTerimaGeneric({
          barcode: bundle.barcode,
          tahap: tahap,
          karyawan_id: null,
          qty: qty,
          tenant_id: 'STX-001'
        });
      }
      toast.success(`Bundle diterima di tahap ${tahapLabel}`);
      await reloadBundle(bundle.barcode);
    } catch (err: any) {
      toast.error(err.message || 'Gagal proses penerimaan');
      setState({ phase: 'LOADED', bundle });
    }
  };

  const handleLanjut = async () => {
    if (state.phase !== 'LOADED') return;
    const bundle = state.bundle;
    setState({ phase: 'SUBMITTING', bundle });
    try {
      const result = await scanLanjutTahap({
        barcode: bundle.barcode,
        tahap_baru: tahap,
        karyawan_id: '',
        qty: qty,
      });
      toast.success(`Proses ${tahapLabel} dicatat`);
      setState({ phase: 'RESULT', gajiLedgerId: result.gaji_entry_id, upah: result.upah_nominal });
    } catch (err: any) {
      toast.error(err.message || 'Gagal proses');
      setState({ phase: 'LOADED', bundle });
    }
  };

  const handleSingle = async (qtySelesai: number, alasan_qty_id: string | null) => {
    if (state.phase !== 'LOADED') return;
    const bundle = state.bundle;

    setState({ phase: 'SUBMITTING', bundle });
    try {
      // Step 1: terima tahap ini (auto-close prev tahap)
      await scanLanjutTahap({
        barcode: bundle.barcode,
        tahap_baru: tahap,
        karyawan_id: karyawanId ?? '',
        qty: qtySelesai,
      });
      // Step 2: langsung selesai tahap ini
      const result = await scanSelesai({
        barcode: bundle.barcode,
        tahap: tahap,
        karyawan_id: karyawanId ?? null,
        qty: qtySelesai,
        catatan: undefined,
        alasan_qty_id: alasan_qty_id,
        tenant_id: 'STX-001',
      });
      if (tahap === 'packing') {
        setPrintData({
          noUrut: bundle.barcode.split('-')[2] ?? String(bundle.no_urut).padStart(5, '0'),
          model_nama: bundle.model_nama ?? null,
          warna: bundle.warna,
          size: bundle.size,
          qty: qtySelesai,
        });
      }
      if (result.is_qty_lebih) {
        setState({ phase: 'RESULT', gajiLedgerId: result.gaji_entry_id, upah: result.upah_nominal });
        setShowToastQtyLebih(true);
      } else {
        toast.success(`${tahapLabel} selesai`);
        setState({ phase: 'RESULT', gajiLedgerId: result.gaji_entry_id, upah: result.upah_nominal });
      }
      router.refresh();
    } catch (err: any) {
      toast.error(err.message || 'Gagal proses');
      setState({ phase: 'LOADED', bundle });
    }
  };

  async function handleSelesai(alasan_qty_id?: string) {
    if (state.phase !== 'LOADED') return;
    const bundle = state.bundle;
    const qtyTerima = bundle.status_tahap?.[tahap]?.qty_terima ?? bundle.qty_per_bundle;
    
    // Jika qty kurang dan belum ada alasan → tampilkan modal
    if (qty < qtyTerima && !alasan_qty_id) {
      setShowModalAlasan(true);
      return;
    }

    if (qty > qtyTerima) {
      toast.error(`QTY tidak boleh melebihi yang diterima (${qtyTerima} pcs)`);
      return;
    }
    
    setState({ phase: 'SUBMITTING', bundle });
    try {
      const result = await scanSelesai({
        barcode: bundle.barcode,
        tahap: tahap,
        karyawan_id: null,
        qty: qty,
        catatan: undefined,
        alasan_qty_id: alasan_qty_id ?? null,
        tenant_id: 'STX-001'
      });
      
      if (tahap === 'packing') {
        setPrintData({
          noUrut: bundle.barcode.split('-')[2] ?? String(bundle.no_urut).padStart(5, '0'),
          model_nama: bundle.model_nama ?? null,
          warna: bundle.warna,
          size: bundle.size,
          qty: qty,
        });
      }

      if (result.is_qty_lebih) {
        setState({ phase: 'RESULT', gajiLedgerId: result.gaji_entry_id, upah: result.upah_nominal });
        setShowToastQtyLebih(true);
      } else {
        toast.success(`Pengerjaan ${tahapLabel} selesai`);
        setState({ phase: 'RESULT', gajiLedgerId: result.gaji_entry_id, upah: result.upah_nominal });
        // Trigger reject prompt jika ada qty kurang
        if (qty < qtyTerima) {
          const selisih = qtyTerima - qty;
          try {
            const list = await getAlasanRejectList();
            setAlasanList(list);
            setSelectedAlasanId(list[0]?.id ?? '');
            setQtyReject(selisih);
            setShowRejectPrompt(true);
          } catch {
            // Prompt gagal dimuat — tidak blocking
          }
        }
      }
    } catch (err: any) {
      toast.error(err.message || 'Gagal proses penyelesaian');
      setState({ phase: 'LOADED', bundle });
    }
  }

  // ── RejectPromptCard (inline) ────────────────────────────────────────────
  const RejectPromptCard = () => {
    const [submitting, setSubmitting] = useState(false);

    const handleLogReject = async () => {
      if (!selectedAlasanId || qtyReject < 1) {
        toast.error('Pilih alasan dan pastikan qty > 0');
        return;
      }
      setSubmitting(true);
      try {
        await buatReject({
          alasan_reject_id: selectedAlasanId,
          qty_reject: qtyReject,
          tahap_ditemukan: tahap,
          source: 'produksi',
          bundle_id: undefined,
        });
        toast.success('Reject berhasil dicatat');
        setShowRejectPrompt(false);
      } catch (err: any) {
        toast.error(err.message || 'Gagal log reject');
      } finally {
        setSubmitting(false);
      }
    };

    return (
      <div className="w-full max-w-sm mt-4 rounded-xl border border-red-800/30 bg-red-950/20 p-4 text-left">
        {/* Header */}
        <div className="flex items-center gap-2 mb-3">
          <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-red-900/40">
            <svg viewBox="0 0 12 12" className="w-3 h-3 text-red-400" fill="currentColor">
              <path d="M6 1L11 10H1L6 1Z" />
            </svg>
          </span>
          <p className="text-[13px] font-semibold text-red-300">
            Qty kurang{' '}
            <span className="font-bold text-red-200">{qtyReject} pcs</span>.
            {' '}Log sebagai reject?
          </p>
        </div>

        {/* Alasan Select */}
        <div className="mb-3">
          <label className="block text-[10px] font-bold uppercase tracking-widest text-[#9aa0a6] mb-1.5">
            Alasan Reject
          </label>
          <select
            value={selectedAlasanId}
            onChange={(e) => setSelectedAlasanId(e.target.value)}
            className="w-full bg-[#0D0E10] border border-red-800/40 rounded-lg px-3 py-2 text-[13px] text-[#e8eaed] outline-none focus:border-red-500/60"
          >
            {alasanList.length === 0 && (
              <option value="">Memuat alasan...</option>
            )}
            {alasanList.map((a) => (
              <option key={a.id} value={a.id}>
                {a.jenis_nama} — {a.nama}
              </option>
            ))}
          </select>
        </div>

        {/* Qty Reject */}
        <div className="mb-4">
          <label className="block text-[10px] font-bold uppercase tracking-widest text-[#9aa0a6] mb-1.5">
            Qty Reject (pcs)
          </label>
          <input
            type="number"
            min={1}
            value={qtyReject}
            onChange={(e) => setQtyReject(Number(e.target.value))}
            className="w-full bg-[#0D0E10] border border-red-800/40 rounded-lg px-3 py-2 text-[13px] text-[#e8eaed] text-center font-bold outline-none focus:border-red-500/60"
          />
        </div>

        {/* Actions */}
        <div className="flex gap-2">
          <button
            onClick={() => setShowRejectPrompt(false)}
            disabled={submitting}
            className="flex-1 py-2 rounded-lg border border-[#2A2D31] text-[12px] font-semibold text-[#9aa0a6] hover:bg-[#2A2D31] transition-colors disabled:opacity-40"
          >
            Lewati
          </button>
          <button
            onClick={handleLogReject}
            disabled={submitting || !selectedAlasanId || qtyReject < 1}
            className="flex-1 py-2 rounded-lg bg-red-700/80 hover:bg-red-700 text-[12px] font-bold text-white transition-colors disabled:opacity-40 flex items-center justify-center gap-1.5"
          >
            {submitting ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <>Ya, Log Reject</>
            )}
          </button>
        </div>
      </div>
    );
  };

  // UI Components
  const BundleInfoDisplay = ({ bundle }: { bundle: BundleForScan }) => (
    <div className="bg-[#1A1D1F] border border-[#2A2D31] rounded-2xl overflow-hidden mb-6">
      <div className="bg-[#2A2D31]/50 px-6 py-4 flex items-center justify-between border-b border-[#2A2D31]">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-[#e5c17b]/10 flex items-center justify-center">
            <Package className="w-4 h-4 text-[#e5c17b]" />
          </div>
          <div>
            <div className="text-[10px] text-[#9aa0a6] uppercase font-bold tracking-wider">Detail Bundle</div>
            <div className="text-sm font-bold text-[#e8eaed]">{bundle.barcode}</div>
          </div>
        </div>
        <div className="px-3 py-1 bg-[#1A1D1F] rounded-full border border-[#2A2D31] text-[10px] font-bold text-[#e5c17b] tracking-wide">
          ACTIVE
        </div>
      </div>
      
      <div className="p-6 grid grid-cols-2 md:grid-cols-3 gap-6">
        <InfoItem label="No. PO" value={bundle.no_po} color="#e5c17b" />
        <InfoItem label="Model" value={bundle.model_nama ?? '-'} />
        <InfoItem label="Warna" value={bundle.warna} />
        <InfoItem label="Size" value={bundle.size} />
        <InfoItem label="QTY Target" value={`${bundle.qty_per_bundle} pcs`} highlight />
        <InfoItem label="Waktu Scan" value={new Date().toLocaleDateString('id-ID')} />
      </div>
    </div>
  );

  const InfoItem = ({ label, value, color, highlight }: { label: string, value: string, color?: string, highlight?: boolean }) => (
    <div className="space-y-1">
      <div className="text-[11px] text-[#9aa0a6] font-medium uppercase tracking-tight">{label}</div>
      <div className={`text-sm font-bold ${highlight ? 'text-[#e5c17b]' : 'text-[#e8eaed]'}`} style={color ? { color } : {}}>
        {value}
      </div>
    </div>
  );

  return (
    <div className="max-w-4xl mx-auto">
      {/* Search Section */}
      {(state.phase === 'IDLE' || state.phase === 'LOADING') && (
        <div className="bg-[#1A1D1F] border border-[#2A2D31] rounded-3xl p-8 mb-8 shadow-xl">
          <div className="flex items-center gap-4 mb-6">
            <div className="w-12 h-12 rounded-2xl bg-[#e5c17b]/10 flex items-center justify-center ring-1 ring-[#e5c17b]/20">
              <Search className="text-[#e5c17b] w-6 h-6" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-[#e8eaed]">Scan Barcode</h2>
              <p className="text-[#9aa0a6] text-sm">Ketuk kolom di bawah untuk mulai scan ({tahapLabel})</p>
            </div>
          </div>

          <form onSubmit={handleScan} className="relative group">
            <input
              ref={inputRef}
              type="text"
              value={barcode}
              onChange={(e) => setBarcode(e.target.value)}
              placeholder="Masukkan barcode bundle..."
              disabled={state.phase === 'LOADING'}
              className="w-full bg-[#0D0E10] border-2 border-[#2A2D31] rounded-2xl py-4 px-14 text-lg font-bold text-[#e8eaed] placeholder:text-[#9aa0a6]/30 focus:border-[#e5c17b] focus:ring-4 focus:ring-[#e5c17b]/5 outline-none transition-all"
            />
            <div className="absolute left-5 top-1/2 -translate-y-1/2 text-[#9aa0a6]/50 group-focus-within:text-[#e5c17b] transition-colors">
              <Hash size={20} />
            </div>
            {state.phase === 'LOADING' ? (
              <div className="absolute right-5 top-1/2 -translate-y-1/2">
                <Loader2 className="w-6 h-6 text-[#e5c17b] animate-spin" />
              </div>
            ) : (
              <button
                type="submit"
                className="absolute right-3 top-1/2 -translate-y-1/2 bg-[#e5c17b] hover:bg-[#d4b16a] text-[#0D0E10] px-4 py-2 rounded-xl text-xs font-black shadow-lg transition-transform active:scale-95"
              >
                PROSES
              </button>
            )}
          </form>
        </div>
      )}

      {/* Search Results Picker */}
      {state.phase === 'SEARCH_RESULTS' && (
        <div className="bg-[#1A1D1F] border border-[#2A2D31] rounded-3xl p-8 mb-8 shadow-xl">
           <div className="flex items-center gap-4 mb-6">
            <div className="w-12 h-12 rounded-2xl bg-[#e5c17b]/10 flex items-center justify-center">
              <Info className="text-[#e5c17b] w-6 h-6" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-[#e8eaed]">Ditemukan {state.results.length} Bundle</h2>
              <p className="text-[#9aa0a6] text-sm">Barcode '{barcode}' merujuk ke beberapa bundle, silakan pilih salah satu:</p>
            </div>
          </div>

          <div className="grid gap-3">
            {state.results.map((res) => (
              <button
                key={res.barcode}
                onClick={() => handleSelectBundle(res.barcode)}
                className="flex items-center justify-between p-4 bg-[#0D0E10] border border-[#2A2D31] hover:border-[#e5c17b]/30 rounded-2xl transition-all group hover:bg-[#e5c17b]/5"
              >
                 <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-xl bg-[#2A2D31] flex items-center justify-center text-xs font-bold text-[#e8eaed] group-hover:bg-[#e5c17b] group-hover:text-[#0D0E10]">
                        {res.barcode.slice(-3)}
                    </div>
                    <div className="text-left">
                        <div className="text-xs text-[#9aa0a6] font-bold uppercase">{res.no_po}</div>
                        <div className="text-sm font-bold text-[#e8eaed] group-hover:text-[#e5c17b]">{res.warna} / {res.size}</div>
                    </div>
                 </div>
                 <ChevronRight className="w-5 h-5 text-[#2A2D31] group-hover:text-[#e5c17b]" />
              </button>
            ))}
          </div>

          <button
            onClick={resetToIdle}
            className="w-full mt-6 py-4 rounded-2xl border-2 border-[#2A2D31] text-sm font-bold text-[#9aa0a6] hover:bg-[#2A2D31]/30 transition-all"
          >
            BATAL & SCAN ULANG
          </button>
        </div>
      )}

      {/* Loaded Content */}
      {state.phase === 'LOADED' && (
        <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
           <BundleInfoDisplay bundle={state.bundle} />

           <div className="bg-[#1A1D1F] border border-[#2A2D31] rounded-3xl p-8 shadow-xl">
             <div className="flex flex-col md:flex-row items-center gap-6">
                {/* Status Indicator */}
                <div className="flex-1 w-full">
                    <div className="text-[11px] text-[#9aa0a6] font-bold uppercase tracking-wider mb-2">Status Saat Ini</div>
                    {state.bundle.status_tahap?.[tahap]?.status === 'terima' ? (
                        <div className="flex items-center gap-3 p-4 bg-[#e5c17b]/10 border border-[#e5c17b]/20 rounded-2xl">
                           <div className="w-10 h-10 rounded-full bg-[#e5c17b] flex items-center justify-center shadow-lg">
                              <History className="w-5 h-5 text-[#0D0E10]" />
                           </div>
                           <div>
                              <div className="text-xs font-bold text-[#e5c17b] uppercase">BUNDLE SEDANG DIPROSES</div>
                              <div className="text-[10px] text-[#9aa0a6]">Diterima: {new Date(state.bundle.status_tahap[tahap].waktu_terima).toLocaleTimeString()}</div>
                           </div>
                        </div>
                    ) : (
                        <div className="flex items-center gap-3 p-4 bg-[#2A2D31]/50 border border-[#2A2D31] rounded-2xl opacity-60">
                           <div className="w-10 h-10 rounded-full bg-[#1A1D1F] border border-[#2A2D31] flex items-center justify-center">
                              <Info className="w-5 h-5 text-[#9aa0a6]" />
                           </div>
                           <div>
                               <div className="text-xs font-bold text-[#9aa0a6] uppercase">MENUNGGU PENERIMAAN</div>
                               <div className="text-[10px] text-[#9aa0a6]/50">Siap untuk diproses di tahap {tahapLabel}</div>
                           </div>
                        </div>
                    )}
                </div>

                <div className="w-full flex flex-col gap-2 bg-[#0D0E10]/50 p-4 rounded-2xl border border-[#2A2D31]">
                  <div className="flex items-center justify-between">
                    <label className="text-[11px] font-bold text-[#9aa0a6] uppercase tracking-wider">QTY Selesai</label>
                    <span className="text-[10px] text-[#5f6368]">Default: {state.bundle.qty_per_bundle} pcs</span>
                  </div>
                  <input 
                    type="number" 
                    value={qty} 
                    onChange={(e) => setQty(Number(e.target.value))}
                    min={1}
                    className="bg-[#0D0E10] border border-[#2A2D31] rounded-xl px-4 py-2 text-[#e8eaed] w-full text-center text-lg font-bold focus:border-[#e5c17b] focus:ring-1 focus:ring-[#e5c17b] outline-none"
                  />
                </div>

                <div className="w-full md:w-auto flex flex-col md:flex-row gap-3">
                    <button
                        onClick={resetToIdle}
                        className="px-6 py-4 rounded-2xl bg-[#2A2D31] hover:bg-[#32363a] text-[#e8eaed] text-xs font-bold tracking-wide transition-all"
                    >
                        Batal
                    </button>
                    {isSingleMode ? (
                        <button
                            onClick={() => setShowModalSingle(true)}
                            className="px-10 py-4 rounded-2xl bg-[#e5c17b] hover:bg-[#d4b16a] text-[#0D0E10] text-xs font-black uppercase tracking-widest shadow-xl transition-all flex items-center justify-center gap-2"
                        >
                            <CheckCircle2 className="w-4 h-4" />
                            Selesaikan {tahapLabel}
                        </button>
                    ) : isLanjutMode ? (
                        <button
                            onClick={handleLanjut}
                            className="px-10 py-4 rounded-2xl bg-[#e5c17b] hover:bg-[#d4b16a] text-[#0D0E10] text-xs font-black uppercase tracking-widest shadow-xl shadow-[#e5c17b]/10 transition-all flex items-center justify-center gap-2"
                        >
                            <CheckCircle2 className="w-4 h-4" />
                            Proses {tahapLabel}
                        </button>
                    ) : state.bundle.status_tahap?.[tahap]?.status === 'terima' ? (
                         <button
                            onClick={() => handleSelesai()}
                            className="px-10 py-4 rounded-2xl bg-[#e5c17b] hover:bg-[#d4b16a] text-[#0D0E10] text-xs font-black uppercase tracking-widest shadow-xl shadow-[#e5c17b]/10 transition-all flex items-center justify-center gap-2"
                         >
                            <CheckCircle2 className="w-4 h-4" />
                            Selesaikan {tahapLabel}
                         </button>
                    ) : (
                        <button
                            onClick={handleTerima}
                            className="px-10 py-4 rounded-2xl bg-[#e5c17b] hover:bg-[#d4b16a] text-[#0D0E10] text-xs font-black uppercase tracking-widest shadow-xl shadow-[#e5c17b]/10 transition-all flex items-center justify-center gap-2"
                        >
                            <ArrowRight className="w-4 h-4" />
                            Terima {tahapLabel}
                        </button>
                    )}
                </div>
             </div>
           </div>
        </div>
      )}

      {/* Submitting Screen */}
      {state.phase === 'SUBMITTING' && (
        <div className="bg-[#1A1D1F] border border-[#2A2D31] rounded-3xl p-12 shadow-xl flex flex-col items-center text-center">
          <div className="relative w-20 h-20 mb-6">
            <div className="absolute inset-0 rounded-full border-4 border-[#e5c17b]/10"></div>
            <div className="absolute inset-0 rounded-full border-4 border-[#e5c17b] border-t-transparent animate-spin"></div>
            <div className="absolute inset-0 flex items-center justify-center">
               <RefreshCcw className="w-8 h-8 text-[#e5c17b] animate-pulse" />
            </div>
          </div>
          <h2 className="text-2xl font-bold text-[#e8eaed] mb-2">Memproses Data...</h2>
          <p className="text-[#9aa0a6] text-sm max-w-xs mx-auto">Sistem sedang memperbarui status bundle dan mencatat log aktivitas.</p>
        </div>
      )}

      {/* Result Screen */}
      {state.phase === 'RESULT' && (
        <div className="bg-[#1A1D1F] border border-[#2A2D31] rounded-3xl p-12 shadow-xl flex flex-col items-center text-center animate-in zoom-in-95 duration-300">
          <div className="w-24 h-24 rounded-full bg-[#e5c17b]/10 flex items-center justify-center mb-6 ring-2 ring-[#e5c17b]/20">
            <CheckCircle className="w-12 h-12 text-[#e5c17b]" />
          </div>
          <h2 className="text-3xl font-bold text-[#e8eaed] mb-2">Berhasil Disimpan!</h2>
          <p className="text-[#9aa0a6] text-sm mb-4">Data pengerjaan telah tercatat ke dalam sistem produksi.</p>

          {/* Reject Section — hanya muncul jika scan selesai (ada gaji entry) */}
          <div className="w-full max-w-sm mb-6">
            <RejectSection
              gajiLedgerId={state.gajiLedgerId}
              upahNominal={state.upah}
              onDone={() => {}}
            />
            {/* Reject Prompt — muncul jika qty kurang dari target */}
            {showRejectPrompt && <RejectPromptCard />}
          </div>

          <button
            onClick={resetToIdle}
            className="bg-[#e5c17b] hover:bg-[#d4b16a] text-[#0D0E10] px-12 py-4 rounded-2xl text-sm font-black uppercase tracking-widest shadow-xl shadow-[#e5c17b]/10 transition-all hover:scale-105 active:scale-95"
          >
            Scan Barcode Lain
          </button>
          
          {tahap === 'packing' && printData && (
            <button
              onClick={() => window.print()}
              className="mt-4 bg-indigo-600 hover:bg-indigo-700 text-white px-12 py-4 rounded-2xl text-sm font-black uppercase tracking-widest shadow-xl transition-all hover:scale-105 active:scale-95 flex items-center justify-center gap-2 w-full max-w-sm"
            >
              🖨️ Cetak {printData.qty} Label Hang Tag
            </button>
          )}

          {tahap === 'packing' && (
            <button
              onClick={() => router.push('/app/pengiriman/buat-surat-jalan')}
              className="mt-4 border border-[#e5c17b] text-[#e5c17b] hover:bg-[#e5c17b]/10 px-12 py-4 rounded-2xl text-sm font-black uppercase tracking-widest transition-all hover:scale-105 active:scale-95 w-full max-w-sm"
            >
              Buat Surat Jalan
            </button>
          )}
        </div>
      )}
      {/* Extras */}
      {/* Modal alasan untuk mode standard/lanjut (qty selesai < qty terima) */}
      <ModalAlasanQty
        isOpen={showModalAlasan}
        qtyTerima={state.phase === 'LOADED' ? (state.bundle.status_tahap?.[tahap]?.qty_terima ?? state.bundle.qty_per_bundle) : 0}
        qtyInput={qty}
        onConfirm={(id) => {
          setShowModalAlasan(false);
          handleSelesai(id);
        }}
        onCancel={() => setShowModalAlasan(false)}
      />

      {/* Modal konfirmasi QTY untuk mode single — selalu muncul sebelum submit */}
      <ModalKonfirmasiQtySingle
        isOpen={showModalSingle}
        tahapLabel={tahapLabel}
        qtyDefault={state.phase === 'LOADED' ? state.bundle.qty_per_bundle : 0}
        initialQty={qty}
        onConfirm={(finalQty, alasanId) => {
          setShowModalSingle(false);
          setQty(finalQty);
          handleSingle(finalQty, alasanId);
        }}
        onCancel={() => setShowModalSingle(false)}
      />

      <ToastQtyLebih show={showToastQtyLebih} onClose={() => setShowToastQtyLebih(false)} />

      {/* Print Layout — hidden kecuali saat print */}
      {tahap === 'packing' && printData && (
        <PrintHangTagLayout
          bundles={[printData]}
        />
      )}
    </div>
  );
}
