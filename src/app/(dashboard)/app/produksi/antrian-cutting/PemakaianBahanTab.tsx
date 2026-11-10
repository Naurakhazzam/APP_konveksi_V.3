'use client';

import React, { useMemo, useState } from 'react';
import {
  ChevronDown, ChevronRight, Search, Clock, Package, Scissors, Download, Pencil, Loader2,
  TrendingDown, TrendingUp, CheckCircle2, HelpCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import type { PemakaianCuttingRow } from '@/lib/actions/produksi/cutting-v2.actions';
import {
  isBahanUtama, statusPemakaian, persenSelisih, STATUS_LABEL, STATUS_CLASS, type StatusPemakaian,
} from '@/lib/produksi/patokan-bahan';
import ModalEditPemakaian from './ModalEditPemakaian';

interface Props {
  rows: PemakaianCuttingRow[];
  isOwner: boolean;
  onChanged: () => void;
}

type Periode = 'semua' | 'bulan_ini' | '3_bulan';

const PERIODE: { key: Periode; label: string }[] = [
  { key: 'bulan_ini', label: 'Bulan ini' },
  { key: '3_bulan', label: '3 bulan' },
  { key: 'semua', label: 'Semua' },
];

const SIZE_URUT = ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL', '4XL', '5XL', '6XL'];
const urutSize = (a: string, b: string) => {
  const ia = SIZE_URUT.indexOf(a), ib = SIZE_URUT.indexOf(b);
  return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
};

const fmtQty = (n: number) => n.toLocaleString('id-ID', { maximumFractionDigits: 2 });
const fmtRate = (n: number) => n.toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 3 });
const fmtRp = (n: number) =>
  new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(n);
const fmtTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '-';
/** Tanggal Selesai Cutting (WIB) sebagai kunci YYYY-MM-DD */
const tglKey = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
const tglTampil = (key: string) => { const [y, m, d] = key.split('-'); return `${d}/${m}/${y}`; };
const r3 = (n: number) => Math.round(n * 1000) / 1000;

const utama = (r: PemakaianCuttingRow) => isBahanUtama(r.bahan_nama, r.jenis_bahan);

/** Pemakaian bahan utama per bundle, untuk dibandingkan dengan patokan. */
interface BundleNilai { rate: number; patokan: number | null; qty: number; satuan: string }

function nilaiPerBundle(items: PemakaianCuttingRow[]): Map<string, BundleNilai> {
  const m = new Map<string, BundleNilai>();
  for (const r of items) {
    if (!utama(r)) continue;
    const b = m.get(r.bundle_id) ?? { rate: 0, patokan: r.patokan, qty: r.qty_potong, satuan: r.satuan };
    b.rate += r.rate_per_pcs;
    m.set(r.bundle_id, b);
  }
  return m;
}

/** Ringkas status sekumpulan bundle: total pakai vs total patokan. */
function statusKumpulan(bundles: BundleNilai[]) {
  let aktual = 0, target = 0, satuan = '';
  for (const b of bundles) {
    if (b.patokan == null) continue;
    aktual += b.rate * b.qty;
    target += b.patokan * b.qty;
    satuan = b.satuan;
  }
  const status: StatusPemakaian = target > 0 ? statusPemakaian(aktual, target) : 'tanpa';
  return { status, selisih: r3(aktual - target), persen: target > 0 ? persenSelisih(aktual, target) : 0, satuan };
}

function BadgeStatus({ status, persen, selisih, satuan }: { status: StatusPemakaian; persen?: number; selisih?: number; satuan?: string }) {
  const ber = status === 'irit' || status === 'boros';
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-bold whitespace-nowrap ${STATUS_CLASS[status]}`}>
      {STATUS_LABEL[status]}
      {ber && persen != null && ` ${Math.abs(persen)}%`}
      {ber && selisih != null && <span className="font-normal opacity-80">({selisih > 0 ? '+' : ''}{fmtQty(selisih)} {satuan})</span>}
    </span>
  );
}

/** Satu baris tabel = PO + artikel (model); isinya semua bundle & bahan yang dipakai. */
interface Grup {
  key: string;
  no_po: string;
  klien_nama: string;
  model_nama: string | null;
  tanggal: string;
  bundle_ids: Set<string>;
  qty_potong: number;
  bahan: Map<string, { qty: number; satuan: string }>;
  harga: number;
  items: PemakaianCuttingRow[];
  status: ReturnType<typeof statusKumpulan>;
}

function batasPeriode(p: Periode): Date | null {
  if (p === 'semua') return null;
  const d = new Date();
  if (p === 'bulan_ini') return new Date(d.getFullYear(), d.getMonth(), 1);
  return new Date(d.getFullYear(), d.getMonth() - 2, 1);
}

// ─── Export Excel ────────────────────────────────────────────────────────────

async function exportExcel(items: PemakaianCuttingRow[]) {
  const XLSX = await import('xlsx');
  const HEADER = ['Nomor PO', 'Model', 'QTY order', 'Perkiraan pemakaian', 'Bahan', 'QTY cutting',
    'Pemakaian', 'Total pemakaian', 'Satuan', 'Status'];

  // tanggal → artikel (po_item) → baris bahan utama + bahan lain
  const perTgl = new Map<string, PemakaianCuttingRow[]>();
  for (const r of items) {
    const k = tglKey(r.tanggal);
    perTgl.set(k, [...(perTgl.get(k) ?? []), r]);
  }

  const aoa: (string | number)[][] = [];
  const grand = new Map<string, { qty: number; total: number }>();
  const tambahTotal = (m: Map<string, { qty: number; total: number }>, satuan: string, qty: number, total: number) => {
    const t = m.get(satuan) ?? { qty: 0, total: 0 };
    t.qty += qty; t.total += total; m.set(satuan, t);
  };

  for (const tgl of [...perTgl.keys()].sort()) {
    aoa.push([tglTampil(tgl)]);
    aoa.push(HEADER);
    const sub = new Map<string, { qty: number; total: number }>();

    const perArtikel = new Map<string, PemakaianCuttingRow[]>();
    for (const r of perTgl.get(tgl)!) perArtikel.set(r.po_item_id, [...(perArtikel.get(r.po_item_id) ?? []), r]);

    const artikel = [...perArtikel.values()].sort((a, b) =>
      a[0].no_po.localeCompare(b[0].no_po) || (a[0].model_nama ?? '').localeCompare(b[0].model_nama ?? '')
      || a[0].warna.localeCompare(b[0].warna) || urutSize(a[0].size, b[0].size));

    for (const rs of artikel) {
      const f = rs[0];
      const nama = `${f.model_nama ?? f.produk_nama} ${f.warna} - ${f.size}`;
      const qtyCut = [...new Map(rs.map(r => [r.bundle_id, r.qty_potong])).values()].reduce((s, q) => s + q, 0);

      const rsUtama = rs.filter(utama);
      if (rsUtama.length) {
        const total = r3(rsUtama.reduce((s, r) => s + r.qty_pakai, 0));
        const perPcs = qtyCut > 0 ? r3(total / qtyCut) : 0;
        const st = statusPemakaian(perPcs, f.patokan);
        const bahan = [...new Set(rsUtama.map(r => r.bahan_nama))].join(' + ');
        aoa.push([f.no_po, nama, f.qty_order, f.patokan ?? '', bahan, qtyCut, perPcs, total, f.satuan,
          st === 'tanpa' ? '' : STATUS_LABEL[st] + (st === 'sesuai' ? '' : ` ${Math.abs(persenSelisih(perPcs, f.patokan!))}%`)]);
        tambahTotal(sub, f.satuan, qtyCut, total);
      }
      // Bahan lain (mis. puring) — tanpa patokan, baris sendiri
      const lain = new Map<string, PemakaianCuttingRow[]>();
      for (const r of rs.filter(r => !utama(r))) lain.set(r.bahan_nama, [...(lain.get(r.bahan_nama) ?? []), r]);
      for (const [bahan, br] of lain) {
        const total = r3(br.reduce((s, r) => s + r.qty_pakai, 0));
        aoa.push([f.no_po, nama, f.qty_order, '', bahan, qtyCut, qtyCut > 0 ? r3(total / qtyCut) : 0, total, br[0].satuan, '']);
        tambahTotal(sub, br[0].satuan, rsUtama.length ? 0 : qtyCut, total);
      }
    }
    for (const [satuan, t] of sub) {
      aoa.push(['', '', '', '', 'Subtotal', t.qty, '', r3(t.total), satuan, '']);
      tambahTotal(grand, satuan, t.qty, t.total);
    }
    aoa.push([]);
  }
  for (const [satuan, t] of grand) aoa.push(['', '', '', '', 'TOTAL SEMUA', t.qty, '', r3(t.total), satuan, '']);

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [{ wch: 11 }, { wch: 30 }, { wch: 10 }, { wch: 19 }, { wch: 30 }, { wch: 11 }, { wch: 11 }, { wch: 15 }, { wch: 8 }, { wch: 12 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Pemakaian Bahan');
  XLSX.writeFile(wb, `Pemakaian_Bahan_Cutting_${tglKey(new Date().toISOString())}.xlsx`);
}

// ─── Komponen ────────────────────────────────────────────────────────────────

export default function PemakaianBahanTab({ rows, isOwner, onChanged }: Props) {
  const [q, setQ] = useState('');
  const [periode, setPeriode] = useState<Periode>('bulan_ini');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [pilih, setPilih] = useState<Set<string>>(new Set());
  const [editKey, setEditKey] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  /** Periode menyaring catatan; pencarian memilih artikel utuh (semua bahannya tetap ikut). */
  const tersaring = useMemo(() => {
    const batas = batasPeriode(periode);
    const diPeriode = batas ? rows.filter(r => new Date(r.tanggal) >= batas) : rows;
    const kata = q.trim().toLowerCase();
    if (!kata) return diPeriode;
    const cocok = new Set(diPeriode.filter(r =>
      [r.no_po, r.klien_nama, r.model_nama ?? '', r.produk_nama, r.bahan_nama, r.barcode, r.warna, r.karyawan_nama ?? '']
        .some(s => s.toLowerCase().includes(kata))).map(r => `${r.po_id}::${r.model_nama ?? ''}`));
    return diPeriode.filter(r => cocok.has(`${r.po_id}::${r.model_nama ?? ''}`));
  }, [rows, q, periode]);

  const grup = useMemo(() => {
    const map = new Map<string, Omit<Grup, 'status'>>();
    const bundleTerhitung = new Set<string>();
    for (const r of tersaring) {
      const key = `${r.po_id}::${r.model_nama ?? ''}`;
      let g = map.get(key);
      if (!g) {
        g = {
          key, no_po: r.no_po, klien_nama: r.klien_nama, model_nama: r.model_nama, tanggal: r.tanggal,
          bundle_ids: new Set(), qty_potong: 0, bahan: new Map(), harga: 0, items: [],
        };
        map.set(key, g);
      }
      g.items.push(r);
      if (r.tanggal > g.tanggal) g.tanggal = r.tanggal;
      // Satu bundle bisa pakai 2 bahan → hasil potong dihitung sekali
      const bk = `${key}|${r.bundle_id}`;
      if (!bundleTerhitung.has(bk)) { bundleTerhitung.add(bk); g.bundle_ids.add(r.bundle_id); g.qty_potong += r.qty_potong; }
      const bh = g.bahan.get(r.bahan_nama) ?? { qty: 0, satuan: r.satuan };
      bh.qty += r.qty_pakai;
      g.bahan.set(r.bahan_nama, bh);
      g.harga += r.harga_pakai;
    }
    return [...map.values()].map(g => {
      g.items.sort((a, b) => a.warna.localeCompare(b.warna) || urutSize(a.size, b.size)
        || a.barcode.localeCompare(b.barcode) || a.bahan_nama.localeCompare(b.bahan_nama));
      return { ...g, status: statusKumpulan([...nilaiPerBundle(g.items).values()]) } as Grup;
    }).sort((a, b) => b.tanggal.localeCompare(a.tanggal));
  }, [tersaring]);

  // Pilihan yang sudah tidak terlihat (filter berubah) ikut diabaikan
  const terpilih = useMemo(() => grup.filter(g => pilih.has(g.key)), [grup, pilih]);
  const semuaTerpilih = grup.length > 0 && terpilih.length === grup.length;

  const ringkasan = useMemo(() => {
    const bundles = new Set<string>();
    let pcs = 0;
    const perSatuan = new Map<string, number>();
    const st = { irit: { n: 0, sel: 0 }, sesuai: { n: 0, sel: 0 }, boros: { n: 0, sel: 0 }, tanpa: { n: 0, sel: 0 } };
    for (const g of grup) {
      g.bundle_ids.forEach(id => bundles.add(id));
      pcs += g.qty_potong;
      for (const v of g.bahan.values()) perSatuan.set(v.satuan, (perSatuan.get(v.satuan) ?? 0) + v.qty);
      st[g.status.status].n += 1;
      st[g.status.status].sel += g.status.selisih;
    }
    return { bundles: bundles.size, pcs, perSatuan, st };
  }, [grup]);

  const togglePilih = (key: string) => setPilih(p => {
    const s = new Set(p);
    if (s.has(key)) s.delete(key); else s.add(key);
    return s;
  });

  const doExport = async () => {
    if (!terpilih.length) return;
    setExporting(true);
    try {
      await exportExcel(terpilih.flatMap(g => g.items));
      toast.success(`${terpilih.length} artikel diexport`);
    } catch (e) {
      toast.error('Gagal export: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setExporting(false);
    }
  };

  const grupEdit = editKey ? grup.find(g => g.key === editKey) : null;

  const th = 'sticky top-0 z-10 px-4 py-3 text-[10px] uppercase tracking-widest text-[#9aa0a6] font-bold bg-[#16181A] border-b border-[#2A2D31]';
  const card = 'flex items-center gap-3 rounded-xl px-4 py-3 bg-[#1A1D1F] border border-[#2A2D31]';
  const ikon = 'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border';
  const satuanUtama = [...ringkasan.perSatuan.keys()][0] ?? '';

  return (
    <div className="space-y-4">
      {/* Filter + aksi */}
      <div className="flex flex-col lg:flex-row lg:items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#9aa0a6]" />
          <input value={q} onChange={e => setQ(e.target.value)}
            placeholder="Cari PO, klien, artikel, bahan, barcode, tukang potong…"
            className="w-full h-10 pl-9 pr-3 rounded-md bg-[#0D0E10] border border-[#2A2D31] text-sm text-[#e8eaed] placeholder:text-[#9aa0a6]/60 outline-none focus:border-[#e5c17b]/60" />
        </div>
        <div className="flex p-1 bg-[#0D0E10] rounded-lg w-fit border border-[#2A2D31]">
          {PERIODE.map(p => (
            <button key={p.key} onClick={() => { setPeriode(p.key); setExpanded(null); }}
              className={'px-3 py-1.5 rounded-md text-xs font-medium transition-all ' +
                (periode === p.key ? 'bg-[#2A2D31] text-[#e8eaed]' : 'text-[#9aa0a6] hover:text-[#e8eaed]')}>
              {p.label}
            </button>
          ))}
        </div>
        <div className="lg:ml-auto flex items-center gap-2">
          {terpilih.length > 0 && (
            <span className="text-xs text-[#9aa0a6]">Dipilih <b className="text-[#e5c17b]">{terpilih.length}</b> artikel</span>
          )}
          <button disabled={!terpilih.length || exporting} onClick={doExport}
            className="flex items-center gap-2 px-4 h-10 rounded-md bg-[#e5c17b] text-[#0D0E10] text-sm font-semibold hover:bg-[#d4b06a] disabled:opacity-30 disabled:cursor-not-allowed">
            {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            Export Excel{terpilih.length ? ` (${terpilih.length})` : ''}
          </button>
        </div>
      </div>

      {/* Ringkasan */}
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
        <div className={`${card} lg:col-span-1`}>
          <div className={`${ikon} bg-[rgba(229,193,123,0.12)] border-[rgba(229,193,123,0.2)]`}><Scissors className="w-4 h-4 text-[#e5c17b]" /></div>
          <div>
            <p className="text-lg font-bold leading-none text-[#e8eaed]">{ringkasan.pcs.toLocaleString('id-ID')} <span className="text-xs font-medium text-[#9aa0a6]">pcs</span></p>
            <p className="text-[11px] text-[#9aa0a6] mt-1">{ringkasan.bundles} bundle dipotong</p>
          </div>
        </div>
        <div className={`${card} lg:col-span-1`}>
          <div className={`${ikon} bg-[rgba(229,193,123,0.12)] border-[rgba(229,193,123,0.2)]`}><Package className="w-4 h-4 text-[#e5c17b]" /></div>
          <div>
            <p className="text-lg font-bold leading-none text-[#e8eaed]">
              {ringkasan.perSatuan.size === 0 ? '0' : [...ringkasan.perSatuan].map(([s, v]) => `${fmtQty(v)} ${s}`).join(' · ')}
            </p>
            <p className="text-[11px] text-[#9aa0a6] mt-1">Total bahan terpakai</p>
          </div>
        </div>
        <div className={card}>
          <div className={`${ikon} bg-green-500/10 border-green-500/30`}><TrendingDown className="w-4 h-4 text-green-400" /></div>
          <div>
            <p className="text-lg font-bold leading-none text-green-400">{ringkasan.st.irit.n} <span className="text-xs font-medium text-[#9aa0a6]">artikel</span></p>
            <p className="text-[11px] text-[#9aa0a6] mt-1">Irit {ringkasan.st.irit.n ? `(${fmtQty(ringkasan.st.irit.sel)} ${satuanUtama})` : ''}</p>
          </div>
        </div>
        <div className={card}>
          <div className={`${ikon} bg-sky-500/10 border-sky-500/30`}><CheckCircle2 className="w-4 h-4 text-sky-300" /></div>
          <div>
            <p className="text-lg font-bold leading-none text-sky-300">{ringkasan.st.sesuai.n} <span className="text-xs font-medium text-[#9aa0a6]">artikel</span></p>
            <p className="text-[11px] text-[#9aa0a6] mt-1">Sesuai patokan</p>
          </div>
        </div>
        <div className={card}>
          <div className={`${ikon} bg-red-500/10 border-red-500/30`}><TrendingUp className="w-4 h-4 text-red-400" /></div>
          <div>
            <p className="text-lg font-bold leading-none text-red-400">{ringkasan.st.boros.n} <span className="text-xs font-medium text-[#9aa0a6]">artikel</span></p>
            <p className="text-[11px] text-[#9aa0a6] mt-1">Boros {ringkasan.st.boros.n ? `(+${fmtQty(ringkasan.st.boros.sel)} ${satuanUtama})` : ''}</p>
          </div>
        </div>
        <div className={card}>
          <div className={`${ikon} bg-[#2A2D31]/40 border-[#2A2D31]`}><HelpCircle className="w-4 h-4 text-[#9aa0a6]" /></div>
          <div>
            <p className="text-lg font-bold leading-none text-[#e8eaed]">{ringkasan.st.tanpa.n} <span className="text-xs font-medium text-[#9aa0a6]">artikel</span></p>
            <p className="text-[11px] text-[#9aa0a6] mt-1">Tanpa patokan</p>
          </div>
        </div>
      </div>

      {/* Tabel */}
      <div className="rounded-xl border border-[#2A2D31] bg-[#1A1D1F] overflow-hidden">
        <div className="overflow-auto max-h-[60vh]">
          <table className="w-full text-sm border-separate border-spacing-0">
            <thead>
              <tr>
                <th className={`${th} w-10 text-center`}>
                  <input type="checkbox" checked={semuaTerpilih}
                    ref={el => { if (el) el.indeterminate = terpilih.length > 0 && !semuaTerpilih; }}
                    onChange={() => setPilih(semuaTerpilih ? new Set() : new Set(grup.map(g => g.key)))}
                    className="accent-[#e5c17b] w-4 h-4 cursor-pointer" />
                </th>
                <th className={`${th} text-left`}>No PO</th>
                <th className={`${th} text-left`}>Klien</th>
                <th className={`${th} text-left`}>Artikel</th>
                <th className={`${th} text-center`}>Bundle</th>
                <th className={`${th} text-center`}>Hasil Potong</th>
                <th className={`${th} text-left`}>Bahan Terpakai</th>
                <th className={`${th} text-left`}>Patokan HPP</th>
                <th className={`${th} text-right`}>Nilai</th>
                <th className={`${th} text-left`}>Terakhir</th>
                <th className={`${th} w-20`} />
              </tr>
            </thead>
            <tbody>
              {grup.length === 0 ? (
                <tr><td colSpan={11} className="px-4 py-12 text-center text-[#9aa0a6] text-sm">Belum ada pemakaian bahan pada periode ini</td></tr>
              ) : grup.map(g => {
                const perBundle = nilaiPerBundle(g.items);
                return (
                  <React.Fragment key={g.key}>
                    <tr onClick={() => setExpanded(expanded === g.key ? null : g.key)}
                      className={'cursor-pointer transition-colors ' + (pilih.has(g.key) ? 'bg-[#e5c17b]/5' : 'hover:bg-[#1E2124]')}>
                      <td className="px-4 py-3 text-center border-b border-[#2A2D31]" onClick={e => e.stopPropagation()}>
                        <input type="checkbox" checked={pilih.has(g.key)} onChange={() => togglePilih(g.key)}
                          className="accent-[#e5c17b] w-4 h-4 cursor-pointer" />
                      </td>
                      <td className="px-4 py-3 font-mono font-bold text-[#e5c17b] border-b border-[#2A2D31]">{g.no_po}</td>
                      <td className="px-4 py-3 text-[#9aa0a6] border-b border-[#2A2D31]">{g.klien_nama}</td>
                      <td className="px-4 py-3 text-[#e8eaed] border-b border-[#2A2D31]">{g.model_nama ?? '-'}</td>
                      <td className="px-4 py-3 text-center font-semibold text-[#e8eaed] border-b border-[#2A2D31]">{g.bundle_ids.size}</td>
                      <td className="px-4 py-3 text-center font-mono text-[#e8eaed] border-b border-[#2A2D31]">
                        {g.qty_potong} <span className="text-[#9aa0a6] text-xs">pcs</span>
                      </td>
                      <td className="px-4 py-3 border-b border-[#2A2D31]">
                        <div className="flex flex-wrap gap-1">
                          {[...g.bahan].map(([nama, v]) => (
                            <span key={nama} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[#0D0E10] border border-[#2A2D31] text-xs">
                              <span className="text-[#e8eaed]">{nama}</span>
                              <span className="font-mono text-[#e5c17b]">{fmtQty(v.qty)} {v.satuan}</span>
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="px-4 py-3 border-b border-[#2A2D31]">
                        <BadgeStatus status={g.status.status} persen={g.status.persen} selisih={g.status.selisih} satuan={g.status.satuan} />
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-[#e8eaed] border-b border-[#2A2D31]">
                        {g.harga > 0 ? fmtRp(g.harga) : <span className="text-[#9aa0a6]">-</span>}
                      </td>
                      <td className="px-4 py-3 text-xs text-[#9aa0a6] border-b border-[#2A2D31]">
                        <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{fmtTime(g.tanggal)}</span>
                      </td>
                      <td className="px-2 py-3 text-[#9aa0a6] border-b border-[#2A2D31]">
                        <span className="flex items-center justify-end gap-1">
                          {isOwner && (
                            <button title="Edit pemakaian" onClick={e => { e.stopPropagation(); setEditKey(g.key); }}
                              className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-[#2A2D31] hover:text-[#e5c17b]">
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                          )}
                          {expanded === g.key ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                        </span>
                      </td>
                    </tr>

                    {expanded === g.key && (
                      <tr>
                        <td colSpan={11} className="bg-[#16181A] px-4 py-3 border-b border-[#2A2D31]">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="border-b border-[#2A2D31] text-[#9aa0a6] uppercase tracking-wider">
                                <th className="text-left py-1.5 px-2 font-bold">Barcode</th>
                                <th className="text-left py-1.5 px-2 font-bold">Warna</th>
                                <th className="text-left py-1.5 px-2 font-bold">Size</th>
                                <th className="text-center py-1.5 px-2 font-bold">Hasil</th>
                                <th className="text-left py-1.5 px-2 font-bold">Bahan</th>
                                <th className="text-right py-1.5 px-2 font-bold">Pakai/pcs</th>
                                <th className="text-right py-1.5 px-2 font-bold">Patokan</th>
                                <th className="text-left py-1.5 px-2 font-bold">Status</th>
                                <th className="text-right py-1.5 px-2 font-bold">Total Pakai</th>
                                <th className="text-right py-1.5 px-2 font-bold">Nilai</th>
                                <th className="text-left py-1.5 px-2 font-bold">Tukang Potong</th>
                                <th className="text-left py-1.5 px-2 font-bold">Waktu</th>
                              </tr>
                            </thead>
                            <tbody>
                              {g.items.map(r => {
                                const bn = perBundle.get(r.bundle_id);
                                const st = utama(r) && bn ? statusPemakaian(bn.rate, bn.patokan) : null;
                                return (
                                  <tr key={r.id} className="border-b border-[#2A2D31]/50 hover:bg-[#1A1D1F]">
                                    <td className="py-1.5 px-2 font-mono text-[#e5c17b]">{r.barcode}</td>
                                    <td className="py-1.5 px-2 text-[#e8eaed]">{r.warna}</td>
                                    <td className="py-1.5 px-2 text-[#e8eaed]">{r.size}</td>
                                    <td className="py-1.5 px-2 text-center text-[#e8eaed]">{r.qty_potong} pcs</td>
                                    <td className="py-1.5 px-2 text-[#e8eaed]">{r.bahan_nama}</td>
                                    <td className="py-1.5 px-2 text-right font-mono text-[#e8eaed]">{fmtRate(r.rate_per_pcs)} <span className="text-[#9aa0a6]">{r.satuan}</span></td>
                                    <td className="py-1.5 px-2 text-right font-mono text-[#9aa0a6]">{utama(r) && r.patokan != null ? fmtRate(r.patokan) : '-'}</td>
                                    <td className="py-1.5 px-2">
                                      {st && <BadgeStatus status={st} persen={bn?.patokan ? persenSelisih(bn.rate, bn.patokan) : undefined} />}
                                    </td>
                                    <td className="py-1.5 px-2 text-right font-mono font-semibold text-[#e8eaed]">{fmtQty(r.qty_pakai)} <span className="text-[#9aa0a6] font-normal">{r.satuan}</span></td>
                                    <td className="py-1.5 px-2 text-right font-mono text-[#e8eaed]">{r.harga_pakai > 0 ? fmtRp(r.harga_pakai) : <span className="text-[#9aa0a6]">-</span>}</td>
                                    <td className="py-1.5 px-2 text-[#e8eaed]">{r.karyawan_nama ?? <span className="text-[#9aa0a6]">-</span>}</td>
                                    <td className="py-1.5 px-2 text-[#9aa0a6]">{fmtTime(r.tanggal)}</td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                          <p className="text-[10px] text-[#9aa0a6] mt-2">
                            Patokan HPP adalah total bahan utama per pcs. Artikel dua warna dibandingkan dari jumlah kedua bahannya.
                          </p>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {grupEdit && (
        <ModalEditPemakaian
          judul={`${grupEdit.no_po} · ${grupEdit.model_nama ?? '-'}`}
          items={grupEdit.items}
          onClose={() => setEditKey(null)}
          onSaved={() => { setEditKey(null); onChanged(); }}
        />
      )}
    </div>
  );
}
