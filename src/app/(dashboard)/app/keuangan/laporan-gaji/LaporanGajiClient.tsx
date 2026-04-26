'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { Loader2, Filter, ExternalLink, ChevronDown, ChevronUp } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow
} from '@/components/ui/table';
import { getLaporanGaji, type LaporanGajiData } from '@/lib/actions/keuangan/laporan-gaji.actions';

const BULAN = [
  'Januari','Februari','Maret','April','Mei','Juni',
  'Juli','Agustus','September','Oktober','November','Desember'
];
const idrFmt = (n: number) =>
  'Rp ' + Math.abs(n).toLocaleString('id-ID', { minimumFractionDigits: 0 });
const dateFmt = (d: string) =>
  new Date(d).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
const labelCls = 'block text-[10px] font-bold text-[#9aa0a6] uppercase tracking-widest mb-1';

interface Props { initialData: LaporanGajiData; }

export default function LaporanGajiClient({ initialData }: Props) {
  const [data, setData] = useState<LaporanGajiData>(initialData);
  const [filterBulan, setFilterBulan] = useState('');
  const [filterTahun, setFilterTahun] = useState(String(new Date().getFullYear()));
  const [loading, setLoading] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  const handleFilter = async () => {
    setLoading(true);
    try {
      const result = await getLaporanGaji({
        bulan: filterBulan || undefined,
        tahun: filterTahun || undefined,
      });
      setData(result);
    } catch (e: any) {
      toast.error(e.message || 'Gagal memuat data');
    } finally {
      setLoading(false);
    }
  };

  const kpiCards = [
    { label: 'Total Sudah Dibayar', value: idrFmt(data.total_upah_sudah_bayar), color: 'text-green-400', border: 'border-green-500/20' },
    { label: 'Total Belum Dibayar', value: idrFmt(data.total_upah_belum_bayar), color: 'text-orange-400', border: 'border-orange-500/20' },
    { label: 'Total Kasbon Outstanding', value: idrFmt(data.total_kasbon_outstanding), color: 'text-blue-400', border: 'border-blue-500/20' },
  ];

  return (
    <div className="space-y-6">
      {/* Filter */}
      <div className="flex flex-wrap gap-3 items-end p-4 rounded-xl bg-[#1A1D1F] border border-[#2A2D31]">
        <div>
          <p className={labelCls}>Bulan</p>
          <select className="h-9 px-3 rounded-lg bg-[#1E2124] border border-[#2A2D31] text-sm text-[#e8eaed] outline-none focus:ring-1 focus:ring-[#e5c17b]"
            value={filterBulan} onChange={e => setFilterBulan(e.target.value)}>
            <option value="">Semua</option>
            {BULAN.map((b, i) => <option key={i} value={String(i + 1).padStart(2, '0')}>{b}</option>)}
          </select>
        </div>
        <div>
          <p className={labelCls}>Tahun</p>
          <input type="number" className="h-9 w-24 px-3 rounded-lg bg-[#1E2124] border border-[#2A2D31] text-sm text-[#e8eaed] outline-none focus:ring-1 focus:ring-[#e5c17b]"
            value={filterTahun} onChange={e => setFilterTahun(e.target.value)} />
        </div>
        <Button onClick={handleFilter} disabled={loading}
          className="h-9 bg-[#2A2D31] text-[#e8eaed] hover:bg-[#3A3D41] text-xs">
          {loading ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Filter className="h-4 w-4 mr-1" />}
          Terapkan
        </Button>
        <Link href="/app/penggajian/rekap-gaji">
          <Button variant="ghost" className="h-9 text-xs text-[#9aa0a6] hover:text-[#e8eaed]">
            <ExternalLink className="h-3.5 w-3.5 mr-1" />
            Kelola Pembayaran
          </Button>
        </Link>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {kpiCards.map(c => (
          <div key={c.label} className={`p-4 rounded-xl bg-[#1A1D1F] border ${c.border}`}>
            <p className="text-[10px] uppercase tracking-widest text-[#9aa0a6] font-bold mb-1">{c.label}</p>
            <p className={`text-lg font-bold font-mono ${c.color}`}>{c.value}</p>
          </div>
        ))}
      </div>

      {/* Tabel per karyawan */}
      <div className="rounded-xl border border-[#2A2D31] overflow-hidden bg-[#16181A]">
        <Table>
          <TableHeader className="bg-[#1A1C1E]">
            <TableRow className="border-[#2A2D31] hover:bg-transparent">
              <TableHead className="text-[#9aa0a6]">Karyawan</TableHead>
              <TableHead className="text-[#9aa0a6] text-right">Upah Sudah Dibayar</TableHead>
              <TableHead className="text-[#9aa0a6] text-right">Upah Belum Dibayar</TableHead>
              <TableHead className="text-[#9aa0a6] text-right">Kasbon Sisa</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.per_karyawan.length === 0 ? (
              <TableRow className="hover:bg-transparent border-[#2A2D31]">
                <TableCell colSpan={4} className="h-20 text-center text-[#5f6368]">Belum ada data karyawan</TableCell>
              </TableRow>
            ) : data.per_karyawan.map(k => (
              <TableRow key={k.karyawan_id} className="border-[#2A2D31] bg-[#16181A] hover:bg-[#1A1C1E]">
                <TableCell className="text-sm text-[#e8eaed] font-medium">{k.karyawan_nama}</TableCell>
                <TableCell className="text-sm text-right font-mono text-green-400">{idrFmt(k.upah_sudah_bayar)}</TableCell>
                <TableCell className="text-sm text-right font-mono text-orange-400">{idrFmt(k.upah_belum_bayar)}</TableCell>
                <TableCell className="text-sm text-right font-mono text-blue-400">{k.kasbon_sisa > 0 ? idrFmt(k.kasbon_sisa) : '-'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* History Pembayaran (collapsible) */}
      {data.history_pembayaran.length > 0 && (
        <div className="rounded-xl border border-[#2A2D31] bg-[#1A1D1F] overflow-hidden">
          <button
            onClick={() => setHistoryOpen(!historyOpen)}
            className="w-full flex items-center justify-between p-4 text-left hover:bg-[#1E2124] transition-colors"
          >
            <span className="text-xs font-bold text-[#9aa0a6] uppercase tracking-widest">
              History Pembayaran ({data.history_pembayaran.length})
            </span>
            {historyOpen
              ? <ChevronUp className="h-4 w-4 text-[#9aa0a6]" />
              : <ChevronDown className="h-4 w-4 text-[#9aa0a6]" />
            }
          </button>
          {historyOpen && (
            <div className="border-t border-[#2A2D31] divide-y divide-[#2A2D31]">
              {data.history_pembayaran.map((h, i) => (
                <div key={i} className="flex items-center justify-between px-4 py-2.5 text-sm">
                  <div className="flex items-center gap-3">
                    <span className="text-[#9aa0a6] text-xs whitespace-nowrap">{dateFmt(h.tanggal_bayar)}</span>
                    <span className="text-[#e8eaed]">{h.karyawan_nama}</span>
                  </div>
                  <span className="font-mono text-green-400 text-sm">{idrFmt(h.jumlah_dibayar)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
