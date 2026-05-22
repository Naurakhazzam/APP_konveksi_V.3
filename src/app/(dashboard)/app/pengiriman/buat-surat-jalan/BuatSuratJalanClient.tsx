'use client';

import React, { useState, useMemo, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { BundleReadyToShip, createSuratJalan } from '@/lib/actions/pengiriman/surat-jalan.actions';
import CartPanel from './CartPanel';
import { ChevronRight, ChevronDown } from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface BundleGroup {
  key: string;
  model_nama: string | null;
  warna: string;
  size: string;
  no_po: string;
  klien_id: string;
  klien_nama: string;
  bundles: BundleReadyToShip[];
  total_qty: number;
}

// ─── Indeterminate Checkbox ────────────────────────────────────────────────────

function IndeterminateCheckbox({
  checked,
  indeterminate,
  disabled,
  onChange,
}: {
  checked: boolean;
  indeterminate: boolean;
  disabled?: boolean;
  onChange: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (ref.current) {
      ref.current.indeterminate = indeterminate && !checked;
    }
  }, [indeterminate, checked]);

  return (
    <input
      ref={ref}
      type="checkbox"
      checked={checked}
      disabled={disabled}
      onChange={onChange}
      className="w-4 h-4 rounded border-[#2A2D31] bg-[#0D0E10] text-[#e5c17b] focus:ring-[#e5c17b] cursor-pointer disabled:cursor-not-allowed"
    />
  );
}

// ─── Main Component ────────────────────────────────────────────────────────────

export default function BuatSuratJalanClient({ initialBundles }: { initialBundles: BundleReadyToShip[] }) {
  const router = useRouter();
  const [bundles, setBundles] = useState<BundleReadyToShip[]>(initialBundles);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [tanggal, setTanggal] = useState<string>(new Date().toISOString().split('T')[0]);
  const [catatan, setCatatan] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // ─── Derived state ─────────────────────────────────────────────────────────

  const selectedBundles = useMemo(() =>
    bundles.filter(b => selectedIds.has(b.id)),
  [bundles, selectedIds]);

  const currentKlienId = selectedBundles.length > 0 ? selectedBundles[0].klien_id : null;

  // ─── Grouping logic ────────────────────────────────────────────────────────

  const groups = useMemo((): BundleGroup[] => {
    const map = new Map<string, BundleGroup>();

    bundles.forEach(b => {
      const key = `${b.model_nama}||${b.warna}||${b.size}||${b.no_po}||${b.klien_id}`;
      if (!map.has(key)) {
        map.set(key, {
          key,
          model_nama: b.model_nama,
          warna: b.warna,
          size: b.size,
          no_po: b.no_po,
          klien_id: b.klien_id,
          klien_nama: b.klien_nama,
          bundles: [],
          total_qty: 0,
        });
      }
      const g = map.get(key)!;
      g.bundles.push(b);
      g.total_qty += b.qty_per_bundle;
    });

    return Array.from(map.values());
  }, [bundles]);

  // ─── Handlers ─────────────────────────────────────────────────────────────

  const toggleExpand = (key: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleToggleSingle = (id: string, klienId: string) => {
    if (currentKlienId && klienId !== currentKlienId && !selectedIds.has(id)) {
      toast.error('Klien berbeda! Satu Surat Jalan hanya untuk satu klien yang sama.');
      return;
    }
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  const handleToggleGroup = (group: BundleGroup) => {
    const isGroupDisabled = currentKlienId !== null && group.klien_id !== currentKlienId;
    const allSelected = group.bundles.every(b => selectedIds.has(b.id));

    if (isGroupDisabled && !allSelected) {
      toast.error('Klien berbeda! Satu Surat Jalan hanya untuk satu klien yang sama.');
      return;
    }

    const next = new Set(selectedIds);
    if (allSelected) {
      // uncheck semua bundle dalam group
      group.bundles.forEach(b => next.delete(b.id));
    } else {
      // check semua bundle dalam group
      group.bundles.forEach(b => next.add(b.id));
    }
    setSelectedIds(next);
  };

  const handleUpdateQty = (id: string, qty: number) => {
    setBundles(prev => prev.map(b => {
      if (b.id === id) {
        return { ...b, qty_kirim: Math.min(Math.max(1, qty), b.qty_per_bundle) };
      }
      return b;
    }));
  };

  const handleFinalize = async () => {
    if (selectedBundles.length === 0 || !currentKlienId) return;

    try {
      setIsSubmitting(true);
      const items = selectedBundles.map(b => ({
        bundle_id: b.id,
        qty_kirim: b.qty_kirim,
      }));

      const nomorSj = await createSuratJalan({
        klien_id: currentKlienId,
        tanggal,
        catatan,
        bundles: items,
      });

      toast.success(`Surat Jalan ${nomorSj} berhasil dibuat!`);
      setSelectedIds(new Set());
      setCatatan('');
      setTanggal(new Date().toISOString().split('T')[0]);
      router.refresh();
    } catch (error: any) {
      toast.error(error.message || 'Gagal membuat surat jalan');
    } finally {
      setIsSubmitting(false);
    }
  };

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="grid lg:grid-cols-3 gap-6">
      <div className="lg:col-span-2 space-y-4">
        <div className="bg-[#1A1D1F] border border-[#2A2D31] rounded-lg overflow-hidden">
          <div className="p-4 border-b border-[#2A2D31] flex justify-between items-center bg-[#0D0E10]">
            <h2 className="font-semibold text-[#e8eaed]">
              Pilih Bundle{' '}
              <span className="text-[#9aa0a6] font-normal text-sm">
                ({groups.length} grup · {bundles.length} bundle)
              </span>
            </h2>
            {selectedIds.size > 0 && (
              <span className="text-xs text-[#e5c17b] font-medium">
                {selectedIds.size} bundle dipilih
              </span>
            )}
          </div>

          <div className="overflow-x-auto max-h-[600px]">
            <table className="w-full text-sm text-left">
              <thead className="text-xs text-[#9aa0a6] uppercase bg-[#0D0E10] sticky top-0 border-b border-[#2A2D31] z-10">
                <tr>
                  <th className="px-4 py-3 w-10">Pilih</th>
                  <th className="px-4 py-3 w-8"></th>
                  <th className="px-4 py-3">Item Info</th>
                  <th className="px-4 py-3">PO</th>
                  <th className="px-4 py-3">Klien</th>
                  <th className="px-4 py-3 text-right">Jml Bundle</th>
                  <th className="px-4 py-3 text-right">Total QTY</th>
                </tr>
              </thead>
              <tbody>
                {groups.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-[#9aa0a6]">
                      Tidak ada bundle siap kirim.
                    </td>
                  </tr>
                ) : (
                  groups.map(group => {
                    const isExpanded = expandedGroups.has(group.key);
                    const isGroupDisabled = currentKlienId !== null && group.klien_id !== currentKlienId;

                    const selectedCount = group.bundles.filter(b => selectedIds.has(b.id)).length;
                    const allSelected = selectedCount === group.bundles.length;
                    const someSelected = selectedCount > 0 && !allSelected;

                    return (
                      <React.Fragment key={group.key}>
                        {/* ── Group Row ── */}
                        <tr
                          className={`border-b border-[#2A2D31] transition-colors ${
                            allSelected
                              ? 'bg-[#e5c17b]/10'
                              : someSelected
                              ? 'bg-[#e5c17b]/5'
                              : isGroupDisabled
                              ? 'opacity-50 grayscale bg-[#0D0E10]'
                              : 'hover:bg-[#0D0E10]/50'
                          }`}
                        >
                          {/* Checkbox group */}
                          <td className="px-4 py-3">
                            <IndeterminateCheckbox
                              checked={allSelected}
                              indeterminate={someSelected}
                              disabled={isGroupDisabled && selectedCount === 0}
                              onChange={() => handleToggleGroup(group)}
                            />
                          </td>

                          {/* Expand toggle */}
                          <td className="px-2 py-3">
                            <button
                              onClick={() => toggleExpand(group.key)}
                              className="w-6 h-6 flex items-center justify-center rounded hover:bg-[#2A2D31] text-[#9aa0a6] hover:text-[#e8eaed] transition-colors"
                              title={isExpanded ? 'Tutup detail' : 'Lihat detail barcode'}
                            >
                              {isExpanded
                                ? <ChevronDown className="w-3.5 h-3.5" />
                                : <ChevronRight className="w-3.5 h-3.5" />
                              }
                            </button>
                          </td>

                          {/* Item Info */}
                          <td className="px-4 py-3">
                            <div className="font-medium text-[#e8eaed]">
                              {group.model_nama || '-'}
                            </div>
                            <div className="text-xs text-[#9aa0a6] mt-0.5">
                              {group.warna}
                              <span className="mx-1.5 text-[#2A2D31]">·</span>
                              {group.size}
                            </div>
                          </td>

                          {/* PO */}
                          <td className="px-4 py-3">
                            <span className="text-xs font-mono text-[#e5c17b] bg-[#e5c17b]/10 px-2 py-0.5 rounded">
                              {group.no_po}
                            </span>
                          </td>

                          {/* Klien */}
                          <td className="px-4 py-3 text-xs text-[#e8eaed]">
                            {group.klien_nama}
                            {isGroupDisabled && selectedCount === 0 && (
                              <span className="block text-[10px] text-red-400 mt-0.5">Klien berbeda</span>
                            )}
                          </td>

                          {/* Jumlah Bundle */}
                          <td className="px-4 py-3 text-right">
                            <span className="text-sm font-bold text-[#e8eaed]">
                              {selectedCount > 0
                                ? <><span className="text-[#e5c17b]">{selectedCount}</span>/{group.bundles.length}</>
                                : group.bundles.length
                              }
                            </span>
                            <span className="text-xs text-[#9aa0a6] ml-1">bdl</span>
                          </td>

                          {/* Total QTY */}
                          <td className="px-4 py-3 text-right font-medium text-[#e8eaed]">
                            {group.total_qty}
                            <span className="text-xs text-[#9aa0a6] ml-1">pcs</span>
                          </td>
                        </tr>

                        {/* ── Sub-rows (expanded) ── */}
                        {isExpanded && group.bundles.map((b, idx) => {
                          const isSelected = selectedIds.has(b.id);
                          const isDisabled = currentKlienId !== null && b.klien_id !== currentKlienId && !isSelected;

                          return (
                            <tr
                              key={b.id}
                              className={`border-b border-[#2A2D31]/60 transition-colors ${
                                isSelected
                                  ? 'bg-[#e5c17b]/10'
                                  : isDisabled
                                  ? 'opacity-40 bg-[#0D0E10]'
                                  : 'bg-[#16181A] hover:bg-[#1A1D1F]'
                              }`}
                            >
                              {/* indent spacer */}
                              <td className="pl-8 pr-2 py-2">
                                <input
                                  type="checkbox"
                                  checked={isSelected}
                                  disabled={isDisabled}
                                  onChange={() => handleToggleSingle(b.id, b.klien_id)}
                                  className="w-3.5 h-3.5 rounded border-[#2A2D31] bg-[#0D0E10] text-[#e5c17b] focus:ring-[#e5c17b] cursor-pointer disabled:cursor-not-allowed"
                                />
                              </td>

                              {/* expand column — kosong di sub-row */}
                              <td className="px-2 py-2">
                                <div className="w-6 h-full flex items-center justify-center">
                                  <div className={`w-px h-4 ${idx === group.bundles.length - 1 ? '' : 'bg-[#2A2D31]'}`} />
                                </div>
                              </td>

                              {/* Barcode */}
                              <td colSpan={4} className="px-4 py-2">
                                <span className="font-mono text-xs text-[#9aa0a6] bg-[#2A2D31]/40 px-2 py-0.5 rounded">
                                  {b.barcode}
                                </span>
                              </td>

                              {/* QTY per bundle */}
                              <td className="px-4 py-2 text-right text-xs text-[#9aa0a6]">
                                {b.qty_per_bundle} pcs
                              </td>
                            </tr>
                          );
                        })}
                      </React.Fragment>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="lg:col-span-1">
        <CartPanel
          selectedBundles={selectedBundles}
          onUpdateQty={handleUpdateQty}
          onRemove={(id) => {
            const next = new Set(selectedIds);
            next.delete(id);
            setSelectedIds(next);
          }}
          tanggal={tanggal}
          setTanggal={setTanggal}
          catatan={catatan}
          setCatatan={setCatatan}
          onFinalize={handleFinalize}
          isSubmitting={isSubmitting}
        />
      </div>
    </div>
  );
}
