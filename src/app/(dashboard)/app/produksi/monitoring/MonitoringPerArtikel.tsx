'use client';

import React, { useState, useMemo } from 'react';
import { Filter, ChevronDown, ChevronRight, Truck } from 'lucide-react';
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
  packing: 'PACKING',
  pengiriman: 'KIRIM'
};

const STAGE_ORDER = ['cutting', 'jahit', 'buang_benang', 'lubang_kancing', 'qc', 'steam', 'packing'];
const STAGE_ORDER_WITH_SHIP = [...STAGE_ORDER, 'pengiriman'];
const TOTAL_COLS = 1 + 7 + STAGE_ORDER_WITH_SHIP.length + 2; // expand + info cols + stages + terkirim/diterima

// Header dibekukan (freeze pane): sticky relatif ke container overflow-y sendiri,
// bg solid supaya baris di bawahnya tidak tembus pandang saat discroll.
const STICKY_HEAD = 'sticky top-0 z-20 bg-[#1A1D1F] border-b border-[#2A2D31]';

export default function MonitoringPerArtikel({ data, poList }: Props) {
  const [selectedPo, setSelectedPo] = useState<string>('all');
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

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

  const toggleExpand = (id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
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
        <div className="overflow-x-auto max-h-[70vh] overflow-y-auto">
          <Table>
            <TableHeader>
              <TableRow className="border-[#2A2D31] hover:bg-transparent">
                <TableHead className={`${STICKY_HEAD} w-8`} />
                <TableHead className={`${STICKY_HEAD} text-[#9aa0a6] font-semibold text-[10px] uppercase`}>No. PO</TableHead>
                <TableHead className={`${STICKY_HEAD} text-[#9aa0a6] font-semibold text-[10px] uppercase`}>Klien</TableHead>
                <TableHead className={`${STICKY_HEAD} text-[#9aa0a6] font-semibold text-[10px] uppercase`}>Model</TableHead>
                <TableHead className={`${STICKY_HEAD} text-[#9aa0a6] font-semibold text-[10px] uppercase`}>Warna</TableHead>
                <TableHead className={`${STICKY_HEAD} text-[#9aa0a6] font-semibold text-[10px] uppercase`}>Size</TableHead>
                <TableHead className={`${STICKY_HEAD} text-[#9aa0a6] font-semibold text-[10px] uppercase text-center`}>Qty</TableHead>
                <TableHead className={`${STICKY_HEAD} text-[#9aa0a6] font-semibold text-[10px] uppercase text-center border-r border-[#2A2D31]`}>Bdl</TableHead>
                {STAGE_ORDER_WITH_SHIP.map(s => (
                  <TableHead key={s} className={`${STICKY_HEAD} text-[#9aa0a6] font-semibold text-[10px] uppercase text-center px-1`}>
                    {STAGE_LABELS[s]}
                  </TableHead>
                ))}
                <TableHead className={`${STICKY_HEAD} text-[#9aa0a6] font-semibold text-[10px] uppercase text-center border-l border-[#2A2D31]`}>Terkirim (pcs)</TableHead>
                <TableHead className={`${STICKY_HEAD} text-[#9aa0a6] font-semibold text-[10px] uppercase text-center`}>Diterima (pcs)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredData.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={TOTAL_COLS} className="h-32 text-center text-[#9aa0a6]">
                    Tidak ada data ditemukan
                  </TableCell>
                </TableRow>
              ) : (
                filteredData.map((row) => {
                  const isExpanded = expandedIds.has(row.id);
                  const hasHistory = row.sj_history.length > 0;

                  return (
                    <React.Fragment key={row.id}>
                      <TableRow className="border-[#2A2D31] hover:bg-[#2A2D31]/40 transition-colors">
                        <TableCell className="px-1">
                          {hasHistory && (
                            <button
                              onClick={() => toggleExpand(row.id)}
                              className="text-[#9aa0a6] hover:text-[#e5c17b] transition-colors"
                            >
                              {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                            </button>
                          )}
                        </TableCell>
                        <TableCell className="font-mono text-[11px] font-bold text-[#e5c17b]">{row.no_po}</TableCell>
                        <TableCell className="text-[#e8eaed] text-xs whitespace-nowrap">{row.klien_nama}</TableCell>
                        <TableCell className="text-[#e8eaed] text-xs font-medium">{row.model_nama}</TableCell>
                        <TableCell className="text-[#9aa0a6] text-xs">{row.warna}</TableCell>
                        <TableCell className="text-[#9aa0a6] text-xs font-mono">{row.size}</TableCell>
                        <TableCell className="text-center text-[#e8eaed] text-xs font-bold">{row.qty_order}</TableCell>
                        <TableCell className="text-center text-[#9aa0a6] text-xs border-r border-[#2A2D31]">{row.total_bundle}</TableCell>

                        {STAGE_ORDER_WITH_SHIP.map(s => {
                          const prog = row.progress[s] || { done: 0, total: 0 };
                          return (
                            <TableCell key={s} className={`text-center font-bold text-[11px] px-1 ${s === 'pengiriman' && prog.done > 0 ? 'text-[#a855f7]' : getStageColor(prog.done, prog.total)}`}>
                              {prog.done}/{prog.total}
                            </TableCell>
                          );
                        })}

                        <TableCell className="text-center text-[11px] font-bold text-[#e8eaed] border-l border-[#2A2D31]">
                          {row.qty_terkirim} <span className="text-[#9aa0a6] font-normal">/ {row.qty_order}</span>
                        </TableCell>
                        <TableCell className="text-center text-[11px] font-bold text-[#e8eaed]">
                          {row.qty_terkirim > 0 ? row.qty_diterima : '-'}
                        </TableCell>
                      </TableRow>

                      {isExpanded && hasHistory && (
                        <TableRow className="border-[#2A2D31] bg-[#0D0E10]/40 hover:bg-[#0D0E10]/40">
                          <TableCell colSpan={TOTAL_COLS} className="py-3 px-6">
                            <div className="flex items-center gap-2 text-[10px] font-bold text-[#9aa0a6] uppercase mb-2">
                              <Truck size={12} />
                              Riwayat Pengiriman
                            </div>
                            <div className="space-y-1.5">
                              {row.sj_history.map(sj => (
                                <div
                                  key={sj.nomor_sj}
                                  className="flex items-center gap-4 text-xs bg-[#1A1D1F] border border-[#2A2D31] rounded-lg px-3 py-1.5 w-fit"
                                >
                                  <span className="font-mono font-bold text-[#e5c17b]">{sj.nomor_sj}</span>
                                  <span className="text-[#9aa0a6]">
                                    {new Date(sj.tanggal).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' })}
                                  </span>
                                  <span className="text-[#e8eaed]">Kirim: <span className="font-bold">{sj.qty_kirim}</span> pcs</span>
                                  <span className="text-[#e8eaed]">
                                    Diterima: <span className="font-bold">{sj.qty_diterima ?? 'Belum divalidasi'}</span>{sj.qty_diterima != null ? ' pcs' : ''}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </React.Fragment>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}
