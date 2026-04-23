'use client';

import React, { useState } from 'react';
import { toast } from 'sonner';
import { 
    getBundleForScan, 
    searchBundlesByBarcode,
    type BundleForScan,
    type BundleSearchResult
} from '@/lib/actions/produksi/scan.actions';
import { 
    scanTerimaGeneric, 
    scanSelesai 
} from '@/lib/actions/produksi/scan-mutations.actions';
import ModalSerahTerima from './ModalSerahTerima';
import ModalAlasanQty from '@/components/produksi/ModalAlasanQty';
import ToastQtyLebih from '@/components/produksi/ToastQtyLebih';
import { 
    Search, 
    Loader2, 
    User, 
    Hash, 
    ChevronRight, 
    CheckCircle2, 
    RefreshCcw,
    AlertCircle
} from 'lucide-react';
import { TAHAP_ORDER, TAHAP_CONFIG } from '@/modules/produksi/constants/tahap';

type ScanState =
  | { phase: 'IDLE' }
  | { phase: 'LOADING' }
  | { phase: 'SEARCH_RESULTS'; results: BundleSearchResult[] }
  | { phase: 'LOADED'; bundle: BundleForScan }
  | { phase: 'CONFIRM_TERIMA'; bundle: BundleForScan }
  | { phase: 'SUBMITTING'; bundle: BundleForScan }
  | { phase: 'RESULT' };

interface Props {
  karyawanList: { id: string; nama: string }[];
  inventoryItems: { id: string; nama: string; satuan: string }[];
}

export default function ScanJahitClient({ karyawanList, inventoryItems }: Props) {
  const [state, setState] = useState<ScanState>({ phase: 'IDLE' });
  const [barcode, setBarcode] = useState('');
  const [karyawanId, setKaryawanId] = useState('');
  const [qty, setQty] = useState(0);
  const [showModalAlasan, setShowModalAlasan] = useState(false);
  const [showToastQtyLebih, setShowToastQtyLebih] = useState(false);

  const resetToIdle = () => {
    setState({ phase: 'IDLE' });
    setBarcode('');
    setKaryawanId('');
    setQty(0);
  };

  const checkPrerequisite = (bundle: BundleForScan): boolean => {
    // Jahit membutuhkan cutting selesai
    if (bundle.status_tahap?.['cutting']?.status !== 'selesai') {
      toast.error('Bundle belum selesai di tahap Cutting');
      setState({ phase: 'IDLE' });
      return false;
    }
    return true;
  };

  const handleScan = async () => {
    if (!barcode.trim()) return;
    setState({ phase: 'LOADING' });
    try {
      // 1. Exact match
      const exact = await getBundleForScan(barcode.trim());
      if (exact) {
        if (exact.status_tahap?.['jahit']?.status === 'selesai') {
          toast.error('Bundle ini sudah selesai di tahap Jahit');
          setState({ phase: 'IDLE' });
          return;
        }
        if (!checkPrerequisite(exact)) return;
        setQty(exact.qty_per_bundle);
        setState({ phase: 'LOADED', bundle: exact });
        return;
      }
      // 2. Partial search
      const results = await searchBundlesByBarcode(barcode.trim(), 'jahit');
      if (results.length === 0) {
        toast.error('Barcode tidak ditemukan');
        setState({ phase: 'IDLE' });
      } else if (results.length === 1) {
        const bundle = await getBundleForScan(results[0].barcode);
        if (bundle) {
          if (bundle.status_tahap?.['jahit']?.status === 'selesai') {
            toast.error('Bundle ini sudah selesai di tahap Jahit');
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
        if (bundle.status_tahap?.['jahit']?.status === 'selesai') {
          toast.error('Bundle ini sudah selesai di tahap Jahit');
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

  const handleTerimaJahit = () => {
    if (!karyawanId) {
      toast.error('Pilih karyawan penjahit terlebih dahulu');
      return;
    }
    const bundle = (state as { bundle: BundleForScan }).bundle;
    setState({ phase: 'CONFIRM_TERIMA', bundle });
  };

  const handleApproveTerima = async () => {
    const bundle = (state as { bundle: BundleForScan }).bundle;
    setState({ phase: 'SUBMITTING', bundle });
    try {
      await scanTerimaGeneric({
        barcode: bundle.barcode,
        tahap: 'jahit',
        karyawan_id: karyawanId,
        qty: qty,
        tenant_id: 'STX-001'
      });
      toast.success('Bundle diterima di tahap Jahit');
      setState({ phase: 'RESULT' });
    } catch (err: any) {
      toast.error(err.message || 'Gagal submit penerimaan');
      setState({ phase: 'LOADED', bundle });
    }
  };

  async function handleSelesaikanJahit(alasan_qty_id?: string) {
    if (state.phase !== 'LOADED') return;
    const bundle = state.bundle;
    const qtyTerima = bundle.status_tahap?.['jahit']?.qty_terima ?? bundle.qty_per_bundle;

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
        tahap: 'jahit',
        karyawan_id: karyawanId || null,
        qty,
        catatan: undefined,
        alasan_qty_id: alasan_qty_id ?? null,
        tenant_id: 'STX-001',
      });

      if (result.is_qty_lebih) {
        setState({ phase: 'RESULT' });
        setShowToastQtyLebih(true);
      } else {
        toast.success('Pengerjaan jahit selesai');
        setState({ phase: 'RESULT' });
      }
    } catch (err: any) {
      toast.error(err.message || 'Gagal menyimpan scan selesai');
      setState({ phase: 'LOADED', bundle });
    }
  }

  // Sub-components
  const BundleInfoItem = ({ label, value }: { label: string; value: string | number }) => (
    <div className="bg-[#1A1D1F] p-3 rounded-lg border border-[#2A2D31]">
      <p className="text-[10px] uppercase tracking-wider text-[#9aa0a6] mb-0.5 font-bold">{label}</p>
      <p className="text-sm font-semibold text-[#e8eaed]">{value}</p>
    </div>
  );

  const BundleInfoDisplay = ({ bundle }: { bundle: BundleForScan }) => (
    <div className="rounded-2xl border border-[#2A2D31] bg-[#1A1D1F] overflow-hidden shadow-xl mb-6">
      <div className="bg-[#16181A] px-5 py-4 border-b border-[#2A2D31] flex items-center justify-between">
        <div>
           <div className="text-[10px] uppercase font-black tracking-widest text-[#9aa0a6] mb-1">Active Bundle</div>
           <h2 className="text-xl font-mono font-black text-[#e5c17b] tracking-tighter">{bundle.barcode}</h2>
        </div>
        <div className="bg-[#2A2D31] px-3 py-1 rounded text-[11px] font-bold text-[#e8eaed]">{bundle.no_po}</div>
      </div>
      <div className="p-5 grid grid-cols-2 md:grid-cols-3 gap-3">
        <BundleInfoItem label="Klien" value={bundle.klien_nama} />
        <BundleInfoItem label="Model" value={bundle.model_nama ?? '-'} />
        <BundleInfoItem label="Warna" value={bundle.warna} />
        <BundleInfoItem label="Size" value={bundle.size} />
        <BundleInfoItem label="QTY Bundle" value={`${bundle.qty_per_bundle} pcs`} />
        <BundleInfoItem label="No. Urut" value={`#${bundle.no_urut}`} />
      </div>
      
      {/* Progress mini dots */}
      <div className="px-5 pb-5 flex items-center gap-2">
        {TAHAP_ORDER.map(t => {
            const s = bundle.status_tahap[t]?.status;
            return (
                <div key={t} className="flex flex-col items-center gap-1 group relative">
                    <div className={`w-3 h-3 rounded-full border ${s === 'selesai' ? 'bg-[#e5c17b] border-[#e5c17b]' : s === 'terima' ? 'bg-[#e5c17b]/30 border-[#e5c17b] animate-pulse' : 'bg-transparent border-[#2A2D31]'}`} />
                    <span className="text-[8px] uppercase font-bold text-[#9aa0a6] group-hover:text-[#e8eaed] transition-colors">{TAHAP_CONFIG[t].label.slice(0, 3)}</span>
                    <div className="absolute bottom-full mb-2 hidden group-hover:block bg-[#2A2D31] text-[10px] px-2 py-1 rounded whitespace-nowrap z-20">
                        {TAHAP_CONFIG[t].label}: {s === 'selesai' ? 'Selesai' : s === 'terima' ? 'Proses' : 'Menunggu'}
                    </div>
                </div>
            )
        })}
      </div>
    </div>
  );

  return (
    <div className="max-w-2xl mx-auto space-y-6 min-h-[400px]">
      {/* Search Input Panel */}
      {(state.phase === 'IDLE' || state.phase === 'LOADING') && (
        <div className="bg-[#1A1D1F] border border-[#2A2D31] rounded-2xl p-6 shadow-2xl">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-[#e5c17b]/10 flex items-center justify-center">
              <Search className="w-5 h-5 text-[#e5c17b]" />
            </div>
            <div>
              <h3 className="text-sm font-black text-[#e8eaed] tracking-tight uppercase">Scan Barcode Jahit</h3>
              <p className="text-xs text-[#9aa0a6]">Gunakan scanner atau ketik ID Bundle</p>
            </div>
          </div>
          <div className="flex gap-2">
            <input
              autoFocus
              disabled={state.phase === 'LOADING'}
              value={barcode}
              onChange={(e) => setBarcode(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleScan()}
              placeholder="Scan barcode bundle..."
              className="flex-1 bg-[#16181A] border border-[#2A2D31] rounded-xl px-4 py-3 text-[#e8eaed] focus:ring-2 focus:ring-[#e5c17b]/50 focus:border-[#e5c17b] outline-none transition-all placeholder:text-[#9aa0a6] font-mono text-sm"
            />
            <button
              onClick={handleScan}
              disabled={state.phase === 'LOADING' || !barcode.trim()}
              className="bg-[#e5c17b] text-[#0D0E10] px-6 py-2 rounded-xl font-bold hover:bg-[#e5c17b]/90 transition-all disabled:opacity-50 flex items-center gap-2"
            >
              {state.phase === 'LOADING' ? <Loader2 className="animate-spin w-4 h-4" /> : 'Scan'}
            </button>
          </div>
        </div>
      )}

      {/* Multi-result picker */}
      {state.phase === 'SEARCH_RESULTS' && (
        <div className="bg-[#1A1D1F] border border-[#2A2D31] rounded-2xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-2 text-[#e5c17b] mb-2">
                <AlertCircle size={16} />
                <h3 className="text-xs font-black uppercase tracking-widest">Ditemukan {state.results.length} Bundle</h3>
            </div>
            <div className="grid gap-2">
                {state.results.map(r => (
                    <button
                        key={r.id}
                        onClick={() => handleSelectBundle(r.barcode)}
                        className="w-full text-left p-4 rounded-xl border border-[#2A2D31] hover:border-[#e5c17b] hover:bg-[#e5c17b]/5 transition-all flex items-center justify-between group"
                    >
                        <div>
                            <div className="text-sm font-mono font-bold text-[#e8eaed] group-hover:text-[#e5c17b]">{r.barcode}</div>
                            <div className="text-[10px] text-[#9aa0a6] uppercase tracking-tighter">{r.model_nama} · {r.warna} / {r.size}</div>
                        </div>
                        <div className="text-right">
                           <div className="text-xs font-bold text-[#e5c17b]">{r.no_po}</div>
                        </div>
                    </button>
                ))}
            </div>
            <button 
                onClick={resetToIdle}
                className="w-full py-2 text-xs font-bold text-[#9aa0a6] hover:text-[#e8eaed] bg-[#2A2D31]/30 rounded-lg transition-all"
            >
                Batal & Scan Ulang
            </button>
        </div>
      )}

      {/* Main Loaded Interaction */}
      {(state.phase === 'LOADED' || state.phase === 'CONFIRM_TERIMA' || state.phase === 'SUBMITTING') && (
        <div className="space-y-6">
          <BundleInfoDisplay bundle={state.bundle} />

          <div className="bg-[#1A1D1F] border border-[#2A2D31] rounded-2xl p-6 shadow-2xl space-y-5">
             <div className="flex flex-col md:flex-row gap-4">
                {/* Employee Selector — HANYA tampil saat bundle belum diterima (fase terima) */}
                {state.bundle.status_tahap?.['jahit']?.status !== 'terima' && (
                  <div className="flex-1 space-y-2">
                      <label className="text-[10px] font-black uppercase tracking-[0.2em] text-[#e5c17b] flex items-center gap-2">
                          <User size={12} /> Karyawan Penjahit
                      </label>
                      <select
                          value={karyawanId}
                          onChange={(e) => setKaryawanId(e.target.value)}
                          className="w-full bg-[#16181A] border border-[#2A2D31] rounded-xl px-4 py-3 text-[#e8eaed] focus:ring-1 focus:ring-[#e5c17b] outline-none transition-all text-sm"
                      >
                          <option value="">Pilih Penjahit...</option>
                          {karyawanList.map(k => (
                              <option key={k.id} value={k.id}>{k.nama}</option>
                          ))}
                      </select>
                  </div>
                )}

                {/* Qty Input */}
                <div className="w-full md:w-32 space-y-2">
                    <label className="text-[10px] font-black uppercase tracking-[0.2em] text-[#e5c17b] flex items-center gap-2">
                        <Hash size={12} /> Quantity
                    </label>
                    <input 
                        type="number"
                        value={qty}
                        onChange={(e) => setQty(Number(e.target.value))}
                        className="w-full bg-[#16181A] border border-[#2A2D31] rounded-xl px-4 py-3 text-[#e8eaed] focus:ring-1 focus:ring-[#e5c17b] outline-none text-sm text-center font-bold"
                    />
                </div>
             </div>

             {/* Action Buttons */}
             <div className="pt-4 flex gap-3">
                <button
                    onClick={resetToIdle}
                    className="flex-1 py-3 text-xs font-bold text-[#9aa0a6] hover:text-[#e8eaed] border border-[#2A2D31] rounded-xl hover:bg-[#2A2D31] transition-all"
                >
                    Reset
                </button>
                
                {/* Logic: if not received in jahit yet */}
                {state.bundle.status_tahap.jahit?.status !== 'terima' && state.bundle.status_tahap.jahit?.status !== 'selesai' && (
                    <button
                        onClick={handleTerimaJahit}
                        disabled={state.phase === 'SUBMITTING'}
                        className="flex-[2] bg-[#e5c17b] text-[#0D0E10] py-3 rounded-xl font-bold hover:bg-[#e5c17b]/90 transition-all flex items-center justify-center gap-2"
                    >
                        {state.phase === 'SUBMITTING' ? <Loader2 className="animate-spin w-4 h-4" /> : <>Terima Jahit <ChevronRight size={16} /></>}
                    </button>
                )}

                {/* Logic: if already received, show Selesai */}
                {state.bundle.status_tahap.jahit?.status === 'terima' && (
                  <div className="flex flex-col items-end gap-3 flex-[2]">
                    <div className="space-y-1">
                      <label className="text-[11px] font-bold text-[#9aa0a6] uppercase tracking-wider">QTY Selesai</label>
                      <input
                        type="number"
                        min={1}
                        value={qty}
                        onChange={(e) => setQty(Number(e.target.value))}
                        className="w-24 bg-[#0D0E10] border border-[#2A2D31] rounded-xl px-4 py-2 text-[#e8eaed] text-center text-lg font-bold focus:border-[#e5c17b] focus:outline-none"
                      />
                      <p className="text-[10px] text-[#9aa0a6]">Default: {state.bundle.qty_per_bundle} pcs</p>
                    </div>
                     <button
                        onClick={() => handleSelesaikanJahit()}
                        disabled={state.phase === 'SUBMITTING'}
                        className="w-full bg-[color:var(--status-green)] text-white py-3 rounded-xl font-bold hover:opacity-90 transition-all flex items-center justify-center gap-2"
                     >
                        {state.phase === 'SUBMITTING' ? <Loader2 className="animate-spin w-4 h-4" /> : <>Selesaikan Jahit <CheckCircle2 size={16} /></>}
                     </button>
                  </div>
                )}
             </div>
          </div>

          <ModalSerahTerima 
            open={state.phase === 'CONFIRM_TERIMA'}
            onOpenChange={(open) => !open && setState({ phase: 'LOADED', bundle: state.bundle })}
            bundle={state.bundle}
            karyawanNama={karyawanList.find(k => k.id === karyawanId)?.nama ?? ''}
            inventoryItems={inventoryItems}
            onApprove={handleApproveTerima}
            disabled={state.phase === 'SUBMITTING'}
          />
        </div>
      )}

      {/* Success Result Panel */}
      {state.phase === 'RESULT' && (
        <div className="bg-[#1A1D1F] border border-[#2A2D31] rounded-2xl p-10 shadow-2xl text-center flex flex-col items-center">
            <div className="w-16 h-16 rounded-full bg-[color:var(--status-green)]/10 flex items-center justify-center mb-6">
                <CheckCircle2 className="w-8 h-8 text-[color:var(--status-green)]" />
            </div>
            <h2 className="text-2xl font-black text-[#e8eaed] mb-2 tracking-tight">SCAN HASIL BERHASIL</h2>
            <p className="text-[#9aa0a6] text-sm mb-8">Data produksi tahap Jahit telah diperbarui dan dicatatkan pada sistem.</p>
            <button
                onClick={resetToIdle}
                className="w-full py-4 bg-[#e5c17b] text-[#0D0E10] font-black rounded-xl hover:bg-[#e5c17b]/90 transition-all flex items-center justify-center gap-3"
            >
                <RefreshCcw size={18} /> SCAN BARCODE LAIN
            </button>
        </div>
      )}
  <ModalAlasanQty
    isOpen={showModalAlasan}
    qtyTerima={state.phase === 'LOADED' ? (state.bundle.status_tahap?.['jahit']?.qty_terima ?? state.bundle.qty_per_bundle) : 0}
    qtyInput={qty}
    onConfirm={(id) => { setShowModalAlasan(false); handleSelesaikanJahit(id); }}
    onCancel={() => setShowModalAlasan(false)}
  />
  <ToastQtyLebih show={showToastQtyLebih} onClose={() => setShowToastQtyLebih(false)} />
    </div>
  );
}
