'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { Loader2, Filter, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { getLaporanBulan, type LaporanBulanData } from '@/lib/actions/keuangan/laporan-bulan.actions';

const BULAN = [
  'Januari','Februari','Maret','April','Mei','Juni',
  'Juli','Agustus','September','Oktober','November','Desember'
];
const idrFmt = (n: number) =>
  'Rp ' + Math.abs(n).toLocaleString('id-ID', { minimumFractionDigits: 0 });
const labelCls = 'block text-[10px] font-bold text-[#9aa0a6] uppercase tracking-widest mb-1';

interface Props { initialData: LaporanBulanData; }

export default function LaporanBulanClient({ initialData }: Props) {
  const [data, setData] = useState<LaporanBulanData>(initialData);
  const [filterBulan, setFilterBulan] = useState(initialData.bulan);
  const [filterTahun, setFilterTahun] = useState(initialData.tahun);
  const [loading, setLoading] = useState(false);

  const handleFilter = async () => {
    setLoading(true);
    try {
      const result = await getLaporanBulan(filterBulan, filterTahun);
      setData(result);
    } catch (e: any) {
      toast.error(e.message || 'Gagal memuat data');
    } finally {
      setLoading(false);
    }
  };

  const isEmpty = data.pemasukan.length === 0 && data.pengeluaran.length === 0;
  const bulanLabel = BULAN[parseInt(data.bulan) - 1] ?? data.bulan;

  return (
    <div className="space-y-6">
      {/* Filter */}
      <div className="flex flex-wrap gap-3 items-end p-4 rounded-xl bg-[#1A1D1F] border border-[#2A2D31]">
        <div>
          <p className={labelCls}>Bulan</p>
          <select
            className="h-9 px-3 rounded-lg bg-[#1E2124] border border-[#2A2D31] text-sm text-[#e8eaed] outline-none focus:ring-1 focus:ring-[#e5c17b]"
            value={filterBulan}
            onChange={e => setFilterBulan(e.target.value)}
          >
            {BULAN.map((b, i) => (
              <option key={i} value={String(i + 1)}>{b}</option>
            ))}
          </select>
        </div>
        <div>
          <p className={labelCls}>Tahun</p>
          <input type="number"
            className="h-9 w-24 px-3 rounded-lg bg-[#1E2124] border border-[#2A2D31] text-sm text-[#e8eaed] outline-none focus:ring-1 focus:ring-[#e5c17b]"
            value={filterTahun}
            onChange={e => setFilterTahun(e.target.value)}
          />
        </div>
        <Button onClick={handleFilter} disabled={loading}
          className="h-9 bg-[#2A2D31] text-[#e8eaed] hover:bg-[#3A3D41] text-xs">
          {loading ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Filter className="h-4 w-4 mr-1" />}
          Terapkan
        </Button>
      </div>

      {/* Title */}
      <h3 className="text-sm font-bold text-[#9aa0a6] uppercase tracking-widest">
        Laporan Keuangan — {bulanLabel} {data.tahun}
      </h3>

      {isEmpty ? (
        <div className="p-8 rounded-xl bg-[#1A1D1F] border border-[#2A2D31] text-center text-[#5f6368] text-sm">
          Tidak ada transaksi di bulan ini.
        </div>
      ) : (
        <>
          {/* Two columns: Pemasukan & Pengeluaran */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* PEMASUKAN */}
            <div className="p-5 rounded-xl bg-[#1A1D1F] border border-green-500/20">
              <h4 className="text-xs font-bold text-green-400 uppercase tracking-widest mb-4">Pemasukan</h4>
              {data.pemasukan.length === 0 ? (
                <p className="text-sm text-[#5f6368]">Tidak ada pemasukan</p>
              ) : (
                <div className="space-y-2">
                  {data.pemasukan.map((p, i) => (
                    <div key={i} className="flex justify-between items-center">
                      <span className="text-sm text-[#e8eaed]">{p.kategori_nama}</span>
                      <span className="text-sm font-mono text-green-400">{idrFmt(p.total)}</span>
                    </div>
                  ))}
                  <div className="border-t border-[#2A2D31] pt-2 mt-2 flex justify-between items-center">
                    <span className="text-xs font-bold text-[#9aa0a6] uppercase">Total Pemasukan</span>
                    <span className="text-sm font-bold font-mono text-green-400">{idrFmt(data.total_pemasukan)}</span>
                  </div>
                </div>
              )}
            </div>

            {/* PENGELUARAN */}
            <div className="p-5 rounded-xl bg-[#1A1D1F] border border-red-500/20">
              <h4 className="text-xs font-bold text-red-400 uppercase tracking-widest mb-4">Pengeluaran</h4>
              {data.pengeluaran.length === 0 ? (
                <p className="text-sm text-[#5f6368]">Tidak ada pengeluaran</p>
              ) : (
                <div className="space-y-2">
                  {data.pengeluaran.map((p, i) => (
                    <div key={i} className="flex justify-between items-center">
                      <span className="text-sm text-[#e8eaed]">{p.label}</span>
                      <span className="text-sm font-mono text-red-400">{idrFmt(p.total)}</span>
                    </div>
                  ))}
                  <div className="border-t border-[#2A2D31] pt-2 mt-2 flex justify-between items-center">
                    <span className="text-xs font-bold text-[#9aa0a6] uppercase">Total Pengeluaran</span>
                    <span className="text-sm font-bold font-mono text-red-400">{idrFmt(data.total_pengeluaran)}</span>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* SALDO */}
          <div className={`p-5 rounded-xl border ${
            data.saldo >= 0
              ? 'bg-green-500/10 border-green-500/30'
              : 'bg-red-500/10 border-red-500/30'
          }`}>
            <div className="flex justify-between items-center">
              <span className="text-sm font-bold uppercase tracking-widest text-[#9aa0a6]">
                Saldo Bulan Ini
              </span>
              <span className={`text-lg font-bold font-mono ${
                data.saldo >= 0 ? 'text-green-400' : 'text-red-400'
              }`}>
                {data.saldo < 0 ? '-' : ''}{idrFmt(data.saldo)}
              </span>
            </div>
          </div>

          {/* Link ke Jurnal */}
          <div className="flex justify-end">
            <Link href="/app/keuangan/jurnal-umum">
              <Button variant="ghost" className="text-xs text-[#9aa0a6] hover:text-[#e8eaed]">
                <ExternalLink className="h-3.5 w-3.5 mr-1" />
                Lihat Jurnal
              </Button>
            </Link>
          </div>
        </>
      )}
    </div>
  );
}
