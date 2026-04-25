'use client';

import React, { useState, useEffect, useMemo } from 'react';
import {
  X, CheckCircle2, AlertTriangle, Loader2, Plus, Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  getBundlesByIds,
  getInventoryItemsForCutting,
  selesaiCuttingBatch,
  type BundleForModal,
  type InventoryItemOption,
  type StokWarning,
  type BundleQtyInput,
  type PemakaianInput,
} from '@/lib/actions/produksi/cutting.actions';

// ─── Types ────────────────────────────────────────────────────────────────────

interface BahanRow {
  rowId: string;
  inventory_item_id: string;
  rate_per_pcs: number;
}

interface Props {
  selectedBundleIds: string[];
  onSuccess: () => void;
  onClose: () => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const artikelKey = (b: BundleForModal) => `${b.warna}||${b.size}`;

// ─── Component ────────────────────────────────────────────────────────────────

export default function ModalSelesaiCutting({ selectedBundleIds, onSuccess, onClose }: Props) {

  // ─ Data
  const [bundles, setBundles] = useState<BundleForModal[]>([]);
  const [inventoryItems, setInventoryItems] = useState<InventoryItemOption[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [stokWarnings, setStokWarnings] = useState<StokWarning[]>([]);

  // ─ Section A: qty aktual per bundle
  const [bundleQty, setBundleQty] = useState<Record<string, number>>({});

  // ─ Section B: bahan per artikel key
  const [bahanPerArtikel, setBahanPerArtikel] = useState<Record<string, BahanRow[]>>({});

  // ─── Fetch on mount ───────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    Promise.all([
      getBundlesByIds(selectedBundleIds),
      getInventoryItemsForCutting(),
    ]).then(([b, inv]) => {
      if (cancelled) return;
      setBundles(b);
      setInventoryItems(inv);
      // Init bundleQty defaults
      const qtyInit: Record<string, number> = {};
      b.forEach(bd => { qtyInit[bd.id] = bd.qty_per_bundle; });
      setBundleQty(qtyInit);
      // Init bahanPerArtikel
      const bahanInit: Record<string, BahanRow[]> = {};
      const seen = new Set<string>();
      b.forEach(bd => {
        const k = artikelKey(bd);
        if (!seen.has(k)) { seen.add(k); bahanInit[k] = []; }
      });
      setBahanPerArtikel(bahanInit);
    }).catch(e => {
      if (!cancelled) toast.error('Gagal memuat data: ' + e.message);
    }).finally(() => { if (!cancelled) setIsLoading(false); });
    return () => { cancelled = true; };
  }, [selectedBundleIds]);

  // ─── Derived data ─────────────────────────────────────────────────────────

  // Group bundles by artikel
  const artikelGroups = useMemo(() => {
    const groups: { key: string; warna: string; size: string; bundles: BundleForModal[] }[] = [];
    const seen = new Set<string>();
    bundles.forEach(b => {
      const k = artikelKey(b);
      if (!seen.has(k)) {
        seen.add(k);
        groups.push({ key: k, warna: b.warna, size: b.size, bundles: [] });
      }
      groups.find(g => g.key === k)!.bundles.push(b);
    });
    return groups;
  }, [bundles]);

  const totalQtyAktualForArtikel = (key: string, articleBundles: BundleForModal[]) =>
    articleBundles.reduce((s, b) => s + (bundleQty[b.id] ?? b.qty_per_bundle), 0);

  const totalSelesai = bundles.filter(b => (bundleQty[b.id] ?? b.qty_per_bundle) >= b.qty_per_bundle).length;
  const totalPartial  = bundles.length - totalSelesai;

  // Summary: compute all deductions
  const summaryDeductions = useMemo(() => {
    const map: Record<string, { nama: string; satuan: string; total: number }> = {};
    for (const [key, rows] of Object.entries(bahanPerArtikel)) {
      const group = artikelGroups.find(g => g.key === key);
      if (!group) continue;
      const qtyArtikel = totalQtyAktualForArtikel(key, group.bundles);
      for (const row of rows) {
        if (!row.inventory_item_id || row.rate_per_pcs <= 0) continue;
        const item = inventoryItems.find(i => i.id === row.inventory_item_id);
        if (!item) continue;
        const deduct = row.rate_per_pcs * qtyArtikel;
        if (map[row.inventory_item_id]) {
          map[row.inventory_item_id].total += deduct;
        } else {
          map[row.inventory_item_id] = { nama: item.nama, satuan: item.satuan, total: deduct };
        }
      }
    }
    return Object.values(map);
  }, [bahanPerArtikel, bundleQty, artikelGroups, inventoryItems]);

  // ─── Section A handlers ───────────────────────────────────────────────────

  const setQty = (bundle_id: string, val: number) =>
    setBundleQty(prev => ({ ...prev, [bundle_id]: Math.max(0, val) }));

  // ─── Section B handlers ───────────────────────────────────────────────────

  const addBahan = (key: string) => {
    setBahanPerArtikel(prev => ({
      ...prev,
      [key]: [...(prev[key] ?? []), { rowId: crypto.randomUUID(), inventory_item_id: '', rate_per_pcs: 0 }],
    }));
  };

  const updateBahan = (key: string, rowId: string, field: 'inventory_item_id' | 'rate_per_pcs', val: string | number) => {
    setBahanPerArtikel(prev => ({
      ...prev,
      [key]: (prev[key] ?? []).map(r => r.rowId === rowId ? { ...r, [field]: val } : r),
    }));
  };

  const removeBahan = (key: string, rowId: string) => {
    setBahanPerArtikel(prev => ({
      ...prev,
      [key]: (prev[key] ?? []).filter(r => r.rowId !== rowId),
    }));
  };

  // ─── Validation ───────────────────────────────────────────────────────────

  const validate = (): string | null => {
    for (const group of artikelGroups) {
      const rows = bahanPerArtikel[group.key] ?? [];
      const valid = rows.filter(r => r.inventory_item_id && r.rate_per_pcs > 0);
      if (valid.length === 0) {
        return `Artikel ${group.warna} - ${group.size} belum memiliki bahan. Minimal 1 bahan wajib diisi.`;
      }
    }
    return null;
  };

  // ─── Submit ───────────────────────────────────────────────────────────────

  const handleSubmit = async () => {
    const err = validate();
    if (err) { toast.error(err); return; }

    setIsSubmitting(true);
    setStokWarnings([]);

    // Build bundle_qty
    const bundleQtyPayload: BundleQtyInput[] = bundles.map(b => ({
      bundle_id:  b.id,
      qty_aktual: bundleQty[b.id] ?? b.qty_per_bundle,
    }));

    // Build pemakaian: flatten all artikel rows
    const pemakaianPayload: PemakaianInput[] = [];
    for (const group of artikelGroups) {
      const qtyArtikel = totalQtyAktualForArtikel(group.key, group.bundles);
      const rows = (bahanPerArtikel[group.key] ?? []).filter(r => r.inventory_item_id && r.rate_per_pcs > 0);
      for (const row of rows) {
        pemakaianPayload.push({
          inventory_item_id:  row.inventory_item_id,
          rate_per_pcs:       row.rate_per_pcs,
          total_qty_artikel:  qtyArtikel,
        });
      }
    }

    const result = await selesaiCuttingBatch(bundleQtyPayload, pemakaianPayload);
    setIsSubmitting(false);

    if (result.stok_warnings?.length) {
      setStokWarnings(result.stok_warnings);
      toast.warning(`${result.stok_warnings.length} item stok tidak mencukupi — produksi tetap dicatat`);
    }

    if (result.success) {
      const msg = result.partial_count > 0
        ? `Selesai! ${result.total_qty} pcs selesai, ${result.partial_count} bundle partial.`
        : `Selesai! Total ${result.total_qty} pcs.`;
      toast.success(msg);
      onSuccess();
    } else {
      toast.error(result.error ?? 'Gagal menyelesaikan cutting');
    }
  };

  // ─── Render ───────────────────────────────────────────────────────────────

  const inputCls = 'h-8 rounded-md border border-[#2A2D31] bg-[#0D0E10] px-2 text-sm text-[#e8eaed] focus:outline-none focus:ring-1 focus:ring-[#e5c17b]';
  const selectCls = `${inputCls} flex-1`;

  return (
    <div className="fixed inset-0 bg-black/75 flex items-center justify-center z-50 p-4">
      <div className="bg-[#1A1D1F] border border-[#2A2D31] rounded-xl w-full max-w-3xl max-h-[90vh] flex flex-col shadow-2xl">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#2A2D31] flex-shrink-0">
          <div>
            <h2 className="text-base font-bold text-[#e8eaed]">Selesai Cutting</h2>
            <p className="text-xs text-[#9aa0a6] mt-0.5">{selectedBundleIds.length} bundle dipilih</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg text-[#9aa0a6] hover:text-[#e8eaed] hover:bg-[#2A2D31] transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-20 gap-3 text-[#9aa0a6]">
              <Loader2 className="w-8 h-8 animate-spin text-[#e5c17b]" />
              <span className="text-sm">Memuat data bundle...</span>
            </div>
          ) : (
            <>
              {/* ═══ BAGIAN A: Qty Aktual per Bundle ════════════════════════ */}
              <section>
                <h3 className="text-[10px] uppercase tracking-widest text-[#9aa0a6] font-bold mb-3">
                  A — Qty Aktual per Bundle
                </h3>
                <div className="rounded-lg border border-[#2A2D31] overflow-hidden">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-[#16181A] border-b border-[#2A2D31]">
                        <th className="text-left px-3 py-2 text-[#9aa0a6] font-bold uppercase tracking-wider">Barcode</th>
                        <th className="text-left px-3 py-2 text-[#9aa0a6] font-bold uppercase tracking-wider">Warna</th>
                        <th className="text-left px-3 py-2 text-[#9aa0a6] font-bold uppercase tracking-wider">Size</th>
                        <th className="text-center px-3 py-2 text-[#9aa0a6] font-bold uppercase tracking-wider">Qty Order</th>
                        <th className="text-center px-3 py-2 text-[#9aa0a6] font-bold uppercase tracking-wider">Qty Aktual</th>
                        <th className="text-left px-3 py-2 text-[#9aa0a6] font-bold uppercase tracking-wider">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#2A2D31]">
                      {bundles.map(b => {
                        const qty = bundleQty[b.id] ?? b.qty_per_bundle;
                        const isPartial = qty < b.qty_per_bundle;
                        return (
                          <tr key={b.id} className="hover:bg-[#1E2124] transition-colors">
                            <td className="px-3 py-2 font-mono text-[#e5c17b]">{b.barcode}</td>
                            <td className="px-3 py-2 text-[#9aa0a6]">{b.warna}</td>
                            <td className="px-3 py-2 text-[#9aa0a6]">{b.size}</td>
                            <td className="px-3 py-2 text-center text-[#e8eaed] font-semibold">{b.qty_per_bundle}</td>
                            <td className="px-3 py-2 text-center">
                              <input
                                type="number"
                                min={0}
                                max={b.qty_per_bundle}
                                value={qty === 0 ? '' : qty}
                                onChange={e => setQty(b.id, parseFloat(e.target.value) || 0)}
                                className={`${inputCls} w-20 text-center`}
                              />
                            </td>
                            <td className="px-3 py-2">
                              {isPartial
                                ? <span className="flex items-center gap-1 text-orange-400 font-bold">⚠️ Partial</span>
                                : <span className="flex items-center gap-1 text-green-400 font-bold">✅ Selesai</span>}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>

              {/* ═══ BAGIAN B: Pemakaian Bahan per Artikel ══════════════════ */}
              <section>
                <h3 className="text-[10px] uppercase tracking-widest text-[#9aa0a6] font-bold mb-3">
                  B — Pemakaian Bahan per Artikel
                </h3>
                <div className="space-y-4">
                  {artikelGroups.map(group => {
                    const qtyArtikel = totalQtyAktualForArtikel(group.key, group.bundles);
                    const rows = bahanPerArtikel[group.key] ?? [];
                    return (
                      <div key={group.key} className="rounded-lg border border-[#2A2D31] overflow-hidden">
                        {/* Artikel header */}
                        <div className="flex items-center justify-between px-4 py-2.5 bg-[#16181A] border-b border-[#2A2D31]">
                          <div>
                            <span className="text-sm font-bold text-[#e8eaed]">
                              {group.warna} — {group.size}
                            </span>
                            <span className="ml-2 text-[10px] text-[#9aa0a6]">
                              {group.bundles.length} bundle · total qty aktual:{' '}
                              <span className="text-[#e5c17b] font-bold">{qtyArtikel}</span> pcs
                            </span>
                          </div>
                        </div>

                        {/* Bahan rows */}
                        <div className="px-4 py-3 space-y-2">
                          {rows.length === 0 && (
                            <p className="text-xs text-[#9aa0a6] italic">
                              Belum ada bahan — klik "+ Tambah Bahan"
                            </p>
                          )}

                          {rows.length > 0 && (
                            <div className="grid grid-cols-[1fr_120px_100px_32px] gap-2 items-center mb-1">
                              <span className="text-[10px] text-[#9aa0a6] uppercase font-bold">Bahan</span>
                              <span className="text-[10px] text-[#9aa0a6] uppercase font-bold text-center">Rate / pcs</span>
                              <span className="text-[10px] text-[#9aa0a6] uppercase font-bold text-center">Total</span>
                              <span />
                            </div>
                          )}

                          {rows.map(row => {
                            const item = inventoryItems.find(i => i.id === row.inventory_item_id);
                            const total = row.rate_per_pcs * qtyArtikel;
                            return (
                              <div key={row.rowId} className="grid grid-cols-[1fr_120px_100px_32px] gap-2 items-center">
                                <select
                                  className={selectCls}
                                  value={row.inventory_item_id}
                                  onChange={e => updateBahan(group.key, row.rowId, 'inventory_item_id', e.target.value)}
                                >
                                  <option value="">— Pilih bahan —</option>
                                  {inventoryItems.map(i => (
                                    <option key={i.id} value={i.id}>
                                      {i.nama} (stok: {i.stok_aktual} {i.satuan})
                                    </option>
                                  ))}
                                </select>

                                <div className="flex items-center gap-1">
                                  <input
                                    type="number"
                                    min={0}
                                    step={0.01}
                                    placeholder="0"
                                    value={row.rate_per_pcs === 0 ? '' : row.rate_per_pcs}
                                    onChange={e => updateBahan(group.key, row.rowId, 'rate_per_pcs', parseFloat(e.target.value) || 0)}
                                    className={`${inputCls} w-full text-center`}
                                  />
                                  <span className="text-[10px] text-[#9aa0a6] whitespace-nowrap">
                                    {item?.satuan ?? ''}
                                  </span>
                                </div>

                                <div className="text-center text-xs font-bold text-[#e5c17b]">
                                  {row.rate_per_pcs > 0 ? total.toFixed(2) : '—'}
                                  {item ? <span className="text-[#9aa0a6] font-normal ml-1">{item.satuan}</span> : null}
                                </div>

                                <button
                                  onClick={() => removeBahan(group.key, row.rowId)}
                                  className="w-8 h-8 flex items-center justify-center text-[#9aa0a6] hover:text-red-400 hover:bg-red-400/10 rounded transition-colors"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            );
                          })}

                          <button
                            onClick={() => addBahan(group.key)}
                            className="flex items-center gap-1.5 mt-1 text-xs text-[#9aa0a6] hover:text-[#e5c17b] border border-dashed border-[#2A2D31] hover:border-[#e5c17b] px-3 py-1 rounded-md transition-colors"
                          >
                            <Plus className="w-3.5 h-3.5" />
                            Tambah Bahan
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>

              {/* ═══ BAGIAN C: Summary ═══════════════════════════════════════ */}
              <section className="rounded-lg border border-[#2A2D31] bg-[#16181A] px-5 py-4 space-y-3">
                <h3 className="text-[10px] uppercase tracking-widest text-[#9aa0a6] font-bold">
                  C — Ringkasan
                </h3>
                <div className="flex gap-6 text-sm">
                  <div>
                    <div className="text-[10px] text-[#9aa0a6] uppercase">Bundle Selesai</div>
                    <div className="text-green-400 font-bold text-lg">{totalSelesai}</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-[#9aa0a6] uppercase">Bundle Partial</div>
                    <div className="text-orange-400 font-bold text-lg">{totalPartial}</div>
                  </div>
                </div>

                {summaryDeductions.length > 0 && (
                  <div>
                    <div className="text-[10px] text-[#9aa0a6] uppercase mb-2">Bahan yang Akan Dikurangi</div>
                    <div className="space-y-1">
                      {summaryDeductions.map((d, i) => (
                        <div key={i} className="flex justify-between text-xs">
                          <span className="text-[#e8eaed]">{d.nama}</span>
                          <span className="text-[#e5c17b] font-bold">
                            {d.total.toFixed(2)} <span className="text-[#9aa0a6] font-normal">{d.satuan}</span>
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {stokWarnings.length > 0 && (
                  <div className="rounded-lg border border-[#e5c17b]/30 bg-[#e5c17b]/5 p-3 space-y-1">
                    <div className="flex items-center gap-2 text-[#e5c17b] font-semibold text-xs">
                      <AlertTriangle className="w-3.5 h-3.5" />
                      Peringatan Stok
                    </div>
                    {stokWarnings.map((w, i) => (
                      <p key={i} className="text-[10px] text-[#e5c17b]/80">
                        <span className="font-medium">{w.item_nama}</span>
                        {' '}— kekurangan <span className="font-bold">{w.qty_kurang}</span>, sisa stok: {w.sisa_stok}
                      </p>
                    ))}
                    <p className="text-[10px] text-[#9aa0a6]">Produksi tetap dicatat. Segera lakukan pengadaan.</p>
                  </div>
                )}
              </section>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-[#2A2D31] flex-shrink-0">
          <button
            onClick={onClose}
            disabled={isSubmitting}
            className="px-5 h-9 rounded-lg border border-[#2A2D31] text-[#e8eaed] text-sm hover:bg-[#2A2D31] transition-colors disabled:opacity-40"
          >
            Batal
          </button>
          <button
            onClick={handleSubmit}
            disabled={isLoading || isSubmitting}
            className="flex items-center gap-2 px-5 h-9 rounded-lg bg-[#e5c17b] text-[#0D0E10] text-sm font-bold hover:bg-[#d4b06a] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
            {isSubmitting ? 'Menyimpan...' : 'Selesai Cutting'}
          </button>
        </div>
      </div>
    </div>
  );
}
