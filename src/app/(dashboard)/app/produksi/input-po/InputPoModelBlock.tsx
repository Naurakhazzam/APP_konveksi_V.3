'use client';

import React, { useEffect, useState } from 'react';
import { getProdukMatrixByModel, type ProdukMatrix } from '@/lib/actions/produksi/po.actions';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Trash2 } from 'lucide-react';

export interface ModelBlockState {
  id: string;
  model_id: string;
  qty_per_bundle: number;
  /** key `${warna_id}|${size_id}` → qty */
  qty: Record<string, number>;
  matrix: ProdukMatrix | null;
}

interface Props {
  block: ModelBlockState;
  modelList: { id: string; nama: string }[];
  /** model_id yang sudah dipakai blok lain */
  usedModelIds: string[];
  onChange: (id: string, updates: Partial<ModelBlockState>) => void;
  onRemove: (id: string) => void;
  canRemove: boolean;
  disabled: boolean;
}

export const cellKey = (warnaId: string, sizeId: string) => `${warnaId}|${sizeId}`;

export function InputPoModelBlock({ block, modelList, usedModelIds, onChange, onRemove, canRemove, disabled }: Props) {
  // Galat muat disimpan bersama model_id-nya, supaya ganti model otomatis "mereset" galat
  const [loadError, setLoadError] = useState<{ modelId: string; msg: string } | null>(null);

  useEffect(() => {
    if (!block.model_id) return;
    let active = true;
    getProdukMatrixByModel(block.model_id)
      .then(matrix => { if (active) onChange(block.id, { matrix }); })
      .catch(err => {
        if (active) setLoadError({ modelId: block.model_id, msg: err instanceof Error ? err.message : 'Gagal memuat produk' });
      });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [block.model_id]);

  const errorMsg = loadError && loadError.modelId === block.model_id ? loadError.msg : null;
  const isLoading = !!block.model_id && !block.matrix && !errorMsg;

  const matrix = block.model_id ? block.matrix : null;
  const isi = block.qty_per_bundle || 12;
  const q = (w: string, s: string) => block.qty[cellKey(w, s)] || 0;

  const setQty = (w: string, s: string, val: number) => {
    const next = { ...block.qty };
    if (val > 0) next[cellKey(w, s)] = val;
    else delete next[cellKey(w, s)];
    onChange(block.id, { qty: next });
  };

  const rowTotal = (w: string) => matrix ? matrix.size.reduce((t, s) => t + q(w, s.id), 0) : 0;
  const rowBundle = (w: string) => matrix ? matrix.size.reduce((t, s) => t + Math.ceil(q(w, s.id) / isi), 0) : 0;
  const colTotal = (s: string) => matrix ? matrix.warna.reduce((t, w) => t + q(w.id, s), 0) : 0;
  const grandTotal = matrix ? matrix.warna.reduce((t, w) => t + rowTotal(w.id), 0) : 0;
  const grandBundle = matrix ? matrix.warna.reduce((t, w) => t + rowBundle(w.id), 0) : 0;

  const selectClass = "flex h-10 w-full md:w-64 rounded-md border border-[#2A2D31] bg-[#1E2124] px-3 py-2 text-sm text-[#e8eaed] focus:outline-none focus:ring-1 focus:ring-[#e5c17b] disabled:cursor-not-allowed disabled:opacity-50";
  const cellInput = "h-9 w-16 mx-auto text-center bg-[#1E2124] border-[#2A2D31] text-[#e8eaed] px-1 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none";

  return (
    <div className="border-b border-[#2A2D31] p-4 space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <div className="text-xs font-semibold text-[#9aa0a6]">MODEL</div>
          <select
            className={selectClass}
            value={block.model_id}
            disabled={disabled}
            onChange={e => onChange(block.id, { model_id: e.target.value, qty: {}, matrix: null })}
          >
            <option value="">Pilih Model...</option>
            {modelList.map(m => (
              <option key={m.id} value={m.id} disabled={usedModelIds.includes(m.id)}>
                {m.nama}{usedModelIds.includes(m.id) ? ' (sudah dipilih)' : ''}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <div className="text-xs font-semibold text-[#9aa0a6]">ISI/BUNDLE</div>
          <Input
            type="number"
            min={1}
            className="bg-[#1E2124] border-[#2A2D31] text-[#e8eaed] h-10 w-20"
            value={block.qty_per_bundle || ''}
            disabled={disabled}
            onChange={e => onChange(block.id, { qty_per_bundle: parseInt(e.target.value) || 0 })}
            onBlur={() => { if (!block.qty_per_bundle) onChange(block.id, { qty_per_bundle: 12 }); }}
          />
        </div>
        <div className="ml-auto flex items-center gap-4 text-sm">
          {matrix && (
            <span className="text-[#9aa0a6]">
              <span className="text-[#e8eaed] font-medium">{grandTotal} pcs</span> · <span className="text-[#e5c17b] font-medium">{grandBundle} bundle</span>
            </span>
          )}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            disabled={disabled || !canRemove}
            className="text-[#9aa0a6] hover:bg-red-500/10 hover:text-red-400 disabled:opacity-30"
            onClick={() => onRemove(block.id)}
            title="Hapus model ini"
          >
            <Trash2 className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {isLoading && <div className="text-sm text-[#9aa0a6]">Memuat warna & size...</div>}
      {errorMsg && <div className="text-sm text-red-400">{errorMsg}</div>}
      {matrix && matrix.warna.length === 0 && (
        <div className="text-sm text-red-400">Model ini belum punya produk aktif (warna × size) di master.</div>
      )}

      {matrix && matrix.warna.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-[#2A2D31]">
          <table className="w-full text-sm text-[#9aa0a6]">
            <thead className="bg-[#1E2124]/60 border-b border-[#2A2D31]">
              <tr>
                <th className="p-2 text-left font-semibold text-[#e8eaed] whitespace-nowrap">Warna \ Size</th>
                {matrix.size.map(s => (
                  <th key={s.id} className="p-2 text-center font-semibold text-[#e8eaed] whitespace-nowrap">{s.nama}</th>
                ))}
                <th className="p-2 text-center font-semibold text-[#e8eaed]">Total</th>
                <th className="p-2 text-center font-semibold text-[#e8eaed]">Bundle</th>
              </tr>
            </thead>
            <tbody>
              {matrix.warna.map(w => (
                <tr key={w.id} className="border-b border-[#2A2D31]/60 hover:bg-[#2A2D31]/10">
                  <td className="p-2 text-[#e8eaed] whitespace-nowrap">{w.nama}</td>
                  {matrix.size.map(s => {
                    const exists = !!matrix.produk[cellKey(w.id, s.id)];
                    return (
                      <td key={s.id} className="p-1 text-center">
                        {exists ? (
                          <Input
                            type="number"
                            min={0}
                            inputMode="numeric"
                            className={cellInput}
                            value={q(w.id, s.id) || ''}
                            disabled={disabled}
                            onChange={e => setQty(w.id, s.id, parseInt(e.target.value) || 0)}
                            onFocus={e => e.target.select()}
                          />
                        ) : (
                          <span className="text-[#5f6368]" title="Kombinasi ini belum ada di master produk">—</span>
                        )}
                      </td>
                    );
                  })}
                  <td className="p-2 text-center text-[#e8eaed] font-medium">{rowTotal(w.id) || ''}</td>
                  <td className="p-2 text-center text-[#e5c17b]">{rowBundle(w.id) || ''}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-[#1E2124]/60">
              <tr>
                <td className="p-2 font-semibold text-[#e8eaed]">Total</td>
                {matrix.size.map(s => (
                  <td key={s.id} className="p-2 text-center text-[#e8eaed] font-medium">{colTotal(s.id) || ''}</td>
                ))}
                <td className="p-2 text-center text-[#e8eaed] font-bold">{grandTotal}</td>
                <td className="p-2 text-center text-[#e5c17b] font-bold">{grandBundle}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
