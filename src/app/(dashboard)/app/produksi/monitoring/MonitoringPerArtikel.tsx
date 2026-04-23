'use client';

import React, { useState, useMemo } from 'react';
import { Filter } from 'lucide-react';
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from '@/components/ui/table';
import type { ArtikelRow } from '@/lib/actions/produksi/monitoring.actions';

interface Props {
  data: ArtikelRow[];
  poList: { id: string; no_po: string }[];
}

const STAGE_LABELS: Record<string, string> = {
  cutting: 'CUTTING',
  jahit: 'JAHIT',
  buang_benang: 'B.BENANG',
  lubang_kancing: 'L.KANCING',
  qc: 'QC',
  steam: 'STEAM',
  packing: 'PACKING'
};

const STAGE_ORDER = ['cutting', 'jahit', 'buang_benang', 'lubang_kancing', 'qc', 'steam', 'packing'];

export default function MonitoringPerArtikel({ data, poList }: Props) {
  const [selectedPo, setSelectedPo] = useState<string>('all');

  const filteredData = useMemo(() => {
    if (selectedPo === 'all') return data;
    return data.filter(item => item.no_po === selectedPo);
  }, [data, selectedPo]);

  const getStageColor = (done: number, total: number) => {
    if (total === 0) return 'text-[#9aa0a6]';
    if (done === total) return 'text-[#22c55e]'; // Green
    if (done === 0) return 'text-[#9aa0a6]';    // Gray
    return 'text-[#e5c17b]';                   // Yellow/Accent
  };

  return (
    <div className="space-y-6">
      {/* 1. Filter Row */}
      <div className="flex items-center gap-3 bg-[#16181A] border border-[#2A2D31] px-4 py-2 rounded-xl w-fit">
        <Filter size={16} className="text-[#9aa0a6]" />
        <select 
          className="bg-transparent text-sm text-[#e8eaed] font-bold focus:outline-none cursor-pointer"
          value={selectedPo}
          onChange={(e) => setSelectedPo(e.target.value)}
        >
          <option value="all" className="bg-[#1A1D1F]">SEMUA PO</option>
          {poList.map(po => (
            <option key={po.id} value={po.no_po} className="bg-[#1A1D1F]">
              {po.no_po}
            </option>
          ))}
        </select>
      </div>

      {/* 2. Table */}
      <div className="bg-[#1A1D1F] border border-[#2A2D31] rounded-2xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="border-[#2A2D31] hover:bg-transparent">
                <TableHead className="text-[#9aa0a6] font-semibold text-[10px] uppercase">No. PO</TableHead>
                <TableHead className="text-[#9aa0a6] font-semibold text-[10px] uppercase">Klien</TableHead>
                <TableHead className="text-[#9aa0a6] font-semibold text-[10px] uppercase">Model</TableHead>
                <TableHead className="text-[#9aa0a6] font-semibold text-[10px] uppercase">Warna</TableHead>
                <TableHead className="text-[#9aa0a6] font-semibold text-[10px] uppercase">Size</TableHead>
                <TableHead className="text-[#9aa0a6] font-semibold text-[10px] uppercase text-center">Qty</TableHead>
                <TableHead className="text-[#9aa0a6] font-semibold text-[10px] uppercase text-center border-r border-[#2A2D31]">Bdl</TableHead>
                {STAGE_ORDER.map(s => (
                  <TableHead key={s} className="text-[#9aa0a6] font-semibold text-[10px] uppercase text-center px-1">
                    {STAGE_LABELS[s]}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredData.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={14} className="h-32 text-center text-[#9aa0a6]">
                    Tidak ada data ditemukan
                  </TableCell>
                </TableRow>
              ) : (
                filteredData.map((row) => (
                  <TableRow key={row.id} className="border-[#2A2D31] hover:bg-[#2A2D31]/40 transition-colors">
                    <TableCell className="font-mono text-[11px] font-bold text-[#e5c17b]">{row.no_po}</TableCell>
                    <TableCell className="text-[#e8eaed] text-xs whitespace-nowrap">{row.klien_nama}</TableCell>
                    <TableCell className="text-[#e8eaed] text-xs font-medium">{row.model_nama}</TableCell>
                    <TableCell className="text-[#9aa0a6] text-xs">{row.warna}</TableCell>
                    <TableCell className="text-[#9aa0a6] text-xs font-mono">{row.size}</TableCell>
                    <TableCell className="text-center text-[#e8eaed] text-xs font-bold">{row.qty_order}</TableCell>
                    <TableCell className="text-center text-[#9aa0a6] text-xs border-r border-[#2A2D31]">{row.total_bundle}</TableCell>
                    
                    {STAGE_ORDER.map(s => {
                      const prog = row.progress[s] || { done: 0, total: 0 };
                      return (
                        <TableCell key={s} className={`text-center font-bold text-[11px] px-1 ${getStageColor(prog.done, prog.total)}`}>
                          {prog.done}/{prog.total}
                        </TableCell>
                      );
                    })}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}
