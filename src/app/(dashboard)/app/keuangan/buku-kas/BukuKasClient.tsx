'use client';

import React, { useState } from 'react';
import { toast } from 'sonner';
import { Plus, Trash2, Loader2, Filter, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  type BukuKasEntry,
  type AddBukuKasInput,
  KATEGORI_MASUK,
  KATEGORI_KELUAR,
  getBukuKasEntries,
  addBukuKas,
  deleteBukuKas,
} from '@/lib/actions/keuangan/buku-kas.actions';

// ─── CONSTANTS ───────────────────────────────────────────────────────────────

const BULAN = [
  'Januari','Februari','Maret','April','Mei','Juni',
  'Juli','Agustus','September','Oktober','November','Desember',
];

const idrFmt = (n: number) =>
  'Rp ' + Math.abs(n).toLocaleString('id-ID', { minimumFractionDigits: 0 });

const dateFmt = (d: string) =>
  new Date(d).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });

const inputCls = 'w-full h-10 px-3 rounded-lg bg-[#1E2124] border border-[#2A2D31] text-sm text-[#e8eaed] focus:ring-1 focus:ring-[#e5c17b] outline-none';
const labelCls = 'block text-[10px] font-bold text-[#9aa0a6] uppercase tracking-widest mb-1';

// ─── PROPS ───────────────────────────────────────────────────────────────────

interface Props {
  initialEntries: BukuKasEntry[];
  poList: { id: string; no_po: string }[];
}

// ─── DEFAULT FORM ─────────────────────────────────────────────────────────────

const makeDefaultForm = (tipe: 'masuk' | 'keluar') => ({
  tanggal: '',
  tipe,
  kategori: '',
  nominal: '',
  keterangan: '',
  no_referensi: '',
  po_id: '',
});

// ─── COMPONENT ───────────────────────────────────────────────────────────────

export default function BukuKasClient({ initialEntries, poList }: Props) {
  const [entries, setEntries] = useState<BukuKasEntry[]>(initialEntries);
  const [filterBulan, setFilterBulan] = useState('');
  const [filterTahun, setFilterTahun] = useState(String(new Date().getFullYear()));
  const [filterTipe, setFilterTipe] = useState('');
  const [filtering, setFiltering] = useState(false);

  // Modal state
  const [modalTipe, setModalTipe] = useState<'masuk' | 'keluar' | null>(null);
  const [form, setForm] = useState(makeDefaultForm('masuk'));
  const [submitting, setSubmitting] = useState(false);

  // Delete state
  const [deleteTarget, setDeleteTarget] = useState<BukuKasEntry | null>(null);
  const [deleting, setDeleting] = useState(false);

  // ─── DERIVED ──────────────────────────────────────────────────────────────

  const poMap = React.useMemo(() => {
    const m: Record<string, string> = {};
    poList.forEach(p => { m[p.id] = p.no_po; });
    return m;
  }, [poList]);

  const totalMasuk  = entries.filter(e => e.tipe === 'masuk').reduce((s, e) => s + e.nominal, 0);
  const totalKeluar = entries.filter(e => e.tipe === 'keluar').reduce((s, e) => s + e.nominal, 0);
  const saldo       = totalMasuk - totalKeluar;

  // ─── FILTER ───────────────────────────────────────────────────────────────

  const handleFilter = async () => {
    setFiltering(true);
    try {
      const data = await getBukuKasEntries({
        bulan: filterBulan || undefined,
        tahun: filterTahun || undefined,
        tipe:  filterTipe  || undefined,
      });
      setEntries(data);
    } catch (e: any) {
      toast.error(e.message || 'Gagal memuat data');
    } finally {
      setFiltering(false);
    }
  };

  // ─── OPEN MODAL ───────────────────────────────────────────────────────────

  const openModal = (tipe: 'masuk' | 'keluar') => {
    setForm(makeDefaultForm(tipe));
    setModalTipe(tipe);
  };

  // ─── ADD ──────────────────────────────────────────────────────────────────

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    const input: AddBukuKasInput = {
      tanggal:      form.tanggal,
      tipe:         form.tipe,
      kategori:     form.kategori,
      nominal:      parseFloat(form.nominal),
      keterangan:   form.keterangan,
      no_referensi: form.no_referensi || undefined,
      po_id:        form.po_id        || undefined,
    };
    const result = await addBukuKas(input);
    setSubmitting(false);
    if (!result.success) {
      toast.error(result.error || 'Gagal menyimpan');
      return;
    }
    toast.success(`Kas ${form.tipe === 'masuk' ? 'Masuk' : 'Keluar'} berhasil ditambahkan`);
    setModalTipe(null);
    // Refresh data
    const fresh = await getBukuKasEntries({
      bulan: filterBulan || undefined,
      tahun: filterTahun || undefined,
      tipe:  filterTipe  || undefined,
    });
    setEntries(fresh);
  };

  // ─── DELETE ───────────────────────────────────────────────────────────────

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    const result = await deleteBukuKas(deleteTarget.id);
    setDeleting(false);
    if (!result.success) {
      toast.error(result.error || 'Gagal menghapus');
      return;
    }
    toast.success('Entri dihapus');
    setEntries(prev => prev.filter(e => e.id !== deleteTarget.id));
    setDeleteTarget(null);
  };

  // ─── RENDER ───────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6 mt-4">

      {/* ─── HEADER ─────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-base font-bold text-[#e8eaed]">Buku Kas</h2>
        <div className="flex gap-2">
          <Button
            onClick={() => openModal('masuk')}
            className="bg-green-600 hover:bg-green-700 text-white font-bold text-xs h-9 px-4"
          >
            <Plus className="h-4 w-4 mr-1" /> Kas Masuk
          </Button>
          <Button
            onClick={() => openModal('keluar')}
            className="bg-red-600 hover:bg-red-700 text-white font-bold text-xs h-9 px-4"
          >
            <Plus className="h-4 w-4 mr-1" /> Kas Keluar
          </Button>
        </div>
      </div>

      {/* ─── SUMMARY CARDS ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="p-4 rounded-xl bg-[#1A1D1F] border border-[#2A2D31]">
          <div className="flex items-center justify-between mb-1">
            <p className="text-[10px] uppercase tracking-widest text-[#9aa0a6] font-bold">Total Masuk</p>
            <TrendingUp className="h-4 w-4 text-green-400" />
          </div>
          <p className="text-sm font-bold text-green-400">{idrFmt(totalMasuk)}</p>
        </div>
        <div className="p-4 rounded-xl bg-[#1A1D1F] border border-[#2A2D31]">
          <div className="flex items-center justify-between mb-1">
            <p className="text-[10px] uppercase tracking-widest text-[#9aa0a6] font-bold">Total Keluar</p>
            <TrendingDown className="h-4 w-4 text-red-400" />
          </div>
          <p className="text-sm font-bold text-red-400">{idrFmt(totalKeluar)}</p>
        </div>
        <div className="p-4 rounded-xl bg-[#1A1D1F] border border-[#2A2D31]">
          <div className="flex items-center justify-between mb-1">
            <p className="text-[10px] uppercase tracking-widest text-[#9aa0a6] font-bold">Saldo Kas</p>
            {saldo >= 0
              ? <TrendingUp className="h-4 w-4 text-[#e5c17b]" />
              : <TrendingDown className="h-4 w-4 text-red-400" />}
          </div>
          <p className={`text-sm font-bold ${saldo >= 0 ? 'text-[#e5c17b]' : 'text-red-400'}`}>
            {saldo < 0 ? '-' : ''}{idrFmt(saldo)}
          </p>
        </div>
      </div>

      {/* ─── FILTER BAR ─────────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-3 items-end p-4 rounded-xl bg-[#1A1D1F] border border-[#2A2D31]">
        <div>
          <p className={labelCls}>Bulan</p>
          <select
            className="h-9 px-3 rounded-lg bg-[#1E2124] border border-[#2A2D31] text-sm text-[#e8eaed] outline-none focus:ring-1 focus:ring-[#e5c17b]"
            value={filterBulan}
            onChange={e => setFilterBulan(e.target.value)}
          >
            <option value="">Semua</option>
            {BULAN.map((b, i) => (
              <option key={i} value={String(i + 1).padStart(2, '0')}>{b}</option>
            ))}
          </select>
        </div>
        <div>
          <p className={labelCls}>Tahun</p>
          <input
            type="number"
            className="h-9 w-24 px-3 rounded-lg bg-[#1E2124] border border-[#2A2D31] text-sm text-[#e8eaed] outline-none focus:ring-1 focus:ring-[#e5c17b]"
            value={filterTahun}
            onChange={e => setFilterTahun(e.target.value)}
          />
        </div>
        <div>
          <p className={labelCls}>Tipe</p>
          <select
            className="h-9 px-3 rounded-lg bg-[#1E2124] border border-[#2A2D31] text-sm text-[#e8eaed] outline-none focus:ring-1 focus:ring-[#e5c17b]"
            value={filterTipe}
            onChange={e => setFilterTipe(e.target.value)}
          >
            <option value="">Semua</option>
            <option value="masuk">Masuk</option>
            <option value="keluar">Keluar</option>
          </select>
        </div>
        <Button
          onClick={handleFilter}
          disabled={filtering}
          className="h-9 bg-[#2A2D31] text-[#e8eaed] hover:bg-[#3A3D41] text-xs"
        >
          {filtering
            ? <Loader2 className="h-4 w-4 animate-spin mr-1" />
            : <Filter className="h-4 w-4 mr-1" />}
          Terapkan Filter
        </Button>
        <Button
          onClick={() => {
            setFilterBulan('');
            setFilterTipe('');
            setFilterTahun(String(new Date().getFullYear()));
          }}
          variant="ghost"
          className="h-9 text-xs text-[#9aa0a6] hover:text-[#e8eaed]"
        >
          Reset
        </Button>
      </div>

      {/* ─── TABEL ──────────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-[#2A2D31] overflow-hidden bg-[#16181A]">
        <Table>
          <TableHeader className="bg-[#1A1C1E]">
            <TableRow className="border-[#2A2D31] hover:bg-transparent">
              <TableHead className="text-[#9aa0a6]">Tanggal</TableHead>
              <TableHead className="text-[#9aa0a6]">Tipe</TableHead>
              <TableHead className="text-[#9aa0a6]">Kategori</TableHead>
              <TableHead className="text-[#9aa0a6]">Keterangan</TableHead>
              <TableHead className="text-[#9aa0a6]">No. Referensi</TableHead>
              <TableHead className="text-[#9aa0a6]">Tag PO</TableHead>
              <TableHead className="text-[#9aa0a6] text-right">Nominal</TableHead>
              <TableHead className="text-[#9aa0a6] w-14 text-center">Aksi</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody className="bg-[#16181A]">
            {entries.length === 0 ? (
              <TableRow className="hover:bg-transparent border-[#2A2D31]">
                <TableCell colSpan={8} className="h-32 text-center text-[#5f6368]">
                  Belum ada transaksi kas
                </TableCell>
              </TableRow>
            ) : entries.map(entry => (
              <TableRow key={entry.id} className="border-[#2A2D31] hover:bg-[#1A1C1E]">
                <TableCell className="text-sm text-[#e8eaed] whitespace-nowrap">
                  {dateFmt(entry.tanggal)}
                </TableCell>
                <TableCell>
                  <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-bold ${
                    entry.tipe === 'masuk'
                      ? 'bg-green-500/10 text-green-400 border-green-500/20'
                      : 'bg-red-500/10 text-red-400 border-red-500/20'
                  }`}>
                    {entry.tipe === 'masuk' ? 'Masuk' : 'Keluar'}
                  </span>
                </TableCell>
                <TableCell className="text-sm text-[#9aa0a6]">{entry.kategori}</TableCell>
                <TableCell className="text-sm text-[#e8eaed] max-w-[200px] truncate">
                  {entry.keterangan}
                </TableCell>
                <TableCell className="text-sm text-[#9aa0a6] font-mono">
                  {entry.no_referensi ?? '-'}
                </TableCell>
                <TableCell>
                  {entry.po_no ? (
                    <span className="bg-[#2A2D31] text-[#9aa0a6] text-[10px] px-1.5 py-0.5 rounded border border-[#3A3D41] font-mono">
                      {entry.po_no}
                    </span>
                  ) : (
                    <span className="text-[#5f6368] text-xs">-</span>
                  )}
                </TableCell>
                <TableCell className={`text-sm font-bold text-right ${
                  entry.tipe === 'masuk' ? 'text-green-400' : 'text-red-400'
                }`}>
                  {entry.tipe === 'keluar' ? '-' : '+'}{idrFmt(entry.nominal)}
                </TableCell>
                <TableCell className="text-center">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setDeleteTarget(entry)}
                    className="h-8 w-8 text-[#9aa0a6] hover:text-red-400 hover:bg-red-400/10"
                    title="Hapus"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* ─── MODAL FORM (MASUK / KELUAR) ────────────────────────────────── */}
      <Dialog open={modalTipe !== null} onOpenChange={open => { if (!open) setModalTipe(null); }}>
        <DialogContent className="bg-[#16181A] border-[#2A2D31] text-[#e8eaed] sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {modalTipe === 'masuk'
                ? <span className="text-green-400">+ Kas Masuk</span>
                : <span className="text-red-400">+ Kas Keluar</span>}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleAdd} className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>Tanggal *</label>
                <input
                  type="date"
                  required
                  className={`${inputCls} [color-scheme:dark]`}
                  value={form.tanggal}
                  onChange={e => setForm(f => ({ ...f, tanggal: e.target.value }))}
                />
              </div>
              <div>
                <label className={labelCls}>Kategori *</label>
                <select
                  required
                  className={inputCls}
                  value={form.kategori}
                  onChange={e => setForm(f => ({ ...f, kategori: e.target.value }))}
                >
                  <option value="">-- Pilih --</option>
                  {(modalTipe === 'masuk' ? KATEGORI_MASUK : KATEGORI_KELUAR).map(k => (
                    <option key={k} value={k}>{k}</option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className={labelCls}>Nominal (Rp) *</label>
              <input
                type="number"
                required
                min="1"
                placeholder="contoh: 1000000"
                className={inputCls}
                value={form.nominal}
                onChange={e => setForm(f => ({ ...f, nominal: e.target.value }))}
              />
            </div>

            <div>
              <label className={labelCls}>Keterangan *</label>
              <input
                type="text"
                required
                placeholder="Deskripsi transaksi"
                className={inputCls}
                value={form.keterangan}
                onChange={e => setForm(f => ({ ...f, keterangan: e.target.value }))}
              />
            </div>

            <div>
              <label className={labelCls}>No. Referensi <span className="text-[#5f6368] normal-case font-normal">(opsional)</span></label>
              <input
                type="text"
                placeholder="No. faktur, kwitansi, dll."
                className={inputCls}
                value={form.no_referensi}
                onChange={e => setForm(f => ({ ...f, no_referensi: e.target.value }))}
              />
            </div>

            <div>
              <label className={labelCls}>Tag ke PO <span className="text-[#5f6368] normal-case font-normal">(opsional)</span></label>
              <select
                className={inputCls}
                value={form.po_id}
                onChange={e => setForm(f => ({ ...f, po_id: e.target.value }))}
              >
                <option value="">-- Tidak ada --</option>
                {poList.map(po => (
                  <option key={po.id} value={po.id}>{po.no_po}</option>
                ))}
              </select>
            </div>

            <DialogFooter className="pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setModalTipe(null)}
                className="border-[#2A2D31] bg-transparent text-[#e8eaed]"
                disabled={submitting}
              >
                Batal
              </Button>
              <Button
                type="submit"
                disabled={submitting}
                className={modalTipe === 'masuk'
                  ? 'bg-green-600 hover:bg-green-700 text-white font-bold'
                  : 'bg-red-600 hover:bg-red-700 text-white font-bold'}
              >
                {submitting && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                {submitting ? 'Menyimpan...' : 'Simpan'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ─── KONFIRMASI HAPUS ───────────────────────────────────────────── */}
      <Dialog open={!!deleteTarget} onOpenChange={open => { if (!open) setDeleteTarget(null); }}>
        <DialogContent className="bg-[#16181A] border-[#2A2D31] text-[#e8eaed] sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Konfirmasi Hapus</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-[#9aa0a6] py-2">
            Yakin hapus entri{' '}
            <span className="text-[#e8eaed] font-semibold">{deleteTarget?.keterangan}</span>?{' '}
            Tindakan ini tidak dapat dibatalkan.
          </p>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteTarget(null)}
              className="border-[#2A2D31] bg-transparent text-[#e8eaed]"
              disabled={deleting}
            >
              Batal
            </Button>
            <Button
              onClick={handleDelete}
              disabled={deleting}
              className="bg-red-600 hover:bg-red-700 text-white font-bold"
            >
              {deleting
                ? <Loader2 className="h-4 w-4 animate-spin mr-2" />
                : <Trash2 className="h-4 w-4 mr-2" />}
              {deleting ? 'Menghapus...' : 'Ya, Hapus'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}
