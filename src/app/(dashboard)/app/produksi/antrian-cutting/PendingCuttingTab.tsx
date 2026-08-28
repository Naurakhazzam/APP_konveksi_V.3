'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Loader2, XCircle, Scissors, Plus, Trash2, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import {
  getPendingCuttingBundles,
  getInventoryItemsForCutting,
  getKaryawanCutting,
  closeBundleCutting,
  lanjutCuttingPartial,
  type PendingBundle,
  type InventoryItemOption,
  type StokWarning,
  type KaryawanOption,
} from '@/lib/actions/produksi/cutting.actions';

interface BahanRow {
  rowId: string;
  inventory_item_id: string;
  rate_per_pcs: number;
}

const terpotong = (b: PendingBundle) => b.qty_aktual + b.qty_susulan;
const sisaOf    = (b: PendingBundle) => Math.max(b.qty_order - terpotong(b), 0);

export default function PendingCuttingTab() {
  const [bundles, setBundles] = useState<PendingBundle[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [confirmBundle, setConfirmBundle] = useState<PendingBundle | null>(null);
  const [lanjutBundle, setLanjutBundle] = useState<PendingBundle | null>(null);
  const [closingId, setClosingId] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await getPendingCuttingBundles();
      setBundles(data);
    } catch (e: any) {
      toast.error('Gagal memuat data pending: ' + e.message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleClose = async (bundle: PendingBundle) => {
    setConfirmBundle(null);
    setClosingId(bundle.id);
    try {
      const result = await closeBundleCutting(bundle.id);
      if (result.success) {
        toast.success(`Bundle ${bundle.barcode} ditutup di ${terpotong(bundle)} pcs`);
        await fetchData();
      } else {
        toast.error(result.error ?? 'Gagal menutup bundle');
      }
    } catch (e: any) {
      toast.error(e.message ?? 'Terjadi kesalahan');
    } finally {
      setClosingId(null);
    }
  };

  // ─── Loading ─────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-[#9aa0a6] text-sm">
        <Loader2 className="w-5 h-5 animate-spin text-[#e5c17b]" />
        Memuat data pending cutting...
      </div>
    );
  }

  // ─── Empty ────────────────────────────────────────────────────────────────
  if (bundles.length === 0) {
    return (
      <div className="rounded-xl border border-[#2A2D31] bg-[#1A1D1F] px-4 py-16 text-center">
        <div className="text-[#9aa0a6] text-sm">Tidak ada sisa potongan yang menggantung</div>
        <p className="text-[10px] text-[#9aa0a6]/50 mt-1">
          Sisa muncul di sini ketika qty terpotong kurang dari qty rencana
        </p>
      </div>
    );
  }

  return (
    <>
      {/* Info bar */}
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs text-[#9aa0a6]">
          <span className="text-orange-400 font-bold">{bundles.length}</span> bundle punya sisa yang belum dipotong.
          Qty yang sudah terpotong tetap jalan ke Antrian Jahit.
        </p>
        <button
          onClick={fetchData}
          className="text-[10px] text-[#9aa0a6] hover:text-[#e5c17b] transition-colors underline underline-offset-2"
        >
          Refresh
        </button>
      </div>

      {/* Tabel */}
      <div className="rounded-xl border border-[#2A2D31] bg-[#1A1D1F] overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-[#16181A] border-b border-[#2A2D31]">
              <th className="px-4 py-3 text-left text-[10px] uppercase tracking-widest text-[#9aa0a6] font-bold">No PO</th>
              <th className="px-4 py-3 text-left text-[10px] uppercase tracking-widest text-[#9aa0a6] font-bold">Barcode</th>
              <th className="px-4 py-3 text-left text-[10px] uppercase tracking-widest text-[#9aa0a6] font-bold">Klien</th>
              <th className="px-4 py-3 text-left text-[10px] uppercase tracking-widest text-[#9aa0a6] font-bold">Warna</th>
              <th className="px-4 py-3 text-left text-[10px] uppercase tracking-widest text-[#9aa0a6] font-bold">Size</th>
              <th className="px-4 py-3 text-center text-[10px] uppercase tracking-widest text-[#9aa0a6] font-bold">Rencana</th>
              <th className="px-4 py-3 text-center text-[10px] uppercase tracking-widest text-[#9aa0a6] font-bold">Terpotong</th>
              <th className="px-4 py-3 text-center text-[10px] uppercase tracking-widest text-[#9aa0a6] font-bold">Sisa</th>
              <th className="px-4 py-3 text-center text-[10px] uppercase tracking-widest text-[#9aa0a6] font-bold">Aksi</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#2A2D31]">
            {bundles.map(b => {
              const sudah    = terpotong(b);
              const sisa     = sisaOf(b);
              const pct      = b.qty_order > 0 ? Math.round((sudah / b.qty_order) * 100) : 0;
              const isClosing = closingId === b.id;

              return (
                <tr key={b.id} className="bg-[#1A1D1F] hover:bg-[#1E2124] transition-colors">
                  <td className="px-4 py-3 font-mono font-bold text-[#e5c17b] whitespace-nowrap">{b.no_po}</td>
                  <td className="px-4 py-3 font-mono text-xs text-[#e8eaed] whitespace-nowrap">{b.barcode}</td>
                  <td className="px-4 py-3 text-[#9aa0a6] text-xs">{b.klien_nama}</td>
                  <td className="px-4 py-3 text-[#9aa0a6]">{b.warna}</td>
                  <td className="px-4 py-3 text-[#9aa0a6]">{b.size}</td>
                  <td className="px-4 py-3 text-center text-[#e8eaed] font-semibold">{b.qty_order}</td>
                  <td className="px-4 py-3 text-center whitespace-nowrap">
                    <span className="text-orange-400 font-bold">{sudah}</span>
                    <span className="text-[#9aa0a6] text-xs ml-1">({pct}%)</span>
                    {b.qty_susulan > 0 && (
                      <div className="text-[10px] text-[#9aa0a6] mt-0.5">
                        {b.qty_aktual} + {b.qty_susulan} susulan
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-500/10 border border-red-500/20 text-red-400 text-[10px] font-bold whitespace-nowrap">
                      {sisa} pcs
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {isClosing ? (
                      <Loader2 className="w-4 h-4 animate-spin text-[#e5c17b] mx-auto" />
                    ) : (
                      <div className="flex items-center justify-center gap-2">
                        <button
                          onClick={() => setLanjutBundle(b)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[#e5c17b]/10 text-[#e5c17b] border border-[#e5c17b]/20 text-xs font-semibold hover:bg-[#e5c17b]/20 transition-colors whitespace-nowrap"
                        >
                          <Scissors className="w-3.5 h-3.5" />
                          Lanjut Cutting
                        </button>
                        <button
                          onClick={() => setConfirmBundle(b)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-orange-500/10 text-orange-400 border border-orange-500/20 text-xs font-semibold hover:bg-orange-500/20 transition-colors whitespace-nowrap"
                        >
                          <XCircle className="w-3.5 h-3.5" />
                          Close
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Dialog Konfirmasi Close */}
      {confirmBundle && (
        <div className="fixed inset-0 bg-black/75 flex items-center justify-center z-50 p-4">
          <div className="bg-[#1A1D1F] border border-[#2A2D31] rounded-xl w-full max-w-md shadow-2xl">
            <div className="px-6 py-5">
              <div className="flex items-start gap-3 mb-4">
                <div className="w-9 h-9 rounded-lg bg-orange-500/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <XCircle className="w-5 h-5 text-orange-400" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-[#e8eaed]">Tutup Sisa Potongan</h3>
                  <p className="text-xs text-[#9aa0a6] mt-1">Sisa dianggap batal dipotong</p>
                </div>
              </div>

              <div className="bg-[#16181A] border border-[#2A2D31] rounded-lg px-4 py-3 text-sm text-[#e8eaed] leading-relaxed">
                Bundle <span className="font-mono text-[#e5c17b] font-bold">{confirmBundle.barcode}</span> ditutup
                di <span className="text-orange-400 font-bold">{terpotong(confirmBundle)} pcs</span>.
                Sisa <span className="text-red-400 font-bold">{sisaOf(confirmBundle)} pcs</span> dianggap
                batal dan tidak akan dipotong lagi. Lanjutkan?
              </div>

              <div className="flex items-center justify-end gap-3 mt-5">
                <button
                  onClick={() => setConfirmBundle(null)}
                  className="px-4 h-9 rounded-lg border border-[#2A2D31] text-[#e8eaed] text-sm hover:bg-[#2A2D31] transition-colors"
                >
                  Batal
                </button>
                <button
                  onClick={() => handleClose(confirmBundle)}
                  className="flex items-center gap-2 px-4 h-9 rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-sm font-bold transition-colors"
                >
                  <XCircle className="w-4 h-4" />
                  Ya, Tutup
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal Lanjut Cutting */}
      {lanjutBundle && (
        <ModalLanjutCutting
          bundle={lanjutBundle}
          onClose={() => setLanjutBundle(null)}
          onSuccess={async () => { setLanjutBundle(null); await fetchData(); }}
        />
      )}
    </>
  );
}

// ─── Modal Lanjut Cutting ─────────────────────────────────────────────────────

function ModalLanjutCutting({
  bundle, onClose, onSuccess,
}: {
  bundle: PendingBundle;
  onClose: () => void;
  onSuccess: () => void | Promise<void>;
}) {
  const sisa = sisaOf(bundle);

  const [qty, setQty] = useState<number>(sisa);
  const [bahanRows, setBahanRows] = useState<BahanRow[]>([]);
  const [inventoryItems, setInventoryItems] = useState<InventoryItemOption[]>([]);
  const [karyawanList, setKaryawanList] = useState<KaryawanOption[]>([]);
  const [karyawanId, setKaryawanId] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [stokWarnings, setStokWarnings] = useState<StokWarning[]>([]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([getInventoryItemsForCutting(), getKaryawanCutting()])
      .then(([inv, kar]) => {
        if (cancelled) return;
        setInventoryItems(inv);
        setKaryawanList(kar);
        const operator = kar.filter(k => /cutting|potong/i.test(k.jabatan));
        if (operator.length === 1) setKaryawanId(operator[0].id);
      })
      .catch(e => { if (!cancelled) toast.error('Gagal memuat data: ' + e.message); });
    return () => { cancelled = true; };
  }, []);

  const addBahan = () =>
    setBahanRows(prev => [
      ...prev,
      { rowId: `${Date.now()}-${prev.length}`, inventory_item_id: '', rate_per_pcs: 0 },
    ]);

  const updateBahan = (rowId: string, patch: Partial<BahanRow>) =>
    setBahanRows(prev => prev.map(r => (r.rowId === rowId ? { ...r, ...patch } : r)));

  const removeBahan = (rowId: string) =>
    setBahanRows(prev => prev.filter(r => r.rowId !== rowId));

  const deductions = useMemo(
    () =>
      bahanRows
        .filter(r => r.inventory_item_id && r.rate_per_pcs > 0)
        .map(r => {
          const item = inventoryItems.find(i => i.id === r.inventory_item_id);
          return {
            rowId: r.rowId,
            nama:  item?.nama ?? '-',
            satuan: item?.satuan ?? '',
            total: r.rate_per_pcs * qty,
          };
        }),
    [bahanRows, inventoryItems, qty],
  );

  const qtyValid = qty >= 1 && qty <= sisa;

  const handleSubmit = async () => {
    if (!qtyValid) {
      toast.error(`Qty harus antara 1 dan ${sisa} pcs`);
      return;
    }
    setIsSubmitting(true);
    setStokWarnings([]);
    try {
      const result = await lanjutCuttingPartial(
        bundle.id,
        qty,
        bahanRows
          .filter(r => r.inventory_item_id && r.rate_per_pcs > 0)
          .map(r => ({ inventory_item_id: r.inventory_item_id, rate_per_pcs: r.rate_per_pcs })),
        karyawanId || null,
      );

      if (!result.success) {
        toast.error(result.error ?? 'Gagal mencatat potongan susulan');
        return;
      }

      if (result.stok_warnings.length > 0) {
        setStokWarnings(result.stok_warnings);
        toast.warning('Tercatat, tapi ada stok bahan yang minus — cek peringatan di bawah');
        return;
      }

      toast.success(
        `${result.qty_tambahan} pcs tercatat sebagai bundle baru ${result.new_bundle_barcode} — sudah masuk Antrian Jahit`,
      );
      await onSuccess();
    } catch (e: any) {
      toast.error(e.message ?? 'Terjadi kesalahan');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/75 flex items-center justify-center z-50 p-4">
      <div className="bg-[#1A1D1F] border border-[#2A2D31] rounded-xl w-full max-w-lg shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-5">
          <div className="flex items-start gap-3 mb-4">
            <div className="w-9 h-9 rounded-lg bg-[#e5c17b]/10 flex items-center justify-center flex-shrink-0 mt-0.5">
              <Scissors className="w-5 h-5 text-[#e5c17b]" />
            </div>
            <div>
              <h3 className="text-base font-bold text-[#e8eaed]">Lanjut Cutting</h3>
              <p className="text-xs text-[#9aa0a6] mt-1">
                Catat potongan susulan — hasilnya jadi bundle baru di Antrian Jahit
              </p>
            </div>
          </div>

          {/* Ringkasan bundle */}
          <div className="bg-[#16181A] border border-[#2A2D31] rounded-lg px-4 py-3 mb-4">
            <div className="font-mono text-xs text-[#e5c17b] font-bold mb-2">{bundle.barcode}</div>
            <div className="grid grid-cols-3 gap-3 text-center">
              <div>
                <div className="text-[10px] uppercase tracking-wider text-[#9aa0a6]">Rencana</div>
                <div className="text-[#e8eaed] font-bold">{bundle.qty_order}</div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-[#9aa0a6]">Terpotong</div>
                <div className="text-orange-400 font-bold">{terpotong(bundle)}</div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-[#9aa0a6]">Sisa</div>
                <div className="text-red-400 font-bold">{sisa}</div>
              </div>
            </div>
            <p className="text-[10px] text-[#9aa0a6]/70 mt-3 leading-relaxed">
              {terpotong(bundle)} pcs yang sudah terpotong tidak diubah — itu yang sedang dikerjakan penjahit.
            </p>
          </div>

          {/* Tukang potong */}
          <div className="mb-4">
            <label className="block text-[10px] uppercase tracking-widest text-[#9aa0a6] font-bold mb-2">
              Tukang Potong
            </label>
            <select
              value={karyawanId}
              onChange={e => setKaryawanId(e.target.value)}
              className="w-full bg-[#16181A] border border-[#2A2D31] rounded-lg px-3 py-2 text-sm text-[#e8eaed] outline-none focus:border-[#e5c17b]"
            >
              <option value="">— Pilih tukang potong —</option>
              {karyawanList.map(k => (
                <option key={k.id} value={k.id}>
                  {k.nama}{k.jabatan !== '-' ? ` · ${k.jabatan}` : ''}
                </option>
              ))}
            </select>
            {!karyawanId && (
              <p className="text-[10px] text-orange-400 mt-1.5">
                Kalau dikosongkan, upah cutting untuk potongan susulan ini tidak akan terbentuk.
              </p>
            )}
          </div>

          {/* Qty susulan */}
          <div className="mb-4">
            <label className="block text-[10px] uppercase tracking-widest text-[#9aa0a6] font-bold mb-2">
              Qty yang baru selesai dipotong
            </label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={1}
                max={sisa}
                value={qty === 0 ? '' : qty}
                onChange={e => setQty(Math.max(0, Number(e.target.value) || 0))}
                className="w-28 bg-[#16181A] border border-[#2A2D31] rounded-lg px-3 py-2 text-sm text-[#e8eaed] text-center font-bold outline-none focus:border-[#e5c17b]"
              />
              <span className="text-xs text-[#9aa0a6]">/ maks {sisa} pcs</span>
            </div>
            {!qtyValid && (
              <p className="text-[10px] text-red-400 mt-1.5">Qty harus antara 1 dan {sisa} pcs</p>
            )}
          </div>

          {/* Pemakaian bahan (opsional) */}
          <div className="mb-4">
            <div className="flex items-center justify-between mb-2">
              <label className="text-[10px] uppercase tracking-widest text-[#9aa0a6] font-bold">
                Pemakaian bahan <span className="normal-case tracking-normal font-normal">(opsional)</span>
              </label>
              <button
                onClick={addBahan}
                className="inline-flex items-center gap-1 text-[10px] text-[#e5c17b] hover:text-[#f0d194] transition-colors"
              >
                <Plus className="w-3 h-3" /> Tambah bahan
              </button>
            </div>

            {bahanRows.length === 0 ? (
              <p className="text-[10px] text-[#9aa0a6]/60 bg-[#16181A] border border-[#2A2D31] rounded-lg px-3 py-2.5">
                Kosongkan kalau tidak perlu memotong stok bahan untuk potongan susulan ini.
              </p>
            ) : (
              <div className="space-y-2">
                {bahanRows.map(row => (
                  <div key={row.rowId} className="flex items-center gap-2">
                    <select
                      value={row.inventory_item_id}
                      onChange={e => updateBahan(row.rowId, { inventory_item_id: e.target.value })}
                      className="flex-1 bg-[#16181A] border border-[#2A2D31] rounded-lg px-2 py-2 text-xs text-[#e8eaed] outline-none focus:border-[#e5c17b]"
                    >
                      <option value="">— Pilih bahan —</option>
                      {inventoryItems.map(i => (
                        <option key={i.id} value={i.id}>
                          {i.nama} (stok {i.stok_aktual} {i.satuan})
                        </option>
                      ))}
                    </select>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      placeholder="per pcs"
                      value={row.rate_per_pcs === 0 ? '' : row.rate_per_pcs}
                      onChange={e => updateBahan(row.rowId, { rate_per_pcs: Number(e.target.value) || 0 })}
                      className="w-24 bg-[#16181A] border border-[#2A2D31] rounded-lg px-2 py-2 text-xs text-[#e8eaed] text-center outline-none focus:border-[#e5c17b]"
                    />
                    <button
                      onClick={() => removeBahan(row.rowId)}
                      className="p-2 text-[#9aa0a6] hover:text-red-400 transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {deductions.length > 0 && (
              <div className="mt-2 bg-[#16181A] border border-[#2A2D31] rounded-lg px-3 py-2.5 space-y-1">
                <div className="text-[10px] uppercase tracking-widest text-[#9aa0a6] font-bold mb-1">
                  Stok yang akan terpotong
                </div>
                {deductions.map(d => (
                  <div key={d.rowId} className="flex items-center justify-between text-xs">
                    <span className="text-[#9aa0a6]">{d.nama}</span>
                    <span className="text-[#e8eaed] font-semibold">
                      {d.total.toLocaleString('id-ID')} {d.satuan}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Peringatan stok */}
          {stokWarnings.length > 0 && (
            <div className="mb-4 bg-red-500/5 border border-red-500/20 rounded-lg px-3 py-2.5 space-y-1">
              <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-red-400 font-bold">
                <AlertTriangle className="w-3.5 h-3.5" /> Stok minus
              </div>
              {stokWarnings.map((w, i) => (
                <p key={i} className="text-xs text-[#e8eaed]">
                  <span className="font-semibold">{w.item_nama}</span> — kekurangan{' '}
                  <span className="font-bold text-red-400">{w.qty_kurang}</span>, sisa stok: {w.sisa_stok}
                </p>
              ))}
              <button
                onClick={onSuccess}
                className="mt-2 text-[10px] text-[#e5c17b] underline underline-offset-2"
              >
                Mengerti, tutup
              </button>
            </div>
          )}

          <div className="flex items-center justify-end gap-3">
            <button
              onClick={onClose}
              disabled={isSubmitting}
              className="px-4 h-9 rounded-lg border border-[#2A2D31] text-[#e8eaed] text-sm hover:bg-[#2A2D31] transition-colors disabled:opacity-50"
            >
              Batal
            </button>
            <button
              onClick={handleSubmit}
              disabled={isSubmitting || !qtyValid}
              className="flex items-center gap-2 px-4 h-9 rounded-lg bg-[#e5c17b] hover:bg-[#f0d194] text-[#16181A] text-sm font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Scissors className="w-4 h-4" />}
              Catat {qtyValid ? qty : ''} pcs
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
