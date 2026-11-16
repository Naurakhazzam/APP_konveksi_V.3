'use client';

import React, { useState } from 'react';
import { ChevronDown, ChevronRight, Info } from 'lucide-react';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow
} from '@/components/ui/table';
import type { ProyeksiSurplusData } from '@/lib/actions/keuangan/proyeksi-surplus.actions';

const idr = (n: number) => 'Rp ' + Math.round(n).toLocaleString('id-ID');
const idrTanda = (n: number) => (n < 0 ? '− ' : '+ ') + idr(Math.abs(n));
const tglFmt = (d: string) =>
  new Date(`${d}T00:00:00`).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });

function Baris({ label, nilai, sub, tebal, warna, children }: {
  label: React.ReactNode; nilai: number; sub?: string; tebal?: boolean; warna?: string; children?: React.ReactNode;
}) {
  const [buka, setBuka] = useState(false);
  const bisaBuka = !!children;
  return (
    <div className="border-b border-[#2A2D31] last:border-0">
      <button type="button" disabled={!bisaBuka} onClick={() => setBuka(!buka)}
        className={`w-full flex items-start justify-between gap-4 py-3 text-left ${bisaBuka ? 'cursor-pointer' : 'cursor-default'}`}>
        <span className="flex items-start gap-1.5">
          {bisaBuka
            ? (buka ? <ChevronDown className="h-4 w-4 mt-0.5 text-[#9aa0a6]" /> : <ChevronRight className="h-4 w-4 mt-0.5 text-[#9aa0a6]" />)
            : <span className="w-4" />}
          <span>
            <span className={`text-sm ${tebal ? 'font-bold text-[#e8eaed]' : 'text-[#e8eaed]'}`}>{label}</span>
            {sub && <span className="block text-xs text-[#9aa0a6] mt-0.5">{sub}</span>}
          </span>
        </span>
        <span className={`text-sm font-mono whitespace-nowrap ${tebal ? 'font-bold' : ''} ${warna ?? 'text-[#e8eaed]'}`}>
          {idrTanda(nilai)}
        </span>
      </button>
      {buka && children && <div className="pl-10 pb-3 space-y-1">{children}</div>}
    </div>
  );
}

const Rinci = ({ label, nilai }: { label: string; nilai: number }) => (
  <div className="flex justify-between text-xs text-[#9aa0a6]">
    <span>{label}</span><span className="font-mono">{idr(nilai)}</span>
  </div>
);

export default function ProyeksiSurplusClient({ data }: { data: ProyeksiSurplusData }) {
  const totalMasuk = data.masuk.reduce((s, m) => s + m.nominal, 0);
  const totalKeluar = data.keluar.reduce((s, k) => s + k.nominal, 0);
  const surplus = data.totalNilaiJual - totalKeluar - data.totalBiayaTetap - data.upahBelumLunas - data.upahSisa;
  const sisaTagihan = data.totalNilaiJual - totalMasuk;
  const totalPcs = data.po.reduce((s, p) => s + p.pcs, 0);
  const plus = surplus >= 0;

  return (
    <div className="space-y-6 mt-4">

      {/* Hasil utama */}
      <div className={`p-5 rounded-xl border ${plus ? 'border-green-500/30 bg-green-500/5' : 'border-red-500/30 bg-red-500/5'}`}>
        <p className="text-[10px] uppercase tracking-widest text-[#9aa0a6] font-bold mb-1">
          Perkiraan {plus ? 'surplus' : 'minus'} bila semua hasil potong terkirim & dibayar
        </p>
        <p className={`text-2xl font-bold font-mono ${plus ? 'text-green-400' : 'text-red-400'}`}>{idrTanda(surplus)}</p>
        <p className="text-xs text-[#9aa0a6] mt-2">
          {totalPcs.toLocaleString('id-ID')} pcs hasil potong · uang dihitung sejak {tglFmt(data.sejak)}
          {data.stokTersisa > 0 && <> · masih ada stok bahan {idr(data.stokTersisa)} yang belum terpakai (tidak termasuk di angka ini)</>}
        </p>
      </div>

      {/* Rincian hitungan */}
      <div className="rounded-xl bg-[#1A1D1F] border border-[#2A2D31] px-4">
        <Baris label="Nilai jual semua hasil potong" nilai={data.totalNilaiJual}
          sub={`Sudah diterima ${idr(totalMasuk)} (DP, nanti dipotong dari tagihan) · sisa tagihan ${idr(sisaTagihan)}`}
          warna="text-green-400">
          {data.po.map(p => <Rinci key={p.po_id} label={`${p.no_po} — ${p.pcs} pcs`} nilai={p.nilai_jual} />)}
        </Baris>
        <Baris label="Uang sudah keluar (Buku Kas)" nilai={-totalKeluar} warna="text-red-400"
          sub={data.setoranModal > 0 ? `Termasuk pembelian dari setoran modal ${idr(data.setoranModal)} (sisa bahan lama)` : undefined}>
          {data.keluar.map(k => <Rinci key={k.kategori} label={k.kategori} nilai={k.nominal} />)}
        </Baris>
        {data.totalBiayaTetap > 0 && (
          <Baris label="Biaya tetap kontrak (sewa rumah)" nilai={-data.totalBiayaTetap} warna="text-red-400"
            sub={`Dibayar sebelum periode ini, dihitung per hari: ${tglFmt(data.biayaTetapDari)} – ${tglFmt(data.biayaTetapSampai)}`}>
            {data.biayaTetap.map(b => (
              <Rinci key={b.nama} label={`${b.nama} — ${b.hari} hari × ${idr(b.perHari)}`} nilai={b.nominal} />
            ))}
          </Baris>
        )}
        <Baris label="Upah sudah dikerjakan, belum dibayar" nilai={-data.upahBelumLunas} warna="text-red-400">
          {data.po.filter(p => p.upah_belum_lunas).map(p => <Rinci key={p.po_id} label={p.no_po} nilai={p.upah_belum_lunas} />)}
        </Baris>
        <Baris label="Perkiraan upah tahap yang belum dikerjakan" nilai={-data.upahSisa} warna="text-red-400"
          sub="Tarif upah di HPP × pcs hasil potong, untuk tahap yang belum selesai">
          {data.po.filter(p => p.upah_sisa).map(p => <Rinci key={p.po_id} label={p.no_po} nilai={p.upah_sisa} />)}
        </Baris>
        <div className="flex justify-between py-3">
          <span className="text-sm font-bold text-[#e8eaed] pl-5">= Perkiraan {plus ? 'surplus' : 'minus'}</span>
          <span className={`text-sm font-bold font-mono ${plus ? 'text-green-400' : 'text-red-400'}`}>{idrTanda(surplus)}</span>
        </div>
      </div>

      {data.stokTersisaRinci.length > 0 && (
        <div className="rounded-xl bg-[#1A1D1F] border border-[#2A2D31] p-4">
          <p className="text-xs font-bold text-[#e8eaed] mb-2">Stok bahan yang sudah dibeli tapi belum terpakai — {idr(data.stokTersisa)}</p>
          <div className="space-y-1">
            {data.stokTersisaRinci.map(s => (
              <Rinci key={s.nama}
                label={`${s.nama} — ${s.qty.toLocaleString('id-ID', { maximumFractionDigits: 2 })} ${s.satuan}`}
                nilai={s.nilai} />
            ))}
          </div>
          <p className="text-[11px] text-[#5f6368] mt-2">Uangnya sudah keluar, tapi barangnya masih ada dan bisa dipakai PO berikutnya.</p>
        </div>
      )}

      {/* Per PO */}
      <div>
        <h2 className="text-base font-bold text-[#e8eaed] mb-1">Per PO</h2>
        <p className="text-xs text-[#9aa0a6] mb-3">
          Kain & aksesori = yang benar-benar terpakai. Overhead, bahan pembantu, lainnya (Buku Kas) & sewa rumah dibagi menurut jumlah pcs.
          Totalnya bisa beda sedikit dari angka di atas karena di atas memakai uang yang keluar (termasuk bahan yang belum terpakai).
        </p>
        <div className="rounded-xl border border-[#2A2D31] overflow-x-auto bg-[#1A1D1F]">
          <Table>
            <TableHeader className="bg-[#1A1C1E]">
              <TableRow className="border-[#2A2D31] hover:bg-transparent">
                <TableHead className="text-[#9aa0a6]">PO</TableHead>
                <TableHead className="text-[#9aa0a6] text-right">Pcs potong</TableHead>
                <TableHead className="text-[#9aa0a6] text-right">Nilai jual</TableHead>
                <TableHead className="text-[#9aa0a6] text-right">Kain & aksesori</TableHead>
                <TableHead className="text-[#9aa0a6] text-right">Upah (tercatat + perkiraan)</TableHead>
                <TableHead className="text-[#9aa0a6] text-right">Overhead & pembantu</TableHead>
                <TableHead className="text-[#9aa0a6] text-right">Surplus</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.po.length === 0 ? (
                <TableRow className="border-[#2A2D31] hover:bg-transparent">
                  <TableCell colSpan={7} className="h-24 text-center text-[#5f6368]">Belum ada hasil potong</TableCell>
                </TableRow>
              ) : data.po.map(p => {
                const upah = p.upah_lunas + p.upah_belum_lunas + p.upah_sisa;
                return (
                  <TableRow key={p.po_id} className="border-[#2A2D31] hover:bg-[#16181A]">
                    <TableCell className="text-sm text-[#e8eaed] font-mono whitespace-nowrap">{p.no_po}</TableCell>
                    <TableCell className="text-sm text-[#9aa0a6] text-right">{p.pcs.toLocaleString('id-ID')}</TableCell>
                    <TableCell className="text-sm text-[#e8eaed] text-right whitespace-nowrap">{idr(p.nilai_jual)}</TableCell>
                    <TableCell className="text-sm text-[#9aa0a6] text-right whitespace-nowrap">{idr(p.kain + p.aksesori)}</TableCell>
                    <TableCell className="text-sm text-[#9aa0a6] text-right whitespace-nowrap"
                      title={`Dibayar ${idr(p.upah_lunas)} · belum dibayar ${idr(p.upah_belum_lunas)} · perkiraan sisa ${idr(p.upah_sisa)}`}>
                      {idr(upah)}
                    </TableCell>
                    <TableCell className="text-sm text-[#9aa0a6] text-right whitespace-nowrap">{idr(p.alokasi)}</TableCell>
                    <TableCell className={`text-sm font-semibold text-right whitespace-nowrap ${p.surplus >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {idrTanda(p.surplus)}
                      {p.nilai_jual > 0 && (
                        <span className="block text-[10px] text-[#9aa0a6] font-normal">
                          {Math.round((p.surplus / p.nilai_jual) * 100)}% dari nilai jual
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </div>

      <div className="flex items-start gap-2 text-xs text-[#9aa0a6]">
        <Info className="h-4 w-4 shrink-0 mt-0.5" />
        <p>
          Reject belum dikurangi — semua pcs hasil potong dianggap terkirim. Setoran modal (mis. sisa bahan lama yang
          &ldquo;dibeli&rdquo; lewat Stok Masuk) tidak dihitung sebagai uang masuk, tapi pembeliannya tetap dihitung sebagai uang keluar.
          Kontrak (sewa rumah) dihitung per hari untuk bulan berjalan, walau uangnya dibayar di muka.
        </p>
      </div>
    </div>
  );
}
