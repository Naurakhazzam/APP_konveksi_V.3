'use client';

import React, { useState } from 'react';
import TogglePoLama from '@/components/keuangan/TogglePoLama';
import { poPeriodeBaru } from '@/lib/keuangan/periode-po';
import { toast } from 'sonner';
import Link from 'next/link';
import { tanggalWIB } from '@/lib/waktu';
import { Plus, Trash2, Loader2, Filter, TrendingUp, TrendingDown, Minus, Pencil, Lock, CalendarDays, ChevronDown, ChevronRight, ChevronLeft, Download } from 'lucide-react';
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
  type OverheadSubOption,
  type PembantuJenisOption,
  KATEGORI_MASUK,
  KATEGORI_KELUAR,
  KATEGORI_BAHAN_PEMBANTU,
  KATEGORI_OVERHEAD,
  SATUAN_BELI,
} from '@/lib/actions/keuangan/buku-kas.types';
import {
  getBukuKasEntries,
  addBukuKas,
  updateBukuKas,
  deleteBukuKas,
  ubahTanggalStokMasuk,
  tambahOverheadSub,
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

/** Nama hari dari tanggal 'YYYY-MM-DD' (tanpa geser zona waktu) */
const hariFmt = (d: string) => {
  const [y, m, day] = d.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, day).toLocaleDateString('id-ID', { weekday: 'long' });
};

const inputCls = 'w-full h-10 px-3 rounded-lg bg-[#1E2124] border border-[#2A2D31] text-sm text-[#e8eaed] focus:ring-1 focus:ring-[#e5c17b] outline-none';
const labelCls = 'block text-[10px] font-bold text-[#9aa0a6] uppercase tracking-widest mb-1';

const PER_HALAMAN = 20;

type Baris =
  | { jenis: 'entri'; entry: BukuKasEntry }
  | { jenis: 'gaji'; key: string; tanggal: string; items: BukuKasEntry[]; total: number; poNo: string[] };

/** "Bayar upah Ade (PO-0099)" → "Ade" */
const namaGaji = (ket: string | null) =>
  (ket ?? '-').replace(/^(Bayar upah|Pembayaran Gaji\s*—)\s*/i, '').replace(/\s*\(PO-\d+\)\s*$/i, '').trim() || '-';

/** Link ke Slip Gaji: pembayaran melunasi pekan sebelum tanggal bayar, jadi buka pekan yang memuat H-1 */
const linkSlip = (karyawanId: string, tanggalBayar: string) => {
  const [y, m, d] = tanggalBayar.slice(0, 10).split('-').map(Number);
  const h1 = new Date(y, m - 1, d - 1);
  const iso = `${h1.getFullYear()}-${String(h1.getMonth() + 1).padStart(2, '0')}-${String(h1.getDate()).padStart(2, '0')}`;
  return `/app/penggajian/slip-gaji?karyawan=${karyawanId}&tanggal=${iso}`;
};

// ─── PROPS ───────────────────────────────────────────────────────────────────

interface Props {
  initialEntries: BukuKasEntry[];
  poList: { id: string; no_po: string }[];
  overheadSubList: OverheadSubOption[];
  pembantuList: PembantuJenisOption[];
  /** Bulan berjalan "MM" & tahun "YYYY" — filter awal */
  defaultBulan: string;
  defaultTahun: string;
}

// ─── DEFAULT FORM ─────────────────────────────────────────────────────────────

const makeDefaultForm = (tipe: 'masuk' | 'keluar') => ({
  // Default hari ini (WIB); tetap bisa diganti
  tanggal: tanggalWIB(),
  tipe,
  kategori: '',
  nominal: '',
  keterangan: '',
  no_referensi: '',
  po_id: '',
  komponen_id: '',
  overhead_sub_id: '',
  pembantu_jenis_id: '',
  qty: '',
  satuan: '',
  /** Harga satuan (angka murni) — hanya di form; nominal = qty × harga */
  harga: '',
});

type FormKas = ReturnType<typeof makeDefaultForm>;

/** Isi nominal otomatis bila qty & harga satuan sama-sama terisi */
const hitungNominal = (f: FormKas): FormKas => {
  const q = parseFloat(f.qty);
  const h = Number(f.harga);
  return q > 0 && h > 0 ? { ...f, nominal: String(Math.round(q * h)) } : f;
};

/** Pilihan satuan untuk kas keluar umum; "Lainnya" = ketik sendiri */
const SATUAN_UMUM = [
  'orang', 'hari', 'orang/hari', 'bulan', 'kali',
  'pcs', 'kg', 'liter', 'tabung', 'galon', 'karung', 'pack', 'meter',
];
const SATUAN_LAINNYA = '__lainnya__';

// ─── COMPONENT ───────────────────────────────────────────────────────────────

export default function BukuKasClient({ initialEntries, poList, overheadSubList, pembantuList, defaultBulan, defaultTahun }: Props) {
  const [entries, setEntries] = useState<BukuKasEntry[]>(initialEntries);
  // Sub-kelompok overhead (bisa bertambah dari form)
  const [subList, setSubList] = useState<OverheadSubOption[]>(overheadSubList);
  const [subBaru, setSubBaru] = useState<string | null>(null);
  const [menambahSub, setMenambahSub] = useState(false);
  /** Entri bertanda PO lama (sebelum PO-0100) disembunyikan kecuali dicentang; tanpa tag PO selalu tampil */
  const [tampilkanLama, setTampilkanLama] = useState(false);
  const tampil = tampilkanLama ? entries : entries.filter(e => !e.po_no || poPeriodeBaru(e.po_no));
  const jumlahLama = entries.length - tampil.length;
  const [filterBulan, setFilterBulan] = useState(defaultBulan);
  const [filterTahun, setFilterTahun] = useState(defaultTahun);
  const [filterTipe, setFilterTipe] = useState('');
  const [filtering, setFiltering] = useState(false);

  // Modal state
  const [modalTipe, setModalTipe] = useState<'masuk' | 'keluar' | null>(null);
  const [form, setForm] = useState(makeDefaultForm('masuk'));
  /** id entri yang sedang diedit; null = tambah baru */
  const [editId, setEditId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Delete state
  const [deleteTarget, setDeleteTarget] = useState<BukuKasEntry | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Ubah tanggal (baris dari Stok Masuk)
  const [tanggalTarget, setTanggalTarget] = useState<BukuKasEntry | null>(null);
  const [tanggalBaru, setTanggalBaru] = useState('');
  const [simpanTanggal, setSimpanTanggal] = useState(false);

  // ─── DERIVED ──────────────────────────────────────────────────────────────

  const poMap = React.useMemo(() => {
    const m: Record<string, string> = {};
    poList.forEach(p => { m[p.id] = p.no_po; });
    return m;
  }, [poList]);

  const isPembantu = form.tipe === 'keluar' && form.kategori === KATEGORI_BAHAN_PEMBANTU;
  const isOverhead = form.tipe === 'keluar' && form.kategori === KATEGORI_OVERHEAD;
  /** Satuan diketik sendiri (pilihan "Lainnya…") */
  const [satuanManual, setSatuanManual] = useState(false);
  /** Nominal dihitung dari qty × harga satuan → kolom nominal dikunci */
  const nominalOtomatis = form.tipe === 'keluar' && parseFloat(form.qty) > 0 && Number(form.harga) > 0;

  const simpanSubBaru = async () => {
    if (!subBaru?.trim()) return;
    setMenambahSub(true);
    const res = await tambahOverheadSub(subBaru);
    setMenambahSub(false);
    if (!res.success || !res.data) { toast.error(res.error || 'Gagal menambah sub-kelompok'); return; }
    const baru = res.data;
    setSubList(prev => prev.some(s => s.id === baru.id) ? prev : [...prev, baru]);
    setForm(f => ({ ...f, overhead_sub_id: baru.id }));
    setSubBaru(null);
    toast.success(`Sub-kelompok "${baru.nama}" siap dipakai`);
  };

  /** Rekap Biaya Overhead per sub-kelompok (data yang sedang tampil) */
  const rekapOverhead = (() => {
    const m = new Map<string, number>();
    tampil.forEach(e => {
      if (e.tipe !== 'keluar' || e.kategori !== KATEGORI_OVERHEAD) return;
      const k = e.overhead_sub_nama ?? 'Tanpa sub-kelompok';
      m.set(k, (m.get(k) ?? 0) + e.nominal);
    });
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  })();

  /** Baris tabel: pembayaran gaji otomatis pada tanggal yang sama disatukan jadi satu baris */
  const barisTabel = (() => {
    const hasil: Baris[] = [];
    const grupGaji = new Map<string, Extract<Baris, { jenis: 'gaji' }>>();
    tampil.forEach(entry => {
      if (!entry.karyawan_id_gaji) { hasil.push({ jenis: 'entri', entry }); return; }
      const tgl = entry.tanggal.slice(0, 10);
      let g = grupGaji.get(tgl);
      if (!g) {
        g = { jenis: 'gaji', key: `gaji-${tgl}`, tanggal: entry.tanggal, items: [], total: 0, poNo: [] };
        grupGaji.set(tgl, g);
        hasil.push(g);
      }
      g.items.push(entry);
      g.total += entry.nominal;
      if (entry.po_no && !g.poNo.includes(entry.po_no)) g.poNo.push(entry.po_no);
    });
    grupGaji.forEach(g => g.items.sort((a, b) => namaGaji(a.keterangan).localeCompare(namaGaji(b.keterangan))));
    return hasil;
  })();
  // Paginasi: 20 baris per halaman (grup gaji dihitung satu baris)
  const [halaman, setHalaman] = useState(1);
  const totalHalaman = Math.max(1, Math.ceil(barisTabel.length / PER_HALAMAN));
  const halamanAktif = Math.min(halaman, totalHalaman);
  const barisHalaman = barisTabel.slice((halamanAktif - 1) * PER_HALAMAN, halamanAktif * PER_HALAMAN);

  // Unduh Excel per rentang tanggal
  const [unduhDari, setUnduhDari] = useState(`${defaultTahun}-${defaultBulan}-01`);
  const [unduhSampai, setUnduhSampai] = useState(() => {
    const akhir = new Date(Number(defaultTahun), Number(defaultBulan), 0).getDate();
    return `${defaultTahun}-${defaultBulan}-${String(akhir).padStart(2, '0')}`;
  });
  const [mengunduh, setMengunduh] = useState(false);

  const handleUnduh = async () => {
    if (!unduhDari || !unduhSampai) { toast.error('Isi tanggal dari dan sampai'); return; }
    if (unduhDari > unduhSampai) { toast.error('Tanggal "dari" tidak boleh setelah tanggal "sampai"'); return; }
    setMengunduh(true);
    try {
      const data = await getBukuKasEntries({ dari: unduhDari, sampai: unduhSampai });
      const rows = (tampilkanLama ? data : data.filter(e => !e.po_no || poPeriodeBaru(e.po_no)))
        .slice()
        .sort((a, b) => a.tanggal.localeCompare(b.tanggal) || a.created_at.localeCompare(b.created_at));
      if (!rows.length) { toast.error('Tidak ada transaksi pada rentang tanggal itu'); return; }

      // Gaji otomatis disatukan: 1 baris per tanggal bayar (sama seperti tabel)
      const gabung: BukuKasEntry[] = [];
      const grup = new Map<string, { baris: BukuKasEntry; n: number; po: Set<string> }>();
      rows.forEach(e => {
        if (!e.karyawan_id_gaji) { gabung.push(e); return; }
        const tgl = e.tanggal.slice(0, 10);
        const g = grup.get(tgl);
        if (g) {
          g.baris.nominal += e.nominal;
          g.n += 1;
          if (e.po_no) g.po.add(e.po_no);
        } else {
          const baris = { ...e };
          grup.set(tgl, { baris, n: 1, po: new Set(e.po_no ? [e.po_no] : []) });
          gabung.push(baris);
        }
      });
      grup.forEach(g => {
        g.baris.keterangan = `Bayar upah ${g.n} karyawan`;
        g.baris.po_no = [...g.po].join(', ') || null;
      });

      let saldoJalan = 0;
      const isi = gabung.map(e => {
        const masuk = e.tipe === 'masuk' ? e.nominal : 0;
        const keluar = e.tipe === 'keluar' ? e.nominal : 0;
        saldoJalan += masuk - keluar;
        return {
          Tanggal: e.tanggal.slice(0, 10),
          Hari: hariFmt(e.tanggal),
          Tipe: e.tipe === 'masuk' ? 'Masuk' : 'Keluar',
          Kategori: e.kategori,
          'Sub-kelompok': e.overhead_sub_nama ?? '',
          Keterangan: e.keterangan ?? '',
          'No. Referensi': e.no_referensi ?? '',
          'Tag PO': e.po_no ?? '',
          Masuk: masuk || null,
          Keluar: keluar || null,
          Saldo: saldoJalan,
        };
      });
      const totMasuk = rows.filter(e => e.tipe === 'masuk').reduce((s, e) => s + e.nominal, 0);
      const totKeluar = rows.filter(e => e.tipe === 'keluar').reduce((s, e) => s + e.nominal, 0);

      const XLSX = await import('xlsx');
      const ws = XLSX.utils.json_to_sheet(isi);
      XLSX.utils.sheet_add_aoa(ws, [
        [],
        ['', '', '', '', '', 'TOTAL', '', '', totMasuk, totKeluar, totMasuk - totKeluar],
      ], { origin: -1 });
      ws['!cols'] = [
        { wch: 11 }, { wch: 9 }, { wch: 8 }, { wch: 18 }, { wch: 18 }, { wch: 42 },
        { wch: 14 }, { wch: 9 }, { wch: 13 }, { wch: 13 }, { wch: 14 },
      ];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Buku Kas');
      XLSX.writeFile(wb, `Buku_Kas_${unduhDari}_sd_${unduhSampai}.xlsx`);
      toast.success(`${gabung.length} baris diunduh`);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Gagal mengunduh');
    } finally {
      setMengunduh(false);
    }
  };

  const [gajiTerbuka, setGajiTerbuka] = useState<Set<string>>(new Set());
  const toggleGaji = (key: string) => setGajiTerbuka(prev => {
    const s = new Set(prev);
    if (s.has(key)) s.delete(key); else s.add(key);
    return s;
  });

  const totalMasuk  = tampil.filter(e => e.tipe === 'masuk').reduce((s, e) => s + e.nominal, 0);
  const totalKeluar = tampil.filter(e => e.tipe === 'keluar').reduce((s, e) => s + e.nominal, 0);
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
      setHalaman(1);
    } catch (e: any) {
      toast.error(e.message || 'Gagal memuat data');
    } finally {
      setFiltering(false);
    }
  };

  // ─── OPEN MODAL ───────────────────────────────────────────────────────────

  const openModal = (tipe: 'masuk' | 'keluar') => {
    setEditId(null);
    setSatuanManual(false);
    setForm(makeDefaultForm(tipe));
    setModalTipe(tipe);
  };

  const openEdit = (entry: BukuKasEntry) => {
    setEditId(entry.id);
    setSatuanManual(false);
    setForm({
      tanggal:      entry.tanggal.slice(0, 10),
      tipe:         entry.tipe,
      kategori:     entry.kategori,
      nominal:      String(Math.round(entry.nominal)),
      keterangan:   entry.keterangan ?? '',
      no_referensi: entry.no_referensi ?? '',
      po_id:        entry.po_id ?? '',
      komponen_id:  entry.komponen_id ?? '',
      overhead_sub_id: entry.overhead_sub_id ?? '',
      pembantu_jenis_id: entry.pembantu_jenis_id ?? '',
      qty:          entry.qty == null ? '' : String(entry.qty),
      satuan:       entry.satuan ?? '',
      // Harga satuan hanya diisi kembali bila nominal pas = qty × harga (bulat)
      harga:        entry.qty && entry.qty > 0 && Number.isInteger(entry.nominal / entry.qty)
                      ? String(entry.nominal / entry.qty) : '',
    });
    setModalTipe(entry.tipe);
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
      overhead_sub_id: isOverhead ? form.overhead_sub_id || null : null,
      pembantu_jenis_id: isPembantu ? form.pembantu_jenis_id || null : null,
      qty:          form.tipe === 'keluar' ? parseFloat(form.qty) || null : null,
      satuan:       form.tipe === 'keluar' ? form.satuan || null : null,
    };
    const result = editId ? await updateBukuKas(editId, input) : await addBukuKas(input);
    setSubmitting(false);
    if (!result.success) {
      toast.error(result.error || 'Gagal menyimpan');
      return;
    }
    toast.success(editId
      ? 'Entri kas berhasil diperbarui'
      : `Kas ${form.tipe === 'masuk' ? 'Masuk' : 'Keluar'} berhasil ditambahkan`);
    setModalTipe(null);
    setEditId(null);
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

  // ─── UBAH TANGGAL ─────────────────────────────────────────────────────────

  const openUbahTanggal = (entry: BukuKasEntry) => {
    setTanggalTarget(entry);
    setTanggalBaru(entry.tanggal.slice(0, 10));
  };

  const handleUbahTanggal = async () => {
    if (!tanggalTarget || !tanggalBaru) return;
    setSimpanTanggal(true);
    const result = await ubahTanggalStokMasuk(tanggalTarget.id, tanggalBaru);
    setSimpanTanggal(false);
    if (!result.success) {
      toast.error(result.error || 'Gagal mengubah tanggal');
      return;
    }
    toast.success('Tanggal diperbarui (LOT stok & jurnal ikut diubah)');
    setTanggalTarget(null);
    const fresh = await getBukuKasEntries({
      bulan: filterBulan || undefined,
      tahun: filterTahun || undefined,
      tipe:  filterTipe  || undefined,
    });
    setEntries(fresh);
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

      {/* ─── REKAP OVERHEAD PER SUB-KELOMPOK ─────────────────────────────── */}
      {rekapOverhead.length > 0 && (
        <div className="p-4 rounded-xl bg-[#1A1D1F] border border-[#2A2D31]">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] uppercase tracking-widest text-[#9aa0a6] font-bold">Biaya Overhead per Sub-kelompok</p>
            <p className="text-xs font-bold text-red-400">
              {idrFmt(rekapOverhead.reduce((s, [, v]) => s + v, 0))}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {rekapOverhead.map(([nama, total]) => (
              <span key={nama} className="inline-flex items-center gap-2 rounded-lg border border-[#2A2D31] bg-[#16181A] px-3 py-1.5 text-xs">
                <span className={nama === 'Tanpa sub-kelompok' ? 'text-[#5f6368] italic' : 'text-[#e8eaed]'}>{nama}</span>
                <span className="font-bold text-red-400">{idrFmt(total)}</span>
              </span>
            ))}
          </div>
        </div>
      )}

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
            setFilterBulan(defaultBulan);
            setFilterTipe('');
            setFilterTahun(defaultTahun);
          }}
          variant="ghost"
          className="h-9 text-xs text-[#9aa0a6] hover:text-[#e8eaed]"
        >
          Reset
        </Button>
        <TogglePoLama className="ml-auto" checked={tampilkanLama} onChange={v => { setTampilkanLama(v); setHalaman(1); }}
          info={!tampilkanLama && jumlahLama > 0 ? `(${jumlahLama} disembunyikan)` : undefined} />
      </div>

      {/* ─── UNDUH EXCEL ────────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-3 items-end p-4 rounded-xl bg-[#1A1D1F] border border-[#2A2D31]">
        <div>
          <p className={labelCls}>Unduh dari</p>
          <input
            type="date"
            value={unduhDari}
            onChange={e => setUnduhDari(e.target.value)}
            className="h-9 px-3 rounded-lg bg-[#1E2124] border border-[#2A2D31] text-sm text-[#e8eaed] outline-none focus:ring-1 focus:ring-[#e5c17b]"
          />
        </div>
        <div>
          <p className={labelCls}>Sampai</p>
          <input
            type="date"
            value={unduhSampai}
            onChange={e => setUnduhSampai(e.target.value)}
            className="h-9 px-3 rounded-lg bg-[#1E2124] border border-[#2A2D31] text-sm text-[#e8eaed] outline-none focus:ring-1 focus:ring-[#e5c17b]"
          />
        </div>
        <Button
          onClick={handleUnduh}
          disabled={mengunduh}
          className="h-9 bg-[#e5c17b] hover:bg-[#d4b06a] text-black font-bold text-xs"
        >
          {mengunduh
            ? <Loader2 className="h-4 w-4 animate-spin mr-1" />
            : <Download className="h-4 w-4 mr-1" />}
          Unduh Excel
        </Button>
        <p className="text-[11px] text-[#9aa0a6]">
          Semua tipe transaksi pada rentang tanggal itu, dengan saldo berjalan dan total.
          {!tampilkanLama && ' Entri bertanda PO lama ikut disembunyikan, sama seperti tabel.'}
        </p>
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
              <TableHead className="text-[#9aa0a6] w-24 text-center">Aksi</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody className="bg-[#16181A]">
            {tampil.length === 0 ? (
              <TableRow className="hover:bg-transparent border-[#2A2D31]">
                <TableCell colSpan={8} className="h-32 text-center text-[#5f6368]">
                  Belum ada transaksi kas
                </TableCell>
              </TableRow>
            ) : barisHalaman.map(baris => {
              if (baris.jenis === 'gaji') {
                const buka = gajiTerbuka.has(baris.key);
                return (
                  <React.Fragment key={baris.key}>
                    <TableRow
                      onClick={() => toggleGaji(baris.key)}
                      className="border-[#2A2D31] hover:bg-[#1A1C1E] cursor-pointer"
                      title={buka ? 'Tutup rincian' : 'Lihat rincian per karyawan'}
                    >
                      <TableCell className="text-sm text-[#e8eaed] whitespace-nowrap">
                        <div>{dateFmt(baris.tanggal)}</div>
                        <div className="text-[11px] text-[#9aa0a6]">{hariFmt(baris.tanggal)}</div>
                      </TableCell>
                      <TableCell>
                        <span className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-bold bg-red-500/10 text-red-400 border-red-500/20">
                          Keluar
                        </span>
                      </TableCell>
                      <TableCell className="text-sm text-[#9aa0a6]">Pembayaran Gaji</TableCell>
                      <TableCell className="text-sm text-[#e8eaed]">
                        <span className="inline-flex items-center gap-1.5">
                          {buka
                            ? <ChevronDown className="h-4 w-4 text-[#e5c17b]" />
                            : <ChevronRight className="h-4 w-4 text-[#9aa0a6]" />}
                          Bayar upah {baris.items.length} karyawan
                        </span>
                      </TableCell>
                      <TableCell className="text-sm text-[#9aa0a6] font-mono">-</TableCell>
                      <TableCell>
                        {baris.poNo.length ? (
                          <div className="flex flex-wrap gap-1">
                            {baris.poNo.map(p => (
                              <span key={p} className="bg-[#2A2D31] text-[#9aa0a6] text-[10px] px-1.5 py-0.5 rounded border border-[#3A3D41] font-mono">
                                {p}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span className="text-[#5f6368] text-xs">-</span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm font-bold text-right text-red-400">
                        -{idrFmt(baris.total)}
                      </TableCell>
                      <TableCell className="text-center">
                        <span title="Dibuat otomatis dari pembayaran gaji — perbaiki lewat menu Gaji." className="inline-flex h-8 w-8 items-center justify-center text-[#5f6368]">
                          <Lock className="h-4 w-4" />
                        </span>
                      </TableCell>
                    </TableRow>
                    {buka && baris.items.map(item => (
                      <TableRow key={item.id} className="border-[#2A2D31] bg-[#131517] hover:bg-[#1A1C1E]">
                        <TableCell colSpan={3} />
                        <TableCell className="text-sm pl-8" colSpan={3}>
                          <Link
                            href={linkSlip(item.karyawan_id_gaji!, item.tanggal)}
                            className="text-[#e5c17b] hover:underline"
                            title="Buka slip gaji karyawan ini"
                          >
                            {namaGaji(item.keterangan)}
                          </Link>
                        </TableCell>
                        <TableCell className="text-sm text-right text-red-400/80">
                          -{idrFmt(item.nominal)}
                        </TableCell>
                        <TableCell />
                      </TableRow>
                    ))}
                  </React.Fragment>
                );
              }
              const entry = baris.entry;
              return (
              <TableRow key={entry.id} className="border-[#2A2D31] hover:bg-[#1A1C1E]">
                <TableCell className="text-sm text-[#e8eaed] whitespace-nowrap">
                  <div>{dateFmt(entry.tanggal)}</div>
                  <div className="text-[11px] text-[#9aa0a6]">{hariFmt(entry.tanggal)}</div>
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
                <TableCell className="text-sm text-[#9aa0a6]">
                  <div>{entry.kategori}</div>
                  {entry.overhead_sub_nama && (
                    <div className="text-[11px] text-[#e5c17b]">{entry.overhead_sub_nama}</div>
                  )}
                </TableCell>
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
                <TableCell className="text-center whitespace-nowrap">
                  {entry.dikunci && entry.bisa_ubah_tanggal ? (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => openUbahTanggal(entry)}
                      className="h-8 w-8 text-[#9aa0a6] hover:text-[#e5c17b] hover:bg-[#e5c17b]/10"
                      title="Ubah tanggal (nominal dari Stok Masuk tetap terkunci)"
                    >
                      <CalendarDays className="h-4 w-4" />
                    </Button>
                  ) : entry.dikunci ? (
                    <span title={entry.dikunci} className="inline-flex h-8 w-8 items-center justify-center text-[#5f6368]">
                      <Lock className="h-4 w-4" />
                    </span>
                  ) : (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => openEdit(entry)}
                      className="h-8 w-8 text-[#9aa0a6] hover:text-[#e5c17b] hover:bg-[#e5c17b]/10"
                      title="Edit"
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                  )}
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
              );
            })}
          </TableBody>
        </Table>
        {barisTabel.length > PER_HALAMAN && (
          <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-[#2A2D31] bg-[#1A1C1E]">
            <p className="text-xs text-[#9aa0a6]">
              {(halamanAktif - 1) * PER_HALAMAN + 1}–{Math.min(halamanAktif * PER_HALAMAN, barisTabel.length)} dari {barisTabel.length} baris
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                onClick={() => setHalaman(halamanAktif - 1)}
                disabled={halamanAktif <= 1}
                className="h-8 px-3 text-xs text-[#9aa0a6] hover:text-[#e8eaed] hover:bg-[#2A2D31] disabled:opacity-30"
              >
                <ChevronLeft className="h-4 w-4 mr-1" /> Sebelumnya
              </Button>
              <span className="text-xs font-bold text-[#e5c17b] whitespace-nowrap">
                {halamanAktif} / {totalHalaman}
              </span>
              <Button
                variant="ghost"
                onClick={() => setHalaman(halamanAktif + 1)}
                disabled={halamanAktif >= totalHalaman}
                className="h-8 px-3 text-xs text-[#9aa0a6] hover:text-[#e8eaed] hover:bg-[#2A2D31] disabled:opacity-30"
              >
                Berikutnya <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* ─── MODAL FORM (MASUK / KELUAR) ────────────────────────────────── */}
      <Dialog open={modalTipe !== null} onOpenChange={open => { if (!open) { setModalTipe(null); setEditId(null); } }}>
        <DialogContent className="bg-[#16181A] border-[#2A2D31] text-[#e8eaed] sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editId
                ? <span className="text-[#e5c17b]">Edit Kas {modalTipe === 'masuk' ? 'Masuk' : 'Keluar'}</span>
                : modalTipe === 'masuk'
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
                {form.tanggal && (
                  <p className="text-[11px] text-[#9aa0a6] mt-1">{hariFmt(form.tanggal)}</p>
                )}
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
                  {(() => {
                    const daftar: string[] = [...(modalTipe === 'masuk' ? KATEGORI_MASUK : KATEGORI_KELUAR)];
                    if (form.kategori && !daftar.includes(form.kategori)) daftar.push(form.kategori);
                    return daftar.map(k => <option key={k} value={k}>{k}</option>);
                  })()}
                </select>
                {form.kategori === 'Pembelian Bahan' && (
                  <p className="text-[11px] text-orange-300 mt-1">
                    Belanja bahan yang diinput lewat Inventory → Stok Masuk sudah otomatis tercatat di sini.
                    Input manual hanya untuk belanja bahan yang tidak masuk stok.
                  </p>
                )}
              </div>
            </div>

            {isPembantu && (
              <div className="space-y-3 p-3 rounded-lg border border-[#e5c17b]/30 bg-[#e5c17b]/5">
                <div>
                  <label className={labelCls}>Jenis Bahan *</label>
                  <select
                    required
                    className={inputCls}
                    value={form.pembantu_jenis_id}
                    onChange={e => {
                      const j = pembantuList.find(p => p.id === e.target.value);
                      setForm(f => ({ ...f, pembantu_jenis_id: e.target.value, satuan: j?.satuan_default ?? f.satuan }));
                    }}
                  >
                    <option value="">-- Pilih --</option>
                    {pembantuList.map(j => (
                      <option key={j.id} value={j.id}>{j.nama}</option>
                    ))}
                  </select>
                </div>
                <p className="text-[11px] text-[#9aa0a6]">
                  Masuk ke saldo jenis bahan ini (menu Keuangan → Saldo Bahan Pembantu).
                </p>
              </div>
            )}

            {isOverhead && (
              <div className="space-y-2 p-3 rounded-lg border border-[#e5c17b]/30 bg-[#e5c17b]/5">
                <label className={labelCls}>Sub-kelompok Overhead *</label>
                {subBaru === null ? (
                  <div className="flex gap-2">
                    <select
                      required
                      className={inputCls}
                      value={form.overhead_sub_id}
                      onChange={e => setForm(f => ({ ...f, overhead_sub_id: e.target.value }))}
                    >
                      <option value="">-- Pilih --</option>
                      {subList.map(s => (
                        <option key={s.id} value={s.id}>{s.nama}{s.dari_hpp ? ' (HPP)' : ''}</option>
                      ))}
                    </select>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => setSubBaru('')}
                      className="h-10 px-3 shrink-0 text-xs text-[#e5c17b] hover:bg-[#e5c17b]/10"
                      title="Buat sub-kelompok baru"
                    >
                      <Plus className="h-4 w-4 mr-1" /> Baru
                    </Button>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <input
                      type="text"
                      autoFocus
                      placeholder="Nama sub-kelompok baru, mis. Parkir"
                      className={inputCls}
                      value={subBaru}
                      onChange={e => setSubBaru(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); simpanSubBaru(); } }}
                    />
                    <Button
                      type="button"
                      onClick={simpanSubBaru}
                      disabled={menambahSub || !subBaru.trim()}
                      className="h-10 px-3 shrink-0 bg-[#e5c17b] hover:bg-[#d4b06a] text-black text-xs font-bold"
                    >
                      {menambahSub ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Simpan'}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => setSubBaru(null)}
                      className="h-10 px-3 shrink-0 text-xs text-[#9aa0a6]"
                    >
                      Batal
                    </Button>
                  </div>
                )}
                <p className="text-[11px] text-[#9aa0a6]">
                  Untuk mengelompokkan biaya overhead. Tanda (HPP) = bisa dibandingkan dengan patokan di sheet HPP.
                </p>
              </div>
            )}

            {modalTipe === 'keluar' && (
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className={labelCls}>
                    Qty {isPembantu ? '*' : <span className="text-[#5f6368] normal-case font-normal">(opsional)</span>}
                  </label>
                  <input
                    type="number"
                    required={isPembantu}
                    min="0"
                    step="any"
                    placeholder="contoh: 2"
                    className={inputCls}
                    value={form.qty}
                    onChange={e => setForm(f => hitungNominal({ ...f, qty: e.target.value }))}
                  />
                </div>
                <div>
                  <label className={labelCls}>Satuan {isPembantu ? '*' : ''}</label>
                  {isPembantu ? (
                    <select
                      required
                      className={inputCls}
                      value={form.satuan}
                      onChange={e => setForm(f => ({ ...f, satuan: e.target.value }))}
                    >
                      <option value="">-- Pilih --</option>
                      {SATUAN_BELI.map(s => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  ) : (
                    satuanManual ? (
                      <div className="flex gap-1">
                        <input
                          type="text"
                          autoFocus
                          placeholder="ketik satuan"
                          className={inputCls}
                          value={form.satuan}
                          onChange={e => setForm(f => ({ ...f, satuan: e.target.value }))}
                        />
                        <button
                          type="button"
                          onClick={() => { setSatuanManual(false); setForm(f => ({ ...f, satuan: '' })); }}
                          className="px-2 text-xs text-[#9aa0a6] hover:text-[#e8eaed]"
                          title="Kembali ke daftar"
                        >
                          ✕
                        </button>
                      </div>
                    ) : (
                      <select
                        className={inputCls}
                        value={form.satuan}
                        onChange={e => {
                          if (e.target.value === SATUAN_LAINNYA) { setSatuanManual(true); setForm(f => ({ ...f, satuan: '' })); }
                          else setForm(f => ({ ...f, satuan: e.target.value }));
                        }}
                      >
                        <option value="">-- Pilih --</option>
                        {(form.satuan && !SATUAN_UMUM.includes(form.satuan) ? [form.satuan, ...SATUAN_UMUM] : SATUAN_UMUM)
                          .map(s => <option key={s} value={s}>{s}</option>)}
                        <option value={SATUAN_LAINNYA}>Lainnya…</option>
                      </select>
                    )
                  )}
                </div>
                <div>
                  <label className={labelCls}>Harga Satuan</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    placeholder="contoh: 10.000"
                    className={inputCls}
                    value={form.harga ? Number(form.harga).toLocaleString('id-ID') : ''}
                    onChange={e => setForm(f => hitungNominal({ ...f, harga: e.target.value.replace(/\D/g, '').replace(/^0+/, '') }))}
                  />
                </div>
              </div>
            )}

            <div>
              <label className={labelCls}>Nominal (Rp) *</label>
              <input
                type="text"
                inputMode="numeric"
                required
                readOnly={nominalOtomatis}
                placeholder="contoh: 1.000.000"
                className={`${inputCls} ${nominalOtomatis ? 'opacity-80 cursor-not-allowed' : ''}`}
                value={form.nominal ? Number(form.nominal).toLocaleString('id-ID') : ''}
                // Tampil "300.000", disimpan sebagai angka murni "300000"
                onChange={e => setForm(f => ({ ...f, nominal: e.target.value.replace(/\D/g, '').replace(/^0+/, '') }))}
              />
              {nominalOtomatis && (
                <p className="text-[11px] text-[#e5c17b] mt-1">
                  Otomatis: {form.qty} {form.satuan || ''} × Rp {Number(form.harga).toLocaleString('id-ID')}
                </p>
              )}
            </div>

            <div>
              <label className={labelCls}>
                Keterangan {isPembantu ? <span className="text-[#5f6368] normal-case font-normal">(opsional)</span> : '*'}
              </label>
              <input
                type="text"
                required={!isPembantu}
                placeholder={isPembantu ? 'contoh: roll WP hitam' : 'Deskripsi transaksi'}
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
                {submitting ? 'Menyimpan...' : editId ? 'Simpan Perubahan' : 'Simpan'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ─── UBAH TANGGAL (STOK MASUK) ──────────────────────────────────── */}
      <Dialog open={!!tanggalTarget} onOpenChange={open => { if (!open) setTanggalTarget(null); }}>
        <DialogContent className="bg-[#16181A] border-[#2A2D31] text-[#e8eaed] sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Ubah Tanggal</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-[#9aa0a6]">
            <span className="text-[#e8eaed] font-semibold">{tanggalTarget?.keterangan}</span>
          </p>
          <div>
            <label className={labelCls}>Tanggal</label>
            <input
              type="date"
              value={tanggalBaru}
              onChange={e => setTanggalBaru(e.target.value)}
              className={inputCls}
            />
            {tanggalBaru && (
              <p className="text-[11px] text-[#9aa0a6] mt-1">{hariFmt(tanggalBaru)}</p>
            )}
          </div>
          <p className="text-[11px] text-[#9aa0a6]">
            Entri ini dari Stok Masuk. Tanggal LOT stok dan jurnal pembelian ikut diubah; nominal dan jumlah tidak berubah.
          </p>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setTanggalTarget(null)}
              className="border-[#2A2D31] bg-transparent text-[#e8eaed]"
              disabled={simpanTanggal}
            >
              Batal
            </Button>
            <Button
              onClick={handleUbahTanggal}
              disabled={simpanTanggal || !tanggalBaru}
              className="bg-[#e5c17b] hover:bg-[#d4b06a] text-black font-bold"
            >
              {simpanTanggal && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              {simpanTanggal ? 'Menyimpan...' : 'Simpan'}
            </Button>
          </DialogFooter>
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
