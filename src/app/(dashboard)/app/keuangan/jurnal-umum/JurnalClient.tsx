'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Trash2, Plus, Loader2, TrendingUp, TrendingDown, Filter } from 'lucide-react';
import { toast } from 'sonner';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow
} from '@/components/ui/table';
import {
  addJurnalEntry,
  deleteJurnalEntry,
  getJurnalEntries,
  type JurnalEntry,
  type KategoriTrxItem,
} from '@/lib/actions/keuangan/jurnal.actions';

// ─── CONSTANTS ──────────────────────────────────────────────────────────────

// Opsi jenis untuk FORM TAMBAH — direct_upah SENGAJA TIDAK ADA (hanya dari sistem)
const JENIS_OPTIONS = [
  { value: 'direct_bahan', label: 'Pembelian Bahan' },
  { value: 'overhead',     label: 'Biaya Overhead' },
  { value: 'masuk',        label: 'Pemasukan' },
];

// Label untuk TABEL — semua jenis termasuk direct_upah
const JENIS_LABELS: Record<string, string> = {
  direct_bahan: 'Pembelian Bahan',
  direct_upah:  'Upah Produksi',
  overhead:     'Biaya Overhead',
  masuk:        'Pemasukan',
};

const JENIS_BADGE: Record<string, string> = {
  direct_bahan: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  direct_upah:  'bg-purple-500/10 text-purple-400 border-purple-500/20',
  overhead:     'bg-orange-500/10 text-orange-400 border-orange-500/20',
  masuk:        'bg-green-500/10 text-green-400 border-green-500/20',
};

const BULAN = [
  'Januari','Februari','Maret','April','Mei','Juni',
  'Juli','Agustus','September','Oktober','November','Desember'
];

const idrFmt = (n: number) =>
  'Rp ' + n.toLocaleString('id-ID', { minimumFractionDigits: 0 });

const dateFmt = (d: string) =>
  new Date(d).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });

const inputCls = 'w-full h-10 px-3 rounded-lg bg-[#1E2124] border border-[#2A2D31] text-sm text-[#e8eaed] focus:ring-1 focus:ring-[#e5c17b] outline-none';
const labelCls = 'block text-[10px] font-bold text-[#9aa0a6] uppercase tracking-widest mb-1';

// ─── PROPS ──────────────────────────────────────────────────────────────────

interface Props {
  initialEntries: JurnalEntry[];
  kategoriList: KategoriTrxItem[];
  poList: { id: string; no_po: string }[];
}

// ─── DEFAULT FORM ────────────────────────────────────────────────────────────

const defaultForm = {
  tanggal: '',
  jenis: 'masuk',
  kategori_trx_id: '',
  nominal: '',
  keterangan: '',
  no_faktur: '',
  qty: '',
  tag_po_ids: [] as string[],
};

// ─── COMPONENT ───────────────────────────────────────────────────────────────

export default function JurnalClient({ initialEntries, kategoriList, poList }: Props) {
  const router = useRouter();

  // Map PO ID to no_po for quick lookup
  const poMap = React.useMemo(() => {
    const m: Record<string, string> = {};
    poList.forEach(p => { m[p.id] = p.no_po; });
    return m;
  }, [poList]);

  // Entries & filter state
  const [entries, setEntries] = useState<JurnalEntry[]>(initialEntries);
  const [filterBulan, setFilterBulan] = useState('');
  const [filterTahun, setFilterTahun] = useState(String(new Date().getFullYear()));
  const [filterJenis, setFilterJenis] = useState('');
  const [filtering, setFiltering] = useState(false);

  // Modal state
  const [addOpen, setAddOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState(defaultForm);

  // Delete state
  const [deleteTarget, setDeleteTarget] = useState<JurnalEntry | null>(null);
  const [deleting, setDeleting] = useState(false);

  // ─── FILTER ─────────────────────────────────────────────────────────────

  const handleFilter = async () => {
    setFiltering(true);
    try {
      const data = await getJurnalEntries({
        bulan: filterBulan || undefined,
        tahun: filterTahun || undefined,
        jenis: filterJenis || undefined,
      });
      setEntries(data);
    } catch (e: any) {
      toast.error(e.message || 'Gagal memuat data');
    } finally {
      setFiltering(false);
    }
  };

  // ─── SUMMARY ─────────────────────────────────────────────────────────────

  const sum = (jenis: string) =>
    entries.filter(e => e.jenis === jenis).reduce((acc, e) => acc + e.nominal, 0);

  const summaryCards = [
    { label: 'Total Masuk',        value: sum('masuk'),        color: 'text-green-400' },
    { label: 'Total Direct Bahan', value: sum('direct_bahan'), color: 'text-red-400' },
    { label: 'Total Upah',         value: sum('direct_upah'),  color: 'text-orange-400' },
    { label: 'Total Overhead',     value: sum('overhead'),     color: 'text-orange-400' },
  ];

  // ─── ADD ENTRY ───────────────────────────────────────────────────────────

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    const result = await addJurnalEntry({
      kategori_trx_id: form.kategori_trx_id,
      jenis: form.jenis,
      nominal: parseFloat(form.nominal),
      tanggal: form.tanggal,
      keterangan: form.keterangan,
      no_faktur: form.no_faktur || undefined,
      qty: form.qty ? parseFloat(form.qty) : undefined,
      tag_po_ids: form.tag_po_ids,
    });
    setSubmitting(false);
    if (!result.success) { toast.error(result.error || 'Gagal menambahkan'); return; }
    toast.success('Entri jurnal berhasil ditambahkan');
    setAddOpen(false);
    setForm(defaultForm);
    router.refresh();
    // Re-fetch agar tabel terupdate tanpa full reload
    const fresh = await getJurnalEntries({
      bulan: filterBulan || undefined,
      tahun: filterTahun || undefined,
      jenis: filterJenis || undefined,
    });
    setEntries(fresh);
  };

  // ─── DELETE ──────────────────────────────────────────────────────────────

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    const result = await deleteJurnalEntry(deleteTarget.id);
    setDeleting(false);
    if (!result.success) { toast.error(result.error || 'Gagal menghapus'); return; }
    toast.success('Entri dihapus');
    setDeleteTarget(null);
    setEntries(prev => prev.filter(e => e.id !== deleteTarget.id));
  };

  const isBahan = form.jenis === 'direct_bahan';

  // ─── RENDER ──────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6 mt-4">

      {/* Header row */}
      <div className="flex items-center justify-between">
        <h2 className="text-base font-bold text-[#e8eaed]">Daftar Transaksi</h2>
        <Button onClick={() => setAddOpen(true)}
          className="bg-[#e5c17b] text-[#0D0E10] hover:bg-[#d4b06a] font-bold text-xs h-9 px-4">
          <Plus className="h-4 w-4 mr-1" /> Tambah Entri
        </Button>
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap gap-3 items-end p-4 rounded-xl bg-[#1A1D1F] border border-[#2A2D31]">
        <div>
          <p className={labelCls}>Bulan</p>
          <select className="h-9 px-3 rounded-lg bg-[#1E2124] border border-[#2A2D31] text-sm text-[#e8eaed] outline-none focus:ring-1 focus:ring-[#e5c17b]"
            value={filterBulan} onChange={e => setFilterBulan(e.target.value)}>
            <option value="">Semua</option>
            {BULAN.map((b, i) => <option key={i} value={String(i + 1).padStart(2,'0')}>{b}</option>)}
          </select>
        </div>
        <div>
          <p className={labelCls}>Tahun</p>
          <input type="number" className="h-9 w-24 px-3 rounded-lg bg-[#1E2124] border border-[#2A2D31] text-sm text-[#e8eaed] outline-none focus:ring-1 focus:ring-[#e5c17b]"
            value={filterTahun} onChange={e => setFilterTahun(e.target.value)} />
        </div>
        <div>
          <p className={labelCls}>Jenis</p>
          <select className="h-9 px-3 rounded-lg bg-[#1E2124] border border-[#2A2D31] text-sm text-[#e8eaed] outline-none focus:ring-1 focus:ring-[#e5c17b]"
            value={filterJenis} onChange={e => setFilterJenis(e.target.value)}>
            <option value="">Semua</option>
            {JENIS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <Button onClick={handleFilter} disabled={filtering}
          className="h-9 bg-[#2A2D31] text-[#e8eaed] hover:bg-[#3A3D41] text-xs">
          {filtering ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Filter className="h-4 w-4 mr-1" />}
          Terapkan Filter
        </Button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {summaryCards.map(card => (
          <div key={card.label} className="p-4 rounded-xl bg-[#1A1D1F] border border-[#2A2D31]">
            <p className="text-[10px] uppercase tracking-widest text-[#9aa0a6] font-bold mb-1">{card.label}</p>
            <p className={`text-sm font-bold ${card.color}`}>{idrFmt(card.value)}</p>
          </div>
        ))}
      </div>

      {/* Tabel */}
      <div className="rounded-xl border border-[#2A2D31] overflow-hidden">
        <Table>
          <TableHeader className="bg-[#1A1C1E]">
            <TableRow className="border-[#2A2D31] hover:bg-transparent">
              <TableHead className="text-[#9aa0a6]">Tanggal</TableHead>
              <TableHead className="text-[#9aa0a6]">Kategori</TableHead>
              <TableHead className="text-[#9aa0a6]">Jenis</TableHead>
              <TableHead className="text-[#9aa0a6]">Tag PO</TableHead>
              <TableHead className="text-[#9aa0a6]">Keterangan</TableHead>
              <TableHead className="text-[#9aa0a6]">No. Faktur</TableHead>
              <TableHead className="text-[#9aa0a6] text-right">Nominal</TableHead>
              <TableHead className="text-[#9aa0a6] w-14 text-center">Aksi</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.length === 0 ? (
              <TableRow className="hover:bg-transparent border-[#2A2D31]">
                <TableCell colSpan={7} className="h-32 text-center text-[#5f6368]">
                  Belum ada transaksi
                </TableCell>
              </TableRow>
            ) : entries.map(entry => (
              <TableRow key={entry.id} className="border-[#2A2D31] hover:bg-[#1A1C1E]/50">
                <TableCell className="text-sm text-[#e8eaed] whitespace-nowrap">{dateFmt(entry.tanggal)}</TableCell>
                <TableCell className="text-sm text-[#9aa0a6]">{entry.kategori_nama}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-1.5">
                    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${JENIS_BADGE[entry.jenis] ?? 'text-[#9aa0a6]'}`}>
                      {JENIS_LABELS[entry.jenis] ?? entry.jenis}
                    </span>
                    {entry.jenis === 'direct_upah' && (
                      <span className="inline-flex items-center rounded-full border border-sky-500/30 bg-sky-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-sky-400">
                        OTOMATIS
                      </span>
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1 max-w-[150px]">
                    {entry.tag_po_ids.length > 0 ? (
                      entry.tag_po_ids.map(pid => (
                        <span key={pid} className="bg-[#2A2D31] text-[#9aa0a6] text-[10px] px-1.5 py-0.5 rounded border border-[#3A3D41]">
                          {poMap[pid] || '???'}
                        </span>
                      ))
                    ) : (
                      <span className="text-[#5f6368] text-xs">-</span>
                    )}
                  </div>
                </TableCell>
                <TableCell className="text-sm text-[#e8eaed] max-w-[200px] truncate">{entry.keterangan}</TableCell>
                <TableCell className="text-sm text-[#9aa0a6] font-mono">{entry.no_faktur ?? '-'}</TableCell>
                <TableCell className="text-sm font-semibold text-right text-[#e8eaed]">{idrFmt(entry.nominal)}</TableCell>
                <TableCell className="text-center">
                  <Button variant="ghost" size="icon"
                    onClick={() => entry.jenis !== 'direct_upah' && setDeleteTarget(entry)}
                    disabled={entry.jenis === 'direct_upah'}
                    title={entry.jenis === 'direct_upah' ? 'Entry otomatis tidak dapat dihapus' : 'Hapus'}
                    className={`h-8 w-8 ${
                      entry.jenis === 'direct_upah'
                        ? 'text-[#3A3D41] opacity-30 cursor-not-allowed'
                        : 'text-[#9aa0a6] hover:text-red-400 hover:bg-red-400/10'
                    }`}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* ─── MODAL TAMBAH ───────────────────────────────────────────────────── */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="bg-[#16181A] border-[#2A2D31] text-[#e8eaed] sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Tambah Entri Jurnal</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleAdd} className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>Tanggal *</label>
                <input type="date" required className={inputCls}
                  value={form.tanggal} onChange={e => setForm(f => ({ ...f, tanggal: e.target.value }))} />
              </div>
              <div>
                <label className={labelCls}>Jenis *</label>
                <select required className={inputCls}
                  value={form.jenis} 
                  onChange={e => {
                    const newJenis = e.target.value;
                    setForm(f => ({ ...f, jenis: newJenis, kategori_trx_id: '', tag_po_ids: [] }));
                  }}
                >
                  {JENIS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className={labelCls}>Kategori *</label>
              <select required className={inputCls}
                value={form.kategori_trx_id} onChange={e => setForm(f => ({ ...f, kategori_trx_id: e.target.value }))}>
                <option value="">-- Pilih Kategori --</option>
                {kategoriList
                  .filter(k => k.jenis === form.jenis)
                  .map(k => <option key={k.id} value={k.id}>{k.nama}</option>)
                }
              </select>
              {kategoriList.filter(k => k.jenis === form.jenis).length === 0 && (
                <p className="text-[10px] text-orange-400 mt-1">Belum ada kategori untuk jenis ini</p>
              )}
            </div>
            <div>
              <label className={labelCls}>Nominal (Rp) *</label>
              <input type="number" required min="1" className={inputCls}
                placeholder="contoh: 500000"
                value={form.nominal} onChange={e => setForm(f => ({ ...f, nominal: e.target.value }))} />
            </div>
            <div>
              <label className={labelCls}>Keterangan *</label>
              <input type="text" required className={inputCls}
                placeholder="Deskripsi transaksi"
                value={form.keterangan} onChange={e => setForm(f => ({ ...f, keterangan: e.target.value }))} />
            </div>
            {isBahan && (
              <>
                <div>
                  <label className={labelCls}>No. Faktur *</label>
                  <input type="text" required={isBahan} className={inputCls}
                    placeholder="contoh: INV-001"
                    value={form.no_faktur} onChange={e => setForm(f => ({ ...f, no_faktur: e.target.value }))} />
                </div>
                <div>
                  <label className={labelCls}>Qty *</label>
                  <input type="number" required={isBahan} min="0.001" step="0.001" className={inputCls}
                    placeholder="contoh: 10"
                    value={form.qty} onChange={e => setForm(f => ({ ...f, qty: e.target.value }))} />
                </div>
              </>
            )}

            {/* Tag PO Multi-select (for direct_bahan and masuk) */}
            {(isBahan || form.jenis === 'masuk') && (
              <div>
                <label className={labelCls}>Tag ke PO {isBahan && '*'}</label>
                <div className="mt-2 p-3 rounded-lg bg-[#1A1D1F] border border-[#2A2D31] max-h-40 overflow-y-auto space-y-2">
                  {poList.length === 0 ? (
                    <p className="text-xs text-[#5f6368]">Belum ada data PO aktif</p>
                  ) : (
                    poList.map(po => (
                      <label key={po.id} className="flex items-center gap-2 cursor-pointer group">
                        <input
                          type="checkbox"
                          className="w-4 h-4 rounded border-[#2A2D31] bg-[#1E2124] text-[#e5c17b] focus:ring-offset-0 focus:ring-1 focus:ring-[#e5c17b]"
                          checked={form.tag_po_ids.includes(po.id)}
                          onChange={e => {
                            const checked = e.target.checked;
                            setForm(f => ({
                              ...f,
                              tag_po_ids: checked
                                ? [...f.tag_po_ids, po.id]
                                : f.tag_po_ids.filter(id => id !== po.id)
                            }));
                          }}
                        />
                        <span className="text-sm text-[#9aa0a6] group-hover:text-[#e8eaed] transition-colors font-mono">
                          {po.no_po}
                        </span>
                      </label>
                    ))
                  )}
                </div>
                {isBahan && form.tag_po_ids.length === 0 && (
                  <p className="text-[10px] text-red-400 mt-1">Wajib pilih minimal 1 PO</p>
                )}
              </div>
            )}

            <DialogFooter className="pt-2">
              <Button type="button" variant="outline" onClick={() => setAddOpen(false)}
                className="border-[#2A2D31] bg-transparent text-[#e8eaed]" disabled={submitting}>
                Batal
              </Button>
              <Button type="submit" disabled={submitting}
                className="bg-[#e5c17b] text-[#0D0E10] hover:bg-[#d4b06a] font-bold">
                {submitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                {submitting ? 'Menyimpan...' : 'Simpan'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ─── KONFIRMASI HAPUS ──────────────────────────────────────────────── */}
      <Dialog open={!!deleteTarget} onOpenChange={open => { if (!open) setDeleteTarget(null); }}>
        <DialogContent className="bg-[#16181A] border-[#2A2D31] text-[#e8eaed] sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Konfirmasi Hapus</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-[#9aa0a6] py-2">
            Yakin hapus entri jurnal <span className="text-[#e8eaed] font-semibold">{deleteTarget?.keterangan}</span>? 
            Tindakan ini tidak dapat dibatalkan.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}
              className="border-[#2A2D31] bg-transparent text-[#e8eaed]" disabled={deleting}>
              Batal
            </Button>
            <Button onClick={handleDelete} disabled={deleting}
              className="bg-red-600 hover:bg-red-700 text-white font-bold">
              {deleting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Trash2 className="h-4 w-4 mr-2" />}
              {deleting ? 'Menghapus...' : 'Ya, Hapus'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}
