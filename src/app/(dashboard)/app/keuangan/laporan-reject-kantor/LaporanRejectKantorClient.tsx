'use client';

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import type { RejectKantorRow, RejectTingkat } from '@/lib/actions/pengiriman/reject-kantor.actions';
import { PanduanProvider, PanelPanduan, InfoIstilah, TombolPanduan } from '@/components/keuangan/panduan/Panduan';
import type { KunciIstilah } from '@/lib/keuangan/kamus';
import { buatPanduanRejectKantor } from './panduan-reject-kantor';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const idr = (n: number) => 'Rp ' + Math.round(n).toLocaleString('id-ID');
const tgl = (iso: string) =>
  iso ? new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }) : '-';
const namaBulan = (ym: string) => {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });
};

const TINGKAT: Record<RejectTingkat, string> = { minor: 'Minor', mayor: 'Mayor', parah: 'Rusak parah' };

/** Pecahan nilai satu catatan reject (pcs & rupiah). */
interface Nilai {
  pcs: number;
  nilai: number;          // qty × harga SJ
  pcsPulih: number;       // dikirim ulang & diterima
  pulihKirim: number;
  pcsDibeli: number;
  pulihDibeli: number;    // harga beli × pcs dibeli
  pcsTidakBisa: number;
  pcsGantung: number;     // masih retur / diperbaiki
  gantung: number;
  permanen: number;       // kerugian pasti: tidak bisa (penuh) + dibeli (selisih harga)
}

function hitung(r: RejectKantorRow): Nilai {
  const h = r.harga_satuan;
  const hb = Math.min(r.harga_beli_kantor ?? 0, h);
  const dibeli = r.status === 'dibeli_kantor';
  const tidakBisa = r.status === 'tidak_bisa';
  const gantung = r.status === 'retur' || r.status === 'diperbaiki';
  return {
    pcs: r.qty,
    nilai: r.qty * h,
    pcsPulih: r.terkirim,
    pulihKirim: r.terkirim * h,
    pcsDibeli: dibeli ? r.sisa : 0,
    pulihDibeli: dibeli ? r.sisa * hb : 0,
    pcsTidakBisa: tidakBisa ? r.sisa : 0,
    pcsGantung: gantung ? r.sisa : 0,
    gantung: gantung ? r.sisa * h : 0,
    permanen: tidakBisa ? r.sisa * h : dibeli ? r.sisa * (h - hb) : 0,
  };
}

const kosong = (): Nilai => ({
  pcs: 0, nilai: 0, pcsPulih: 0, pulihKirim: 0, pcsDibeli: 0, pulihDibeli: 0,
  pcsTidakBisa: 0, pcsGantung: 0, gantung: 0, permanen: 0,
});
const tambah = (a: Nilai, b: Nilai): Nilai => {
  const o = { ...a };
  (Object.keys(o) as (keyof Nilai)[]).forEach(k => { o[k] += b[k]; });
  return o;
};

interface Grup { key: string; label: string; sub?: string; n: Nilai; catatan: number }

function kelompokkan(rows: RejectKantorRow[], keyFn: (r: RejectKantorRow) => [string, string, string?]): Grup[] {
  const m = new Map<string, Grup>();
  rows.forEach(r => {
    const [key, label, sub] = keyFn(r);
    const g = m.get(key) ?? { key, label, sub, n: kosong(), catatan: 0 };
    g.n = tambah(g.n, hitung(r));
    g.catatan += 1;
    m.set(key, g);
  });
  return [...m.values()].sort((a, b) => (b.n.permanen + b.n.gantung) - (a.n.permanen + a.n.gantung) || b.n.pcs - a.n.pcs);
}

// ─── UI kecil ─────────────────────────────────────────────────────────────────

function Kartu({ label, nilai, sub, warna, k }: { label: string; nilai: string; sub?: string; warna?: string; k?: KunciIstilah }) {
  return (
    <div className="bg-[#1A1D1F] border border-[#2A2D31] rounded-xl p-4">
      <div className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-[#9aa0a6]">{label}{k && <InfoIstilah k={k} />}</div>
      <div className={`text-lg font-bold mt-1 ${warna ?? 'text-[#e8eaed]'}`}>{nilai}</div>
      {sub && <div className="text-[10px] text-[#9aa0a6] mt-0.5">{sub}</div>}
    </div>
  );
}

const pcsRp = (pcs: number, rp?: number) => (pcs ? (
  <>
    <span>{pcs} pcs</span>
    {rp !== undefined && rp !== 0 && <span className="block text-[10px] opacity-80 font-mono">{idr(rp)}</span>}
  </>
) : '—');

function TabelGrup({ judul, kolom, data }: { judul: string; kolom: string; data: Grup[] }) {
  const t = data.reduce((s, g) => tambah(s, g.n), kosong());
  return (
    <div className="bg-[#1A1D1F] border border-[#2A2D31] rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-[#2A2D31] text-sm font-semibold text-[#e8eaed]">{judul}</div>
      {data.length === 0 ? (
        <div className="p-6 text-center text-xs text-[#9aa0a6]">Belum ada data</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-[10px] uppercase text-[#9aa0a6] bg-[#0D0E10]">
              <tr>
                <th className="px-4 py-2 text-left">{kolom}</th>
                <th className="px-3 py-2 text-right">Reject</th>
                <th className="px-3 py-2 text-right">Pulih (kirim ulang)</th>
                <th className="px-3 py-2 text-right"><KolomInfo judul="Dibeli kantor" k="dibeli_kantor" /></th>
                <th className="px-3 py-2 text-right"><KolomInfo judul="Tidak bisa" k="tidak_bisa_diperbaiki" /></th>
                <th className="px-3 py-2 text-right"><KolomInfo judul="Masih menggantung" k="gantung_reject" /></th>
                <th className="px-4 py-2 text-right"><KolomInfo judul="Kerugian pasti" k="kerugian_pasti" /></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#2A2D31]/60">
              {data.map(g => (
                <tr key={g.key}>
                  <td className="px-4 py-2">
                    <div className="text-[#e8eaed]">{g.label}</div>
                    {g.sub && <div className="text-[10px] text-[#9aa0a6]">{g.sub}</div>}
                  </td>
                  <td className="px-3 py-2 text-right text-[#e8eaed] font-bold">{pcsRp(g.n.pcs, g.n.nilai)}</td>
                  <td className="px-3 py-2 text-right text-emerald-400">{pcsRp(g.n.pcsPulih, g.n.pulihKirim)}</td>
                  <td className="px-3 py-2 text-right text-sky-400">{pcsRp(g.n.pcsDibeli, g.n.pulihDibeli)}</td>
                  <td className="px-3 py-2 text-right text-zinc-400">{pcsRp(g.n.pcsTidakBisa)}</td>
                  <td className="px-3 py-2 text-right text-orange-400">{pcsRp(g.n.pcsGantung, g.n.gantung)}</td>
                  <td className="px-4 py-2 text-right font-mono text-red-400">{g.n.permanen ? idr(g.n.permanen) : '—'}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t border-[#3c4043] font-bold">
              <tr>
                <td className="px-4 py-2 text-[#e8eaed]">Total</td>
                <td className="px-3 py-2 text-right text-[#e8eaed]">{pcsRp(t.pcs, t.nilai)}</td>
                <td className="px-3 py-2 text-right text-emerald-400">{pcsRp(t.pcsPulih, t.pulihKirim)}</td>
                <td className="px-3 py-2 text-right text-sky-400">{pcsRp(t.pcsDibeli, t.pulihDibeli)}</td>
                <td className="px-3 py-2 text-right text-zinc-400">{pcsRp(t.pcsTidakBisa)}</td>
                <td className="px-3 py-2 text-right text-orange-400">{pcsRp(t.pcsGantung, t.gantung)}</td>
                <td className="px-4 py-2 text-right font-mono text-red-400">{t.permanen ? idr(t.permanen) : '—'}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

/** Judul kolom + ikon ⓘ (rata kanan) */
const KolomInfo = ({ judul, k }: { judul: string; k: KunciIstilah }) => (
  <span className="inline-flex items-center justify-end gap-1">{judul}<InfoIstilah k={k} /></span>
);

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function LaporanRejectKantorClient(props: { rows: RejectKantorRow[] }) {
  return (
    <PanduanProvider>
      <LaporanRejectKantorIsi {...props} />
    </PanduanProvider>
  );
}

function LaporanRejectKantorIsi({ rows }: { rows: RejectKantorRow[] }) {
  const bulanAda = useMemo(() => [...new Set(rows.map(r => r.tanggal.slice(0, 7)))].sort().reverse(), [rows]);
  const [bulan, setBulan] = useState<string>('');
  const [sumber, setSumber] = useState<'semua' | 'sj' | 'barang_lama'>('semua');

  const data = rows.filter(r => (!bulan || r.tanggal.startsWith(bulan)) && (sumber === 'semua' || r.sumber === sumber));
  const t = data.reduce((s, r) => tambah(s, hitung(r)), kosong());
  const pctReject = (n: number) => (t.nilai > 0 ? ` · ${Math.round((n / t.nilai) * 100)}% dari nilai reject` : '');

  // Penyelesaian: satu catatan bisa terbagi (sebagian sudah dikirim ulang, sisanya menunggu / dibeli / tidak bisa)
  const penyelesaian: Grup[] = [
    { key: 'kirim', label: 'Diperbaiki & dikirim ulang', sub: 'nilai pulih penuh', n: { ...kosong(), pcs: t.pcsPulih, nilai: t.pulihKirim, pcsPulih: t.pcsPulih, pulihKirim: t.pulihKirim }, catatan: 0 },
    { key: 'dibeli', label: 'Dibeli kantor', sub: 'kerugian = selisih harga', n: { ...kosong(), pcs: t.pcsDibeli, nilai: data.filter(r => r.status === 'dibeli_kantor').reduce((s, r) => s + r.sisa * r.harga_satuan, 0), pcsDibeli: t.pcsDibeli, pulihDibeli: t.pulihDibeli, permanen: data.filter(r => r.status === 'dibeli_kantor').reduce((s, r) => s + hitung(r).permanen, 0) }, catatan: 0 },
    { key: 'tidak', label: 'Tidak bisa diperbaiki', sub: 'kerugian penuh', n: { ...kosong(), pcs: t.pcsTidakBisa, nilai: data.filter(r => r.status === 'tidak_bisa').reduce((s, r) => s + hitung(r).permanen, 0), pcsTidakBisa: t.pcsTidakBisa, permanen: data.filter(r => r.status === 'tidak_bisa').reduce((s, r) => s + hitung(r).permanen, 0) }, catatan: 0 },
    { key: 'gantung', label: 'Belum selesai', sub: 'retur / sedang diperbaiki', n: { ...kosong(), pcs: t.pcsGantung, nilai: t.gantung, pcsGantung: t.pcsGantung, gantung: t.gantung }, catatan: 0 },
  ].filter(g => g.n.pcs > 0);

  const kontenPanduan = buatPanduanRejectKantor({
    catatan: data.length, pcs: t.pcs, nilai: t.nilai, pulih: t.pulihKirim + t.pulihDibeli, pcsPulih: t.pcsPulih,
    pcsDibeli: t.pcsDibeli, gantung: t.gantung, pcsGantung: t.pcsGantung, permanen: t.permanen,
  });

  const selectCls = 'bg-[#0D0E10] border border-[#2A2D31] text-[#e8eaed] rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:border-[#e5c17b]';

  return (
    <div className="space-y-5">
      <PanelPanduan konten={kontenPanduan} />
      <div data-panduan="filter-reject-kantor" className="flex flex-wrap items-center gap-3">
        <label className="text-xs text-[#9aa0a6]">Periode (tanggal reject dilaporkan)</label>
        <select value={bulan} onChange={e => setBulan(e.target.value)} className={selectCls}>
          <option value="">Semua</option>
          {bulanAda.map(b => <option key={b} value={b}>{namaBulan(b)}</option>)}
        </select>
        <select value={sumber} onChange={e => setSumber(e.target.value as typeof sumber)} className={selectCls}>
          <option value="semua">Semua barang</option>
          <option value="sj">Kiriman di sistem</option>
          <option value="barang_lama">Barang lama (di luar sistem)</option>
        </select>
        <InfoIstilah k="barang_lama_reject" />
        <Link href="/app/pengiriman/reject-kantor" className="text-xs text-[#e5c17b] underline ml-auto">Buka Reject Kantor (proses) →</Link>
        <TombolPanduan />
      </div>

      <div data-panduan="kartu-reject-kantor" className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Kartu k="nilai_reject" label="Nilai Reject" nilai={idr(t.nilai)} sub={`${t.pcs} pcs · ${data.length} catatan`} />
        <Kartu k="pulih_reject" label="Sudah Pulih" nilai={idr(t.pulihKirim + t.pulihDibeli)} warna="text-emerald-400"
          sub={`${t.pcsPulih} pcs dikirim ulang · ${t.pcsDibeli} pcs dibeli kantor`} />
        <Kartu k="gantung_reject" label="Masih Menggantung" nilai={idr(t.gantung)} warna="text-orange-400"
          sub={`${t.pcsGantung} pcs belum selesai — bisa pulih / jadi kerugian`} />
        <Kartu k="kerugian_pasti" label="Kerugian Pasti" nilai={idr(t.permanen)} warna="text-red-400"
          sub={`tidak bisa + selisih harga dibeli${pctReject(t.permanen)}`} />
        <Kartu k="kerugian_bersih_reject" label="Kerugian Bersih Saat Ini" nilai={idr(t.permanen + t.gantung)} warna="text-red-300"
          sub="= Retur & Reject di Laba Rugi" />
      </div>

      <p className="text-[11px] text-[#9aa0a6]">
        Kerugian bersih saat ini = nilai reject − yang sudah pulih. Angka ini sama dengan baris <strong>Retur &amp; Reject</strong> di
        Kinerja Keuangan (untuk kiriman PO periode baru), karena reject diakui di tanggal dilaporkan dan pemulihan di tanggal kejadiannya.
        Barang lama tidak memotong tagihan, tapi tetap dihitung kerugian.
      </p>

      <div data-panduan="tabel-grup-reject" className="grid lg:grid-cols-2 gap-4">
        <TabelGrup judul="Per Tingkat Reject" kolom="Tingkat"
          data={kelompokkan(data, r => [r.tingkat, TINGKAT[r.tingkat]])} />
        <TabelGrup judul="Per Penyelesaian" kolom="Penyelesaian" data={penyelesaian} />
      </div>
      <TabelGrup judul="Per Produk (Model · Warna · Size)" kolom="Produk"
        data={kelompokkan(data, r => [r.produk_nama, r.produk_nama, r.model_nama !== r.produk_nama ? r.model_nama : undefined])} />
      <div className="grid lg:grid-cols-2 gap-4">
        <TabelGrup judul="Per Alasan" kolom="Alasan"
          data={kelompokkan(data, r => [r.alasan_nama, r.alasan_nama, r.jenis_nama])} />
        <TabelGrup judul="Per Surat Jalan" kolom="Surat Jalan"
          data={kelompokkan(data, r => [r.surat_jalan_id ?? 'barang_lama', r.nomor_sj, r.klien_nama])} />
      </div>

      {/* Rincian catatan */}
      <div data-panduan="rincian-reject-kantor" className="bg-[#1A1D1F] border border-[#2A2D31] rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-[#2A2D31] text-sm font-semibold text-[#e8eaed]">Rincian Catatan Reject</div>
        {data.length === 0 ? (
          <div className="p-6 text-center text-xs text-[#9aa0a6]">Belum ada data</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-[10px] uppercase text-[#9aa0a6] bg-[#0D0E10]">
                <tr>
                  <th className="px-3 py-2 text-left">No. / Tanggal</th>
                  <th className="px-3 py-2 text-left">SJ Asal</th>
                  <th className="px-3 py-2 text-left">Produk</th>
                  <th className="px-3 py-2 text-left">Alasan · Tingkat</th>
                  <th className="px-3 py-2 text-right">Qty</th>
                  <th className="px-3 py-2 text-right">Harga SJ</th>
                  <th className="px-3 py-2 text-left">Penyelesaian</th>
                  <th className="px-3 py-2 text-right">Kerugian</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#2A2D31]/60">
                {data.map(r => {
                  const n = hitung(r);
                  const bagian = [
                    r.terkirim ? `${r.terkirim} dikirim ulang` : '',
                    n.pcsDibeli ? `${n.pcsDibeli} dibeli ${idr(r.harga_beli_kantor ?? 0)}/pcs` : '',
                    n.pcsTidakBisa ? `${n.pcsTidakBisa} tidak bisa` : '',
                    n.pcsGantung ? `${n.pcsGantung} ${r.status === 'diperbaiki' ? 'sedang diperbaiki' : 'retur'}` : '',
                  ].filter(Boolean).join(' · ');
                  return (
                    <tr key={r.id}>
                      <td className="px-3 py-2">
                        <div className="font-mono text-[#e5c17b]">{r.nomor_reject}</div>
                        <div className="text-[10px] text-[#9aa0a6]">{tgl(r.tanggal)}</div>
                      </td>
                      <td className="px-3 py-2">
                        {r.surat_jalan_id
                          ? <Link href={`/app/pengiriman/riwayat/${r.surat_jalan_id}`} className="font-mono text-[#e8eaed] hover:text-[#e5c17b]">{r.nomor_sj}</Link>
                          : <span className="italic text-[#9aa0a6]">Barang lama</span>}
                        <div className="text-[10px] text-[#9aa0a6]">{r.klien_nama}</div>
                      </td>
                      <td className="px-3 py-2 text-[#e8eaed]">{r.produk_nama}</td>
                      <td className="px-3 py-2">
                        <div className="text-[#e8eaed]">{r.alasan_nama}</div>
                        <div className="text-[10px] text-[#9aa0a6]">{TINGKAT[r.tingkat]}</div>
                      </td>
                      <td className="px-3 py-2 text-right font-bold text-[#e8eaed]">{r.qty}</td>
                      <td className="px-3 py-2 text-right font-mono text-[#e8eaed]">{idr(r.harga_satuan)}</td>
                      <td className="px-3 py-2 text-[#9aa0a6]">{bagian || '—'}</td>
                      <td className="px-3 py-2 text-right font-mono">
                        {n.permanen > 0 && <div className="text-red-400">{idr(n.permanen)}</div>}
                        {n.gantung > 0 && <div className="text-orange-400 text-[10px]">menggantung {idr(n.gantung)}</div>}
                        {!n.permanen && !n.gantung && <span className="text-emerald-400">pulih</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
