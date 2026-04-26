'use client';

import React, { useState } from 'react';
import { Loader2, Filter, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow
} from '@/components/ui/table';
import { getLaporanReject, type LaporanRejectSummary } from '@/lib/actions/keuangan/laporan-reject.actions';

const BULAN = [
  'Januari','Februari','Maret','April','Mei','Juni',
  'Juli','Agustus','September','Oktober','November','Desember'
];
const idrFmt = (n: number) =>
  'Rp ' + Math.abs(n).toLocaleString('id-ID', { minimumFractionDigits: 0 });
const dateFmt = (d: string) =>
  new Date(d).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
const labelCls = 'block text-[10px] font-bold text-[#9aa0a6] uppercase tracking-widest mb-1';

interface Props {
  initialData: LaporanRejectSummary;
  karyawanList: { id: string; nama: string }[];
}

export default function LaporanRejectClient({ initialData, karyawanList }: Props) {
  const [data, setData] = useState<LaporanRejectSummary>(initialData);
  const [filterBulan, setFilterBulan] = useState('');
  const [filterTahun, setFilterTahun] = useState(String(new Date().getFullYear()));
  const [filterKaryawan, setFilterKaryawan] = useState('');
  const [loading, setLoading] = useState(false);

  const handleFilter = async () => {
    setLoading(true);
    try {
      const result = await getLaporanReject({
        bulan: filterBulan || undefined,
        tahun: filterTahun || undefined,
        karyawan_id: filterKaryawan || undefined,
      });
      setData(result);
    } catch (e: any) {
      toast.error(e.message || 'Gagal memuat data');
    } finally {
      setLoading(false);
    }
  };

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
        <div>
          <p className={labelCls}>Karyawan</p>
          <select className="h-9 px-3 rounded-lg bg-[#1E2124] border border-[#2A2D31] text-sm text-[#e8eaed] outline-none focus:ring-1 focus:ring-[#e5c17b]"
            value={filterKaryawan} onChange={e => setFilterKaryawan(e.target.value)}>
            <option value="">Semua Karyawan</option>
            {karyawanList.map(k => <option key={k.id} value={k.id}>{k.nama}</option>)}
          </select>
        </div>
        <Button onClick={handleFilter} disabled={loading}
          className="h-9 bg-[#2A2D31] text-[#e8eaed] hover:bg-[#3A3D41] text-xs">
          {loading ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Filter className="h-4 w-4 mr-1" />}
          Terapkan
        </Button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="p-4 rounded-xl bg-[#1A1D1F] border border-red-500/20">
          <p className="text-[10px] uppercase tracking-widest text-[#9aa0a6] font-bold mb-1">Total Potongan Periode</p>
          <p className="text-lg font-bold font-mono text-red-400">-{idrFmt(data.total_potongan_periode)}</p>
        </div>
        <div className="p-4 rounded-xl bg-[#1A1D1F] border border-orange-500/20">
          <p className="text-[10px] uppercase tracking-widest text-[#9aa0a6] font-bold mb-1">Jumlah Kejadian</p>
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-orange-400" />
            <p className="text-lg font-bold text-orange-400">{data.jumlah_kejadian}x</p>
          </div>
        </div>
      </div>

      {/* Per-karyawan breakdown */}
      {data.per_karyawan.length > 0 && (
        <div className="rounded-xl border border-[#2A2D31] overflow-hidden bg-[#16181A]">
          <div className="p-3 bg-[#1A1C1E] border-b border-[#2A2D31]">
            <h4 className="text-xs font-bold text-[#9aa0a6] uppercase tracking-widest">Breakdown per Karyawan</h4>
          </div>
          <Table>
            <TableHeader className="bg-[#1A1C1E]">
              <TableRow className="border-[#2A2D31] hover:bg-transparent">
                <TableHead className="text-[#9aa0a6]">Karyawan</TableHead>
                <TableHead className="text-[#9aa0a6] text-center">Jumlah Kejadian</TableHead>
                <TableHead className="text-[#9aa0a6] text-right">Total Potongan</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.per_karyawan.map((k, i) => (
                <TableRow key={i} className="border-[#2A2D31] bg-[#16181A] hover:bg-[#1A1C1E]">
                  <TableCell className="text-sm text-[#e8eaed] font-medium">{k.karyawan_nama}</TableCell>
                  <TableCell className="text-sm text-center text-orange-400 font-bold">{k.jumlah_kejadian}x</TableCell>
                  <TableCell className="text-sm text-right font-mono text-red-400">-{idrFmt(k.total_potongan)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Detail table */}
      <div className="rounded-xl border border-[#2A2D31] overflow-hidden bg-[#16181A]">
        <div className="p-3 bg-[#1A1C1E] border-b border-[#2A2D31]">
          <h4 className="text-xs font-bold text-[#9aa0a6] uppercase tracking-widest">Detail Semua Kejadian</h4>
        </div>
        <Table>
          <TableHeader className="bg-[#1A1C1E]">
            <TableRow className="border-[#2A2D31] hover:bg-transparent">
              <TableHead className="text-[#9aa0a6]">Tanggal</TableHead>
              <TableHead className="text-[#9aa0a6]">Karyawan</TableHead>
              <TableHead className="text-[#9aa0a6]">Keterangan</TableHead>
              <TableHead className="text-[#9aa0a6] text-right">Potongan</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.items.length === 0 ? (
              <TableRow className="hover:bg-transparent border-[#2A2D31]">
                <TableCell colSpan={4} className="h-20 text-center text-[#5f6368]">
                  Tidak ada data reject
                </TableCell>
              </TableRow>
            ) : data.items.map(item => (
              <TableRow key={item.id} className="border-[#2A2D31] bg-[#16181A] hover:bg-[#1A1C1E]">
                <TableCell className="text-sm text-[#9aa0a6] whitespace-nowrap">{dateFmt(item.tanggal)}</TableCell>
                <TableCell className="text-sm text-[#e8eaed]">{item.karyawan_nama}</TableCell>
                <TableCell className="text-sm text-[#e8eaed] max-w-[250px] truncate">{item.keterangan}</TableCell>
                <TableCell className="text-sm text-right font-mono text-red-400 font-semibold">-{idrFmt(item.total_potongan)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
