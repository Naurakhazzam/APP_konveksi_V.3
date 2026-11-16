'use client';

import React, { useMemo, useState } from 'react';
import { Loader2, Filter, Search, ChevronLeft, ChevronRight, Info } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow
} from '@/components/ui/table';
import TogglePoLama from '@/components/keuangan/TogglePoLama';
import {
  getJurnalProduksi,
  type JenisJurnal,
  type JurnalProduksiData,
} from '@/lib/actions/keuangan/jurnal.actions';

// ─── CONSTANTS ──────────────────────────────────────────────────────────────

const JENIS: Record<JenisJurnal, { label: string; badge: string; sumber: string }> = {
  kain:        { label: 'Kain',           badge: 'bg-blue-500/10 text-blue-400 border-blue-500/20',       sumber: 'Selesai Cutting (modal FIFO LOT)' },
  aksesori:    { label: 'Aksesori',       badge: 'bg-sky-500/10 text-sky-400 border-sky-500/20',          sumber: 'Pemakaian aksesori per bundle' },
  pembantu:    { label: 'Bahan Pembantu', badge: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20',       sumber: 'Buku Kas — Bahan Pembantu' },
  upah:        { label: 'Upah',           badge: 'bg-purple-500/10 text-purple-400 border-purple-500/20', sumber: 'Penggajian (upah borongan)' },
  overhead:    { label: 'Overhead',       badge: 'bg-orange-500/10 text-orange-400 border-orange-500/20', sumber: 'Buku Kas — Biaya Overhead' },
  biaya_tetap: { label: 'Biaya Tetap',    badge: 'bg-amber-500/10 text-amber-400 border-amber-500/20',    sumber: 'Biaya Overhead — kontrak, dialokasikan per hari' },
  lainnya:     { label: 'Lainnya',        badge: 'bg-zinc-500/10 text-zinc-300 border-zinc-500/20',       sumber: 'Buku Kas — Biaya Operasional & Lainnya' },
  pembelian:   { label: 'Pembelian',      badge: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20', sumber: 'Stok Masuk (masuk stok, bukan biaya)' },
};
const URUTAN_JENIS = Object.keys(JENIS) as JenisJurnal[];

const PER_HALAMAN = 50;

const idrFmt = (n: number) =>
  'Rp ' + Math.round(n).toLocaleString('id-ID', { minimumFractionDigits: 0 });

const dateFmt = (d: string) =>
  new Date(`${d}T00:00:00`).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });

const qtyFmt = (q: number | null, satuan: string | null) =>
  q == null ? '-' : `${q.toLocaleString('id-ID', { maximumFractionDigits: 3 })}${satuan ? ` ${satuan}` : ''}`;

const inputCls = 'h-9 px-3 rounded-lg bg-[#1E2124] border border-[#2A2D31] text-sm text-[#e8eaed] outline-none focus:ring-1 focus:ring-[#e5c17b]';
const labelCls = 'block text-[10px] font-bold text-[#9aa0a6] uppercase tracking-widest mb-1';

// ─── COMPONENT ───────────────────────────────────────────────────────────────

export default function JurnalClient({ initialData }: { initialData: JurnalProduksiData }) {
  const [data, setData] = useState(initialData);
  const [dari, setDari] = useState(initialData.dari);
  const [sampai, setSampai] = useState(initialData.sampai);
  const [tampilkanLama, setTampilkanLama] = useState(!initialData.hanyaPeriodeBaru);
  const [memuat, setMemuat] = useState(false);
  const [filterJenis, setFilterJenis] = useState<JenisJurnal | ''>('');
  const [cari, setCari] = useState('');
  const [halaman, setHalaman] = useState(1);

  const muat = async (opts?: { lama?: boolean }) => {
    if (!dari || !sampai || sampai < dari) { toast.error('Rentang tanggal tidak valid'); return; }
    setMemuat(true);
    try {
      const lama = opts?.lama ?? tampilkanLama;
      setData(await getJurnalProduksi({ dari, sampai, hanyaPeriodeBaru: !lama }));
      setHalaman(1);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Gagal memuat data');
    } finally {
      setMemuat(false);
    }
  };

  // ─── RINGKASAN ───────────────────────────────────────────────────────────

  const total = useMemo(() => {
    const t = Object.fromEntries(URUTAN_JENIS.map(j => [j, 0])) as Record<JenisJurnal, number>;
    data.baris.forEach(b => { t[b.jenis] += b.nominal; });
    return t;
  }, [data]);

  const kartu = [
    { label: 'Kain (cutting)',   value: total.kain,                                    color: 'text-blue-400' },
    { label: 'Aksesori & Pembantu', value: total.aksesori + total.pembantu,            color: 'text-cyan-400' },
    { label: 'Upah',             value: total.upah,                                    color: 'text-purple-400' },
    { label: 'Overhead',         value: total.overhead + total.biaya_tetap + total.lainnya, color: 'text-orange-400' },
  ];
  const totalBiaya = kartu.reduce((s, k) => s + k.value, 0);

  // ─── FILTER & PAGINASI ───────────────────────────────────────────────────

  const tersaring = useMemo(() => {
    const q = cari.trim().toLowerCase();
    return data.baris.filter(b =>
      (!filterJenis || b.jenis === filterJenis) &&
      (!q || `${b.kategori} ${b.keterangan} ${b.no_po ?? ''}`.toLowerCase().includes(q)));
  }, [data, filterJenis, cari]);

  const jumlahHalaman = Math.max(1, Math.ceil(tersaring.length / PER_HALAMAN));
  const hal = Math.min(halaman, jumlahHalaman);
  const tampil = tersaring.slice((hal - 1) * PER_HALAMAN, hal * PER_HALAMAN);
  const totalTersaring = tersaring.reduce((s, b) => s + b.nominal, 0);

  // ─── RENDER ──────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6 mt-4">

      {/* Filter bar */}
      <div className="flex flex-wrap gap-3 items-end p-4 rounded-xl bg-[#1A1D1F] border border-[#2A2D31]">
        <div>
          <p className={labelCls}>Dari</p>
          <input type="date" className={inputCls} value={dari} onChange={e => setDari(e.target.value)} />
        </div>
        <div>
          <p className={labelCls}>Sampai</p>
          <input type="date" className={inputCls} value={sampai} onChange={e => setSampai(e.target.value)} />
        </div>
        <Button onClick={() => muat()} disabled={memuat}
          className="h-9 bg-[#2A2D31] text-[#e8eaed] hover:bg-[#3A3D41] text-xs">
          {memuat ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Filter className="h-4 w-4 mr-1" />}
          Terapkan
        </Button>
        <TogglePoLama className="ml-auto" checked={tampilkanLama}
          onChange={v => { setTampilkanLama(v); muat({ lama: v }); }} />
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {kartu.map(card => (
          <div key={card.label} className="p-4 rounded-xl bg-[#1A1D1F] border border-[#2A2D31]">
            <p className="text-[10px] uppercase tracking-widest text-[#9aa0a6] font-bold mb-1">{card.label}</p>
            <p className={`text-sm font-bold ${card.color}`}>{idrFmt(card.value)}</p>
          </div>
        ))}
        <div className="p-4 rounded-xl bg-[#1A1D1F] border border-[#e5c17b]/30 col-span-2 md:col-span-1">
          <p className="text-[10px] uppercase tracking-widest text-[#9aa0a6] font-bold mb-1">Total Biaya Produksi</p>
          <p className="text-sm font-bold text-[#e5c17b]">{idrFmt(totalBiaya)}</p>
        </div>
      </div>

      <div className="flex items-start gap-2 text-xs text-[#9aa0a6]">
        <Info className="h-4 w-4 shrink-0 mt-0.5" />
        <p>
          Semua baris dibuat otomatis dari sumber aslinya — tidak ada input manual di sini.
          Overhead dicatat lewat <span className="text-[#e8eaed]">Buku Kas</span>, kontrak lewat menu{' '}
          <span className="text-[#e8eaed]">Biaya Overhead</span>. Pembelian bahan ({idrFmt(total.pembelian)}) hanya
          informasi karena masuk stok; biayanya terhitung saat kain dipakai cutting.
        </p>
      </div>

      {/* Filter jenis & cari */}
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => { setFilterJenis(''); setHalaman(1); }}
          className={`rounded-full border px-3 py-1 text-xs ${filterJenis === '' ? 'border-[#e5c17b] text-[#e5c17b]' : 'border-[#2A2D31] text-[#9aa0a6] hover:text-[#e8eaed]'}`}>
          Semua ({data.baris.length})
        </button>
        {URUTAN_JENIS.map(j => {
          const n = data.baris.filter(b => b.jenis === j).length;
          if (!n) return null;
          return (
            <button key={j} title={JENIS[j].sumber} onClick={() => { setFilterJenis(j); setHalaman(1); }}
              className={`rounded-full border px-3 py-1 text-xs ${filterJenis === j ? 'border-[#e5c17b] text-[#e5c17b]' : 'border-[#2A2D31] text-[#9aa0a6] hover:text-[#e8eaed]'}`}>
              {JENIS[j].label} ({n})
            </button>
          );
        })}
        <div className="relative ml-auto">
          <Search className="h-4 w-4 absolute left-2.5 top-2.5 text-[#5f6368]" />
          <input className={`${inputCls} pl-8 w-56`} placeholder="Cari bahan, bundle, PO…"
            value={cari} onChange={e => { setCari(e.target.value); setHalaman(1); }} />
        </div>
      </div>

      {/* Tabel */}
      <div className="rounded-xl border border-[#2A2D31] overflow-x-auto bg-[#1A1D1F]">
        <Table>
          <TableHeader className="bg-[#1A1C1E]">
            <TableRow className="border-[#2A2D31] hover:bg-transparent">
              <TableHead className="text-[#9aa0a6]">Tanggal</TableHead>
              <TableHead className="text-[#9aa0a6]">Jenis</TableHead>
              <TableHead className="text-[#9aa0a6]">Kategori</TableHead>
              <TableHead className="text-[#9aa0a6]">Keterangan</TableHead>
              <TableHead className="text-[#9aa0a6]">PO</TableHead>
              <TableHead className="text-[#9aa0a6] text-right">Qty</TableHead>
              <TableHead className="text-[#9aa0a6] text-right">Nominal</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody className="bg-[#1A1D1F]">
            {tampil.length === 0 ? (
              <TableRow className="hover:bg-transparent border-[#2A2D31]">
                <TableCell colSpan={7} className="h-32 text-center text-[#5f6368]">
                  Tidak ada transaksi pada rentang ini
                </TableCell>
              </TableRow>
            ) : tampil.map((b, i) => (
              <TableRow key={`${b.jenis}-${b.waktu ?? ''}-${i}`} className="border-[#2A2D31] hover:bg-[#16181A]">
                <TableCell className="text-sm text-[#e8eaed] whitespace-nowrap">{dateFmt(b.tanggal)}</TableCell>
                <TableCell>
                  <span title={JENIS[b.jenis]?.sumber}
                    className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap ${JENIS[b.jenis]?.badge ?? 'text-[#9aa0a6]'}`}>
                    {JENIS[b.jenis]?.label ?? b.jenis}
                  </span>
                </TableCell>
                <TableCell className="text-sm text-[#9aa0a6] whitespace-nowrap">{b.kategori}</TableCell>
                <TableCell className="text-sm text-[#e8eaed] max-w-[280px] truncate" title={b.keterangan}>{b.keterangan || '-'}</TableCell>
                <TableCell className="text-xs text-[#9aa0a6] font-mono whitespace-nowrap">{b.no_po ?? '-'}</TableCell>
                <TableCell className="text-sm text-[#9aa0a6] text-right whitespace-nowrap">{qtyFmt(b.qty, b.satuan)}</TableCell>
                <TableCell className={`text-sm font-semibold text-right whitespace-nowrap ${b.jenis === 'pembelian' ? 'text-[#9aa0a6]' : b.nominal < 0 ? 'text-red-400' : 'text-[#e8eaed]'}`}>
                  {idrFmt(b.nominal)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Paginasi */}
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-[#9aa0a6]">
        <span>
          {tersaring.length} baris · jumlah {idrFmt(totalTersaring)}
        </span>
        {jumlahHalaman > 1 && (
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" className="h-8 w-8" disabled={hal <= 1}
              onClick={() => setHalaman(hal - 1)}><ChevronLeft className="h-4 w-4" /></Button>
            <span>Halaman {hal} / {jumlahHalaman}</span>
            <Button variant="ghost" size="icon" className="h-8 w-8" disabled={hal >= jumlahHalaman}
              onClick={() => setHalaman(hal + 1)}><ChevronRight className="h-4 w-4" /></Button>
          </div>
        )}
      </div>
    </div>
  );
}
