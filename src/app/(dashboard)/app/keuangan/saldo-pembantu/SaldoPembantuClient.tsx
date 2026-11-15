'use client';

import React, { useState } from 'react';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import type { SaldoPembantuData } from '@/lib/actions/keuangan/saldo-pembantu.actions';

const BULAN = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];

const idr = (n: number) => 'Rp ' + Math.round(Math.abs(n)).toLocaleString('id-ID');
const tgl = (d: string) =>
  new Date(d).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
const bulanLabel = (ym: string) => `${BULAN[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;

type Tab = 'saldo' | 'penghematan' | 'riwayat';

export default function SaldoPembantuClient({ data }: { data: SaldoPembantuData }) {
  const [tab, setTab] = useState<Tab>('saldo');
  const [filterJenis, setFilterJenis] = useState('');

  const hasilBersih = data.total_penghematan - data.total_saldo;
  const jenisHemat = data.jenis.filter(j => j.penghematan > 0);
  const mutasi = filterJenis ? data.mutasi.filter(m => m.jenis_id === filterJenis) : data.mutasi;

  const tabCls = (t: Tab) =>
    `px-4 h-9 rounded-lg text-xs font-bold transition-colors ${
      tab === t ? 'bg-[#e5c17b] text-[#16181A]' : 'bg-[#1E2124] text-[#9aa0a6] hover:text-[#e8eaed]'
    }`;

  return (
    <div className="space-y-6">
      {/* ─── KESIMPULAN ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kartu judul="Total Belanja" nilai={idr(data.total_beli)} warna="text-[#e8eaed]" ket="dari Buku Kas" />
        <Kartu judul="Total Jatah HPP" nilai={idr(data.total_jatah)} warna="text-[#e8eaed]" ket="tarif HPP × pcs selesai jahit" />
        <Kartu judul="Saldo Belum Terpakai" nilai={idr(data.total_saldo)} warna="text-orange-300"
          ket="belanja yang belum habis oleh jatah (barang di rak / boros)" />
        <Kartu judul="Total Penghematan" nilai={idr(data.total_penghematan)} warna="text-green-400"
          ket="jatah yang tidak perlu dibelanjakan" />
      </div>

      <div className="p-4 rounded-xl bg-[#1A1D1F] border border-[#2A2D31] flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[10px] uppercase tracking-widest text-[#9aa0a6] font-bold">Hasil Bersih</p>
          <p className="text-[11px] text-[#5f6368] mt-0.5">
            Penghematan − saldo belum terpakai = jatah HPP − belanja. Angka paling hati-hati: sebagian saldo
            bisa jadi masih berupa barang di rak.
          </p>
        </div>
        <p className={`text-xl font-bold ${hasilBersih >= 0 ? 'text-green-400' : 'text-red-400'}`}>
          {hasilBersih >= 0 ? 'Hemat ' : 'Boros '}{idr(hasilBersih)}
        </p>
      </div>

      <div className="flex gap-2">
        <button className={tabCls('saldo')} onClick={() => setTab('saldo')}>Saldo per Jenis</button>
        <button className={tabCls('penghematan')} onClick={() => setTab('penghematan')}>Penghematan</button>
        <button className={tabCls('riwayat')} onClick={() => setTab('riwayat')}>Riwayat</button>
      </div>

      {/* ─── SALDO PER JENIS ────────────────────────────────────────── */}
      {tab === 'saldo' && (
        <div className="rounded-xl border border-[#2A2D31] overflow-hidden bg-[#16181A]">
          <Table>
            <TableHeader className="bg-[#1A1C1E]">
              <TableRow className="border-[#2A2D31] hover:bg-transparent">
                <TableHead className="text-[#9aa0a6]">Jenis Bahan</TableHead>
                <TableHead className="text-[#9aa0a6] text-right">Pcs Dijahit</TableHead>
                <TableHead className="text-[#9aa0a6] text-right">Belanja</TableHead>
                <TableHead className="text-[#9aa0a6] text-right">Jatah HPP</TableHead>
                <TableHead className="text-[#9aa0a6] text-right">Saldo</TableHead>
                <TableHead className="text-[#9aa0a6] text-right">Penghematan</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.jenis.map(j => (
                <TableRow key={j.id} className="border-[#2A2D31] hover:bg-[#1A1C1E]">
                  <TableCell className="text-sm text-[#e8eaed]">
                    {j.nama}
                    {j.tanpa_barang && <span className="ml-2 text-[10px] text-[#5f6368]">(tanpa belanja)</span>}
                  </TableCell>
                  <TableCell className="text-sm text-right text-[#9aa0a6]">{j.pcs.toLocaleString('id-ID')}</TableCell>
                  <TableCell className="text-sm text-right text-[#e8eaed]">{j.tanpa_barang ? '-' : idr(j.total_beli)}</TableCell>
                  <TableCell className="text-sm text-right text-[#e8eaed]">{idr(j.total_jatah)}</TableCell>
                  <TableCell className={`text-sm text-right font-bold ${j.saldo > 0 ? 'text-orange-300' : 'text-[#5f6368]'}`}>
                    {j.tanpa_barang ? '-' : idr(j.saldo)}
                  </TableCell>
                  <TableCell className={`text-sm text-right font-bold ${j.penghematan > 0 ? 'text-green-400' : 'text-[#5f6368]'}`}>
                    {idr(j.penghematan)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p className="px-4 py-3 text-[11px] text-[#5f6368] border-t border-[#2A2D31]">
            Saldo tidak pernah minus. Saldo 0 bukan berarti barang habis — keputusan belanja tetap berdasarkan cek fisik di rak.
          </p>
        </div>
      )}

      {/* ─── PENGHEMATAN PER BULAN ──────────────────────────────────── */}
      {tab === 'penghematan' && (
        <div className="rounded-xl border border-[#2A2D31] overflow-x-auto bg-[#16181A]">
          <Table>
            <TableHeader className="bg-[#1A1C1E]">
              <TableRow className="border-[#2A2D31] hover:bg-transparent">
                <TableHead className="text-[#9aa0a6]">Bulan</TableHead>
                {jenisHemat.map(j => (
                  <TableHead key={j.id} className="text-[#9aa0a6] text-right whitespace-nowrap">{j.nama}</TableHead>
                ))}
                <TableHead className="text-[#9aa0a6] text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.penghematan_bulanan.length === 0 ? (
                <TableRow className="hover:bg-transparent border-[#2A2D31]">
                  <TableCell colSpan={jenisHemat.length + 2} className="h-24 text-center text-[#5f6368]">
                    Belum ada penghematan
                  </TableCell>
                </TableRow>
              ) : (
                <>
                  {data.penghematan_bulanan.map(b => (
                    <TableRow key={b.bulan} className="border-[#2A2D31] hover:bg-[#1A1C1E]">
                      <TableCell className="text-sm text-[#e8eaed] whitespace-nowrap">{bulanLabel(b.bulan)}</TableCell>
                      {jenisHemat.map(j => (
                        <TableCell key={j.id} className="text-sm text-right text-[#9aa0a6]">
                          {b.per_jenis[j.id] ? idr(b.per_jenis[j.id]) : '-'}
                        </TableCell>
                      ))}
                      <TableCell className="text-sm text-right font-bold text-green-400">{idr(b.total)}</TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="border-[#2A2D31] bg-[#1A1C1E] hover:bg-[#1A1C1E]">
                    <TableCell className="text-sm font-bold text-[#e8eaed]">Total</TableCell>
                    {jenisHemat.map(j => (
                      <TableCell key={j.id} className="text-sm text-right font-bold text-[#e8eaed]">{idr(j.penghematan)}</TableCell>
                    ))}
                    <TableCell className="text-sm text-right font-bold text-green-400">{idr(data.total_penghematan)}</TableCell>
                  </TableRow>
                </>
              )}
            </TableBody>
          </Table>
        </div>
      )}

      {/* ─── RIWAYAT MUTASI ─────────────────────────────────────────── */}
      {tab === 'riwayat' && (
        <div className="space-y-3">
          <select
            className="h-9 px-3 rounded-lg bg-[#1E2124] border border-[#2A2D31] text-sm text-[#e8eaed] outline-none"
            value={filterJenis}
            onChange={e => setFilterJenis(e.target.value)}
          >
            <option value="">Semua jenis</option>
            {data.jenis.map(j => <option key={j.id} value={j.id}>{j.nama}</option>)}
          </select>
          <div className="rounded-xl border border-[#2A2D31] overflow-hidden bg-[#16181A]">
            <Table>
              <TableHeader className="bg-[#1A1C1E]">
                <TableRow className="border-[#2A2D31] hover:bg-transparent">
                  <TableHead className="text-[#9aa0a6]">Tanggal</TableHead>
                  <TableHead className="text-[#9aa0a6]">Jenis</TableHead>
                  <TableHead className="text-[#9aa0a6]">Mutasi</TableHead>
                  <TableHead className="text-[#9aa0a6] text-right">Nominal</TableHead>
                  <TableHead className="text-[#9aa0a6] text-right">Ke Penghematan</TableHead>
                  <TableHead className="text-[#9aa0a6] text-right">Saldo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {mutasi.length === 0 ? (
                  <TableRow className="hover:bg-transparent border-[#2A2D31]">
                    <TableCell colSpan={6} className="h-24 text-center text-[#5f6368]">Belum ada mutasi</TableCell>
                  </TableRow>
                ) : mutasi.map((m, i) => (
                  <TableRow key={i} className="border-[#2A2D31] hover:bg-[#1A1C1E]">
                    <TableCell className="text-sm text-[#e8eaed] whitespace-nowrap">{tgl(m.tanggal)}</TableCell>
                    <TableCell className="text-sm text-[#9aa0a6]">{m.jenis}</TableCell>
                    <TableCell className="text-sm">
                      {m.tipe === 'beli'
                        ? <span className="text-orange-300">Belanja</span>
                        : <span className="text-[#9aa0a6]">Jatah {m.pcs?.toLocaleString('id-ID')} pcs</span>}
                    </TableCell>
                    <TableCell className="text-sm text-right text-[#e8eaed]">{idr(m.nominal)}</TableCell>
                    <TableCell className="text-sm text-right text-green-400">{m.ke_hemat > 0 ? idr(m.ke_hemat) : '-'}</TableCell>
                    <TableCell className="text-sm text-right text-[#e8eaed]">{idr(m.saldo)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
    </div>
  );
}

function Kartu({ judul, nilai, warna, ket }: { judul: string; nilai: string; warna: string; ket: string }) {
  return (
    <div className="p-4 rounded-xl bg-[#1A1D1F] border border-[#2A2D31]">
      <p className="text-[10px] uppercase tracking-widest text-[#9aa0a6] font-bold">{judul}</p>
      <p className={`text-sm font-bold mt-1 ${warna}`}>{nilai}</p>
      <p className="text-[10px] text-[#5f6368] mt-1">{ket}</p>
    </div>
  );
}
