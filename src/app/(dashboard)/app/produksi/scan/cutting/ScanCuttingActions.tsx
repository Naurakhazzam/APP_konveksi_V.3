'use client';

import type { BundleData } from './ScanCuttingClient';

type ScanState =
  | { phase: 'LOADED'; bundle: BundleData }
  | { phase: 'PEMAKAIAN'; bundle: BundleData }
  | { phase: 'CONFIRM_TERIMA'; bundle: BundleData; pemakaian: { inventory_item_id: string; rate_per_pcs: number }[] }
  | { phase: 'CONFIRM_SELESAI'; bundle: BundleData }
  | { phase: 'SUBMITTING'; bundle: BundleData };

interface Props {
  state: ScanState;
  karyawanList: { id: string; nama: string }[];
  karyawanId: string;
  qty: number;
  isSubmitting: boolean;
  onKaryawanChange: (id: string) => void;
  onQtyChange: (qty: number) => void;
  onTerimaCutting: (bundle: BundleData) => void;
  onConfirmTerima: (bundle: BundleData, pemakaian: { inventory_item_id: string; rate_per_pcs: number }[]) => void;
  onConfirmSelesai: (bundle: BundleData) => void;
  onReset: () => void;
}

const selectClass =
  'flex h-10 w-full rounded-md border border-[#2A2D31] bg-[#1E2124] px-3 text-sm text-[#e8eaed] focus:outline-none focus:ring-1 focus:ring-[#e5c17b] disabled:opacity-50';

const inputClass =
  'flex h-10 w-full rounded-md border border-[#2A2D31] bg-[#1E2124] px-3 text-sm text-[#e8eaed] focus:outline-none focus:ring-1 focus:ring-[#e5c17b] disabled:opacity-50';

export function ScanCuttingActions({
  state, karyawanList, karyawanId, qty, isSubmitting,
  onKaryawanChange, onQtyChange, onTerimaCutting,
  onConfirmTerima, onConfirmSelesai, onReset,
}: Props) {
  const { bundle } = state;
  const cuttingStatus = bundle.status_tahap['cutting']?.status ?? null;

  // Case C: already done
  if (cuttingStatus === 'selesai') {
    return (
      <div className="rounded-xl border border-[#2A2D31] bg-[#1A1D1F] p-5 text-center space-y-3">
        <p className="text-[color:var(--status-green)] font-semibold">✓ Bundle ini sudah selesai cutting</p>
        <button
          onClick={onReset}
          className="w-full h-10 rounded-md bg-[#e5c17b] text-[#0D0E10] text-sm font-semibold hover:bg-[#e5c17b]/90 transition-colors"
        >
          Scan Barcode Lain
        </button>
      </div>
    );
  }

  // Case B: in progress — show 'selesai' form
  if (cuttingStatus === 'terima') {
    const cuttingNode = bundle.status_tahap['cutting'];
    const karyawanPemegang = karyawanList.find(k => k.id === cuttingNode?.karyawan_id)?.nama ?? '-';
    const maxQty = cuttingNode?.qty_terima ?? qty;
    return (
      <div className="rounded-xl border border-[#2A2D31] bg-[#1A1D1F] p-5 space-y-4 shadow-sm">
        <p className="text-sm font-semibold tracking-wide text-[#e5c17b]">SELESAIKAN CUTTING</p>
        <div className="text-xs text-[#9aa0a6]">
          Diterima oleh: <span className="text-[#e8eaed] font-medium">{karyawanPemegang}</span>
          {' · '}QTY Terima: <span className="text-[#e8eaed] font-medium">{maxQty} pcs</span>
        </div>
        <div className="space-y-1">
          <label className="text-xs text-[#9aa0a6] uppercase tracking-wide">QTY Selesai</label>
          <input
            type="number"
            min={1}
            max={maxQty}
            disabled={isSubmitting}
            value={qty}
            onChange={(e) => onQtyChange(parseInt(e.target.value) || 0)}
            className={inputClass}
          />
        </div>
        <div className="flex gap-3 pt-1">
          <button
            onClick={onReset}
            disabled={isSubmitting}
            className="flex-1 h-10 rounded-md border border-[#2A2D31] text-[#9aa0a6] text-sm hover:bg-[#2A2D31] disabled:opacity-40 transition-colors"
          >
            Batal
          </button>
          <button
            disabled={isSubmitting || qty <= 0 || qty > maxQty}
            onClick={() => onConfirmSelesai(bundle)}
            className="flex-1 h-10 rounded-md bg-[color:var(--status-green)] text-white text-sm font-semibold hover:opacity-90 disabled:opacity-40 transition-opacity"
          >
            {isSubmitting ? 'Menyimpan...' : 'Selesaikan Cutting'}
          </button>
        </div>
      </div>
    );
  }

  // Case A: null — show 'terima' form
  const pemakaian = state.phase === 'CONFIRM_TERIMA' ? state.pemakaian : [];
  const readyToSubmit = state.phase === 'CONFIRM_TERIMA';

  return (
    <div className="rounded-xl border border-[#2A2D31] bg-[#1A1D1F] p-5 space-y-4 shadow-sm">
      <p className="text-sm font-semibold tracking-wide text-[#e5c17b]">TERIMA CUTTING</p>
      <div className="space-y-1">
        <label className="text-xs text-[#9aa0a6] uppercase tracking-wide">Karyawan</label>
        <select
          className={selectClass}
          value={karyawanId}
          disabled={isSubmitting}
          onChange={(e) => onKaryawanChange(e.target.value)}
        >
          <option value="">Pilih karyawan...</option>
          {karyawanList.map(k => (
            <option key={k.id} value={k.id}>{k.nama}</option>
          ))}
        </select>
      </div>
      <div className="space-y-1">
        <label className="text-xs text-[#9aa0a6] uppercase tracking-wide">QTY Terima</label>
        <input
          type="number"
          min={1}
          disabled={isSubmitting}
          value={qty}
          onChange={(e) => onQtyChange(parseInt(e.target.value) || 0)}
          className={inputClass}
        />
      </div>
      {readyToSubmit && (
        <p className="text-xs text-[#9aa0a6]">
          ✓ Config pemakaian bahan siap ({pemakaian.length} item)
        </p>
      )}
      <div className="flex gap-3 pt-1">
        <button
          onClick={onReset}
          disabled={isSubmitting}
          className="flex-1 h-10 rounded-md border border-[#2A2D31] text-[#9aa0a6] text-sm hover:bg-[#2A2D31] disabled:opacity-40 transition-colors"
        >
          Batal
        </button>
        <button
          disabled={isSubmitting || !karyawanId || qty <= 0}
          onClick={() =>
            readyToSubmit
              ? onConfirmTerima(bundle, pemakaian)
              : onTerimaCutting(bundle)
          }
          className="flex-1 h-10 rounded-md bg-[#e5c17b] text-[#0D0E10] text-sm font-semibold hover:bg-[#e5c17b]/90 disabled:opacity-40 transition-colors"
        >
          {isSubmitting ? 'Menyimpan...' : readyToSubmit ? 'Konfirmasi Terima' : 'Terima Cutting'}
        </button>
      </div>
    </div>
  );
}
