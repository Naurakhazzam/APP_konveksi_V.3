'use client';

import React, { useState, useTransition } from 'react';
import { ChevronDown, ChevronRight, Info, Loader2 } from 'lucide-react';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow
} from '@/components/ui/table';
import type { KinerjaData, KinerjaPO, KolomLR, StatusPO } from '@/lib/keuangan/kinerja.server';
import { getKinerjaKeuangan } from '@/lib/actions/keuangan/proyeksi-surplus.actions';
import PoDetailDialog, { type PoDipilih } from './PoDetailDialog';
import RincianDialog, { type JenisRincian } from './RincianDialog';
import type { KunciIstilah } from '@/lib/keuangan/kamus';
import { PanduanProvider, PanelPanduan, InfoIstilah, TombolPanduan } from '@/components/keuangan/panduan/Panduan';
import { buatPanduanKinerja } from './panduan-kinerja';

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

const Judul = ({ no, children, sub, k }: { no?: string; children: React.ReactNode; sub?: string; k?: KunciIstilah }) => (
  <div className="mb-2">
    <h2 className="flex items-center gap-1.5 text-base font-bold text-[#e8eaed]">
      <span>{no && <span className="text-[#9aa0a6] mr-1.5">{no}.</span>}{children}</span>{k && <InfoIstilah k={k} />}
    </h2>
    {sub && <p className="text-xs text-[#9aa0a6] mt-0.5">{sub}</p>}
  </div>
);

function Kpi({ judul, nilai, ket, warna, k }: { judul: string; nilai: string; ket: React.ReactNode; warna?: string; k?: KunciIstilah }) {
  return (
    <div className="p-4 rounded-xl border border-[#2A2D31] bg-[#1A1D1F]">
      <p className="flex items-center gap-1 text-[10px] uppercase tracking-widest text-[#9aa0a6] font-bold mb-1">{judul}{k && <InfoIstilah k={k} />}</p>
      <p className={`text-xl font-bold font-mono ${warna ?? 'text-[#e8eaed]'}`}>{nilai}</p>
      <p className="text-xs text-[#9aa0a6] mt-1.5">{ket}</p>
    </div>
  );
}

const Rinci = ({ label, nilai }: { label: React.ReactNode; nilai: number }) => (
  <div className="flex justify-between gap-4 text-xs text-[#9aa0a6]">
    <span>{label}</span>
    <span className="font-mono whitespace-nowrap">{akt(nilai)}</span>
  </div>
);

function Pos({ label, nilai, sub, tebal, k, children }: {
  label: string; nilai: number; sub?: string; tebal?: boolean; k?: KunciIstilah; children?: React.ReactNode;
}) {
  const [buka, setBuka] = useState(false);
  return (
    <div className={`py-2.5 ${tebal ? 'border-t border-[#3c4043] mt-1' : 'border-b border-[#2A2D31] last:border-0'}`}>
      <div className="w-full flex justify-between gap-4">
        <span className="flex items-start gap-1">
          <button type="button" disabled={!children} onClick={() => setBuka(!buka)}
            className={`flex items-start gap-1 text-left ${children ? 'cursor-pointer' : 'cursor-default'}`}>
            {children ? (buka ? <ChevronDown className="h-3.5 w-3.5 mt-0.5 text-[#9aa0a6]" /> : <ChevronRight className="h-3.5 w-3.5 mt-0.5 text-[#9aa0a6]" />) : <span className="w-3.5" />}
            <span>
              <span className={`text-sm text-[#e8eaed] ${tebal ? 'font-bold' : ''}`}>{label}</span>
              {sub && <span className="block text-[11px] text-[#9aa0a6]">{sub}</span>}
            </span>
          </button>
          {k && <InfoIstilah k={k} className="mt-0.5" />}
        </span>
        <span className={`text-sm font-mono whitespace-nowrap text-[#e8eaed] ${tebal ? 'font-bold' : ''}`}>{akt(nilai)}</span>
      </div>
      {buka && children && <div className="pl-5 pt-2 space-y-1">{children}</div>}
    </div>
  );
}

type KolomTampil = { judul: string; sub: string; k: KolomLR; abu?: boolean; info?: KunciIstilah };

/** Satu baris laba rugi; label bisa diklik untuk membuka penjelasan & rincian */
function Baris({ kolom, onRinci, label, ambil, jenis = 'pos', negatif, rinci, tampil = true, info }: {
  kolom: KolomTampil[]; onRinci: (j: JenisRincian) => void; label: string; ambil: (k: KolomLR) => number; jenis?: 'pos' | 'rinci' | 'subtotal' | 'total';
  negatif?: boolean; rinci?: JenisRincian; tampil?: boolean; info?: KunciIstilah;
}) {
  if (!tampil) return null;
  const tebal = jenis === 'subtotal' || jenis === 'total';
  return (
    <TableRow className={`border-[#2A2D31] hover:bg-transparent ${jenis === 'total' ? 'border-t-2 border-[#3c4043] bg-[#16181A]' : jenis === 'subtotal' ? 'border-t border-[#3c4043]' : ''}`}>
      <TableCell className={`text-sm ${jenis === 'rinci' ? 'pl-8' : ''} ${tebal ? 'font-bold' : ''}`}>
        {rinci ? (
          <button type="button" onClick={() => onRinci(rinci)}
            className={`text-left underline decoration-dotted underline-offset-4 decoration-[#5f6368] hover:decoration-sky-300 hover:text-sky-300 cursor-pointer ${jenis === 'rinci' ? 'text-[#c4c7c5]' : 'text-[#e8eaed]'}`}>
            {label}
          </button>
        ) : <span className="text-[#e8eaed]">{label}</span>}
        {info && <InfoIstilah k={info} className="ml-1.5 align-middle" />}
      </TableCell>
      {kolom.map(c => {
        const n = negatif ? -ambil(c.k) : ambil(c.k);
        return (
          <TableCell key={c.judul} className={`text-sm font-mono text-right whitespace-nowrap ${tebal ? `font-bold ${warnaAngka(n)}` : c.abu ? 'text-[#9aa0a6]' : 'text-[#e8eaed]'}`}>
            {akt(n)}
            {tebal && <span className="block text-[10px] font-normal text-[#9aa0a6]">{pct(ambil(c.k), c.k.pendapatan)}</span>}
          </TableCell>
        );
      })}
    </TableRow>
  );
}

export default function ProyeksiSurplusClient(props: { data: KinerjaData }) {
  return (
    <PanduanProvider>
      <KinerjaIsi {...props} />
    </PanduanProvider>
  );
}

function KinerjaIsi({ data: awal }: { data: KinerjaData }) {
  const [data, setData] = useState(awal);
  const [memuat, mulai] = useTransition();
  const [galat, setGalat] = useState<string | null>(null);
  const [tampilSemua, setTampilSemua] = useState(false);
  const [poDipilih, setPoDipilih] = useState<PoDipilih | null>(null);
  const [rincian, setRincian] = useState<JenisRincian | null>(null);

  const gantiPeriode = (p: string) => mulai(async () => {
    try { setGalat(null); setData(await getKinerjaKeuangan(p)); }
    catch (e) { setGalat(String((e as Error)?.message ?? e)); }
  });

  const buka = (p: KinerjaPO) => () => setPoDipilih({ po_id: p.po_id, no_po: p.no_po, klien: p.klien });
  const { lr, posisi, arusKas } = data;
  const semua = data.periode === 'semua';
  const t = lr.total;
  const adaRetur = t.returReject !== 0 || data.rincian.returReject.length > 0;
  const kolom: KolomTampil[] = lr.berjalan
    ? [
        { judul: 'Sudah dikirim', sub: 'aktual', k: lr.aktual, info: 'sudah_dikirim' },
        { judul: 'Order berjalan', sub: 'perkiraan', k: lr.berjalan, abu: true, info: 'order_berjalan' },
        { judul: 'Total', sub: '', k: lr.total },
      ]
    : [{ judul: blnFmt(data.periode), sub: 'aktual', k: lr.aktual }];
  const poTerkirim = data.po.filter(p => p.status === 'terkirim');
  const poTampil = tampilSemua ? data.po : data.po.filter(p => p.status !== 'terkirim');
  const adaDiterimaPo = data.po.some(p => p.diterima > 0);
  const kontenPanduan = React.useMemo(() => buatPanduanKinerja(data), [data]);

  return (
    <div className="space-y-8 mt-4">

      <PanelPanduan konten={kontenPanduan} />
      {/* ── Pilih periode ── */}
      <div className="flex flex-wrap items-start justify-between gap-3">
      <div data-panduan="periode" className="flex flex-wrap items-center gap-2">
        <span className="flex items-center gap-1 text-xs text-[#9aa0a6]">Periode <InfoIstilah k="periode_kinerja" />:</span>
        {[{ v: 'semua', l: `Sejak ${tglFmt(data.sejak)}` }, ...data.bulanTersedia.slice().reverse().map(b => ({ v: b, l: blnFmt(b) }))].map(o => (
          <button key={o.v} type="button" disabled={memuat} onClick={() => gantiPeriode(o.v)}
            className={`text-xs px-3 py-1.5 rounded-full border cursor-pointer ${data.periode === o.v
              ? 'bg-sky-500/15 border-sky-500/40 text-sky-200' : 'border-[#2A2D31] text-[#9aa0a6] hover:text-[#e8eaed]'}`}>
            {o.l}
          </button>
        ))}
        {memuat && <Loader2 className="h-4 w-4 animate-spin text-[#9aa0a6]" />}
        {galat && <span className="text-xs text-red-400">{galat}</span>}
      </div>
      <TombolPanduan />
      </div>

      {/* ── Angka utama ── */}
      <div data-panduan="kpi" className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi k={semua ? 'nilai_penjualan' : 'pendapatan'} judul={semua ? 'Nilai penjualan' : 'Pendapatan'} nilai={idr(t.pendapatan)}
          ket={semua ? <>{idr(lr.aktual.pendapatan)} sudah dikirim · {data.totalPcs.toLocaleString('id-ID')} pcs</> : 'Barang yang dikirim bulan ini'} />
        <Kpi k="laba_kotor" judul="Laba kotor" nilai={akt(t.labaKotor)} warna={warnaAngka(t.labaKotor)}
          ket={<>Margin kotor {pct(t.labaKotor, t.pendapatan)}</>} />
        <Kpi k="laba_bersih" judul="Laba bersih" nilai={akt(t.labaBersih)} warna={warnaAngka(t.labaBersih)}
          ket={<>Margin bersih {pct(t.labaBersih, t.pendapatan)}</>} />
        {posisi.uangMukaPelanggan > 0
          ? <Kpi k="uang_muka" judul="Uang muka pelanggan" nilai={idr(posisi.uangMukaPelanggan)} warna="text-sky-300"
              ket="DP yang sudah diterima untuk barang yang belum dikirim" />
          : <Kpi k="piutang" judul="Piutang usaha" nilai={idr(posisi.piutang)} warna="text-amber-300"
              ket="Barang sudah dikirim, pembayaran belum diterima" />}
      </div>

      {/* ── 1. Laba rugi ── */}
      <div data-panduan="laba-rugi">
        <Judul no="1" sub="Basis akrual: biaya dicatat bersama barang yang dijual. Klik nama baris untuk melihat penjelasan & rinciannya.">
          Laporan Laba Rugi
        </Judul>
        <div className="rounded-xl border border-[#2A2D31] overflow-x-auto bg-[#1A1D1F]">
          <Table>
            <TableHeader className="bg-[#1A1C1E]">
              <TableRow className="border-[#2A2D31] hover:bg-transparent">
                <TableHead className="text-[#9aa0a6]">Keterangan</TableHead>
                {kolom.map(c => (
                  <TableHead key={c.judul} className="text-[#9aa0a6] text-right">
                    <span className="inline-flex items-center gap-1">{c.judul}{c.info && <InfoIstilah k={c.info} />}</span>
                    {c.sub && <span className="block text-[10px] font-normal">{c.sub}</span>}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              <Baris kolom={kolom} onRinci={setRincian} label={adaRetur ? 'Penjualan' : 'Pendapatan'} ambil={k => k.penjualan} rinci="pendapatan" info="pendapatan" />
              <Baris kolom={kolom} onRinci={setRincian} jenis="rinci" negatif label="Retur & Reject" ambil={k => k.returReject}
                rinci="returReject" tampil={adaRetur} info="retur_reject" />
              <Baris kolom={kolom} onRinci={setRincian} jenis="subtotal" label="Pendapatan bersih" ambil={k => k.pendapatan} tampil={adaRetur} />
              <Baris kolom={kolom} onRinci={setRincian} jenis="rinci" negatif label="Bahan baku" ambil={k => k.bahan} rinci="bahan" info="bahan_baku" />
              <Baris kolom={kolom} onRinci={setRincian} jenis="rinci" negatif label="Upah produksi" ambil={k => k.upah} rinci="upah" info="upah_produksi" />
              <Baris kolom={kolom} onRinci={setRincian} jenis="rinci" negatif label="Overhead produksi" ambil={k => k.overheadProduksi} rinci="overhead" info="overhead" />
              <Baris kolom={kolom} onRinci={setRincian} negatif label="Harga pokok penjualan (HPP)" ambil={k => k.hpp} rinci="hpp" info="hpp_lr" />
              <Baris kolom={kolom} onRinci={setRincian} jenis="subtotal" label="Laba kotor" ambil={k => k.labaKotor} rinci="labaKotor" info="laba_kotor" />
              <Baris kolom={kolom} onRinci={setRincian} jenis="rinci" negatif label="Overhead bulan tanpa produksi" ambil={k => k.overheadTanpaProduksi}
                rinci="overheadTanpaProduksi" tampil={t.overheadTanpaProduksi > 0} info="overhead_tanpa_produksi" />
              <Baris kolom={kolom} onRinci={setRincian} jenis="rinci" negatif label="Beban operasional" ambil={k => k.bebanOperasional}
                rinci="bebanOperasional" tampil={t.bebanOperasional > 0} info="beban_operasional" />
              <Baris kolom={kolom} onRinci={setRincian} jenis="total" label="Laba bersih" ambil={k => k.labaBersih} rinci="labaBersih" info="laba_bersih" />
            </TableBody>
          </Table>
        </div>
        <p className="text-[11px] text-[#5f6368] mt-2">
          Persentase di bawah laba = margin terhadap pendapatan.
          {data.overheadSementara && <span className="text-amber-300/80"> Overhead bulan berjalan masih sementara (dihitung s/d hari ini, final setelah bulan tutup).</span>}
          {semua && ' Order berjalan = barang yang sudah dipotong tapi belum dikirim, dihitung dengan harga jual dan biaya per pcs PO-nya.'}
          {data.pendapatanBelumValidasi > 0 && <> {idr(data.pendapatanBelumValidasi)} pendapatan berasal dari Surat Jalan yang belum divalidasi kantor.</>}
        </p>

        {data.lrPerBulan.length > 0 && (
          <div data-panduan="lr-bulanan" className="mt-4 rounded-xl border border-[#2A2D31] overflow-x-auto bg-[#1A1D1F]">
            <Table>
              <TableHeader className="bg-[#1A1C1E]">
                <TableRow className="border-[#2A2D31] hover:bg-transparent">
                  <TableHead className="text-[#9aa0a6]">Bulan (aktual)</TableHead>
                  <TableHead className="text-[#9aa0a6] text-right">Pendapatan</TableHead>
                  <TableHead className="text-[#9aa0a6] text-right">HPP</TableHead>
                  <TableHead className="text-[#9aa0a6] text-right">Laba kotor</TableHead>
                  <TableHead className="text-[#9aa0a6] text-right"><span className="inline-flex items-center gap-1">Beban usaha <InfoIstilah k="beban_usaha" /></span></TableHead>
                  <TableHead className="text-[#9aa0a6] text-right">Laba bersih</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.lrPerBulan.map(b => (
                  <TableRow key={b.bulan} className="border-[#2A2D31] hover:bg-[#16181A] cursor-pointer" onClick={() => gantiPeriode(b.bulan)}>
                    <TableCell className="text-sm text-sky-300 whitespace-nowrap">{blnFmt(b.bulan)}</TableCell>
                    <TableCell className="text-sm text-[#e8eaed] text-right font-mono whitespace-nowrap">{idr(b.pendapatan)}</TableCell>
                    <TableCell className="text-sm text-[#e8eaed] text-right font-mono whitespace-nowrap">{akt(-b.hpp)}</TableCell>
                    <TableCell className={`text-sm text-right font-mono whitespace-nowrap ${warnaAngka(b.labaKotor)}`}>
                      {akt(b.labaKotor)}<span className="block text-[10px] text-[#9aa0a6]">{pct(b.labaKotor, b.pendapatan)}</span>
                    </TableCell>
                    <TableCell className="text-sm text-[#e8eaed] text-right font-mono whitespace-nowrap">{akt(-b.bebanUsaha)}</TableCell>
                    <TableCell className={`text-sm font-semibold text-right font-mono whitespace-nowrap ${warnaAngka(b.labaBersih)}`}>
                      {akt(b.labaBersih)}<span className="block text-[10px] font-normal text-[#9aa0a6]">{pct(b.labaBersih, b.pendapatan)}</span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      {/* ── 2. Posisi keuangan ── */}
      <div data-panduan="posisi">
        <Judul no="2" sub={`Per ${tglFmt(data.perTanggal)}`}>Posisi Aset & Kewajiban</Judul>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-xl bg-[#1A1D1F] border border-[#2A2D31] px-4 py-2">
            <p className="text-[10px] uppercase tracking-widest text-[#9aa0a6] font-bold pt-2 pb-1">Aset</p>
            <Pos k="persediaan_bahan" label="Persediaan bahan baku" nilai={posisi.persediaanBahan} sub="Bahan sudah dibeli, belum dipotong">
              {data.stokTersisaRinci.length ? data.stokTersisaRinci.map(s => (
                <Rinci key={s.nama} nilai={s.nilai}
                  label={`${s.nama} — ${s.qty.toLocaleString('id-ID', { maximumFractionDigits: 2 })} ${s.satuan}`} />
              )) : undefined}
            </Pos>
            {posisi.persediaanPembantu > 0 && (
              <Pos k="persediaan_pembantu" label="Persediaan bahan pembantu" nilai={posisi.persediaanPembantu}
                sub={`Saldo di rak (belum terpakai jatah HPP): barang lama ${idr(posisi.persediaanPembantuLama)} + belanja ${idr(posisi.persediaanPembantu - posisi.persediaanPembantuLama)}`}>
                {data.pembantuLamaRinci.filter(p => p.sisa > 0).map(p => (
                  <Rinci key={p.nama} nilai={p.sisa}
                    label={`${p.nama} — dari barang lama ${idr(p.lama)}${p.belanja > 0 ? ` + belanja ${idr(p.belanja)}` : ''}`} />
                ))}
              </Pos>
            )}
            <Pos k="barang_dalam_proses" label="Barang dalam proses" nilai={posisi.barangDalamProses}
              sub="Biaya bahan, upah & overhead untuk barang yang belum dikirim" />
            {posisi.piutang > 0 && <Pos k="piutang" label="Piutang usaha" nilai={posisi.piutang} sub="Sudah dikirim, belum dibayar pelanggan" />}
            <Pos k="total_aset" label="Total aset (di luar kas)" nilai={posisi.totalAset} tebal />
            {data.sewaSisa.length > 0 && (
              <p className="text-[11px] text-[#9aa0a6] py-2 leading-relaxed">
                Catatan: {data.sewaSisa.map(b => `${b.nama} sudah dibayar sampai ${tglFmt(b.sampai)} (sisa ${b.hari} hari)`).join('; ')}.
                Sisa kontrak tidak dihitung sebagai aset — sewa dibebankan per hari ke overhead produksi.
              </p>
            )}
          </div>
          <div className="rounded-xl bg-[#1A1D1F] border border-[#2A2D31] px-4 py-2">
            <p className="text-[10px] uppercase tracking-widest text-[#9aa0a6] font-bold pt-2 pb-1">Kewajiban</p>
            <Pos k="uang_muka" label="Uang muka pelanggan" nilai={posisi.uangMukaPelanggan}
              sub="DP diterima, barang belum dikirim — dilunasi dengan pengiriman" />
            <Pos k="upah_terutang" label="Upah terutang" nilai={posisi.upahTerutang} sub="Pekerjaan sudah selesai, upah belum dibayar" />
            <Pos k="total_kewajiban" label="Total kewajiban" nilai={posisi.totalKewajiban} tebal />
          </div>
        </div>
        <p className="text-[11px] text-[#5f6368] mt-2">
          Posisi selalu per hari ini, tidak ikut pilihan periode. Saldo kas tidak ditampilkan karena saldo awal sebelum {tglFmt(data.sejak)} belum tercatat.
        </p>
      </div>

      {/* ── 3. Arus kas ── */}
      <div data-panduan="arus-kas">
        <Judul no="3" sub={`Uang yang benar-benar masuk & keluar di Buku Kas — ${semua ? `sejak ${tglFmt(data.sejak)}` : blnFmt(data.periode)}`} k="arus_kas">Arus Kas</Judul>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-xl bg-[#1A1D1F] border border-[#2A2D31] px-4 py-2">
            <p className="text-[10px] uppercase tracking-widest text-[#9aa0a6] font-bold pt-2 pb-1">Kas masuk</p>
            <Pos label="Dari pelanggan (DP & pelunasan)" nilai={arusKas.masukKlien} />
            {arusKas.pendapatanLain > 0 && <Pos label="Pendapatan lain" nilai={arusKas.pendapatanLain} />}
            <Pos k="setoran_modal" label="Setoran modal pemilik" nilai={arusKas.setoranModal} />
            <Pos label="Total kas masuk" nilai={arusKas.totalMasuk} tebal />
          </div>
          <div className="rounded-xl bg-[#1A1D1F] border border-[#2A2D31] px-4 py-2">
            <p className="text-[10px] uppercase tracking-widest text-[#9aa0a6] font-bold pt-2 pb-1">Kas keluar</p>
            {arusKas.keluar.map(k => <Pos key={k.kategori} label={k.kategori} nilai={k.nominal} />)}
            <Pos label="Total kas keluar" nilai={arusKas.totalKeluar} tebal />
          </div>
        </div>
        <div className="mt-3 rounded-xl border border-[#2A2D31] bg-[#1A1D1F] px-4 py-3 flex justify-between">
          <span className="flex items-center gap-1.5 text-sm font-bold text-[#e8eaed]">Arus kas bersih <InfoIstilah k="arus_kas_bersih" /></span>
          <span className={`text-sm font-bold font-mono ${warnaAngka(arusKas.bersih)}`}>{akt(arusKas.bersih)}</span>
        </div>
        {semua && data.arusKasPerBulan.length > 1 && (
          <div className="mt-3 rounded-xl border border-[#2A2D31] overflow-x-auto bg-[#1A1D1F]">
            <Table>
              <TableHeader className="bg-[#1A1C1E]">
                <TableRow className="border-[#2A2D31] hover:bg-transparent">
                  <TableHead className="text-[#9aa0a6]">Bulan</TableHead>
                  <TableHead className="text-[#9aa0a6] text-right">Kas masuk</TableHead>
                  <TableHead className="text-[#9aa0a6] text-right">Kas keluar</TableHead>
                  <TableHead className="text-[#9aa0a6] text-right">Arus kas bersih</TableHead>
                  <TableHead className="text-[#9aa0a6] text-right">Kumulatif</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.arusKasPerBulan.map(b => (
                  <TableRow key={b.bulan} className="border-[#2A2D31] hover:bg-[#16181A]">
                    <TableCell className="text-sm text-[#e8eaed] whitespace-nowrap">{blnFmt(b.bulan)}</TableCell>
                    <TableCell className="text-sm text-[#e8eaed] text-right font-mono whitespace-nowrap">{idr(b.masuk)}</TableCell>
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
      <div data-panduan="laba-po">
        <div className="flex flex-wrap items-end justify-between gap-2 mb-2">
          <Judul no="4" sub="Seluruh PO periode ini (tidak ikut pilihan bulan). Laba = nilai jual − bahan − upah − overhead produksi, termasuk perkiraan biaya yang belum tercatat.">
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
                <TableHead className="text-[#9aa0a6]"><span className="inline-flex items-center gap-1">Status <InfoIstilah k="status_kirim" /></span></TableHead>
                <TableHead className="text-[#9aa0a6] text-right"><span className="inline-flex items-center gap-1">Potong / kirim <InfoIstilah k="potong_kirim" /></span></TableHead>
                <TableHead className="text-[#9aa0a6] text-right"><span className="inline-flex items-center gap-1">Nilai jual <InfoIstilah k="nilai_jual" /></span></TableHead>
                {adaDiterimaPo && <TableHead className="text-[#9aa0a6] text-right"><span className="inline-flex items-center gap-1">DP diterima <InfoIstilah k="dp_diterima" /></span></TableHead>}
                <TableHead className="text-[#9aa0a6] text-right"><span className="inline-flex items-center gap-1">Bahan <InfoIstilah k="po_bahan" /></span></TableHead>
                <TableHead className="text-[#9aa0a6] text-right"><span className="inline-flex items-center gap-1">Upah <InfoIstilah k="po_upah" /></span></TableHead>
                <TableHead className="text-[#9aa0a6] text-right"><span className="inline-flex items-center gap-1">Overhead <InfoIstilah k="po_overhead" /></span></TableHead>
                <TableHead className="text-[#9aa0a6] text-right"><span className="inline-flex items-center gap-1">Laba <InfoIstilah k="laba" /></span></TableHead>
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
                    <TableCell className="text-sm text-[#9aa0a6] text-right whitespace-nowrap"
                      title={`Kain ${idr(p.kain)} · aksesori ${idr(p.aksesori)}${p.sisa_bahan > 0.5 ? ` · perkiraan aksesori belum tercatat ${idr(p.sisa_bahan)}` : ''}`}>
                      {idr(p.kain + p.aksesori + p.sisa_bahan)}
                    </TableCell>
                    <TableCell className="text-sm text-[#9aa0a6] text-right whitespace-nowrap"
                      title={`Dibayar ${idr(p.upah_lunas)} · terutang ${idr(p.upah_belum_lunas)} · perkiraan tahap berikutnya ${idr(p.upah_sisa)}`}>
                      {idr(upah)}
                    </TableCell>
                    <TableCell className="text-sm text-[#9aa0a6] text-right whitespace-nowrap"
                      title={p.sisa_pembantu > 0.5 ? `Overhead tercatat ${idr(p.overhead)} · perkiraan bahan pembantu pcs belum jahit ${idr(p.sisa_pembantu)}` : undefined}>
                      {idr(p.overhead + p.sisa_pembantu)}
                    </TableCell>
                    <TableCell className={`text-sm font-semibold text-right whitespace-nowrap ${warnaAngka(p.laba)}`}>
                      {akt(p.laba)}
                      {p.nilai_jual > 0 && (
                        <span className="block text-[10px] text-[#9aa0a6] font-normal">margin {pct(p.laba, p.nilai_jual)}</span>
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
          Biaya bahan dihitung dari pemakaian aktual, bukan dari pembelian. Overhead produksi (termasuk sewa rumah produksi)
          dibagi ke pcs yang dipotong di bulan yang sama. Angka &ldquo;Order berjalan&rdquo; adalah perkiraan
          dengan anggapan semua barang terkirim tanpa reject.
        </p>
      </div>
      <PoDetailDialog po={poDipilih} onClose={() => setPoDipilih(null)} />
      <RincianDialog jenis={rincian} data={data} onClose={() => setRincian(null)} />
    </div>
  );
}
