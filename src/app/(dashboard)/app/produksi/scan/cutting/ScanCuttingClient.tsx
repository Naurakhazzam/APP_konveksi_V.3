'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { getBundleForScan, searchBundlesByBarcode } from '@/lib/actions/produksi/scan.actions';
import { scanCuttingTerima, scanSelesai, type StokWarning } from '@/lib/actions/produksi/scan-mutations.actions';
import type { BundleForScan, BundleSearchResult } from '@/lib/actions/produksi/scan.actions';
import { BundleInfo } from './BundleInfo';
import { ModalPemakaianBahan } from './ModalPemakaianBahan';
import { ScanCuttingActions } from './ScanCuttingActions';
import ModalAlasanQty from '@/components/produksi/ModalAlasanQty';
import ToastQtyLebih from '@/components/produksi/ToastQtyLebih';
import RejectSection from '@/components/produksi/RejectSection';

export type BundleData = BundleForScan;

type ScanState =
  | { phase: 'IDLE' }
  | { phase: 'LOADING' }
  | { phase: 'SEARCH_RESULTS'; results: BundleSearchResult[] }
  | { phase: 'LOADED'; bundle: BundleData }
  | { phase: 'PEMAKAIAN'; bundle: BundleData }
  | { phase: 'CONFIRM_TERIMA'; bundle: BundleData; pemakaian: { inventory_item_id: string; rate_per_pcs: number }[] }
  | { phase: 'CONFIRM_SELESAI'; bundle: BundleData }
  | { phase: 'SUBMITTING'; bundle: BundleData }
  | { phase: 'RESULT'; stok_warnings: StokWarning[]; upah?: number; gajiLedgerId: string | null };

interface Props {
  karyawanList: { id: string; nama: string }[];
  inventoryItems: { id: string; nama: string; satuan: string; stok_aktual: number; warna_nama: string | null }[];
}

export default function ScanCuttingClient({ karyawanList, inventoryItems }: Props) {
  const [state, setState] = useState<ScanState>({ phase: 'IDLE' });
  const [barcode, setBarcode] = useState('');
  const [karyawanId, setKaryawanId] = useState('');
  const [qty, setQty] = useState(0);
  const [showModalAlasan, setShowModalAlasan] = useState(false);
  const [showToastQtyLebih, setShowToastQtyLebih] = useState(false);
  const [pendingSelesaiBundle, setPendingSelesaiBundle] = useState<any>(null);

  const resetToIdle = () => {
    setState({ phase: 'IDLE' });
    setBarcode('');
    setKaryawanId('');
    setQty(0);
  };

  const loadBundleByBarcode = async (exactBarcode: string) => {
    const bundle = await getBundleForScan(exactBarcode);
    if (!bundle) {
      toast.error('Bundle tidak ditemukan');
      setState({ phase: 'IDLE' });
      return;
    }
    if (bundle.status_tahap?.['cutting']?.status === 'selesai') {
      toast.error('Bundle ini sudah selesai di tahap Cutting');
      setState({ phase: 'IDLE' });
      return;
    }
    setQty(bundle.qty_per_bundle);
    setState({ phase: 'LOADED', bundle });
  };

  const handleScan = async () => {
    if (!barcode.trim()) return;
    setState({ phase: 'LOADING' });
    try {
      // 1. Coba exact match dulu
      const exact = await getBundleForScan(barcode.trim());
      if (exact) {
        if (exact.status_tahap?.['cutting']?.status === 'selesai') {
          toast.error('Bundle ini sudah selesai di tahap Cutting');
          setState({ phase: 'IDLE' });
          return;
        }
        setQty(exact.qty_per_bundle);
        setState({ phase: 'LOADED', bundle: exact });
        return;
      }
      // 2. Partial search jika tidak ketemu
      const results = await searchBundlesByBarcode(barcode.trim(), 'cutting');
      if (results.length === 0) {
        toast.error('Barcode tidak ditemukan');
        setState({ phase: 'IDLE' });
      } else if (results.length === 1) {
        // Auto-load jika hanya 1 hasil
        await loadBundleByBarcode(results[0].barcode);
      } else {
        // Tampilkan pilihan jika lebih dari 1
        setState({ phase: 'SEARCH_RESULTS', results });
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Gagal scan barcode');
      setState({ phase: 'IDLE' });
    }
  };

  const handleSelectBundle = async (selectedBarcode: string) => {
    setState({ phase: 'LOADING' });
    try {
      await loadBundleByBarcode(selectedBarcode);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Gagal memuat bundle');
      setState({ phase: 'IDLE' });
    }
  };

  const handleTerimaCutting = (bundle: BundleData) => {
    if (!bundle.has_pemakaian_config) {
      setState({ phase: 'PEMAKAIAN', bundle });
    } else {
      setState({ phase: 'CONFIRM_TERIMA', bundle, pemakaian: [] });
    }
  };

  const handlePemakaianSubmit = (
    bundle: BundleData,
    pemakaian: { inventory_item_id: string; rate_per_pcs: number }[]
  ) => {
    setState({ phase: 'CONFIRM_TERIMA', bundle, pemakaian });
  };

  const handleConfirmTerima = async (
    bundle: BundleData,
    pemakaian: { inventory_item_id: string; rate_per_pcs: number }[]
  ) => {
    if (!karyawanId) { toast.error('Pilih karyawan terlebih dahulu'); return; }
    setState({ phase: 'SUBMITTING', bundle });
    try {
      const result = await scanCuttingTerima({
        barcode: bundle.barcode,
        karyawan_id: karyawanId,
        qty,
        pemakaian,
        tenant_id: 'STX-001',
      });
      setState({ phase: 'RESULT', stok_warnings: result.stok_warnings, gajiLedgerId: null });
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Gagal menyimpan scan');
      setState({ phase: 'LOADED', bundle });
    }
  };

  const handleConfirmSelesai = async (bundle: BundleData, alasan_qty_id?: string) => {
    const qtyTerima = bundle.status_tahap?.['cutting']?.qty_terima ?? bundle.qty_per_bundle;

    if (qty < qtyTerima && !alasan_qty_id) {
      setPendingSelesaiBundle(bundle);
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
        tahap: 'cutting',
        karyawan_id: karyawanId || null,
        qty,
        tenant_id: 'STX-001',
        alasan_qty_id: alasan_qty_id ?? null,
      });

      if (result.is_qty_lebih) {
        setState({ phase: 'RESULT', stok_warnings: [], upah: result.upah_nominal, gajiLedgerId: result.gaji_entry_id });
        setShowToastQtyLebih(true);
      } else {
        const upahFormatted = result.upah_nominal.toLocaleString('id-ID');
        toast.success(`Bundle selesai cutting. Upah Rp ${upahFormatted} dicatat.`);
        setState({ phase: 'RESULT', stok_warnings: [], upah: result.upah_nominal, gajiLedgerId: result.gaji_entry_id });
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Gagal menyimpan scan selesai');
      setState({ phase: 'LOADED', bundle });
    }
  };

  const isSubmitting = state.phase === 'LOADING' || state.phase === 'SUBMITTING';

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      {/* Barcode input — always visible on IDLE */}
      {(state.phase === 'IDLE' || state.phase === 'LOADING') && (
        <div className="rounded-xl border border-[#2A2D31] bg-[#1A1D1F] p-5 shadow-sm">
          <p className="text-sm font-semibold text-[#e5c17b] tracking-wide mb-3">SCAN BARCODE CUTTING</p>
          <div className="flex gap-2">
            <input
              autoFocus
              disabled={isSubmitting}
              value={barcode}
              onChange={(e) => setBarcode(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleScan(); }}
              placeholder="Scan atau ketik barcode..."
              className="flex-1 h-10 rounded-md border border-[#2A2D31] bg-[#1E2124] px-3 text-sm text-[#e8eaed] placeholder:text-[#9aa0a6] focus:outline-none focus:ring-1 focus:ring-[#e5c17b]"
            />
            <button
              disabled={isSubmitting || !barcode.trim()}
              onClick={handleScan}
              className="h-10 px-4 rounded-md bg-[#e5c17b] text-[#0D0E10] text-sm font-semibold hover:bg-[#e5c17b]/90 disabled:opacity-40 transition-colors"
            >
              {state.phase === 'LOADING' ? 'Memuat...' : 'Scan'}
            </button>
          </div>
        </div>
      )}

      {/* Search results picker — muncul jika lebih dari 1 hasil */}
      {state.phase === 'SEARCH_RESULTS' && (
        <div className="rounded-xl border border-[#2A2D31] bg-[#1A1D1F] p-5 shadow-sm space-y-3">
          <p className="text-sm font-semibold text-[#e5c17b] tracking-wide">
            DITEMUKAN {state.results.length} BUNDLE — PILIH SALAH SATU
          </p>
          <div className="divide-y divide-[#2A2D31]">
            {state.results.map((r) => (
              <button
                key={r.id}
                onClick={() => handleSelectBundle(r.barcode)}
                className="w-full flex items-start justify-between gap-4 py-3 text-left hover:bg-[#1E2124] px-2 rounded-lg transition-colors"
              >
                <div>
                  <p className="font-mono text-sm text-[#e8eaed] font-semibold">{r.barcode}</p>
                  <p className="text-xs text-[#9aa0a6] mt-0.5">
                    {r.model_nama ?? '-'} · {r.warna} / {r.size}
                  </p>
                </div>
                <span className="font-mono text-xs text-[#e5c17b] shrink-0 mt-0.5">{r.no_po}</span>
              </button>
            ))}
          </div>
          <button
            onClick={resetToIdle}
            className="w-full h-9 rounded-md border border-[#2A2D31] text-[#9aa0a6] text-sm hover:bg-[#2A2D31] transition-colors"
          >
            Batal
          </button>
        </div>
      )}

      {/* Phase-specific panels */}
      {(state.phase === 'LOADED' || state.phase === 'PEMAKAIAN' || state.phase === 'CONFIRM_TERIMA' || state.phase === 'CONFIRM_SELESAI' || state.phase === 'SUBMITTING') && (
        <>
          <BundleInfo bundle={state.bundle} />
          <ScanCuttingActions
            state={state}
            karyawanList={karyawanList}
            karyawanId={karyawanId}
            qty={qty}
            isSubmitting={state.phase === 'SUBMITTING'}
            onKaryawanChange={setKaryawanId}
            onQtyChange={setQty}
            onTerimaCutting={handleTerimaCutting}
            onConfirmTerima={handleConfirmTerima}
            onConfirmSelesai={handleConfirmSelesai}
            onReset={resetToIdle}
          />
          {state.phase === 'PEMAKAIAN' && (
            <ModalPemakaianBahan
              open
              onOpenChange={(o) => { if (!o) setState({ phase: 'LOADED', bundle: state.bundle }); }}
              inventoryItems={inventoryItems}
              onSubmit={(pem) => handlePemakaianSubmit(state.bundle, pem)}
              disabled={false}
            />
          )}
        </>
      )}

      {/* Result screen */}
      {state.phase === 'RESULT' && (
        <div className="rounded-xl border border-[#2A2D31] bg-[#1A1D1F] p-5 shadow-sm space-y-4">
          <p className="text-[color:var(--status-green)] font-semibold text-sm">✓ Scan berhasil dicatat</p>
          {state.stok_warnings.map((w, i) => (
            <div key={i} className="rounded-lg bg-[#e5c17b]/10 border border-[#e5c17b]/30 px-4 py-3 text-sm text-[#e5c17b]">
              ⚠ Stok <strong>{w.item_nama}</strong> tidak mencukupi. Sisa {w.sisa_stok}. Produksi tetap dicatat.
            </div>
          ))}

          {/* Reject Section — hanya muncul jika ada gaji entry (scan selesai, bukan terima) */}
          <RejectSection
            gajiLedgerId={state.gajiLedgerId}
            upahNominal={state.upah ?? 0}
            onDone={() => {}}
          />

          <button
            onClick={resetToIdle}
            className="w-full h-10 rounded-md bg-[#e5c17b] text-[#0D0E10] text-sm font-semibold hover:bg-[#e5c17b]/90 transition-colors"
          >
            Scan Barcode Lain
          </button>
        </div>
      )}

      <ModalAlasanQty
        isOpen={showModalAlasan}
        qtyTerima={pendingSelesaiBundle?.status_tahap?.['cutting']?.qty_terima ?? pendingSelesaiBundle?.qty_per_bundle ?? 0}
        qtyInput={qty}
        onConfirm={(id) => {
          setShowModalAlasan(false);
          if (pendingSelesaiBundle) handleConfirmSelesai(pendingSelesaiBundle, id);
        }}
        onCancel={() => { setShowModalAlasan(false); setPendingSelesaiBundle(null); }}
      />
      <ToastQtyLebih show={showToastQtyLebih} onClose={() => setShowToastQtyLebih(false)} />
    </div>
  );
}
