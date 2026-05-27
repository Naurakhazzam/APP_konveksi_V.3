'use client';

import React, { useState, useEffect } from 'react';
import { type AntrianJahitBundle } from '@/lib/actions/produksi/scan.actions';
import { getAlasanQty, type AlasanQty } from '@/lib/actions/produksi/qty-approval.actions';
import { scanSelesai } from '@/lib/actions/produksi/scan-mutations.actions';
import { X, CheckCircle, AlertTriangle, Loader2, User } from 'lucide-react';
import { toast } from 'sonner';

interface RowState {
  bundleId: string;
  qty: number;
  alasan_qty_id: string | null;
  catatan: string;
}

interface Props {
  bundles: AntrianJahitBundle[];
  karyawanList: { id: string; nama: string }[];
  onSuccess: () => void;
  onClose: () => void;
}

export default function ModalBatchSelesaiJahit({ bundles, karyawanList, onSuccess, onClose }: Props) {
  const [alasanList, setAlasanList] = useState<AlasanQty[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [rows, setRows] = useState<RowState[]>(() =>
    bundles.map(b => {
      const qtyTerima = (b as any).status_tahap?.['jahit']?.qty_terima ?? b.qty_per_bundle;
      return { bundleId: b.id, qty: qtyTerima, alasan_qty_id: null, catatan: '' };
    })
  );

  useEffect(() => {
    getAlasanQty().then(setAlasanList).catch(() => {});
  }, []);

  const updateRow = (bundleId: string, patch: Partial<RowState>) => {
    setRows(prev => prev.map(r => r.bundleId === bundleId ? { ...r, ...patch } : r));
  };

  const getQtyTerima = (b: AntrianJahitBundle): number =>
    (b as any).status_tahap?.['jahit']?.qty_terima ?? b.qty_per_bundle;

  const getKaryawanId = (b: AntrianJahitBundle): string | null =>
    (b as any).status_tahap?.['jahit']?.karyawan_id ?? null;

  const getKaryawanNama = (b: AntrianJahitBundle): string | null => {
    const kid = getKaryawanId(b);
    return kid ? (karyawanList.find(k => k.id === kid)?.nama ?? null) : null;
  };

  // Per-row validation
  const rowErrors: Record<string, string | null> = {};
  for (const b of bundles) {
    const row = rows.find(r => r.bundleId === b.id)!;
    const qtyTerima = getQtyTerima(b);
    if (!getKaryawanId(b)) {
      rowErrors[b.id] = 'Bundle belum memiliki karyawan — lakukan serah terima dahulu';
    } else if (!row.qty || row.qty <= 0) {
      rowErrors[b.id] = 'QTY harus lebih dari 0';
    } else if (row.qty < qtyTerima && !row.alasan_qty_id) {
      rowErrors[b.id] = 'Wajib pilih alasan karena QTY selesai < QTY diterima';
    } else {
      rowErrors[b.id] = null;
    }
  }

  const hasErrors = Object.values(rowErrors).some(e => e !== null);
  const hasNullKaryawan = bundles.some(b => !getKaryawanId(b));
  const totalPcs = rows.reduce((sum, r) => sum + (r.qty || 0), 0);

  const handleSubmit = async () => {
    if (hasErrors || isSubmitting) return;
    setIsSubmitting(true);
    let berhasil = 0;
    let gagal = 0;
    for (const b of bundles) {
      const row = rows.find(r => r.bundleId === b.id)!;
      try {
        await scanSelesai({
          barcode: b.barcode,
          tahap: 'jahit',
          karyawan_id: getKaryawanId(b),
          qty: row.qty,
          catatan: row.catatan || undefined,
          alasan_qty_id: row.alasan_qty_id,
          tenant_id: 'STX-001',
        });
        berhasil++;
      } catch (err: any) {
        gagal++;
        toast.error(`Gagal: ${b.barcode} — ${err.message}`);
      }
    }
    setIsSubmitting(false);
    if (berhasil > 0) {
      toast.success(`${berhasil} bundle berhasil diselesaikan${gagal > 0 ? `, ${gagal} gagal` : ''}`);
      onSuccess();
    }
  };

  return (
    <div className="fixed inset-0 bg-black/75 flex items-center justify-center z-50 p-4">
      <div className="bg-[#1A1D1F] border border-[#2A2D31] rounded-2xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl">

        {/* Header */}
        <div className="px-6 py-5 border-b border-[#2A2D31] flex items-center justify-between shrink-0">
          <div>
            <h2 className="text-xl font-bold text-[#e8eaed] flex items-center gap-2">
              <CheckCircle className="w-5 h-5 text-green-400" />
              Selesaikan Bundle Jahit
            </h2>
            <p className="text-sm text-[#9aa0a6] mt-0.5">
              {bundles.length} bundle dipilih — periksa & konfirmasi QTY sebelum submit
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={isSubmitting}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-[#9aa0a6] hover:text-[#e8eaed] hover:bg-[#2A2D31] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Warning: null karyawan */}
        {hasNullKaryawan && (
          <div className="mx-6 mt-4 bg-orange-500/10 border border-orange-500/30 rounded-xl px-4 py-3 flex items-start gap-3 shrink-0">
            <AlertTriangle className="w-4 h-4 text-orange-400 mt-0.5 shrink-0" />
            <p className="text-xs text-orange-300 font-medium leading-relaxed">
              Beberapa bundle belum memiliki karyawan dan tidak bisa diselesaikan. Lakukan serah terima terlebih dahulu, atau batalkan pilihan bundle tersebut.
            </p>
          </div>
        )}

        {/* Bundle rows — scrollable */}
        <div className="overflow-y-auto flex-1 px-6 py-4 space-y-3">
          {bundles.map(b => {
            const row = rows.find(r => r.bundleId === b.id)!;
            const qtyTerima = getQtyTerima(b);
            const karyawanNama = getKaryawanNama(b);
            const karyawanId = getKaryawanId(b);
            const isQtyKurang = row.qty < qtyTerima && row.qty > 0;
            const isQtyLebih = row.qty > qtyTerima;
            const rowError = rowErrors[b.id];
            const disabled = isSubmitting || !karyawanId;

            const borderClass = !karyawanId
              ? 'border-orange-500/40'
              : rowError
              ? 'border-red-500/40'
              : isQtyLebih
              ? 'border-yellow-500/30'
              : 'border-[#2A2D31]';

            return (
              <div key={b.id} className={`bg-[#16181A] border rounded-xl p-4 ${borderClass}`}>

                {/* Info row */}
                <div className="flex flex-wrap items-start gap-x-6 gap-y-2 mb-4">
                  <div>
                    <p className="text-[10px] text-[#9aa0a6] uppercase tracking-wider mb-0.5">Barcode</p>
                    <p className="font-mono text-xs text-[#e8eaed] font-bold">{b.barcode}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-[#9aa0a6] uppercase tracking-wider mb-0.5">Artikel</p>
                    <p className="text-xs text-[#e8eaed] font-medium">{b.model_nama ?? '-'}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-[#9aa0a6] uppercase tracking-wider mb-0.5">Warna / Size</p>
                    <p className="text-xs text-[#e8eaed]">{b.warna} / {b.size}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-[#9aa0a6] uppercase tracking-wider mb-0.5">Penjahit</p>
                    {karyawanNama
                      ? (
                        <p className="text-xs text-[#e8eaed] font-medium flex items-center gap-1">
                          <User className="w-3 h-3 text-[#e5c17b]" />
                          {karyawanNama}
                        </p>
                      ) : (
                        <p className="text-xs text-orange-400 font-semibold flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3" />
                          Belum ditentukan
                        </p>
                      )
                    }
                  </div>
                  <div>
                    <p className="text-[10px] text-[#9aa0a6] uppercase tracking-wider mb-0.5">QTY Diterima</p>
                    <p className="text-xs text-[#e5c17b] font-bold">{qtyTerima} pcs</p>
                  </div>
                </div>

                {/* Input row */}
                <div className="flex flex-wrap items-start gap-3">

                  {/* QTY Selesai */}
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black uppercase tracking-[0.15em] text-[#e5c17b]">
                      QTY Selesai
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min={1}
                        value={row.qty || ''}
                        onChange={e => {
                          const newQty = parseInt(e.target.value) || 0;
                          updateRow(b.id, {
                            qty: newQty,
                            // reset alasan jika qty kembali ke >= terima
                            alasan_qty_id: newQty >= qtyTerima ? null : row.alasan_qty_id,
                          });
                        }}
                        disabled={disabled}
                        className="w-24 bg-[#0D0E10] border border-[#2A2D31] rounded-lg px-3 py-2 text-[#e8eaed] text-center text-sm font-bold focus:ring-1 focus:ring-[#e5c17b] outline-none disabled:opacity-40"
                      />
                      {isQtyLebih && (
                        <span className="text-[10px] font-semibold text-yellow-400 flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3" />
                          QTY Lebih — butuh approval
                        </span>
                      )}
                      {isQtyKurang && row.alasan_qty_id && (
                        <span className="text-[10px] font-semibold text-green-400">✓ Alasan dipilih</span>
                      )}
                    </div>
                  </div>

                  {/* Alasan — muncul hanya jika qty kurang */}
                  {isQtyKurang && (
                    <div className="space-y-1.5 flex-1 min-w-[200px]">
                      <label className="text-[10px] font-black uppercase tracking-[0.15em] text-red-400">
                        Alasan QTY Kurang *
                      </label>
                      <select
                        value={row.alasan_qty_id ?? ''}
                        onChange={e => updateRow(b.id, { alasan_qty_id: e.target.value || null })}
                        disabled={disabled}
                        className="w-full bg-[#0D0E10] border border-red-500/40 rounded-lg px-3 py-2 text-[#e8eaed] text-xs focus:ring-1 focus:ring-red-400 outline-none disabled:opacity-40"
                      >
                        <option value="">-- Pilih alasan --</option>
                        {alasanList.map(a => (
                          <option key={a.id} value={a.id}>{a.label}</option>
                        ))}
                      </select>
                    </div>
                  )}

                  {/* Catatan */}
                  <div className="space-y-1.5 flex-1 min-w-[180px]">
                    <label className="text-[10px] font-black uppercase tracking-[0.15em] text-[#9aa0a6]">
                      Catatan (opsional)
                    </label>
                    <input
                      type="text"
                      placeholder="Tambah catatan..."
                      value={row.catatan}
                      onChange={e => updateRow(b.id, { catatan: e.target.value })}
                      disabled={disabled}
                      className="w-full bg-[#0D0E10] border border-[#2A2D31] rounded-lg px-3 py-2 text-[#e8eaed] text-xs placeholder-[#9aa0a6]/40 focus:ring-1 focus:ring-[#e5c17b] outline-none disabled:opacity-40"
                    />
                  </div>
                </div>

                {/* Row error */}
                {rowError && (
                  <p className="text-[10px] text-red-400 mt-2 flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3 shrink-0" />
                    {rowError}
                  </p>
                )}
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-[#2A2D31] bg-[#16181A] rounded-b-2xl shrink-0 flex items-center justify-between">
          <div className="text-sm text-[#9aa0a6]">
            <span className="font-bold text-[#e8eaed]">{bundles.length}</span> bundle
            {' · '}
            <span className="font-bold text-[#e5c17b]">{totalPcs}</span> pcs total
            {hasErrors && (
              <span className="ml-3 text-[10px] text-red-400 font-semibold flex items-center gap-1 inline-flex">
                <AlertTriangle className="w-3 h-3" />
                Ada input yang belum lengkap
              </span>
            )}
          </div>
          <div className="flex gap-3">
            <button
              onClick={onClose}
              disabled={isSubmitting}
              className="px-6 py-2.5 rounded-xl border border-[#2A2D31] text-sm font-bold text-[#e8eaed] hover:bg-[#2A2D31] transition-colors disabled:opacity-50"
            >
              Batal
            </button>
            <button
              onClick={handleSubmit}
              disabled={isSubmitting || hasErrors}
              className="flex items-center gap-2 bg-green-600 hover:bg-green-500 text-white px-6 py-2.5 rounded-xl text-sm font-bold transition-colors disabled:opacity-40 disabled:cursor-not-allowed shadow-lg"
            >
              {isSubmitting
                ? <><Loader2 className="w-4 h-4 animate-spin" /> Memproses...</>
                : <><CheckCircle className="w-4 h-4" /> Selesaikan {bundles.length} Bundle</>
              }
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
