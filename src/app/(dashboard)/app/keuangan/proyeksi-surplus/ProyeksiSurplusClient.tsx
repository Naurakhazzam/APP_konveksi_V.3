'use client';

import React, { useState } from 'react';
import { ChevronDown, ChevronRight, Info } from 'lucide-react';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow
} from '@/components/ui/table';
import type { ProyeksiPO, ProyeksiSurplusData, StatusPO } from '@/lib/actions/keuangan/proyeksi-surplus.actions';
import PoDetailDialog, { type PoDipilih } from './PoDetailDialog';

const idr = (n: number) => 'Rp ' + Math.round(n).toLocaleString('id-ID');
const idrTanda = (n: number) => (n < 0 ? '− ' : '+ ') + idr(Math.abs(n));
const tglFmt = (d: string) =>
  new Date(`${d}T00:00:00`).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
const blnFmt = (ym: string) =>
  new Date(`${ym}-01T00:00:00`).toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });
const warnaAngka = (n: number) => (n >= 0 ? 'text-green-400' : 'text-red-400');

const STATUS_LABEL: Record<StatusPO, { label: string; kelas: string }> = {
  produksi:       { label: 'Produksi',          kelas: 'bg-amber-500/10 text-amber-300 border-amber-500/30' },
  kirim_sebagian: { label: 'Terkirim sebagian', kelas: 'bg-sky-500/10 text-sky-300 border-sky-500/30' },
  terkirim:       { label: 'Terkirim semua',    kelas: 'bg-green-500/10 text-green-300 border-green-500/30' },
};

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

const Rinci = ({ label, nilai, onKlik }: { label: React.ReactNode; nilai: number; onKlik?: () => void }) => (
  <div className="flex justify-between text-xs text-[#9aa0a6]">
    {onKlik
      ? <button type="button" onClick={onKlik} className="text-left hover:text-[#e8eaed] hover:underline underline-offset-2 cursor-pointer">{label}</button>
      : <span>{label}</span>}
    <span className="font-mono">{idr(nilai)}</span>
  </div>
);

function Kartu({ huruf, judul, nilai, ket, utama }: {
  huruf: string; judul: string; nilai: number; ket: string; utama?: boolean;
}) {
  const plus = nilai >= 0;
  return (
    <div className={`p-4 rounded-xl border ${utama
      ? (plus ? 'border-green-500/30 bg-green-500/5' : 'border-red-500/30 bg-red-500/5')
      : 'border-[#2A2D31] bg-[#1A1D1F]'}`}>
      <p className="text-[10px] uppercase tracking-widest text-[#9aa0a6] font-bold mb-1">{huruf}. {judul}</p>
      <p className={`text-xl font-bold font-mono ${warnaAngka(nilai)}`}>{idrTanda(nilai)}</p>
      <p className="text-xs text-[#9aa0a6] mt-1.5">{ket}</p>
    </div>
  );
}

const Judul = ({ children, sub }: { children: React.ReactNode; sub?: string }) => (
  <div className="mb-2">
    <h2 className="text-base font-bold text-[#e8eaed]">{children}</h2>
    {sub && <p className="text-xs text-[#9aa0a6] mt-0.5">{sub}</p>}
  </div>
);

export default function ProyeksiSurplusClient({ data }: { data: ProyeksiSurplusData }) {
  const [tampilSemua, setTampilSemua] = useState(false);
  const [poDipilih, setPoDipilih] = useState<PoDipilih | null>(null);
  const buka = (p: ProyeksiPO) => () => setPoDipilih({ po_id: p.po_id, no_po: p.no_po, klien: p.klien });
  const totalMasuk = data.masuk.reduce((s, m) => s + m.nominal, 0);
  const totalKeluar = data.keluar.reduce((s, k) => s + k.nominal, 0);
  const totalPcs = data.po.reduce((s, p) => s + p.pcs, 0);
  const poTerkirim = data.po.filter(p => p.status === 'terkirim');
  const poTampil = tampilSemua ? data.po : data.po.filter(p => p.status !== 'terkirim');
  const adaDiterimaPo = data.po.some(p => p.diterima > 0);

  return (
    <div className="space-y-6 mt-4">

      {/* A + B = C */}
      <div className="grid gap-3 md:grid-cols-3">
        <Kartu huruf="A" judul="Realisasi" nilai={data.realisasi}
          ket={`Uang yang benar-benar masuk − keluar − sewa, sejak ${tglFmt(data.sejak)}`
            + (data.dpLebih > 0 ? ` · termasuk DP titipan ${idr(data.dpLebih)} untuk barang yang belum dipotong` : '')} />
        <Kartu huruf="B" judul="Proyeksi sisa" nilai={data.proyeksiSisa}
          ket={data.dpLebih > 0
            ? 'DP sudah melebihi nilai hasil potong: sisa ini = DP titipan (utang barang) + upah yang masih harus dibayar'
            : 'Sisa tagihan hasil potong − upah yang masih harus dibayar'} />
        <Kartu huruf="C" judul="Total perkiraan (A + B)" nilai={data.totalPerkiraan} utama
          ket={`Bila ${totalPcs.toLocaleString('id-ID')} pcs hasil potong terkirim & dibayar semua`} />
      </div>
      <p className="text-xs text-[#9aa0a6] -mt-3">
        Setiap kali uang klien masuk, nilainya pindah dari B ke A — totalnya (C) tetap.
      </p>
      {data.stokTersisa > 0 && (
        <div className="rounded-xl border border-[#2A2D31] bg-[#1A1D1F] px-4 py-3 flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs text-[#9aa0a6]">
            C bila stok bahan yang belum terpakai ({idr(data.stokTersisa)}) ikut dihitung
            {data.dpLebih > 0 && <> — bahan ini umumnya dibeli dari DP titipan, jadi angka ini yang lebih adil</>}
          </span>
          <span className={`text-sm font-bold font-mono ${warnaAngka(data.totalPerkiraan + data.stokTersisa)}`}>
            {idrTanda(data.totalPerkiraan + data.stokTersisa)}
          </span>
        </div>
      )}

      {/* Realisasi per bulan */}
      <div>
        <Judul sub="Uang yang benar-benar masuk & keluar tiap bulan (Buku Kas). Setoran modal tidak dihitung sebagai uang masuk.">
          Realisasi per bulan
        </Judul>
        <div className="rounded-xl border border-[#2A2D31] overflow-x-auto bg-[#1A1D1F]">
          <Table>
            <TableHeader className="bg-[#1A1C1E]">
              <TableRow className="border-[#2A2D31] hover:bg-transparent">
                <TableHead className="text-[#9aa0a6]">Bulan</TableHead>
                <TableHead className="text-[#9aa0a6] text-right">Uang masuk</TableHead>
                <TableHead className="text-[#9aa0a6] text-right">Uang keluar</TableHead>
                <TableHead className="text-[#9aa0a6] text-right">Sewa (per hari)</TableHead>
                <TableHead className="text-[#9aa0a6] text-right">Hasil bulan ini</TableHead>
                <TableHead className="text-[#9aa0a6] text-right">Kumulatif</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.perBulan.map(b => (
                <TableRow key={b.bulan} className="border-[#2A2D31] hover:bg-[#16181A]">
                  <TableCell className="text-sm text-[#e8eaed] whitespace-nowrap">{blnFmt(b.bulan)}</TableCell>
                  <TableCell className="text-sm text-green-400 text-right whitespace-nowrap">{idr(b.masuk)}</TableCell>
                  <TableCell className="text-sm text-red-400 text-right whitespace-nowrap">{idr(b.keluar)}</TableCell>
                  <TableCell className="text-sm text-red-400 text-right whitespace-nowrap">{idr(b.sewa)}</TableCell>
                  <TableCell className={`text-sm font-semibold text-right whitespace-nowrap ${warnaAngka(b.hasil)}`}>{idrTanda(b.hasil)}</TableCell>
                  <TableCell className={`text-sm text-right whitespace-nowrap ${warnaAngka(b.kumulatif)}`}>{idrTanda(b.kumulatif)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Rincian A */}
      <div>
        <Judul>A. Realisasi — rincian</Judul>
        <div className="rounded-xl bg-[#1A1D1F] border border-[#2A2D31] px-4">
          <Baris label="Uang masuk (Buku Kas)" nilai={totalMasuk} warna="text-green-400"
            sub={data.setoranModal > 0 ? `Setoran modal ${idr(data.setoranModal)} tidak dihitung` : undefined}>
            {data.masuk.map(m => <Rinci key={m.kategori} label={m.kategori} nilai={m.nominal} />)}
          </Baris>
          <Baris label="Uang keluar (Buku Kas)" nilai={-totalKeluar} warna="text-red-400"
            sub={data.setoranModal > 0 ? `Termasuk pembelian dari setoran modal ${idr(data.setoranModal)} (sisa bahan lama)` : undefined}>
            {data.keluar.map(k => <Rinci key={k.kategori} label={k.kategori} nilai={k.nominal} />)}
          </Baris>
          {data.totalBiayaTetap > 0 && (
            <Baris label="Biaya tetap kontrak (sewa rumah)" nilai={-data.totalBiayaTetap} warna="text-red-400"
              sub={`Dibayar di muka, dihitung per hari: ${tglFmt(data.biayaTetapDari)} – ${tglFmt(data.biayaTetapSampai)}`}>
              {data.biayaTetap.map(b => (
                <Rinci key={b.nama} label={`${b.nama} — ${b.hari} hari × ${idr(b.perHari)}`} nilai={b.nominal} />
              ))}
            </Baris>
          )}
          <div className="flex justify-between py-3">
            <span className="text-sm font-bold text-[#e8eaed] pl-5">= Realisasi</span>
            <span className={`text-sm font-bold font-mono ${warnaAngka(data.realisasi)}`}>{idrTanda(data.realisasi)}</span>
          </div>
        </div>
      </div>

      {/* Rincian B */}
      <div>
        <Judul>B. Proyeksi sisa — rincian</Judul>
        <div className="rounded-xl bg-[#1A1D1F] border border-[#2A2D31] px-4">
          <Baris label="Sisa tagihan hasil potong" nilai={data.sisaTagihan} warna="text-green-400"
            sub={`Nilai jual ${idr(data.totalNilaiJual)} − sudah diterima dari klien ${idr(data.masukKlien)} (DP + pelunasan)`
              + (data.dpLebih > 0 ? ' — sudah tertutup DP' : '')}>
            {data.po.map(p => <Rinci key={p.po_id} label={`${p.no_po} — ${p.pcs} pcs`} nilai={p.nilai_jual} onKlik={buka(p)} />)}
          </Baris>
          {data.dpLebih > 0 && (
            <Baris label="DP titipan (lebih dari nilai hasil potong)" nilai={-data.dpLebih} warna="text-red-400"
              sub="Klien sudah bayar di depan untuk barang yang belum dipotong (mis. untuk beli bahan). Ini utang barang: nanti dibayar dengan hasil potong berikutnya, bukan dengan uang." />
          )}
          <Baris label="Upah sudah dikerjakan, belum dibayar" nilai={-data.upahBelumLunas} warna="text-red-400">
            {data.po.filter(p => p.upah_belum_lunas).map(p => <Rinci key={p.po_id} label={p.no_po} nilai={p.upah_belum_lunas} onKlik={buka(p)} />)}
          </Baris>
          <Baris label="Perkiraan upah tahap yang belum dikerjakan" nilai={-data.upahSisa} warna="text-red-400"
            sub="Tarif upah di HPP × pcs hasil potong, untuk tahap yang belum selesai">
            {data.po.filter(p => p.upah_sisa).map(p => <Rinci key={p.po_id} label={p.no_po} nilai={p.upah_sisa} onKlik={buka(p)} />)}
          </Baris>
          <div className="flex justify-between py-3">
            <span className="text-sm font-bold text-[#e8eaed] pl-5">= Proyeksi sisa</span>
            <span className={`text-sm font-bold font-mono ${warnaAngka(data.proyeksiSisa)}`}>{idrTanda(data.proyeksiSisa)}</span>
          </div>
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
        <div className="flex flex-wrap items-end justify-between gap-2 mb-2">
          <Judul sub="Kain & aksesori = yang benar-benar terpakai. Overhead, bahan pembantu, lainnya & sewa dibagi menurut jumlah pcs.">
            Per PO
          </Judul>
          {poTerkirim.length > 0 && (
            <label className="flex items-center gap-2 text-xs text-[#9aa0a6] cursor-pointer select-none">
              <input type="checkbox" checked={tampilSemua} onChange={e => setTampilSemua(e.target.checked)} />
              Tampilkan PO yang sudah terkirim semua ({poTerkirim.length})
            </label>
          )}
        </div>
        <div className="rounded-xl border border-[#2A2D31] overflow-x-auto bg-[#1A1D1F]">
          <Table>
            <TableHeader className="bg-[#1A1C1E]">
              <TableRow className="border-[#2A2D31] hover:bg-transparent">
                <TableHead className="text-[#9aa0a6]">PO</TableHead>
                <TableHead className="text-[#9aa0a6]">Status</TableHead>
                <TableHead className="text-[#9aa0a6] text-right">Potong / kirim</TableHead>
                <TableHead className="text-[#9aa0a6] text-right">Nilai jual</TableHead>
                {adaDiterimaPo && <TableHead className="text-[#9aa0a6] text-right">Diterima</TableHead>}
                <TableHead className="text-[#9aa0a6] text-right">Kain & aksesori</TableHead>
                <TableHead className="text-[#9aa0a6] text-right">Upah (tercatat + perkiraan)</TableHead>
                <TableHead className="text-[#9aa0a6] text-right">Overhead & pembantu</TableHead>
                <TableHead className="text-[#9aa0a6] text-right">Surplus</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {poTampil.length === 0 ? (
                <TableRow className="border-[#2A2D31] hover:bg-transparent">
                  <TableCell colSpan={adaDiterimaPo ? 9 : 8} className="h-24 text-center text-[#5f6368]">
                    {data.po.length === 0 ? 'Belum ada hasil potong' : 'Semua PO sudah terkirim'}
                  </TableCell>
                </TableRow>
              ) : poTampil.map(p => {
                const upah = p.upah_lunas + p.upah_belum_lunas + p.upah_sisa;
                const st = STATUS_LABEL[p.status];
                return (
                  <TableRow key={p.po_id} className="border-[#2A2D31] hover:bg-[#16181A]">
                    <TableCell className="text-sm text-[#e8eaed] font-mono whitespace-nowrap">
                      <button type="button" onClick={buka(p)}
                        className="text-sky-300 hover:underline underline-offset-2 cursor-pointer">{p.no_po}</button>
                      <span className="block text-[10px] text-[#9aa0a6] font-sans">{p.klien}</span>
                    </TableCell>
                    <TableCell>
                      <span className={`text-[11px] px-2 py-0.5 rounded-full border whitespace-nowrap ${st.kelas}`}>{st.label}</span>
                    </TableCell>
                    <TableCell className="text-sm text-[#9aa0a6] text-right whitespace-nowrap">
                      {p.pcs.toLocaleString('id-ID')} / {p.pcs_kirim.toLocaleString('id-ID')}
                    </TableCell>
                    <TableCell className="text-sm text-[#e8eaed] text-right whitespace-nowrap">{idr(p.nilai_jual)}</TableCell>
                    {adaDiterimaPo && (
                      <TableCell className="text-sm text-[#9aa0a6] text-right whitespace-nowrap">{p.diterima ? idr(p.diterima) : '—'}</TableCell>
                    )}
                    <TableCell className="text-sm text-[#9aa0a6] text-right whitespace-nowrap">{idr(p.kain + p.aksesori)}</TableCell>
                    <TableCell className="text-sm text-[#9aa0a6] text-right whitespace-nowrap"
                      title={`Dibayar ${idr(p.upah_lunas)} · belum dibayar ${idr(p.upah_belum_lunas)} · perkiraan sisa ${idr(p.upah_sisa)}`}>
                      {idr(upah)}
                    </TableCell>
                    <TableCell className="text-sm text-[#9aa0a6] text-right whitespace-nowrap">{idr(p.alokasi)}</TableCell>
                    <TableCell className={`text-sm font-semibold text-right whitespace-nowrap ${warnaAngka(p.surplus)}`}>
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
        <p className="text-[11px] text-[#5f6368] mt-2">
          Klik nomor PO untuk melihat barangnya & posisi di tiap tahap.
          PO yang sudah terkirim semua & semua tahapnya selesai disembunyikan supaya daftar tidak menumpuk;
          angkanya tetap ikut dihitung di A, B, dan C.
        </p>
      </div>

      <div className="flex items-start gap-2 text-xs text-[#9aa0a6]">
        <Info className="h-4 w-4 shrink-0 mt-0.5" />
        <p>
          Uang masuk diambil dari Buku Kas (DP Klien, Pelunasan Klien, Pendapatan Lain) — jangan dicatat lagi sebagai
          pembayaran invoice supaya tidak terhitung dua kali.
          {data.masukKlienTanpaPo > 0 && <> {idr(data.masukKlienTanpaPo)} uang klien belum ditandai ke PO; bila saat mencatat di Buku Kas dipilih PO-nya, kolom &ldquo;Diterima&rdquo; per PO ikut terisi.</>}
          {' '}Reject belum dikurangi — semua pcs hasil potong dianggap terkirim. Total C bisa beda sedikit dengan jumlah surplus per PO
          karena C memakai uang yang sudah keluar (termasuk bahan yang belum terpakai).
        </p>
      </div>
      <PoDetailDialog po={poDipilih} onClose={() => setPoDipilih(null)} />
    </div>
  );
}
