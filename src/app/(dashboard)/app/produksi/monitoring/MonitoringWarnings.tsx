'use client';

import React, { useState, useEffect } from 'react';
import { AlertCircle, CheckCircle2, Clock, Loader2 } from 'lucide-react';
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from '@/components/ui/table';
import { getMonitoringWarnings, type WarningRow } from '@/lib/actions/produksi/monitoring.actions';
// Native Intl API for formatting
const formatDate = (date: Date) => {
  return new Intl.DateTimeFormat('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(date);
};

interface Props {
  thresholdHours: number;
  onWarningCountUpdate: (count: number) => void;
}

export default function MonitoringWarnings({ thresholdHours, onWarningCountUpdate }: Props) {
  const [warnings, setWarnings] = useState<WarningRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function loadWarnings() {
      setIsLoading(true);
      try {
        const data = await getMonitoringWarnings(thresholdHours);
        setWarnings(data);
        onWarningCountUpdate(data.length);
      } catch (err) {
        console.error('Failed to load warnings:', err);
      } finally {
        setIsLoading(false);
      }
    }

    loadWarnings();
  }, [thresholdHours, onWarningCountUpdate]);

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[300px] gap-3">
        <Loader2 className="animate-spin text-[#e5c17b]" size={32} />
        <p className="text-[#9aa0a6] text-sm animate-pulse">Memindai hambatan produksi...</p>
      </div>
    );
  }

  if (warnings.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[300px] space-y-4">
        <div className="w-20 h-20 bg-green-500/10 rounded-full flex items-center justify-center text-green-500 animate-in zoom-in duration-500">
          <CheckCircle2 size={40} />
        </div>
        <div className="text-center">
          <h3 className="text-xl font-bold text-[#e8eaed]">Semua Lancar!</h3>
          <p className="text-[#9aa0a6] text-sm max-w-xs mx-auto">
            Tidak ada bundle yang mandek melebihi ambang batas {thresholdHours} jam.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 animate-in fade-in duration-500">
      <div className="flex items-center gap-2 px-4 py-3 bg-[#ef4444]/10 border border-[#ef4444]/20 rounded-xl text-[#ef4444]">
        <AlertCircle size={18} />
        <p className="text-xs font-bold uppercase tracking-wider">
          Terdeteksi {warnings.length} Bundle yang mengalami hambatan proses
        </p>
      </div>

      <div className="bg-[#1A1D1F] border border-[#2A2D31] rounded-2xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="border-[#2A2D31] hover:bg-transparent">
                <TableHead className="text-[#9aa0a6] font-semibold text-[10px] uppercase">Barcode</TableHead>
                <TableHead className="text-[#9aa0a6] font-semibold text-[10px] uppercase">No. PO</TableHead>
                <TableHead className="text-[#9aa0a6] font-semibold text-[10px] uppercase">Tahap</TableHead>
                <TableHead className="text-[#9aa0a6] font-semibold text-[10px] uppercase">Jenis</TableHead>
                <TableHead className="text-[#9aa0a6] font-semibold text-[10px] uppercase">Detail</TableHead>
                <TableHead className="text-[#9aa0a6] font-semibold text-[10px] uppercase text-right">Waktu Terima</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {warnings.map((row) => (
                <TableRow key={`${row.barcode}-${row.tahap}`} className="border-[#2A2D31] hover:bg-[#2A2D31]/40 transition-colors group">
                  <TableCell className="font-mono text-sm font-bold text-[#e8eaed]">{row.barcode}</TableCell>
                  <TableCell className="font-mono text-[11px] font-bold text-[#e5c17b]">{row.no_po}</TableCell>
                  <TableCell>
                    <span className="text-[10px] font-bold text-[#9aa0a6] bg-[#2A2D31] px-2 py-0.5 rounded uppercase">
                      {row.tahap}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className="flex items-center gap-1.5 text-[10px] font-bold text-red-400 uppercase">
                      <Clock size={12} />
                      {row.jenis}
                    </span>
                  </TableCell>
                  <TableCell className="text-[#9aa0a6] text-xs font-medium italic">
                    {row.detail}
                  </TableCell>
                  <TableCell className="text-right text-[#9aa0a6] text-xs font-mono">
                    {formatDate(new Date(row.waktu))}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}
