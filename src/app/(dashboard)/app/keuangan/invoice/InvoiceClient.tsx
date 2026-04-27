'use client';

import React, { useState } from 'react';
import { toast } from 'sonner';
import {
  Trash2, Loader2, Filter, ChevronDown, ChevronUp,
  CreditCard, Receipt, AlertCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  STATUS_LABEL, STATUS_COLOR, METODE_BAYAR,
} from '@/lib/actions/keuangan/invoice.types';
import type { InvoiceRow, InvoiceDetail, InvoicePembayaran } from '@/lib/actions/keuangan/invoice.types';
import {
  getInvoiceList, getInvoiceDetail,
  addPembayaran, deletePembayaran, deleteInvoice,
} from '@/lib/actions/keuangan/invoice.actions';

// ─── CONSTANTS ───────────────────────────────────────────────────────────────

const BULAN = [
  'Januari','Februari','Maret','April','Mei','Juni',
  'Juli','Agustus','September','Oktober','November','Desember',
];

const idrFmt = (n: number) =>
  'Rp ' + Math.abs(n).toLocaleString('id-ID', { minimumFractionDigits: 0 });

const dateFmt = (d: string | null) =>
  d ? new Date(d).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }) : '-';

const inputCls  = 'w-full h-10 px-3 rounded-lg bg-[#1E2124] border border-[#2A2D31] text-sm text-[#e8eaed] focus:ring-1 focus:ring-[#e5c17b] outline-none';
const labelCls  = 'block text-[10px] font-bold text-[#9aa0a6] uppercase tracking-widest mb-1';

// ─── PROPS ───────────────────────────────────────────────────────────────────

interface Props {
  initialInvoices: InvoiceRow[];
  klienList: { id: string; nama: string }[];
}

const defaultBayarForm = (invoice_id: string) => ({
  invoice_id,
  tanggal:    '',
  jumlah:     '',
  metode:     'transfer' as const,
  keterangan: '',
});

// ─── COMPONENT ───────────────────────────────────────────────────────────────

export default function InvoiceClient({ initialInvoices, klienList }: Props) {
  const [invoices, setInvoices]     = useState<InvoiceRow[]>(initialInvoices);
  const [filtering, setFiltering]   = useState(false);

  // Filter
  const [filterStatus, setFilterStatus] = useState('');
  const [filterKlien, setFilterKlien]   = useState('');
  const [filterBulan, setFilterBulan]   = useState('');
  const [filterTahun, setFilterTahun]   = useState(String(new Date().getFullYear()));

  // Expand detail inline
  const [expandedId, setExpandedId]         = useState<string | null>(null);
  const [expandedDetail, setExpandedDetail] = useState<InvoiceDetail | null>(null);
  const [loadingDetail, setLoadingDetail]   = useState(false);

  // Catat bayar modal
  const [bayarInvoice, setBayarInvoice] = useState<InvoiceRow | null>(null);
  const [bayarForm, setBayarForm]       = useState(defaultBayarForm(''));
  const [bayaring, setBayaring]         = useState(false);

  // Delete states
  const [deleteInvoiceTarget, setDeleteInvoiceTarget] = useState<InvoiceRow | null>(null);
  const [deletingInvoice, setDeletingInvoice]         = useState(false);
  const [deleteBayarTarget, setDeleteBayarTarget]     = useState<InvoicePembayaran | null>(null);
  const [deletingBayar, setDeletingBayar]             = useState(false);

  // ─── DERIVED ──────────────────────────────────────────────────────────────

  const totalPiutang      = invoices.filter(i => i.status !== 'lunas').reduce((s, i) => s + i.sisa, 0);
  const totalLunas        = invoices.filter(i => i.status === 'lunas').reduce((s, i) => s + i.total_nilai, 0);
  const jumlahOutstanding = invoices.filter(i => i.status !== 'lunas').length;

  // ─── FILTER ───────────────────────────────────────────────────────────────

  const handleFilter = async () => {
    setFiltering(true);
    try {
      const data = await getInvoiceList({
        status:   filterStatus || undefined,
        klien_id: filterKlien  || undefined,
        bulan:    filterBulan  || undefined,
        tahun:    filterTahun  || undefined,
      });
      setInvoices(data);
      setExpandedId(null);
      setExpandedDetail(null);
    } catch (e: any) {
      toast.error(e.message || 'Gagal memuat data');
    } finally {
      setFiltering(false);
    }
  };

  // ─── EXPAND DETAIL ────────────────────────────────────────────────────────

  const toggleExpand = async (id: string) => {
    if (expandedId === id) {
      setExpandedId(null);
      setExpandedDetail(null);
      return;
    }
    setExpandedId(id);
    setExpandedDetail(null);
    setLoadingDetail(true);
    try {
      const detail = await getInvoiceDetail(id);
      setExpandedDetail(detail);
    } catch {
      toast.error('Gagal memuat detail invoice');
    } finally {
      setLoadingDetail(false);
    }
  };

  // ─── CATAT BAYAR ──────────────────────────────────────────────────────────

  const openBayar = (inv: InvoiceRow) => {
    setBayarInvoice(inv);
    setBayarForm(defaultBayarForm(inv.id));
  };

  const handleBayar = async (e: React.FormEvent) => {
    e.preventDefault();
    setBayaring(true);
    const result = await addPembayaran({
      invoice_id: bayarForm.invoice_id,
      tanggal:    bayarForm.tanggal,
      jumlah:     parseFloat(bayarForm.jumlah),
      metode:     bayarForm.metode,
      keterangan: bayarForm.keterangan || undefined,
    });
    setBayaring(false);
    if (!result.success) {
      toast.error(result.error || 'Gagal mencatat pembayaran');
      return;
    }
    toast.success('Pembayaran berhasil dicatat');
    setBayarInvoice(null);

    // Refresh
    const fresh = await getInvoiceList({ tahun: filterTahun || undefined, bulan: filterBulan || undefined });
    setInvoices(fresh);
    if (expandedId === bayarForm.invoice_id) {
      const detail = await getInvoiceDetail(bayarForm.invoice_id);
      setExpandedDetail(detail);
    }
  };

  // ─── DELETE PEMBAYARAN ────────────────────────────────────────────────────

  const handleDeleteBayar = async () => {
    if (!deleteBayarTarget) return;
    setDeletingBayar(true);
    const result = await deletePembayaran(deleteBayarTarget.id);
    setDeletingBayar(false);
    if (!result.success) { toast.error(result.error || 'Gagal menghapus'); return; }
    toast.success('Pembayaran dihapus');
    setDeleteBayarTarget(null);
    const fresh = await getInvoiceList({ tahun: filterTahun || undefined, bulan: filterBulan || undefined });
    setInvoices(fresh);
    if (expandedId) {
      const detail = await getInvoiceDetail(expandedId);
      setExpandedDetail(detail);
    }
  };

  // ─── DELETE INVOICE ───────────────────────────────────────────────────────

  const handleDeleteInvoice = async () => {
    if (!deleteInvoiceTarget) return;
    setDeletingInvoice(true);
    const result = await deleteInvoice(deleteInvoiceTarget.id);
    setDeletingInvoice(false);
    if (!result.success) { toast.error(result.error || 'Gagal menghapus invoice'); return; }
    toast.success('Invoice dihapus');
    setDeleteInvoiceTarget(null);
    setInvoices(prev => prev.filter(i => i.id !== deleteInvoiceTarget.id));
    if (expandedId === deleteInvoiceTarget.id) { setExpandedId(null); setExpandedDetail(null); }
  };

  // ─── RENDER ───────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6 mt-4">

      {/* ─── SUMMARY CARDS ────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="p-4 rounded-xl bg-[#1A1D1F] border border-red-500/20">
          <div className="flex items-center justify-between mb-1">
            <p className="text-[10px] uppercase tracking-widest text-[#9aa0a6] font-bold">Total Piutang Aktif</p>
            <AlertCircle className="h-4 w-4 text-red-400" />
          </div>
          <p className="text-lg font-bold font-mono text-red-400">{idrFmt(totalPiutang)}</p>
          <p className="text-[10px] text-[#5f6368] mt-1">{jumlahOutstanding} invoice outstanding</p>
        </div>
        <div className="p-4 rounded-xl bg-[#1A1D1F] border border-green-500/20">
          <div className="flex items-center justify-between mb-1">
            <p className="text-[10px] uppercase tracking-widest text-[#9aa0a6] font-bold">Total Lunas</p>
            <Receipt className="h-4 w-4 text-green-400" />
          </div>
          <p className="text-lg font-bold font-mono text-green-400">{idrFmt(totalLunas)}</p>
        </div>
        <div className="p-4 rounded-xl bg-[#1A1D1F] border border-[#2A2D31]">
          <div className="flex items-center justify-between mb-1">
            <p className="text-[10px] uppercase tracking-widest text-[#9aa0a6] font-bold">Total Invoice</p>
            <CreditCard className="h-4 w-4 text-[#e5c17b]" />
          </div>
          <p className="text-lg font-bold font-mono text-[#e5c17b]">{invoices.length} invoice</p>
          <p className="text-[10px] text-[#5f6368] mt-1">Otomatis dari Surat Jalan</p>
        </div>
      </div>

      {/* ─── FILTER BAR ───────────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-3 items-end p-4 rounded-xl bg-[#1A1D1F] border border-[#2A2D31]">
        <div>
          <p className={labelCls}>Status</p>
          <select className="h-9 px-3 rounded-lg bg-[#1E2124] border border-[#2A2D31] text-sm text-[#e8eaed] outline-none focus:ring-1 focus:ring-[#e5c17b]"
            value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
            <option value="">Semua</option>
            <option value="belum_bayar">Belum Bayar</option>
            <option value="dp">DP / Sebagian</option>
            <option value="lunas">Lunas</option>
          </select>
        </div>
        <div>
          <p className={labelCls}>Klien</p>
          <select className="h-9 px-3 rounded-lg bg-[#1E2124] border border-[#2A2D31] text-sm text-[#e8eaed] outline-none focus:ring-1 focus:ring-[#e5c17b]"
            value={filterKlien} onChange={e => setFilterKlien(e.target.value)}>
            <option value="">Semua</option>
            {klienList.map(k => <option key={k.id} value={k.id}>{k.nama}</option>)}
          </select>
        </div>
        <div>
          <p className={labelCls}>Bulan</p>
          <select className="h-9 px-3 rounded-lg bg-[#1E2124] border border-[#2A2D31] text-sm text-[#e8eaed] outline-none focus:ring-1 focus:ring-[#e5c17b]"
            value={filterBulan} onChange={e => setFilterBulan(e.target.value)}>
            <option value="">Semua</option>
            {BULAN.map((b, i) => <option key={i} value={String(i + 1).padStart(2, '0')}>{b}</option>)}
          </select>
        </div>
        <div>
          <p className={labelCls}>Tahun</p>
          <input type="number"
            className="h-9 w-24 px-3 rounded-lg bg-[#1E2124] border border-[#2A2D31] text-sm text-[#e8eaed] outline-none focus:ring-1 focus:ring-[#e5c17b]"
            value={filterTahun} onChange={e => setFilterTahun(e.target.value)} />
        </div>
        <Button onClick={handleFilter} disabled={filtering}
          className="h-9 bg-[#2A2D31] text-[#e8eaed] hover:bg-[#3A3D41] text-xs">
          {filtering ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Filter className="h-4 w-4 mr-1" />}
          Terapkan
        </Button>
        <Button variant="ghost"
          onClick={() => { setFilterStatus(''); setFilterKlien(''); setFilterBulan(''); setFilterTahun(String(new Date().getFullYear())); }}
          className="h-9 text-xs text-[#9aa0a6] hover:text-[#e8eaed]">
          Reset
        </Button>
      </div>

      {/* ─── TABEL ────────────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-[#2A2D31] overflow-hidden bg-[#16181A]">
        <Table>
          <TableHeader className="bg-[#1A1C1E]">
            <TableRow className="border-[#2A2D31] hover:bg-transparent">
              <TableHead className="text-[#9aa0a6]">No. Invoice</TableHead>
              <TableHead className="text-[#9aa0a6]">Klien</TableHead>
              <TableHead className="text-[#9aa0a6]">No. SJ</TableHead>
              <TableHead className="text-[#9aa0a6]">Tanggal</TableHead>
              <TableHead className="text-[#9aa0a6] text-right">Total Tagihan</TableHead>
              <TableHead className="text-[#9aa0a6] text-right">Terbayar</TableHead>
              <TableHead className="text-[#9aa0a6] text-right">Sisa</TableHead>
              <TableHead className="text-[#9aa0a6] text-center">Status</TableHead>
              <TableHead className="text-[#9aa0a6] text-center w-24">Aksi</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody className="bg-[#16181A]">
            {invoices.length === 0 ? (
              <TableRow className="hover:bg-transparent border-[#2A2D31]">
                <TableCell colSpan={9} className="h-32 text-center text-[#5f6368]">
                  Belum ada invoice — invoice akan muncul otomatis saat Surat Jalan diterbitkan
                </TableCell>
              </TableRow>
            ) : invoices.map(inv => (
              <React.Fragment key={inv.id}>

                {/* ─── ROW UTAMA ─── */}
                <TableRow
                  className={`border-[#2A2D31] hover:bg-[#1A1C1E] cursor-pointer ${expandedId === inv.id ? 'bg-[#1A1C1E]' : ''}`}
                  onClick={() => toggleExpand(inv.id)}
                >
                  <TableCell className="font-mono text-sm text-[#e5c17b] font-bold">
                    {inv.nomor_invoice}
                  </TableCell>
                  <TableCell className="text-sm text-[#e8eaed]">{inv.klien_nama}</TableCell>
                  <TableCell className="text-sm text-[#9aa0a6] font-mono">
                    {inv.nomor_sj ?? '-'}
                  </TableCell>
                  <TableCell className="text-sm text-[#9aa0a6] whitespace-nowrap">
                    {dateFmt(inv.tanggal)}
                  </TableCell>
                  <TableCell className="text-sm font-mono text-right text-[#e8eaed]">
                    {idrFmt(inv.total_nilai)}
                  </TableCell>
                  <TableCell className="text-sm font-mono text-right text-green-400">
                    {idrFmt(inv.total_bayar)}
                  </TableCell>
                  <TableCell className={`text-sm font-mono text-right font-bold ${inv.sisa > 0 ? 'text-red-400' : 'text-green-400'}`}>
                    {idrFmt(inv.sisa)}
                  </TableCell>
                  <TableCell className="text-center">
                    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold whitespace-nowrap ${STATUS_COLOR[inv.status]}`}>
                      {STATUS_LABEL[inv.status]}
                    </span>
                  </TableCell>
                  <TableCell className="text-center" onClick={e => e.stopPropagation()}>
                    <div className="flex items-center justify-center gap-1">
                      {inv.status !== 'lunas' && (
                        <Button variant="ghost" size="icon"
                          onClick={() => openBayar(inv)}
                          className="h-7 w-7 text-green-400 hover:bg-green-400/10"
                          title="Catat Pembayaran">
                          <CreditCard className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      <Button variant="ghost" size="icon"
                        onClick={() => setDeleteInvoiceTarget(inv)}
                        className="h-7 w-7 text-[#9aa0a6] hover:text-red-400 hover:bg-red-400/10"
                        title="Hapus Invoice">
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                      <span className="text-[#5f6368]">
                        {expandedId === inv.id
                          ? <ChevronUp className="h-3.5 w-3.5" />
                          : <ChevronDown className="h-3.5 w-3.5" />}
                      </span>
                    </div>
                  </TableCell>
                </TableRow>

                {/* ─── DETAIL PANEL ─── */}
                {expandedId === inv.id && (
                  <TableRow className="border-[#2A2D31] hover:bg-transparent">
                    <TableCell colSpan={9} className="p-0">
                      <div className="bg-[#12141A] border-t border-[#2A2D31] px-6 py-4 space-y-4">

                        {/* Info baris */}
                        <div className="flex flex-wrap gap-6 text-xs text-[#9aa0a6]">
                          {inv.tanggal_jatuh_tempo && (
                            <span>Jatuh Tempo: <span className={`font-semibold ${inv.status !== 'lunas' && new Date(inv.tanggal_jatuh_tempo) < new Date() ? 'text-red-400' : 'text-[#e8eaed]'}`}>{dateFmt(inv.tanggal_jatuh_tempo)}</span></span>
                          )}
                          {inv.catatan && (
                            <span>Catatan: <span className="text-[#e8eaed] italic">{inv.catatan}</span></span>
                          )}
                        </div>

                        {/* Riwayat Pembayaran */}
                        <div>
                          <p className="text-[10px] font-bold uppercase tracking-widest text-[#9aa0a6] mb-3">
                            Riwayat Pembayaran
                          </p>
                          {loadingDetail ? (
                            <div className="flex items-center gap-2 text-[#9aa0a6] text-sm">
                              <Loader2 className="h-4 w-4 animate-spin" /> Memuat...
                            </div>
                          ) : !expandedDetail || expandedDetail.pembayaran.length === 0 ? (
                            <p className="text-sm text-[#5f6368] italic">Belum ada pembayaran.</p>
                          ) : (
                            <div className="space-y-2 max-w-2xl">
                              {expandedDetail.pembayaran.map(p => (
                                <div key={p.id}
                                  className="flex items-center justify-between p-3 rounded-lg bg-[#1A1D1F] border border-[#2A2D31]">
                                  <div className="flex items-center gap-4">
                                    <span className="text-sm text-[#9aa0a6] whitespace-nowrap">{dateFmt(p.tanggal)}</span>
                                    <span className="text-xs bg-[#2A2D31] text-[#9aa0a6] px-2 py-0.5 rounded capitalize">{p.metode}</span>
                                    {p.keterangan && <span className="text-sm text-[#9aa0a6]">{p.keterangan}</span>}
                                  </div>
                                  <div className="flex items-center gap-3">
                                    <span className="text-sm font-bold font-mono text-green-400">{idrFmt(p.jumlah)}</span>
                                    <Button variant="ghost" size="icon"
                                      onClick={() => setDeleteBayarTarget(p)}
                                      className="h-6 w-6 text-[#9aa0a6] hover:text-red-400 hover:bg-red-400/10">
                                      <Trash2 className="h-3 w-3" />
                                    </Button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>

                        {/* Tombol catat bayar inline */}
                        {inv.status !== 'lunas' && (
                          <Button
                            onClick={() => openBayar(inv)}
                            className="bg-green-600 hover:bg-green-700 text-white font-bold text-xs h-8 px-4">
                            <CreditCard className="h-3.5 w-3.5 mr-1.5" />
                            Catat Pembayaran
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </React.Fragment>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* ─── MODAL: CATAT PEMBAYARAN ──────────────────────────────────────── */}
      <Dialog open={!!bayarInvoice} onOpenChange={open => { if (!open) setBayarInvoice(null); }}>
        <DialogContent className="bg-[#16181A] border-[#2A2D31] text-[#e8eaed] sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-green-400">Catat Pembayaran</DialogTitle>
          </DialogHeader>
          {bayarInvoice && (
            <div className="mb-2 p-3 rounded-lg bg-[#1A1D1F] border border-[#2A2D31] text-sm space-y-1">
              <p className="font-mono text-[#e5c17b] font-bold">{bayarInvoice.nomor_invoice}</p>
              <p className="text-[#9aa0a6]">{bayarInvoice.klien_nama}</p>
              <div className="flex justify-between pt-1 border-t border-[#2A2D31]">
                <span className="text-[#9aa0a6] text-xs">Total Tagihan</span>
                <span className="text-[#e8eaed] font-mono text-xs">{idrFmt(bayarInvoice.total_nilai)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#9aa0a6] text-xs">Sudah Terbayar</span>
                <span className="text-green-400 font-mono text-xs">{idrFmt(bayarInvoice.total_bayar)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#9aa0a6] text-xs font-bold">Sisa</span>
                <span className="text-red-400 font-bold font-mono text-xs">{idrFmt(bayarInvoice.sisa)}</span>
              </div>
            </div>
          )}
          <form onSubmit={handleBayar} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Tanggal *</label>
                <input type="date" required className={`${inputCls} [color-scheme:dark]`}
                  value={bayarForm.tanggal}
                  onChange={e => setBayarForm(f => ({ ...f, tanggal: e.target.value }))} />
              </div>
              <div>
                <label className={labelCls}>Metode</label>
                <select className={inputCls}
                  value={bayarForm.metode}
                  onChange={e => setBayarForm(f => ({ ...f, metode: e.target.value as any }))}>
                  {METODE_BAYAR.map(m => (
                    <option key={m} value={m}>{m.charAt(0).toUpperCase() + m.slice(1)}</option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label className={labelCls}>Jumlah Bayar (Rp) *</label>
              <input type="number" required min="1"
                placeholder={bayarInvoice ? `Maks: ${bayarInvoice.sisa.toLocaleString('id-ID')}` : ''}
                className={inputCls}
                value={bayarForm.jumlah}
                onChange={e => setBayarForm(f => ({ ...f, jumlah: e.target.value }))} />
            </div>
            <div>
              <label className={labelCls}>Keterangan <span className="text-[#5f6368] normal-case font-normal">(opsional)</span></label>
              <input type="text" placeholder="No. transfer, nama pengirim, dll."
                className={inputCls}
                value={bayarForm.keterangan}
                onChange={e => setBayarForm(f => ({ ...f, keterangan: e.target.value }))} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setBayarInvoice(null)}
                className="border-[#2A2D31] bg-transparent text-[#e8eaed]" disabled={bayaring}>
                Batal
              </Button>
              <Button type="submit" disabled={bayaring}
                className="bg-green-600 hover:bg-green-700 text-white font-bold">
                {bayaring && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                {bayaring ? 'Menyimpan...' : 'Simpan Pembayaran'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ─── MODAL: KONFIRMASI HAPUS PEMBAYARAN ──────────────────────────── */}
      <Dialog open={!!deleteBayarTarget} onOpenChange={open => { if (!open) setDeleteBayarTarget(null); }}>
        <DialogContent className="bg-[#16181A] border-[#2A2D31] text-[#e8eaed] sm:max-w-sm">
          <DialogHeader><DialogTitle>Hapus Pembayaran?</DialogTitle></DialogHeader>
          <p className="text-sm text-[#9aa0a6] py-2">
            Hapus pembayaran sebesar{' '}
            <span className="text-[#e8eaed] font-bold">{idrFmt(deleteBayarTarget?.jumlah ?? 0)}</span>?
            Status invoice akan otomatis diperbarui.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteBayarTarget(null)}
              className="border-[#2A2D31] bg-transparent text-[#e8eaed]" disabled={deletingBayar}>Batal</Button>
            <Button onClick={handleDeleteBayar} disabled={deletingBayar}
              className="bg-red-600 hover:bg-red-700 text-white font-bold">
              {deletingBayar ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Trash2 className="h-4 w-4 mr-2" />}
              {deletingBayar ? 'Menghapus...' : 'Ya, Hapus'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── MODAL: KONFIRMASI HAPUS INVOICE ─────────────────────────────── */}
      <Dialog open={!!deleteInvoiceTarget} onOpenChange={open => { if (!open) setDeleteInvoiceTarget(null); }}>
        <DialogContent className="bg-[#16181A] border-[#2A2D31] text-[#e8eaed] sm:max-w-sm">
          <DialogHeader><DialogTitle>Hapus Invoice?</DialogTitle></DialogHeader>
          <p className="text-sm text-[#9aa0a6] py-2">
            Hapus invoice{' '}
            <span className="text-[#e5c17b] font-bold">{deleteInvoiceTarget?.nomor_invoice}</span>?
            Invoice yang sudah memiliki riwayat pembayaran tidak dapat dihapus.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteInvoiceTarget(null)}
              className="border-[#2A2D31] bg-transparent text-[#e8eaed]" disabled={deletingInvoice}>Batal</Button>
            <Button onClick={handleDeleteInvoice} disabled={deletingInvoice}
              className="bg-red-600 hover:bg-red-700 text-white font-bold">
              {deletingInvoice ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Trash2 className="h-4 w-4 mr-2" />}
              {deletingInvoice ? 'Menghapus...' : 'Ya, Hapus'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}
