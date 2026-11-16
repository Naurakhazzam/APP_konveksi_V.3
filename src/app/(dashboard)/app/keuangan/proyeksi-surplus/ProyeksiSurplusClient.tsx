'use client';

import React, { useState } from 'react';
import { ChevronDown, ChevronRight, Info } from 'lucide-react';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow
} from '@/components/ui/table';
import type { KolomLR, ProyeksiPO, ProyeksiSurplusData, StatusPO } from '@/lib/actions/keuangan/proyeksi-surplus.actions';
import PoDetailDialog, { type PoDipilih } from './PoDetailDialog';

const idr = (n: number) => 'Rp ' + Math.round(n).toLocaleString('id-ID');
/** Format laporan keuangan: angka negatif dalam kurung */
const akt = (n: number) => (Math.round(n) < 0 ? `(${idr(-n)})` : idr(n));
const pct = (a: number, b: number) => (b > 0 ? `${((a / b) * 100).toLocaleString('id-ID', { maximumFractionDigits: 1 })}%` : '–');
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

const Judul = ({ no, children, sub }: { no?: string; children: React.ReactNode; sub?: string }) => (
  <div className="mb-2">
    <h2 className="text-base font-bold text-[#e8eaed]">{no && <span className="text-[#9aa0a6] mr-1.5">{no}.</span>}{children}</h2>
    {sub && <p className="text-xs text-[#9aa0a6] mt-0.5">{sub}</p>}
  </div>
);

function Kpi({ judul, nilai, ket, warna }: { judul: string; nilai: string; ket: React.ReactNode; warna?: string }) {
  return (
    <div className="p-4 rounded-xl border border-[#2A2D31] bg-[#1A1D1F]">
      <p className="text-[10px] uppercase tracking-widest text-[#9aa0a6] font-bold mb-1">{judul}</p>
      <p className={`text-xl font-bold font-mono ${warna ?? 'text-[#e8eaed]'}`}>{nilai}</p>
      <p className="text-xs text-[#9aa0a6] mt-1.5">{ket}</p>
    </div>
  );
}

// ── Laba rugi: satu baris dengan tiga kolom ──
type JenisBaris = 'pos' | 'rinci' | 'subtotal' | 'total';
function BarisLR({ label, ambil, jenis = 'pos', negatif, lr, rinci }: {
  label: React.ReactNode; ambil: (k: KolomLR) => number; jenis?: JenisBaris; negatif?: boolean;
  lr: ProyeksiSurplusData['lr']; rinci?: React.ReactNode;
}) {
  const [buka, setBuka] = useState(false);
  const tanda = (n: number) => (negatif ? -n : n);
  const tebal = jenis === 'subtotal' || jenis === 'total';
  const kelasBaris = jenis === 'total' ? 'border-t-2 border-[#3c4043] bg-[#16181A]'
    : jenis === 'subtotal' ? 'border-t border-[#3c4043]' : '';
  const sel = (k: KolomLR, abu?: boolean) => {
    const n = tanda(ambil(k));
    return (
      <TableCell className={`text-sm font-mono text-right whitespace-nowrap ${tebal ? 'font-bold' : ''}
        ${jenis === 'total' || jenis === 'subtotal' ? warnaAngka(n) : abu ? 'text-[#9aa0a6]' : 'text-[#e8eaed]'}`}>
        {akt(n)}
        {tebal && <span className="block text-[10px] font-normal text-[#9aa0a6]">{pct(ambil(k), k.pendapatan)}</span>}
      </TableCell>
    );
  };
  return (
    <>
      <TableRow className={`border-[#2A2D31] hover:bg-transparent ${kelasBaris}`}>
        <TableCell className={`text-sm ${jenis === 'rinci' ? 'pl-8 text-[#9aa0a6]' : 'text-[#e8eaed]'} ${tebal ? 'font-bold' : ''}`}>
          {rinci ? (
            <button type="button" onClick={() => setBuka(!buka)} className="flex items-center gap-1 cursor-pointer">
              {buka ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}{label}
            </button>
          ) : label}
        </TableCell>
        {sel(lr.dikirim)}{sel(lr.berjalan, true)}{sel(lr.total)}
      </TableRow>
      {buka && rinci && (
        <TableRow className="border-[#2A2D31] hover:bg-transparent">
          <TableCell colSpan={4} className="pl-12 py-2 text-xs text-[#9aa0a6]">{rinci}</TableCell>
        </TableRow>
      )}
    </>
  );
}

const Rinci = ({ label, nilai, onKlik }: { label: React.ReactNode; nilai: number; onKlik?: () => void }) => (
  <div className="flex justify-between gap-4 text-xs text-[#9aa0a6]">
    {onKlik
      ? <button type="button" onClick={onKlik} className="text-left hover:text-[#e8eaed] hover:underline underline-offset-2 cursor-pointer">{label}</button>
      : <span>{label}</span>}
    <span className="font-mono whitespace-nowrap">{akt(nilai)}</span>
  </div>
);

function Pos({ label, nilai, sub, tebal, children }: {
  label: string; nilai: number; sub?: string; tebal?: boolean; children?: React.ReactNode;
}) {
  const [buka, setBuka] = useState(false);
  return (
    <div className={`py-2.5 ${tebal ? 'border-t border-[#3c4043] mt-1' : 'border-b border-[#2A2D31] last:border-0'}`}>
      <button type="button" disabled={!children} onClick={() => setBuka(!buka)}
        className={`w-full flex justify-between gap-4 text-left ${children ? 'cursor-pointer' : 'cursor-default'}`}>
        <span className="flex items-start gap-1">
          {children ? (buka ? <ChevronDown className="h-3.5 w-3.5 mt-0.5 text-[#9aa0a6]" /> : <ChevronRight className="h-3.5 w-3.5 mt-0.5 text-[#9aa0a6]" />) : <span className="w-3.5" />}
          <span>
            <span className={`text-sm text-[#e8eaed] ${tebal ? 'font-bold' : ''}`}>{label}</span>
            {sub && <span className="block text-[11px] text-[#9aa0a6]">{sub}</span>}
          </span>
        </span>
        <span className={`text-sm font-mono whitespace-nowrap text-[#e8eaed] ${tebal ? 'font-bold' : ''}`}>{akt(nilai)}</span>
      </button>
      {buka && children && <div className="pl-5 pt-2 space-y-1">{children}</div>}
    </div>
  );
}

export default function ProyeksiSurplusClient({ data }: { data: ProyeksiSurplusData }) {
  const [tampilSemua, setTampilSemua] = useState(false);
  const [poDipilih, setPoDipilih] = useState<PoDipilih | null>(null);
  const buka = (p: ProyeksiPO) => () => setPoDipilih({ po_id: p.po_id, no_po: p.no_po, klien: p.klien });
  const { lr, posisi, arusKas } = data;
  const t = lr.total;
  const poTerkirim = data.po.filter(p => p.status === 'terkirim');
  const poTampil = tampilSemua ? data.po : data.po.filter(p => p.status !== 'terkirim');
  const adaDiterimaPo = data.po.some(p => p.diterima > 0);

  return (
    <div className="space-y-8 mt-4">

      {/* ── Angka utama ── */}
      <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi judul="Nilai penjualan" nilai={idr(t.pendapatan)}
          ket={<>{idr(lr.dikirim.pendapatan)} sudah dikirim · {data.totalPcs.toLocaleString('id-ID')} pcs</>} />
        <Kpi judul="Laba kotor" nilai={akt(t.labaKotor)} warna={warnaAngka(t.labaKotor)}
          ket={<>Margin kotor {pct(t.labaKotor, t.pendapatan)}</>} />
        <Kpi judul="Laba bersih" nilai={akt(t.labaBersih)} warna={warnaAngka(t.labaBersih)}
          ket={<>Margin bersih {pct(t.labaBersih, t.pendapatan)}</>} />
        {posisi.uangMukaPelanggan > 0
          ? <Kpi judul="Uang muka pelanggan" nilai={idr(posisi.uangMukaPelanggan)} warna="text-sky-300"
              ket="DP yang sudah diterima untuk barang yang belum dikirim" />
          : <Kpi judul="Piutang usaha" nilai={idr(posisi.piutang)} warna="text-amber-300"
              ket="Barang sudah dikirim, pembayaran belum diterima" />}
      </div>

      {/* ── 1. Laba rugi ── */}
      <div>
        <Judul no="1" sub={`Basis akrual: biaya dicatat bersama barang yang dijual. Sejak ${tglFmt(data.sejak)}.`}>
          Laporan Laba Rugi
        </Judul>
        <div className="rounded-xl border border-[#2A2D31] overflow-x-auto bg-[#1A1D1F]">
          <Table>
            <TableHeader className="bg-[#1A1C1E]">
              <TableRow className="border-[#2A2D31] hover:bg-transparent">
                <TableHead className="text-[#9aa0a6]">Keterangan</TableHead>
                <TableHead className="text-[#9aa0a6] text-right">Sudah dikirim<span className="block text-[10px] font-normal">aktual</span></TableHead>
                <TableHead className="text-[#9aa0a6] text-right">Order berjalan<span className="block text-[10px] font-normal">perkiraan</span></TableHead>
                <TableHead className="text-[#9aa0a6] text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <BarisLR lr={lr} label="Pendapatan" ambil={k => k.pendapatan} />
              <BarisLR lr={lr} jenis="rinci" negatif label="Bahan baku (kain & aksesori terpakai)" ambil={k => k.bahan} />
              <BarisLR lr={lr} jenis="rinci" negatif label="Upah produksi" ambil={k => k.upah} />
              <BarisLR lr={lr} jenis="rinci" negatif label="Overhead produksi" ambil={k => k.overheadProduksi}
                rinci={data.rincianOverhead.length ? data.rincianOverhead.map(r =>
                  <Rinci key={r.kategori} label={r.kategori} nilai={r.nominal} />) : undefined} />
              <BarisLR lr={lr} negatif label="Harga pokok penjualan (HPP)" ambil={k => k.hpp} />
              <BarisLR lr={lr} jenis="subtotal" label="Laba kotor" ambil={k => k.labaKotor} />
              <BarisLR lr={lr} jenis="rinci" negatif label="Sewa tempat usaha" ambil={k => k.sewa}
                rinci={data.biayaTetap.filter(b => b.hari > 0).map(b =>
                  <Rinci key={b.nama} label={`${b.nama} — ${b.hari} hari × ${idr(b.perHari)} (${tglFmt(data.biayaTetapDari)} – ${tglFmt(data.biayaTetapSampai)})`} nilai={b.nominal} />)} />
              {t.bebanLain > 0 && (
                <BarisLR lr={lr} jenis="rinci" negatif label="Beban operasional lain" ambil={k => k.bebanLain}
                  rinci={data.rincianBebanLain.map(r => <Rinci key={r.kategori} label={r.kategori} nilai={r.nominal} />)} />
              )}
              <BarisLR lr={lr} jenis="total" label="Laba bersih" ambil={k => k.labaBersih} />
            </TableBody>
          </Table>
        </div>
        <p className="text-[11px] text-[#5f6368] mt-2">
          Persentase di bawah laba = margin terhadap pendapatan.
          Order berjalan = barang yang sudah dipotong tapi belum dikirim; upah tahap yang belum dikerjakan memakai tarif HPP.
          Overhead & sewa dibagi menurut jumlah pcs.
          {data.pendapatanBelumValidasi > 0 && <> {idr(data.pendapatanBelumValidasi)} pendapatan berasal dari Surat Jalan yang belum divalidasi kantor.</>}
        </p>
      </div>

      {/* ── 2. Posisi keuangan ── */}
      <div>
        <Judul no="2" sub={`Per ${tglFmt(data.perTanggal)}`}>Posisi Aset & Kewajiban</Judul>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-xl bg-[#1A1D1F] border border-[#2A2D31] px-4 py-2">
            <p className="text-[10px] uppercase tracking-widest text-[#9aa0a6] font-bold pt-2 pb-1">Aset</p>
            <Pos label="Persediaan bahan baku" nilai={posisi.persediaanBahan} sub="Bahan sudah dibeli, belum dipotong">
              {data.stokTersisaRinci.length ? data.stokTersisaRinci.map(s => (
                <Rinci key={s.nama} nilai={s.nilai}
                  label={`${s.nama} — ${s.qty.toLocaleString('id-ID', { maximumFractionDigits: 2 })} ${s.satuan}`} />
              )) : undefined}
            </Pos>
            <Pos label="Barang dalam proses" nilai={posisi.barangDalamProses}
              sub="Biaya bahan, upah & overhead untuk barang yang belum dikirim" />
            {posisi.piutang > 0 && <Pos label="Piutang usaha" nilai={posisi.piutang} sub="Sudah dikirim, belum dibayar klien" />}
            <Pos label="Sewa dibayar di muka" nilai={posisi.sewaDibayarDimuka} sub={`Sisa masa kontrak setelah ${tglFmt(data.biayaTetapSampai)}`}>
              {data.biayaTetap.filter(b => b.sisaHari > 0).map(b =>
                <Rinci key={b.nama} label={`${b.nama} — sisa ${b.sisaHari} hari`} nilai={b.sisaNilai} />)}
            </Pos>
            <Pos label="Total aset (di luar kas)" nilai={posisi.totalAset} tebal />
          </div>
          <div className="rounded-xl bg-[#1A1D1F] border border-[#2A2D31] px-4 py-2">
            <p className="text-[10px] uppercase tracking-widest text-[#9aa0a6] font-bold pt-2 pb-1">Kewajiban</p>
            <Pos label="Uang muka pelanggan" nilai={posisi.uangMukaPelanggan}
              sub="DP diterima, barang belum dikirim — dilunasi dengan pengiriman" />
            <Pos label="Upah terutang" nilai={posisi.upahTerutang} sub="Pekerjaan sudah selesai, upah belum dibayar" />
            <Pos label="Total kewajiban" nilai={posisi.totalKewajiban} tebal />
          </div>
        </div>
        <p className="text-[11px] text-[#5f6368] mt-2">
          Saldo kas tidak ditampilkan karena saldo awal sebelum {tglFmt(data.sejak)} belum tercatat. Pergerakan kas sejak tanggal itu ada di bagian 3.
        </p>
      </div>

      {/* ── 3. Arus kas ── */}
      <div>
        <Judul no="3" sub={`Uang yang benar-benar masuk & keluar di Buku Kas sejak ${tglFmt(data.sejak)}`}>Arus Kas</Judul>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-xl bg-[#1A1D1F] border border-[#2A2D31] px-4 py-2">
            <p className="text-[10px] uppercase tracking-widest text-[#9aa0a6] font-bold pt-2 pb-1">Kas masuk</p>
            <Pos label="Dari pelanggan (DP & pelunasan)" nilai={arusKas.masukKlien} />
            {arusKas.pendapatanLain > 0 && <Pos label="Pendapatan lain" nilai={arusKas.pendapatanLain} />}
            <Pos label="Setoran modal pemilik" nilai={arusKas.setoranModal} />
            <Pos label="Total kas masuk" nilai={arusKas.totalMasuk} tebal />
          </div>
          <div className="rounded-xl bg-[#1A1D1F] border border-[#2A2D31] px-4 py-2">
            <p className="text-[10px] uppercase tracking-widest text-[#9aa0a6] font-bold pt-2 pb-1">Kas keluar</p>
            {arusKas.keluar.map(k => <Pos key={k.kategori} label={k.kategori} nilai={k.nominal} />)}
            <Pos label="Total kas keluar" nilai={arusKas.totalKeluar} tebal />
          </div>
        </div>
        <div className="mt-3 rounded-xl border border-[#2A2D31] bg-[#1A1D1F] px-4 py-3 flex justify-between">
          <span className="text-sm font-bold text-[#e8eaed]">Arus kas bersih</span>
          <span className={`text-sm font-bold font-mono ${warnaAngka(arusKas.bersih)}`}>{akt(arusKas.bersih)}</span>
        </div>

        {data.perBulan.length > 1 && (
          <div className="mt-3 rounded-xl border border-[#2A2D31] overflow-x-auto bg-[#1A1D1F]">
            <Table>
              <TableHeader className="bg-[#1A1C1E]">
                <TableRow className="border-[#2A2D31] hover:bg-transparent">
                  <TableHead className="text-[#9aa0a6]">Bulan</TableHead>
                  <TableHead className="text-[#9aa0a6] text-right">Pendapatan</TableHead>
                  <TableHead className="text-[#9aa0a6] text-right">Kas masuk</TableHead>
                  <TableHead className="text-[#9aa0a6] text-right">Kas keluar</TableHead>
                  <TableHead className="text-[#9aa0a6] text-right">Arus kas bersih</TableHead>
                  <TableHead className="text-[#9aa0a6] text-right">Kumulatif</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.perBulan.map(b => (
                  <TableRow key={b.bulan} className="border-[#2A2D31] hover:bg-[#16181A]">
                    <TableCell className="text-sm text-[#e8eaed] whitespace-nowrap">{blnFmt(b.bulan)}</TableCell>
                    <TableCell className="text-sm text-[#e8eaed] text-right font-mono whitespace-nowrap">{idr(b.pendapatan)}</TableCell>
                    <TableCell className="text-sm text-[#e8eaed] text-right font-mono whitespace-nowrap">{idr(b.kasKlien + b.kasLain + b.modal)}</TableCell>
                    <TableCell className="text-sm text-[#e8eaed] text-right font-mono whitespace-nowrap">{akt(-b.keluar)}</TableCell>
                    <TableCell className={`text-sm font-semibold text-right font-mono whitespace-nowrap ${warnaAngka(b.bersih)}`}>{akt(b.bersih)}</TableCell>
                    <TableCell className={`text-sm text-right font-mono whitespace-nowrap ${warnaAngka(b.kumulatif)}`}>{akt(b.kumulatif)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        <p className="text-[11px] text-[#5f6368] mt-2">
          Arus kas berbeda dengan laba: pembelian bahan masuk persediaan (aset) dan baru menjadi biaya saat dipakai,
          sedangkan DP pelanggan baru menjadi pendapatan saat barang dikirim.
          {arusKas.masukKlienTanpaPo > 0 && <> {idr(arusKas.masukKlienTanpaPo)} uang pelanggan belum ditandai ke PO.</>}
        </p>
      </div>

      {/* ── 4. Per PO ── */}
      <div>
        <div className="flex flex-wrap items-end justify-between gap-2 mb-2">
          <Judul no="4" sub="Bahan = yang benar-benar terpakai. Overhead & sewa dibagi menurut jumlah pcs.">
            Laba per PO
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
                {adaDiterimaPo && <TableHead className="text-[#9aa0a6] text-right">DP diterima</TableHead>}
                <TableHead className="text-[#9aa0a6] text-right">Bahan</TableHead>
                <TableHead className="text-[#9aa0a6] text-right">Upah</TableHead>
                <TableHead className="text-[#9aa0a6] text-right">Overhead & sewa</TableHead>
                <TableHead className="text-[#9aa0a6] text-right">Laba bersih</TableHead>
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
                      title={`Dibayar ${idr(p.upah_lunas)} · terutang ${idr(p.upah_belum_lunas)} · perkiraan tahap berikutnya ${idr(p.upah_sisa)}`}>
                      {idr(upah)}
                    </TableCell>
                    <TableCell className="text-sm text-[#9aa0a6] text-right whitespace-nowrap">{idr(p.alokasi)}</TableCell>
                    <TableCell className={`text-sm font-semibold text-right whitespace-nowrap ${warnaAngka(p.surplus)}`}>
                      {akt(p.surplus)}
                      {p.nilai_jual > 0 && (
                        <span className="block text-[10px] text-[#9aa0a6] font-normal">margin {pct(p.surplus, p.nilai_jual)}</span>
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
          PO yang sudah terkirim semua disembunyikan supaya daftar tidak menumpuk; angkanya tetap ikut di Laporan Laba Rugi.
        </p>
      </div>

      <div className="flex items-start gap-2 text-xs text-[#9aa0a6]">
        <Info className="h-4 w-4 shrink-0 mt-0.5" />
        <p>
          Dasar penyusunan: pendapatan diakui saat barang dikirim (Surat Jalan, dicocokkan dengan validasi kantor).
          Biaya bahan dihitung dari pemakaian aktual, bukan dari pembelian. Angka &ldquo;Order berjalan&rdquo; adalah perkiraan
          dengan anggapan semua barang terkirim tanpa reject.
        </p>
      </div>
      <PoDetailDialog po={poDipilih} onClose={() => setPoDipilih(null)} />
    </div>
  );
}
