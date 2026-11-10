'use client';

import React, { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Search, Clock, Package, Wallet, Scissors, Layers } from 'lucide-react';
import type { PemakaianCuttingRow } from '@/lib/actions/produksi/cutting-v2.actions';

interface Props {
  rows: PemakaianCuttingRow[];
}

type Periode = 'semua' | 'bulan_ini' | '3_bulan';

const PERIODE: { key: Periode; label: string }[] = [
  { key: 'bulan_ini', label: 'Bulan ini' },
  { key: '3_bulan', label: '3 bulan' },
  { key: 'semua', label: 'Semua' },
];

const fmtQty = (n: number) => n.toLocaleString('id-ID', { maximumFractionDigits: 2 });
const fmtRate = (n: number) => n.toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 3 });
const fmtRp = (n: number) =>
  new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(n);
const fmtTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '-';

/** Satu baris tabel = PO + artikel (model); isinya semua bundle & bahan yang dipakai. */
interface Grup {
  key: string;
  no_po: string;
  klien_nama: string;
  model_nama: string | null;
  tanggal: string;
  bundle_ids: Set<string>;
  qty_potong: number;
  /** bahan → { qty, satuan } */
  bahan: Map<string, { qty: number; satuan: string }>;
  harga: number;
  items: PemakaianCuttingRow[];
}

function batasPeriode(p: Periode): Date | null {
  if (p === 'semua') return null;
  const d = new Date();
  if (p === 'bulan_ini') return new Date(d.getFullYear(), d.getMonth(), 1);
  return new Date(d.getFullYear(), d.getMonth() - 2, 1);
}

export default function PemakaianBahanTab({ rows }: Props) {
  const [q, setQ] = useState('');
  const [periode, setPeriode] = useState<Periode>('bulan_ini');
  const [expanded, setExpanded] = useState<string | null>(null);

  const tersaring = useMemo(() => {
    const batas = batasPeriode(periode);
    const kata = q.trim().toLowerCase();
    return rows.filter(r => {
      if (batas && new Date(r.tanggal) < batas) return false;
      if (!kata) return true;
      return [r.no_po, r.klien_nama, r.model_nama ?? '', r.produk_nama, r.bahan_nama, r.barcode, r.warna, r.karyawan_nama ?? '']
        .some(s => s.toLowerCase().includes(kata));
    });
  }, [rows, q, periode]);

  const grup = useMemo(() => {
    const map = new Map<string, Grup>();
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
    for (const g of map.values()) {
      g.items.sort((a, b) => a.warna.localeCompare(b.warna) || a.size.localeCompare(b.size) || a.barcode.localeCompare(b.barcode) || a.bahan_nama.localeCompare(b.bahan_nama));
    }
    return [...map.values()].sort((a, b) => b.tanggal.localeCompare(a.tanggal));
  }, [tersaring]);

  const ringkasan = useMemo(() => {
    const bundles = new Set<string>();
    let pcs = 0, harga = 0;
    const bahan = new Map<string, { qty: number; satuan: string }>();
    for (const g of grup) {
      g.bundle_ids.forEach(id => bundles.add(id));
      pcs += g.qty_potong;
      harga += g.harga;
      for (const [nama, v] of g.bahan) {
        const b = bahan.get(nama) ?? { qty: 0, satuan: v.satuan };
        b.qty += v.qty; bahan.set(nama, b);
      }
    }
    const perSatuan = new Map<string, number>();
    for (const v of bahan.values()) perSatuan.set(v.satuan, (perSatuan.get(v.satuan) ?? 0) + v.qty);
    return { bundles: bundles.size, pcs, harga, jenisBahan: bahan.size, perSatuan };
  }, [grup]);

  const th = 'sticky top-0 z-10 px-4 py-3 text-[10px] uppercase tracking-widest text-[#9aa0a6] font-bold bg-[#16181A] border-b border-[#2A2D31]';
  const card = 'flex items-center gap-3 rounded-xl px-4 py-3 bg-[#1A1D1F] border border-[#2A2D31]';
  const ikon = 'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[rgba(229,193,123,0.12)] border border-[rgba(229,193,123,0.2)]';

  return (
    <div className="space-y-4">
      {/* Filter */}
      <div className="flex flex-col md:flex-row md:items-center gap-3">
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
      </div>

      {/* Ringkasan */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className={card}>
          <div className={ikon}><Scissors className="w-4 h-4 text-[#e5c17b]" /></div>
          <div>
            <p className="text-lg font-bold leading-none text-[#e8eaed]">{ringkasan.pcs.toLocaleString('id-ID')} <span className="text-xs font-medium text-[#9aa0a6]">pcs</span></p>
            <p className="text-[11px] text-[#9aa0a6] mt-1">{ringkasan.bundles} bundle dipotong</p>
          </div>
        </div>
        <div className={card}>
          <div className={ikon}><Package className="w-4 h-4 text-[#e5c17b]" /></div>
          <div>
            <p className="text-lg font-bold leading-none text-[#e8eaed]">
              {ringkasan.perSatuan.size === 0 ? '0' : [...ringkasan.perSatuan].map(([s, v]) => `${fmtQty(v)} ${s}`).join(' · ')}
            </p>
            <p className="text-[11px] text-[#9aa0a6] mt-1">Total bahan terpakai</p>
          </div>
        </div>
        <div className={card}>
          <div className={ikon}><Layers className="w-4 h-4 text-[#e5c17b]" /></div>
          <div>
            <p className="text-lg font-bold leading-none text-[#e8eaed]">{ringkasan.jenisBahan}</p>
            <p className="text-[11px] text-[#9aa0a6] mt-1">Jenis bahan</p>
          </div>
        </div>
        <div className={card}>
          <div className={ikon}><Wallet className="w-4 h-4 text-[#e5c17b]" /></div>
          <div>
            <p className="text-lg font-bold leading-none text-[#e8eaed]">{fmtRp(ringkasan.harga)}</p>
            <p className="text-[11px] text-[#9aa0a6] mt-1">Nilai bahan (harga batch)</p>
          </div>
        </div>
      </div>

      {/* Tabel */}
      <div className="rounded-xl border border-[#2A2D31] bg-[#1A1D1F] overflow-hidden">
        <div className="overflow-auto max-h-[60vh]">
          <table className="w-full text-sm border-separate border-spacing-0">
            <thead>
              <tr>
                <th className={`${th} text-left`}>No PO</th>
                <th className={`${th} text-left`}>Klien</th>
                <th className={`${th} text-left`}>Artikel</th>
                <th className={`${th} text-center`}>Bundle</th>
                <th className={`${th} text-center`}>Hasil Potong</th>
                <th className={`${th} text-left`}>Bahan Terpakai</th>
                <th className={`${th} text-right`}>Nilai</th>
                <th className={`${th} text-left`}>Terakhir</th>
                <th className={`${th} w-10`} />
              </tr>
            </thead>
            <tbody>
              {grup.length === 0 ? (
                <tr><td colSpan={9} className="px-4 py-12 text-center text-[#9aa0a6] text-sm">Belum ada pemakaian bahan pada periode ini</td></tr>
              ) : grup.map(g => (
                <React.Fragment key={g.key}>
                  <tr onClick={() => setExpanded(expanded === g.key ? null : g.key)}
                    className="cursor-pointer transition-colors hover:bg-[#1E2124]">
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
                    <td className="px-4 py-3 text-right font-mono text-[#e8eaed] border-b border-[#2A2D31]">
                      {g.harga > 0 ? fmtRp(g.harga) : <span className="text-[#9aa0a6]">-</span>}
                    </td>
                    <td className="px-4 py-3 text-xs text-[#9aa0a6] border-b border-[#2A2D31]">
                      <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{fmtTime(g.tanggal)}</span>
                    </td>
                    <td className="px-2 py-3 text-[#9aa0a6] border-b border-[#2A2D31]">
                      {expanded === g.key ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                    </td>
                  </tr>

                  {expanded === g.key && (
                    <tr>
                      <td colSpan={9} className="bg-[#16181A] px-4 py-3 border-b border-[#2A2D31]">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="border-b border-[#2A2D31] text-[#9aa0a6] uppercase tracking-wider">
                              <th className="text-left py-1.5 px-2 font-bold">Barcode</th>
                              <th className="text-left py-1.5 px-2 font-bold">Warna</th>
                              <th className="text-left py-1.5 px-2 font-bold">Size</th>
                              <th className="text-center py-1.5 px-2 font-bold">Hasil</th>
                              <th className="text-left py-1.5 px-2 font-bold">Bahan</th>
                              <th className="text-right py-1.5 px-2 font-bold">Pakai/pcs</th>
                              <th className="text-right py-1.5 px-2 font-bold">Standar</th>
                              <th className="text-right py-1.5 px-2 font-bold">Total Pakai</th>
                              <th className="text-right py-1.5 px-2 font-bold">Nilai</th>
                              <th className="text-left py-1.5 px-2 font-bold">Tukang Potong</th>
                              <th className="text-left py-1.5 px-2 font-bold">Waktu</th>
                            </tr>
                          </thead>
                          <tbody>
                            {g.items.map(r => (
                              <tr key={r.id} className="border-b border-[#2A2D31]/50 hover:bg-[#1A1D1F]">
                                <td className="py-1.5 px-2 font-mono text-[#e5c17b]">{r.barcode}</td>
                                <td className="py-1.5 px-2 text-[#e8eaed]">{r.warna}</td>
                                <td className="py-1.5 px-2 text-[#e8eaed]">{r.size}</td>
                                <td className="py-1.5 px-2 text-center text-[#e8eaed]">{r.qty_potong} pcs</td>
                                <td className="py-1.5 px-2 text-[#e8eaed]">{r.bahan_nama}</td>
                                <td className="py-1.5 px-2 text-right font-mono text-[#e8eaed]">{fmtRate(r.rate_per_pcs)} <span className="text-[#9aa0a6]">{r.satuan}</span></td>
                                <td className="py-1.5 px-2 text-right font-mono text-[#9aa0a6]">{r.rate_standar != null ? fmtRate(r.rate_standar) : '-'}</td>
                                <td className="py-1.5 px-2 text-right font-mono font-semibold text-[#e8eaed]">{fmtQty(r.qty_pakai)} <span className="text-[#9aa0a6] font-normal">{r.satuan}</span></td>
                                <td className="py-1.5 px-2 text-right font-mono text-[#e8eaed]">{r.harga_pakai > 0 ? fmtRp(r.harga_pakai) : <span className="text-[#9aa0a6]">-</span>}</td>
                                <td className="py-1.5 px-2 text-[#e8eaed]">{r.karyawan_nama ?? <span className="text-[#9aa0a6]">-</span>}</td>
                                <td className="py-1.5 px-2 text-[#9aa0a6]">{fmtTime(r.tanggal)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
