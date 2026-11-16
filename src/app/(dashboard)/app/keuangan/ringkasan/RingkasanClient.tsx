'use client';

import React, { useState, useTransition } from 'react';
import Link from 'next/link';
import { ChevronLeft, ChevronRight, Loader2, AlertTriangle, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid,
} from 'recharts';
import { getRingkasanKeuangan, type RingkasanKeuanganData } from '@/lib/actions/keuangan/ringkasan.actions';

const idr = (n: number) => 'Rp ' + Math.round(n).toLocaleString('id-ID');
const akt = (n: number) => (Math.round(n) < 0 ? `(${idr(-n)})` : idr(n));
const pct = (a: number, b: number) => (b > 0 ? `${((a / b) * 100).toLocaleString('id-ID', { maximumFractionDigits: 1 })}%` : '–');
const blnFmt = (ym: string) => new Date(`${ym}-01T00:00:00`).toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });
const blnPendek = (ym: string) => new Date(`${ym}-01T00:00:00`).toLocaleDateString('id-ID', { month: 'short' });
const warna = (n: number) => (n >= 0 ? 'text-green-400' : 'text-red-400');

function Kartu({ judul, nilai, ket, kelas }: { judul: string; nilai: string; ket?: React.ReactNode; kelas?: string }) {
  return (
    <div className="p-4 rounded-xl bg-[#1A1D1F] border border-[#2A2D31]">
      <p className="text-[10px] uppercase tracking-widest text-[#9aa0a6] font-bold mb-1">{judul}</p>
      <p className={`text-lg font-bold font-mono ${kelas ?? 'text-[#e8eaed]'}`}>{nilai}</p>
      {ket && <p className="text-[11px] text-[#9aa0a6] mt-1">{ket}</p>}
    </div>
  );
}

export default function RingkasanClient({ initialData }: { initialData: RingkasanKeuanganData }) {
  const [data, setData] = useState(initialData);
  const [memuat, mulai] = useTransition();
  const k = data.kinerja;
  const bulanList = k.bulanTersedia;
  const idx = bulanList.indexOf(k.periode);

  const ke = (bulan: string) => mulai(async () => {
    try { setData(await getRingkasanKeuangan(bulan)); }
    catch (e) { toast.error((e as Error)?.message || 'Gagal memuat data'); }
  });

  const a = k.lr.aktual;
  const ob = k.orderBerjalan;
  const tren = k.lrPerBulan.slice(-6).map(b => ({
    bulan: blnPendek(b.bulan), Pendapatan: b.pendapatan, HPP: b.hpp, 'Laba bersih': b.labaBersih,
  }));

  return (
    <div className="space-y-6">
      {/* Navigasi bulan */}
      <div className="flex items-center justify-between">
        <Button variant="ghost" onClick={() => ke(bulanList[idx - 1])} disabled={memuat || idx <= 0}
          className="text-[#9aa0a6] hover:text-[#e8eaed] text-xs">
          <ChevronLeft className="h-4 w-4 mr-1" />Bulan lalu
        </Button>
        <div className="flex items-center gap-3">
          {memuat && <Loader2 className="h-4 w-4 animate-spin text-[#e5c17b]" />}
          <h3 className="text-sm font-bold text-[#e8eaed]">{blnFmt(k.periode)}</h3>
        </div>
        <Button variant="ghost" onClick={() => ke(bulanList[idx + 1])} disabled={memuat || idx >= bulanList.length - 1}
          className="text-[#9aa0a6] hover:text-[#e8eaed] text-xs">
          Bulan berikutnya<ChevronRight className="h-4 w-4 ml-1" />
        </Button>
      </div>

      {/* Kinerja bulan ini (aktual) */}
      <div>
        <p className="text-xs font-bold text-[#9aa0a6] uppercase tracking-widest mb-2">Kinerja bulan ini — barang yang sudah dikirim</p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Kartu judul="Pendapatan" nilai={idr(a.pendapatan)} kelas="text-green-400" ket="Nilai Surat Jalan + pendapatan lain" />
          <Kartu judul="HPP" nilai={idr(a.hpp)} ket="Bahan + upah + overhead barang terkirim" />
          <Kartu judul="Laba kotor" nilai={akt(a.labaKotor)} kelas={warna(a.labaKotor)} ket={`Margin ${pct(a.labaKotor, a.pendapatan)}`} />
          <Kartu judul="Laba bersih" nilai={akt(a.labaBersih)} kelas={warna(a.labaBersih)} ket={`Margin ${pct(a.labaBersih, a.pendapatan)}`} />
        </div>
      </div>

      {/* Order berjalan & posisi */}
      <div>
        <p className="text-xs font-bold text-[#9aa0a6] uppercase tracking-widest mb-2">Posisi hari ini</p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Kartu judul="Order berjalan" nilai={idr(ob.pendapatan)}
            ket={<>Perkiraan laba <span className={warna(ob.labaKotor)}>{akt(ob.labaKotor)}</span> ({pct(ob.labaKotor, ob.pendapatan)})</>} />
          {k.posisi.uangMukaPelanggan > 0
            ? <Kartu judul="Uang muka pelanggan" nilai={idr(k.posisi.uangMukaPelanggan)} kelas="text-sky-300" ket="DP untuk barang yang belum dikirim" />
            : <Kartu judul="Piutang usaha" nilai={idr(k.posisi.piutang)} kelas="text-amber-300" ket="Sudah dikirim, belum dibayar" />}
          <Kartu judul="Upah terutang" nilai={idr(k.posisi.upahTerutang)} kelas="text-orange-400" ket="Sudah dikerjakan, belum dibayar" />
          <Kartu judul="Persediaan bahan" nilai={idr(k.posisi.persediaanBahan)} ket="Bahan dibeli, belum dipotong" />
        </div>
      </div>

      {/* Tren */}
      <div className="p-5 rounded-xl bg-[#1A1D1F] border border-[#2A2D31]">
        <h4 className="text-xs font-bold text-[#9aa0a6] uppercase tracking-widest mb-4">Tren per bulan (aktual)</h4>
        {tren.length === 0 ? <p className="text-sm text-[#5f6368]">Belum ada data</p> : (
          <div className="w-full h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={tren} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
                <CartesianGrid stroke="#2A2D31" vertical={false} />
                <XAxis dataKey="bulan" tick={{ fill: '#9aa0a6', fontSize: 12 }} axisLine={{ stroke: '#2A2D31' }} tickLine={false} />
                <YAxis tickFormatter={(v: number) => `${(v / 1_000_000).toFixed(1)}jt`} tick={{ fill: '#9aa0a6', fontSize: 11 }}
                  axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ backgroundColor: '#16181A', border: '1px solid #2A2D31', borderRadius: 8, color: '#e8eaed', fontSize: 12 }}
                  formatter={v => akt(Number(v ?? 0))} labelStyle={{ color: '#9aa0a6' }} />
                <Legend wrapperStyle={{ fontSize: 12, color: '#9aa0a6' }} />
                <Bar dataKey="Pendapatan" fill="#4ade80" radius={[4, 4, 0, 0]} maxBarSize={36} />
                <Bar dataKey="HPP" fill="#e5c17b" radius={[4, 4, 0, 0]} maxBarSize={36} />
                <Line dataKey="Laba bersih" stroke="#60a5fa" strokeWidth={2} dot={{ r: 3 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* PO melebihi patokan HPP */}
      {data.po_melebihi_patokan.length > 0 && (
        <div className="p-5 rounded-xl bg-[#1A1D1F] border border-amber-500/20">
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-400" />
              <h4 className="text-xs font-bold text-amber-400 uppercase tracking-widest">PO melebihi patokan HPP</h4>
            </div>
            <Link href="/app/keuangan/laporan-po">
              <Button variant="ghost" className="h-7 text-xs text-[#9aa0a6] hover:text-[#e8eaed]">
                <ExternalLink className="h-3 w-3 mr-1" />Lihat semua
              </Button>
            </Link>
          </div>
          <p className="text-[11px] text-[#9aa0a6] mb-3">Biaya bahan + upah aktual lebih besar dari patokan di sheet HPP. Bukan berarti rugi — cek laba PO di Kinerja Keuangan.</p>
          <div className="space-y-2">
            {data.po_melebihi_patokan.map(po => (
              <div key={po.po_id} className="flex items-center justify-between p-2.5 rounded-lg bg-amber-500/5 border border-amber-500/10">
                <div className="flex items-center gap-3">
                  <span className="font-mono text-sm text-[#e5c17b] font-bold">{po.no_po}</span>
                  <span className="text-sm text-[#9aa0a6]">{po.klien_nama}</span>
                </div>
                <span className="text-sm font-mono text-amber-300 font-semibold">+{idr(po.gap)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tautan cepat */}
      <div className="flex flex-wrap gap-2">
        {[
          { label: 'Kinerja Keuangan', href: '/app/keuangan/proyeksi-surplus' },
          { label: 'Laporan Per PO', href: '/app/keuangan/laporan-po' },
          { label: 'Laporan Gaji', href: '/app/keuangan/laporan-gaji' },
          { label: 'Laporan Koreksi QTY', href: '/app/keuangan/laporan-reject' },
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
