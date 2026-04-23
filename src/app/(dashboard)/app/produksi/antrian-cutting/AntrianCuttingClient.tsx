'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { Filter, FileText, Barcode as BarcodeIcon } from 'lucide-react';
import type { AntrianBundle } from '@/lib/actions/produksi/antrian.actions';
import AntrianTable from './AntrianTable';
import PrintSPKLayout from './PrintSPKLayout';
import PrintLabelLayout from './PrintLabelLayout';
import StagePagination from '@/components/produksi/StagePagination';

interface Props {
  antrianBundles: AntrianBundle[];
  dipotongBundles: AntrianBundle[];
}

export default function AntrianCuttingClient({ antrianBundles, dipotongBundles }: Props) {
  const [activeTab, setActiveTab] = useState<'antrian' | 'dipotong'>('antrian');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [filterNoPo, setFilterNoPo] = useState<string>('');
  const [printMode, setPrintMode] = useState<'spk' | 'label' | null>(null);

  // Pagination & Sorting State
  const [sortKey, setSortKey] = useState<string>('no_po');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 20;

  // Generate list PO unik untuk filter
  const poList = useMemo(() => {
    const all = [...antrianBundles, ...dipotongBundles];
    const unique = Array.from(new Set(all.map(b => b.no_po))).sort();
    return unique;
  }, [antrianBundles, dipotongBundles]);

  // Filter data berdasarkan tab aktif dan dropdown PO
  const currentBundles = activeTab === 'antrian' ? antrianBundles : dipotongBundles;
  const filteredBundles = useMemo(() => {
    if (!filterNoPo) return currentBundles;
    return currentBundles.filter(b => b.no_po === filterNoPo);
  }, [currentBundles, filterNoPo]);

  // Sort Logic
  const sortedBundles = useMemo(() => {
    return [...filteredBundles].sort((a, b) => {
      let valA: string | number = '';
      let valB: string | number = '';
      switch (sortKey) {
        case 'no_po':    valA = a.no_po; valB = b.no_po; break;
        case 'klien':    valA = a.klien_nama; valB = b.klien_nama; break;
        case 'artikel':  valA = a.model_nama ?? ''; valB = b.model_nama ?? ''; break;
        case 'warna':    valA = a.warna; valB = b.warna; break;
        case 'size':     valA = a.size; valB = b.size; break;
        case 'qty':      valA = a.qty_per_bundle; valB = b.qty_per_bundle; break;
        case 'barcode':  valA = a.barcode; valB = b.barcode; break;
      }
      if (valA === valB) return 0;
      const cmp = valA > valB ? 1 : -1;
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [filteredBundles, sortKey, sortDir]);

  // Pagination Logic
  const paginatedBundles = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return sortedBundles.slice(start, start + pageSize);
  }, [sortedBundles, currentPage, pageSize]);

  // Reset page on filter/tab/sort change
  useEffect(() => {
    setCurrentPage(1);
  }, [filterNoPo, activeTab, sortKey, sortDir]);

  // Handlers
  const handleToggle = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  const handleToggleAll = (ids: string[]) => {
    const next = new Set(selectedIds);
    const allIncluded = ids.every(id => next.has(id));
    if (allIncluded) {
      ids.forEach(id => next.delete(id));
    } else {
      ids.forEach(id => next.add(id));
    }
    setSelectedIds(next);
  };

  // Logic Print
  const selectedBundles = useMemo(() => {
    const all = [...antrianBundles, ...dipotongBundles];
    return all.filter(b => selectedIds.has(b.id));
  }, [antrianBundles, dipotongBundles, selectedIds]);

  useEffect(() => {
    if (printMode !== null) {
      const timer = setTimeout(() => window.print(), 200);
      return () => clearTimeout(timer);
    }
  }, [printMode]);

  useEffect(() => {
    const handleAfterPrint = () => setPrintMode(null);
    window.addEventListener('afterprint', handleAfterPrint);
    return () => window.removeEventListener('afterprint', handleAfterPrint);
  }, []);

  return (
    <div className="space-y-6">
      <div className="print:hidden flex flex-col md:flex-row md:items-end justify-between gap-4 bg-[#1A1D1F] p-4 rounded-xl border border-[#2A2D31]">
        <div className="flex flex-col gap-4">
          {/* Tabs */}
          <div className="flex p-1 bg-[#16181A] rounded-lg w-fit border border-[#2A2D31]">
            {(['antrian', 'dipotong'] as const).map((t) => {
              const count = t === 'antrian' ? antrianBundles.length : dipotongBundles.length;
              const isActive = activeTab === t;
              return (
                <button
                  key={t}
                  onClick={() => { setActiveTab(t); setSelectedIds(new Set()); }}
                  className={`flex items-center gap-2 px-4 py-1.5 rounded-md text-sm font-medium transition-all ${
                    isActive ? 'bg-[#e5c17b] text-[#0D0E10]' : 'text-[#9aa0a6] hover:text-[#e8eaed]'
                  }`}
                >
                  <span className="capitalize">{t === 'antrian' ? 'Antrian' : 'Sedang Dipotong'}</span>
                  <span className={`px-1.5 py-0.5 rounded-full text-[10px] ${isActive ? 'bg-[#0D0E10]/10' : 'bg-[#2A2D31]'}`}>
                    {count}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Filter PO */}
          <div className="flex items-center gap-3">
            <div className="relative">
              <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#9aa0a6]" />
              <select
                value={filterNoPo}
                onChange={(e) => setFilterNoPo(e.target.value)}
                className="pl-10 pr-4 h-10 rounded-md border border-[#2A2D31] bg-[#16181A] text-sm text-[#e8eaed] focus:ring-1 focus:ring-[#e5c17b] outline-none min-w-[200px]"
              >
                <option value="">Semua nomor PO</option>
                {poList.map(po => <option key={po} value={po}>{po}</option>)}
              </select>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2">
          <button
            disabled={selectedIds.size === 0}
            onClick={() => setPrintMode('spk')}
            className="flex items-center gap-2 px-4 h-10 rounded-md border border-[#2A2D31] text-[#e8eaed] text-sm font-medium hover:bg-[#2A2D31] disabled:opacity-30 disabled:cursor-not-allowed transition-all"
          >
            <FileText className="w-4 h-4" /> Cetak SPK
          </button>
          <button
            disabled={selectedIds.size === 0}
            onClick={() => setPrintMode('label')}
            className="flex items-center gap-2 px-4 h-10 rounded-md bg-[#e5c17b] text-[#0D0E10] text-sm font-semibold hover:bg-[#e5c17b]/90 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
          >
            <BarcodeIcon className="w-4 h-4" /> Cetak Label
          </button>
        </div>
      </div>

      <div className="print:hidden">
        <AntrianTable
          bundles={paginatedBundles}
          selectedIds={selectedIds}
          onToggle={handleToggle}
          onToggleAll={handleToggleAll}
          sortKey={sortKey}
          sortDir={sortDir}
          onSort={(key) => {
            if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
            else { setSortKey(key); setSortDir('asc'); }
          }}
        />
        
        {sortedBundles.length > pageSize && (
          <StagePagination 
            page={currentPage}
            totalPages={Math.ceil(sortedBundles.length / pageSize)}
            onPageChange={setCurrentPage}
          />
        )}

        {selectedIds.size > 0 && (
          <p className="mt-3 text-xs text-[#9aa0a6]">Terpilih: <span className="text-[#e5c17b] font-bold">{selectedIds.size}</span> bundle</p>
        )}
      </div>

      {printMode === 'spk' && <PrintSPKLayout bundles={selectedBundles} />}
      {printMode === 'label' && <PrintLabelLayout bundles={selectedBundles} />}
    </div>
  );
}
