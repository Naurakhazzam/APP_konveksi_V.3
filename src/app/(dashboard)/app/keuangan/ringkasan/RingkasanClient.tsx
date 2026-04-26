'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import {
  TrendingUp, TrendingDown, ChevronLeft, ChevronRight, Loader2,
  AlertTriangle, ExternalLink,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import {
  getRingkasanKeuangan,
  type RingkasanKeuanganData,
} from '@/lib/actions/keuangan/ringkasan.actions';

const BULAN_FULL = [
  'Januari','Februari','Maret','April','Mei','Juni',
  'Juli','Agustus','September','Oktober','November','Desember'
];

const idrFmt = (n: number) =>
  'Rp ' + Math.abs(n).toLocaleString('id-ID', { minimumFractionDigits: 0 });

interface Props {
  initialData: RingkasanKeuanganData;
}

export default function RingkasanClient({ initialData }: Props) {
  const now = new Date();
  const [data, setData] = useState<RingkasanKeuanganData>(initialData);
  const [monthOffset, setMonthOffset] = useState(0);
  const [loading, setLoading] = useState(false);

  // Derive current month/year from offset
  const viewDate = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1);
  const viewBulan = viewDate.getMonth() + 1;
  const viewTahun = viewDate.getFullYear();
  const viewLabel = `${BULAN_FULL[viewBulan - 1]} ${viewTahun}`;

  const navigate = async (offset: number) => {
    const newOffset = monthOffset + offset;
    setMonthOffset(newOffset);
    setLoading(true);
    try {
      const d = new Date(now.getFullYear(), now.getMonth() + newOffset, 1);
      const result = await getRingkasanKeuangan(d.getMonth() + 1, d.getFullYear());
      setData(result);
    } catch (e: any) {
      toast.error(e.message || 'Gagal memuat data');
    } finally {
      setLoading(false);
    }
  };

  const bd = data.bulan_berjalan;
  const totalPengeluaran = bd.total_pengeluaran || 1; // avoid divide by 0

  // Breakdown percentages
  const breakdownItems = [
    { label: 'Bahan Baku', value: bd.breakdown_pengeluaran.direct_bahan, color: 'bg-[#e5c17b]', textColor: 'text-[#e5c17b]' },
    { label: 'Upah', value: bd.breakdown_pengeluaran.direct_upah, color: 'bg-blue-400', textColor: 'text-blue-400' },
    { label: 'Overhead', value: bd.breakdown_pengeluaran.overhead, color: 'bg-[#6b7280]', textColor: 'text-[#6b7280]' },
  ];

  return (
    <div className="space-y-6">

      {/* Month navigation */}
      <div className="flex items-center justify-between">
        <Button
          variant="ghost"
          onClick={() => navigate(-1)}
          disabled={loading}
          className="text-[#9aa0a6] hover:text-[#e8eaed] text-xs"
        >
          <ChevronLeft className="h-4 w-4 mr-1" />
          Bulan Lalu
        </Button>
        <div className="flex items-center gap-2">
          {loading && <Loader2 className="h-4 w-4 animate-spin text-[#e5c17b]" />}
          <h3 className="text-sm font-bold text-[#e8eaed]">{viewLabel}</h3>
        </div>
        <Button
          variant="ghost"
          onClick={() => navigate(1)}
          disabled={loading || monthOffset >= 0}
          className="text-[#9aa0a6] hover:text-[#e8eaed] text-xs"
        >
          Bulan Ini
          <ChevronRight className="h-4 w-4 ml-1" />
        </Button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="p-4 rounded-xl bg-[#1A1D1F] border border-green-500/20">
          <p className="text-[10px] uppercase tracking-widest text-[#9aa0a6] font-bold mb-1">Total Pemasukan</p>
          <p className="text-lg font-bold font-mono text-green-400">{idrFmt(bd.total_pemasukan)}</p>
        </div>
        <div className="p-4 rounded-xl bg-[#1A1D1F] border border-red-500/20">
          <p className="text-[10px] uppercase tracking-widest text-[#9aa0a6] font-bold mb-1">Total Pengeluaran</p>
          <p className="text-lg font-bold font-mono text-red-400">{idrFmt(bd.total_pengeluaran)}</p>
        </div>
        <div className={`p-4 rounded-xl border ${
          bd.saldo >= 0
            ? 'bg-green-500/10 border-green-500/30'
            : 'bg-red-500/10 border-red-500/30'
        }`}>
          <div className="flex items-center justify-between">
            <p className="text-[10px] uppercase tracking-widest text-[#9aa0a6] font-bold mb-1">Saldo Bulan Ini</p>
            {bd.saldo >= 0
              ? <TrendingUp className="h-4 w-4 text-green-400" />
              : <TrendingDown className="h-4 w-4 text-red-400" />
            }
          </div>
          <p className={`text-lg font-bold font-mono ${bd.saldo >= 0 ? 'text-green-400' : 'text-red-400'}`}>
            {bd.saldo < 0 ? '-' : ''}{idrFmt(bd.saldo)}
          </p>
        </div>
        <div className="p-4 rounded-xl bg-[#1A1D1F] border border-orange-500/20">
          <p className="text-[10px] uppercase tracking-widest text-[#9aa0a6] font-bold mb-1">Upah Outstanding</p>
          <p className="text-lg font-bold font-mono text-orange-400">{idrFmt(data.upah_outstanding)}</p>
        </div>
      </div>

      {/* Breakdown Pengeluaran */}
      <div className="p-5 rounded-xl bg-[#1A1D1F] border border-[#2A2D31]">
        <h4 className="text-xs font-bold text-[#9aa0a6] uppercase tracking-widest mb-4">Breakdown Pengeluaran</h4>
        {bd.total_pengeluaran === 0 ? (
          <p className="text-sm text-[#5f6368]">Tidak ada pengeluaran di bulan ini</p>
        ) : (
          <div className="space-y-3">
            {breakdownItems.map(item => {
              const pct = Math.round((item.value / totalPengeluaran) * 100);
              return (
                <div key={item.label}>
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-sm text-[#e8eaed]">{item.label}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-mono text-[#e8eaed]">{idrFmt(item.value)}</span>
                      <span className={`text-xs font-bold ${item.textColor}`}>({pct}%)</span>
                    </div>
                  </div>
                  <div className="w-full h-2 rounded-full bg-[#2A2D31]">
                    <div className={`h-2 rounded-full ${item.color} transition-all`} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Tren 6 Bulan Chart */}
      <div className="p-5 rounded-xl bg-[#1A1D1F] border border-[#2A2D31]">
        <h4 className="text-xs font-bold text-[#9aa0a6] uppercase tracking-widest mb-4">Tren Pengeluaran 6 Bulan</h4>
        <div className="w-full h-[300px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data.tren_6_bulan} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
              <XAxis
                dataKey="bulan_label"
                tick={{ fill: '#9aa0a6', fontSize: 12 }}
                axisLine={{ stroke: '#2A2D31' }}
                tickLine={false}
              />
              <YAxis
                tickFormatter={(v: number) => `${(v / 1000000).toFixed(1)}jt`}
                tick={{ fill: '#9aa0a6', fontSize: 11 }}
                axisLine={{ stroke: '#2A2D31' }}
                tickLine={false}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#16181A',
                  border: '1px solid #2A2D31',
                  borderRadius: 8,
                  color: '#e8eaed',
                  fontSize: 12,
                }}
                formatter={(v) => idrFmt(Number(v ?? 0))}
                labelStyle={{ color: '#9aa0a6' }}
              />
              <Legend
                wrapperStyle={{ fontSize: 12, color: '#9aa0a6' }}
              />
              <Bar dataKey="direct_bahan" name="Bahan" fill="#e5c17b" radius={[4, 4, 0, 0]} />
              <Bar dataKey="direct_upah" name="Upah" fill="#60a5fa" radius={[4, 4, 0, 0]} />
              <Bar dataKey="overhead" name="Overhead" fill="#6b7280" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* PO Boncos */}
      {data.po_boncos.length > 0 && (
        <div className="p-5 rounded-xl bg-[#1A1D1F] border border-red-500/20">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-red-400" />
              <h4 className="text-xs font-bold text-red-400 uppercase tracking-widest">PO Perlu Perhatian</h4>
            </div>
            <Link href="/app/keuangan/laporan-po">
              <Button variant="ghost" className="h-7 text-xs text-[#9aa0a6] hover:text-[#e8eaed]">
                <ExternalLink className="h-3 w-3 mr-1" />
                Lihat Semua
              </Button>
            </Link>
          </div>
          <div className="space-y-2">
            {data.po_boncos.map(po => (
              <div key={po.po_id} className="flex items-center justify-between p-2.5 rounded-lg bg-red-500/5 border border-red-500/10">
                <div className="flex items-center gap-3">
                  <span className="font-mono text-sm text-[#e5c17b] font-bold">{po.no_po}</span>
                  <span className="text-sm text-[#9aa0a6]">{po.klien_nama}</span>
                </div>
                <span className="text-sm font-mono text-red-400 font-semibold">+{idrFmt(po.gap)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Quick links */}
      <div className="flex flex-wrap gap-2">
        {[
          { label: 'Laporan Per Bulan', href: '/app/keuangan/laporan-bulan' },
          { label: 'Laporan Gaji', href: '/app/keuangan/laporan-gaji' },
          { label: 'Laporan Per PO', href: '/app/keuangan/laporan-po' },
          { label: 'Laporan Reject', href: '/app/keuangan/laporan-reject' },
          { label: 'Jurnal Produksi', href: '/app/keuangan/jurnal-produksi' },
        ].map(link => (
          <Link key={link.href} href={link.href}>
            <Button variant="outline" className="h-8 text-xs border-[#2A2D31] bg-transparent text-[#9aa0a6] hover:text-[#e8eaed] hover:bg-[#1E2124]">
              {link.label}
            </Button>
          </Link>
        ))}
      </div>

    </div>
  );
}
