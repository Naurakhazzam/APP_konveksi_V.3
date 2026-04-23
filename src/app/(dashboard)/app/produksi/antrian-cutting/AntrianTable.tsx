'use client';

import React from 'react';
import type { AntrianBundle } from '@/lib/actions/produksi/antrian.actions';
import { Package, ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react';

interface Props {
  bundles: AntrianBundle[];
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
  onToggleAll: (ids: string[]) => void;
  sortKey: string;
  sortDir: 'asc' | 'desc';
  onSort: (key: string) => void;
}

function SortHeader({ label, field, sortKey, sortDir, onSort, center = false }: {
  label: string; 
  field: string; 
  sortKey: string; 
  sortDir: 'asc' | 'desc';
  onSort: (k: string) => void; 
  center?: boolean;
}) {
  const active = sortKey === field;
  return (
    <th
      className={`p-4 font-semibold text-xs uppercase tracking-wider cursor-pointer select-none hover:text-[#e8eaed] transition-colors ${center ? 'text-center' : ''}`}
      onClick={() => onSort(field)}
    >
      <div className={`flex items-center gap-1 ${center ? 'justify-center' : ''}`}>
        {label}
        {active
          ? (sortDir === 'asc'
              ? <ChevronUp size={12} className="text-[#e5c17b]" />
              : <ChevronDown size={12} className="text-[#e5c17b]" />)
          : <ChevronsUpDown size={12} className="text-[#9aa0a6] opacity-50" />
        }
      </div>
    </th>
  );
}

export default function AntrianTable({ 
  bundles, 
  selectedIds, 
  onToggle, 
  onToggleAll,
  sortKey,
  sortDir,
  onSort
}: Props) {
  const allIds = bundles.map(b => b.id);
  const isAllSelected = bundles.length > 0 && allIds.every(id => selectedIds.has(id));
  const isSomeSelected = bundles.length > 0 && allIds.some(id => selectedIds.has(id)) && !isAllSelected;

  const handleToggleAll = () => {
    onToggleAll(allIds);
  };

  if (bundles.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-12 bg-[#1A1D1F] border border-[#2A2D31] rounded-xl">
        <div className="w-12 h-12 rounded-full bg-[#16181A] flex items-center justify-center mb-4">
          <Package className="w-6 h-6 text-[#9aa0a6]" />
        </div>
        <p className="text-[#e8eaed] font-medium">Tidak ada bundle di tab ini</p>
        <p className="text-[#9aa0a6] text-xs mt-1">Gunakan tab lain atau filter untuk mencari bundle</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-[#2A2D31] bg-[#1A1D1F] overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm whitespace-nowrap">
          <thead className="bg-[#16181A] border-b border-[#2A2D31] text-[#9aa0a6] font-medium">
            <tr>
              <th className="p-4 w-10">
                <input
                  type="checkbox"
                  className="rounded border-[#2A2D31] bg-[#1E2124] text-[#e5c17b] focus:ring-[#e5c17b] focus:ring-offset-0"
                  checked={isAllSelected}
                  ref={(el) => {
                    if (el) el.indeterminate = isSomeSelected;
                  }}
                  onChange={handleToggleAll}
                />
              </th>
              <th className="p-4 font-semibold text-xs uppercase tracking-wider text-center">NO.</th>
              <SortHeader label="PO" field="no_po" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
              <SortHeader label="Klien" field="klien" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
              <SortHeader label="Artikel" field="artikel" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
              <SortHeader label="Warna / Size" field="warna" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
              <SortHeader label="QTY" field="qty" sortKey={sortKey} sortDir={sortDir} onSort={onSort} center={true} />
              <SortHeader label="Barcode" field="barcode" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
            </tr>
          </thead>
          <tbody className="divide-y divide-[#2A2D31]">
            {bundles.map((bundle, index) => (
              <tr 
                key={bundle.id} 
                className="group hover:bg-[#1E2124] transition-colors cursor-pointer text-[#e8eaed]"
                onClick={() => onToggle(bundle.id)}
              >
                <td className="p-4" onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    className="rounded border-[#2A2D31] bg-[#1E2124] text-[#e5c17b] focus:ring-[#e5c17b] focus:ring-offset-0"
                    checked={selectedIds.has(bundle.id)}
                    onChange={() => onToggle(bundle.id)}
                  />
                </td>
                <td className="p-4 font-bold text-[#9aa0a6] text-center text-xs">{index + 1}</td>
                <td className="p-4">
                  <span className="font-mono font-bold text-[#e5c17b]">{bundle.no_po}</span>
                </td>
                <td className="p-4">{bundle.klien_nama}</td>
                <td className="p-4 font-medium">{bundle.model_nama ?? '-'}</td>
                <td className="p-4 text-[#9aa0a6]">{bundle.warna} / {bundle.size}</td>
                <td className="p-4 text-center font-mono">{bundle.qty_per_bundle} <span className="text-[10px] text-[#9aa0a6]">pcs</span></td>
                <td className="p-4 font-mono text-[11px] text-[#9aa0a6]">{bundle.barcode}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
