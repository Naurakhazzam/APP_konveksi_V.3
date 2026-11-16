'use client';

import React, { useState } from 'react';
import { toast } from 'sonner';
import {
  ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts';
import {
  ChevronDown, ChevronRight, Download, Filter, Loader2, CheckCircle2, AlertTriangle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import TogglePoLama from '@/components/keuangan/TogglePoLama';
import {
  getBiayaOverhead, aturSubOverhead, simpanBiayaTetap, hapusBiayaTetap,
  type BiayaOverheadData, type OverheadSubRealisasi, type BiayaTetap,
} from '@/lib/actions/keuangan/biaya-overhead.actions';
import type { BukuKasEntry } from '@/lib/actions/keuangan/buku-kas.types';

// Warna grafik: tervalidasi (dataviz validate_palette, mode gelap, surface #16181A) — ALL PASS
const WARNA_REALISASI = '#3987e5';
const WARNA_PATOKAN = '#c98500';
// Warna status: selalu bersama ikon + label
const WARNA_HEMAT = '#0ca30c';
const WARNA_BOROS = '#d03b3b';

const idr = (n: number) => 'Rp ' + Math.round(Math.abs(n)).toLocaleString('id-ID');
const idrPendek = (n: number) =>
  Math.abs(n) >= 1_000_000 ? `${(n / 1_000_000).toLocaleString('id-ID', { maximumFractionDigits: 1 })} jt`
    : Math.abs(n) >= 1_000 ? `${Math.round(n / 1_000)} rb` : String(Math.round(n));
const tgl = (d: string) =>
  new Date(d).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });

const inputCls = 'h-9 px-3 rounded-lg bg-[#1E2124] border border-[#2A2D31] text-sm text-[#e8eaed] outline-none focus:ring-1 focus:ring-[#e5c17b]';
const labelCls = 'block text-[10px] font-bold text-[#9aa0a6] uppercase tracking-widest mb-1';

export default function BiayaOverheadClient({ initialData }: { initialData: BiayaOverheadData }) {
  const [data, setData] = useState(initialData);
  const [dari, setDari] = useState(initialData.dari);
  const [sampai, setSampai] = useState(initialData.sampai);
  const [tampilkanLama, setTampilkanLama] = useState(!initialData.hanyaPeriodeBaru);
  const [memuat, setMemuat] = useState(false);
  const [terbuka, setTerbuka] = useState<Set<string>>(new Set());
  const [lihatTabelTren, setLihatTabelTren] = useState(false);

  const toggle = (key: string) => setTerbuka(prev => {
    const s = new Set(prev);
    if (s.has(key)) s.delete(key); else s.add(key);
    return s;
  });

  const muat = async (opts?: { lama?: boolean }) => {
    if (!dari || !sampai || dari > sampai) { toast.error('Periksa rentang tanggal'); return; }
    setMemuat(true);
    try {
      const lama = opts?.lama ?? tampilkanLama;
      setData(await getBiayaOverhead({ dari, sampai, hanyaPeriodeBaru: !lama }));
      setTerbuka(new Set());
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Gagal memuat data');
    } finally {
      setMemuat(false);
    }
  };

  const selisih = data.totalPatokan - data.totalRealisasiHpp;
  const totalLuar = data.luarHpp.reduce((s, x) => s + x.realisasi, 0);
  const totalLain = data.lain.reduce((s, x) => s + x.nominal, 0);

  /** Transaksi Buku Kas milik satu sub-kelompok overhead (null = tanpa sub-kelompok) */
  const transaksiSub = (subId: string | null) =>
    data.transaksi.filter(e => e.kategori === 'Biaya Overhead' && (e.overhead_sub_id ?? null) === subId);

  // ─── UNDUH EXCEL ──────────────────────────────────────────────────────────
  const unduh = async () => {
    const XLSX = await import('xlsx');
    const ringkas: (string | number)[][] = [
      ['Biaya Overhead', `${data.dari} s/d ${data.sampai}`],
      ['Pcs terkirim', data.pcsTerkirim],
      [],
      ['Kelompok', 'Komponen HPP', 'Sub-kelompok', 'Patokan HPP', 'Realisasi', 'Selisih (+ hemat / − boros)'],
    ];
    data.komponen.forEach(k => {
      ringkas.push(['Ditanggung HPP', k.nama, '(total)', Math.round(k.patokan), Math.round(k.realisasi), Math.round(k.patokan - k.realisasi)]);
      k.subs.forEach(s => ringkas.push(['', k.nama, s.nama, '', Math.round(s.realisasi), '']));
    });
    data.luarHpp.forEach(s => ringkas.push(['Di luar patokan HPP', '', s.nama, '', Math.round(s.realisasi), '']));
    data.lain.forEach(l => ringkas.push(['Biaya lain', '', l.kategori, '', Math.round(l.nominal), '']));
    ringkas.push([], ['TOTAL ditanggung HPP', '', '', Math.round(data.totalPatokan), Math.round(data.totalRealisasiHpp), Math.round(selisih)]);

    const ws1 = XLSX.utils.aoa_to_sheet(ringkas);
    ws1['!cols'] = [{ wch: 22 }, { wch: 14 }, { wch: 40 }, { wch: 14 }, { wch: 14 }, { wch: 22 }];
    const ws2 = XLSX.utils.json_to_sheet(data.transaksi
      .slice().sort((a, b) => a.tanggal.localeCompare(b.tanggal))
      .map(e => ({
        Tanggal: e.tanggal.slice(0, 10),
        Kategori: e.kategori,
        'Sub-kelompok': e.overhead_sub_nama ?? '',
        Keterangan: e.keterangan,
        Qty: e.qty ?? '',
        Satuan: e.satuan ?? '',
        Nominal: e.nominal,
      })));
    ws2['!cols'] = [{ wch: 11 }, { wch: 18 }, { wch: 36 }, { wch: 40 }, { wch: 6 }, { wch: 10 }, { wch: 14 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws1, 'Ringkasan');
    XLSX.utils.book_append_sheet(wb, ws2, 'Transaksi');
    XLSX.writeFile(wb, `Biaya_Overhead_${data.dari}_sd_${data.sampai}.xlsx`);
  };

  return (
    <div className="space-y-6">
      {/* ─── FILTER ─────────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-3 items-end p-4 rounded-xl bg-[#1A1D1F] border border-[#2A2D31]">
        <div>
          <label className={labelCls}>Dari</label>
          <input type="date" className={inputCls} value={dari} onChange={e => setDari(e.target.value)} />
        </div>
        <div>
          <label className={labelCls}>Sampai</label>
          <input type="date" className={inputCls} value={sampai} onChange={e => setSampai(e.target.value)} />
        </div>
        <Button onClick={() => muat()} disabled={memuat} className="h-9 bg-[#2A2D31] text-[#e8eaed] hover:bg-[#3A3D41] text-xs">
          {memuat ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Filter className="h-4 w-4 mr-1" />}
          Terapkan
        </Button>
        <Button onClick={unduh} className="h-9 bg-[#e5c17b] hover:bg-[#d4b06a] text-black font-bold text-xs">
          <Download className="h-4 w-4 mr-1" /> Unduh Excel
        </Button>
        <TogglePoLama className="ml-auto" checked={tampilkanLama}
          onChange={v => { setTampilkanLama(v); muat({ lama: v }); }} />
      </div>

      {data.pcsTerkirim === 0 && (
        <div className="flex items-start gap-2 p-3 rounded-xl border border-[#c98500]/40 bg-[#c98500]/10 text-xs text-[#e8eaed]">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" style={{ color: WARNA_PATOKAN }} />
          <span>
            Belum ada barang {data.hanyaPeriodeBaru ? 'periode baru (PO-0099 ke atas) ' : ''}yang dikirim pada rentang ini,
            jadi patokan HPP masih <b>Rp 0</b>. Status &quot;Boros&quot; di bawah belum berarti boros —
            patokan akan terisi setelah surat jalan PO tersebut dibuat.
          </span>
        </div>
      )}

      {/* ─── RINGKASAN ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kartu judul="Pcs Terkirim" nilai={data.pcsTerkirim.toLocaleString('id-ID') + ' pcs'}
          ket="dari surat jalan pada rentang ini" />
        <Kartu judul="Patokan HPP" nilai={idr(data.totalPatokan)}
          ket="tarif overhead HPP × pcs terkirim" />
        <Kartu judul="Realisasi" nilai={idr(data.totalRealisasiHpp)}
          ket="uang keluar yang ditanggung komponen HPP" />
        <div className="p-4 rounded-xl bg-[#1A1D1F] border border-[#2A2D31]">
          <p className="text-[10px] uppercase tracking-widest text-[#9aa0a6] font-bold">Selisih</p>
          <StatusSelisih selisih={selisih} besar />
          <p className="text-[11px] text-[#5f6368] mt-1">patokan − realisasi</p>
        </div>
      </div>

      {/* ─── PER KOMPONEN HPP (meter list) ──────────────────────────── */}
      <Panel judul="Ditanggung HPP — per komponen"
        ket="Bar = realisasi terhadap patokannya. Klik baris untuk rincian sub-kelompok dan transaksi.">
        <div className="divide-y divide-[#2A2D31]">
          {data.komponen.map(k => {
            const key = `k-${k.komponen_id}`;
            const buka = terbuka.has(key);
            const rasio = k.patokan > 0 ? k.realisasi / k.patokan : (k.realisasi > 0 ? 2 : 0);
            return (
              <div key={key}>
                <button onClick={() => toggle(key)} className="w-full text-left px-4 py-3 hover:bg-[#1E2124] transition-colors">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1.5 text-sm font-bold text-[#e8eaed]">
                      {buka ? <ChevronDown className="h-4 w-4 text-[#e5c17b]" /> : <ChevronRight className="h-4 w-4 text-[#9aa0a6]" />}
                      {k.nama}
                    </span>
                    <span className="text-xs text-[#9aa0a6]">
                      <span className="text-[#e8eaed] font-semibold">{idr(k.realisasi)}</span> dari {idr(k.patokan)}
                    </span>
                  </div>
                  <Meter rasio={rasio} />
                  <div className="mt-1.5"><StatusSelisih selisih={k.patokan - k.realisasi} /></div>
                </button>
                {buka && (
                  <div className="px-4 pb-4 pl-10 space-y-2">
                    {k.subs.length === 0 && (
                      <p className="text-xs text-[#5f6368] italic">Belum ada pengeluaran untuk komponen ini pada rentang ini.</p>
                    )}
                    {k.subs.map(s => (
                      <SubBaris key={s.sub_id ?? '-'} sub={s} buka={terbuka.has(`s-${s.sub_id}`)}
                        onToggle={() => toggle(`s-${s.sub_id}`)} transaksi={transaksiSub(s.sub_id)}
                        kontrak={data.biayaTetap.filter(b => b.overhead_sub_id === s.sub_id)} />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Panel>

      {/* ─── DI LUAR PATOKAN HPP ────────────────────────────────────── */}
      <Panel judul="Di luar patokan HPP"
        ket="Overhead yang tetap keluar uang tetapi tidak punya jatah di HPP."
        total={totalLuar}>
        <div className="px-4 py-3 space-y-2">
          {data.luarHpp.length === 0 && <p className="text-xs text-[#5f6368] italic">Tidak ada.</p>}
          {data.luarHpp.map(s => (
            <SubBaris key={s.sub_id ?? '-'} sub={s} buka={terbuka.has(`l-${s.sub_id}`)}
              onToggle={() => toggle(`l-${s.sub_id}`)} transaksi={transaksiSub(s.sub_id)}
              kontrak={data.biayaTetap.filter(b => b.overhead_sub_id === s.sub_id)} />
          ))}
        </div>
      </Panel>

      {/* ─── BIAYA LAIN ─────────────────────────────────────────────── */}
      <Panel judul="Biaya lain (Biaya Operasional & Lainnya)"
        ket="Bukan kategori overhead; ditanggung komponen mana ditentukan per kasus."
        total={totalLain}>
        <div className="px-4 py-3 space-y-2">
          {data.lain.length === 0 && <p className="text-xs text-[#5f6368] italic">Tidak ada.</p>}
          {data.lain.map(l => {
            const key = `x-${l.kategori}`;
            return (
              <SubBaris key={key} sub={{ sub_id: null, nama: l.kategori, realisasi: l.nominal }}
                buka={terbuka.has(key)} onToggle={() => toggle(key)}
                transaksi={data.transaksi.filter(e => e.kategori === l.kategori)} />
            );
          })}
        </div>
      </Panel>

      {/* ─── BIAYA TETAP (KONTRAK) ──────────────────────────────────── */}
      <PanelBiayaTetap list={data.biayaTetap} subList={data.subList} onBerubah={() => muat()} />

      {/* ─── TREN 6 BULAN ───────────────────────────────────────────── */}
      <Panel judul="Tren 6 bulan — realisasi vs patokan HPP"
        ket="Batang = uang overhead yang keluar (ditanggung HPP); garis = patokan HPP × pcs terkirim.">
        <div className="px-4 pt-4">
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={data.tren} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="#2A2D31" />
                <XAxis dataKey="label" tick={{ fill: '#9aa0a6', fontSize: 11 }} axisLine={{ stroke: '#2A2D31' }} tickLine={false} />
                <YAxis tickFormatter={idrPendek} tick={{ fill: '#9aa0a6', fontSize: 11 }} axisLine={false} tickLine={false} width={52} />
                <Tooltip
                  cursor={{ fill: '#ffffff0d' }}
                  contentStyle={{ background: '#1A1D1F', border: '1px solid #2A2D31', borderRadius: 8, fontSize: 12 }}
                  labelStyle={{ color: '#e8eaed', fontWeight: 700 }}
                  itemStyle={{ color: '#e8eaed' }}
                  formatter={(v, n) => [idr(Number(v)), String(n)]}
                />
                <Legend wrapperStyle={{ fontSize: 12, color: '#9aa0a6' }} />
                <Bar dataKey="realisasi" name="Realisasi" fill={WARNA_REALISASI} radius={[4, 4, 0, 0]} maxBarSize={36} />
                <Line dataKey="patokan" name="Patokan HPP" stroke={WARNA_PATOKAN} strokeWidth={2}
                  dot={{ r: 4, fill: WARNA_PATOKAN, stroke: '#16181A', strokeWidth: 2 }} activeDot={{ r: 5 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <button onClick={() => setLihatTabelTren(v => !v)} className="text-xs text-[#e5c17b] hover:underline my-3">
            {lihatTabelTren ? 'Sembunyikan tabel' : 'Lihat sebagai tabel'}
          </button>
          {lihatTabelTren && (
            <div className="overflow-x-auto pb-4">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-[#9aa0a6] text-left">
                    <th className="py-1.5 pr-3 font-semibold">Bulan</th>
                    <th className="py-1.5 pr-3 font-semibold text-right">Pcs terkirim</th>
                    <th className="py-1.5 pr-3 font-semibold text-right">Patokan</th>
                    <th className="py-1.5 pr-3 font-semibold text-right">Realisasi</th>
                    <th className="py-1.5 font-semibold text-right">Selisih</th>
                  </tr>
                </thead>
                <tbody className="text-[#e8eaed]">
                  {data.tren.map(t => (
                    <tr key={t.bulan} className="border-t border-[#2A2D31]">
                      <td className="py-1.5 pr-3">{t.label}</td>
                      <td className="py-1.5 pr-3 text-right">{t.pcs.toLocaleString('id-ID')}</td>
                      <td className="py-1.5 pr-3 text-right">{idr(t.patokan)}</td>
                      <td className="py-1.5 pr-3 text-right">{idr(t.realisasi)}</td>
                      <td className="py-1.5 text-right">{t.patokan - t.realisasi < 0 ? '−' : '+'}{idr(t.patokan - t.realisasi)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Panel>

      {/* ─── PERLU DIRAPIKAN ────────────────────────────────────────── */}
      {data.tanpaSub.length > 0 && (
        <PerluDirapikan entri={data.tanpaSub} subList={data.subList} onSelesai={() => muat()} />
      )}
    </div>
  );
}

// ─── KOMPONEN KECIL ──────────────────────────────────────────────────────────

function Kartu({ judul, nilai, ket }: { judul: string; nilai: string; ket: string }) {
  return (
    <div className="p-4 rounded-xl bg-[#1A1D1F] border border-[#2A2D31]">
      <p className="text-[10px] uppercase tracking-widest text-[#9aa0a6] font-bold">{judul}</p>
      <p className="text-lg font-bold text-[#e8eaed] mt-1">{nilai}</p>
      <p className="text-[11px] text-[#5f6368] mt-1">{ket}</p>
    </div>
  );
}

function Panel({ judul, ket, total, children }: { judul: string; ket: string; total?: number; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-[#2A2D31] bg-[#16181A] overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-2 px-4 py-3 bg-[#1A1C1E] border-b border-[#2A2D31]">
        <div>
          <p className="text-sm font-bold text-[#e8eaed]">{judul}</p>
          <p className="text-[11px] text-[#9aa0a6] mt-0.5">{ket}</p>
        </div>
        {total !== undefined && <p className="text-sm font-bold text-[#e8eaed]">{idr(total)}</p>}
      </div>
      {children}
    </div>
  );
}

/** Hemat / boros — selalu ikon + label, warna hanya penguat */
function StatusSelisih({ selisih, besar }: { selisih: number; besar?: boolean }) {
  const hemat = selisih >= 0;
  const Ikon = hemat ? CheckCircle2 : AlertTriangle;
  return (
    <span className={`inline-flex items-center gap-1.5 font-bold ${besar ? 'text-lg mt-1' : 'text-xs'}`}
      style={{ color: hemat ? WARNA_HEMAT : WARNA_BOROS }}>
      <Ikon className={besar ? 'h-5 w-5' : 'h-3.5 w-3.5'} />
      {hemat ? 'Hemat' : 'Boros'} {idr(selisih)}
    </span>
  );
}

/** Track = patokan (100%); isi = realisasi. Lewat batas → isi penuh merah + tanda. */
function Meter({ rasio }: { rasio: number }) {
  const lewat = rasio > 1;
  return (
    <div className="mt-2 h-2 rounded-full bg-[#2A2D31] overflow-hidden" role="img"
      aria-label={`Realisasi ${Math.round(rasio * 100)}% dari patokan`}>
      <div className="h-full rounded-full transition-all"
        style={{ width: `${Math.min(rasio, 1) * 100}%`, background: lewat ? WARNA_BOROS : WARNA_REALISASI }} />
    </div>
  );
}

function SubBaris({ sub, buka, onToggle, transaksi, kontrak = [] }: {
  sub: OverheadSubRealisasi; buka: boolean; onToggle: () => void; transaksi: BukuKasEntry[];
  /** Biaya tetap yang membiayai sub-kelompok ini (realisasinya = alokasi per hari) */
  kontrak?: BiayaTetap[];
}) {
  const pakaiKontrak = kontrak.length > 0;
  return (
    <div className="rounded-lg border border-[#2A2D31] bg-[#1A1D1F]">
      <button onClick={onToggle} className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left hover:bg-[#1E2124] rounded-lg">
        <span className={`inline-flex items-center gap-1.5 text-xs ${sub.sub_id || sub.nama !== 'Tanpa sub-kelompok' ? 'text-[#e8eaed]' : 'text-[#9aa0a6] italic'}`}>
          {buka ? <ChevronDown className="h-3.5 w-3.5 text-[#e5c17b]" /> : <ChevronRight className="h-3.5 w-3.5 text-[#9aa0a6]" />}
          {sub.nama}
          <span className="text-[#5f6368]">
            {pakaiKontrak ? '(biaya tetap kontrak)' : `(${transaksi.length} transaksi)`}
          </span>
        </span>
        <span className="text-xs font-semibold text-[#e8eaed]">{idr(sub.realisasi)}</span>
      </button>
      {buka && (
        <div className="px-3 pb-2">
          {kontrak.map(b => (
            <p key={b.id} className="text-[11px] text-[#e8eaed] py-1">
              Alokasi <b>{b.nama}</b>: {b.hari_dalam_rentang} hari × {idr(b.per_hari)} = <b>{idr(b.alokasi_rentang)}</b>
            </p>
          ))}
          {pakaiKontrak && transaksi.length > 0 && (
            <p className="text-[11px] text-[#9aa0a6] pt-1">
              Pembayaran di Buku Kas berikut tidak dihitung langsung — sudah dialokasikan per hari dari kontrak:
            </p>
          )}
          {pakaiKontrak && transaksi.length === 0 ? null : transaksi.length === 0 ? (
            <p className="text-[11px] text-[#5f6368] italic py-1">Tidak ada transaksi pada rentang ini.</p>
          ) : (
            <table className="w-full text-[11px]">
              <tbody>
                {transaksi.map(e => (
                  <tr key={e.id} className="border-t border-[#2A2D31]">
                    <td className="py-1.5 pr-2 text-[#9aa0a6] whitespace-nowrap">{tgl(e.tanggal)}</td>
                    <td className="py-1.5 pr-2 text-[#e8eaed]">
                      {e.keterangan}
                      {e.qty ? <span className="text-[#5f6368]"> · {e.qty} {e.satuan ?? ''}</span> : null}
                    </td>
                    <td className="py-1.5 text-right text-[#e8eaed] whitespace-nowrap">{idr(e.nominal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

const FORM_KOSONG = { nama: '', overhead_sub_id: '', nominal: '', tanggal_mulai: '', tanggal_selesai: '', catatan: '' };

/** Tempat setup biaya tetap kontrak (mis. kontrak rumah setahun) */
function PanelBiayaTetap({ list, subList, onBerubah }: {
  list: BiayaTetap[]; subList: BiayaOverheadData['subList']; onBerubah: () => void;
}) {
  const [form, setForm] = useState(FORM_KOSONG);
  const [editId, setEditId] = useState<string | null>(null);
  const [formBuka, setFormBuka] = useState(false);
  const [simpan, setSimpan] = useState(false);
  const [konfirmHapus, setKonfirmHapus] = useState<string | null>(null);

  const nominal = Number(form.nominal) || 0;
  const hari = form.tanggal_mulai && form.tanggal_selesai && form.tanggal_selesai >= form.tanggal_mulai
    ? Math.round((new Date(form.tanggal_selesai).getTime() - new Date(form.tanggal_mulai).getTime()) / 86_400_000) + 1
    : 0;

  const bukaBaru = () => { setForm(FORM_KOSONG); setEditId(null); setFormBuka(true); };
  const bukaEdit = (b: BiayaTetap) => {
    setForm({
      nama: b.nama, overhead_sub_id: b.overhead_sub_id, nominal: String(Math.round(b.nominal)),
      tanggal_mulai: b.tanggal_mulai, tanggal_selesai: b.tanggal_selesai, catatan: b.catatan ?? '',
    });
    setEditId(b.id);
    setFormBuka(true);
  };

  /** Tanggal selesai otomatis = 1 tahun dikurangi 1 hari, bila belum diisi */
  const setMulai = (v: string) => setForm(f => {
    if (f.tanggal_selesai || !v) return { ...f, tanggal_mulai: v };
    const d = new Date(`${v}T00:00:00`);
    d.setFullYear(d.getFullYear() + 1);
    d.setDate(d.getDate() - 1);
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return { ...f, tanggal_mulai: v, tanggal_selesai: iso };
  });

  const kirim = async () => {
    setSimpan(true);
    const res = await simpanBiayaTetap({
      nama: form.nama, overhead_sub_id: form.overhead_sub_id, nominal,
      tanggal_mulai: form.tanggal_mulai, tanggal_selesai: form.tanggal_selesai, catatan: form.catatan,
    }, editId ?? undefined);
    setSimpan(false);
    if (!res.success) { toast.error(res.error || 'Gagal menyimpan'); return; }
    toast.success(editId ? 'Biaya tetap diperbarui' : 'Biaya tetap ditambahkan');
    setFormBuka(false);
    onBerubah();
  };

  const hapus = async (id: string) => {
    const res = await hapusBiayaTetap(id);
    setKonfirmHapus(null);
    if (!res.success) { toast.error(res.error || 'Gagal menghapus'); return; }
    toast.success('Biaya tetap dihapus');
    onBerubah();
  };

  return (
    <Panel judul="Biaya Tetap (kontrak)"
      ket="Biaya yang dibayar sekaligus untuk jangka panjang (mis. kontrak rumah). Dibagi rata per hari selama masa kontrak.">
      <div className="px-4 py-3 space-y-3">
        {list.length === 0 && !formBuka && <p className="text-xs text-[#5f6368] italic">Belum ada biaya tetap.</p>}
        {list.map(b => (
          <div key={b.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-[#2A2D31] bg-[#1A1D1F] px-3 py-2">
            <div className="flex-1 min-w-[180px]">
              <p className="text-sm font-bold text-[#e8eaed]">{b.nama}</p>
              <p className="text-[11px] text-[#9aa0a6]">
                {b.sub_nama} · {tgl(b.tanggal_mulai)} – {tgl(b.tanggal_selesai)} ({b.jumlah_hari} hari)
              </p>
            </div>
            <div className="text-right">
              <p className="text-sm font-bold text-[#e8eaed]">{idr(b.nominal)}</p>
              <p className="text-[11px] text-[#9aa0a6]">{idr(b.per_hari)}/hari · ±{idr(b.per_hari * 30)}/bulan</p>
            </div>
            <div className="flex gap-1">
              <Button variant="ghost" onClick={() => bukaEdit(b)} className="h-8 px-2 text-xs text-[#9aa0a6] hover:text-[#e5c17b]">Ubah</Button>
              {konfirmHapus === b.id ? (
                <>
                  <Button onClick={() => hapus(b.id)} className="h-8 px-2 text-xs bg-red-600 hover:bg-red-700 text-white">Ya, hapus</Button>
                  <Button variant="ghost" onClick={() => setKonfirmHapus(null)} className="h-8 px-2 text-xs text-[#9aa0a6]">Batal</Button>
                </>
              ) : (
                <Button variant="ghost" onClick={() => setKonfirmHapus(b.id)} className="h-8 px-2 text-xs text-[#9aa0a6] hover:text-red-400">Hapus</Button>
              )}
            </div>
          </div>
        ))}

        {formBuka ? (
          <div className="rounded-lg border border-[#e5c17b]/30 bg-[#e5c17b]/5 p-3 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Nama *</label>
                <input className={`${inputCls} w-full`} placeholder="mis. Kontrak Rumah 2027–2028"
                  value={form.nama} onChange={e => setForm(f => ({ ...f, nama: e.target.value }))} />
              </div>
              <div>
                <label className={labelCls}>Sub-kelompok overhead *</label>
                <select className={`${inputCls} w-full`} value={form.overhead_sub_id}
                  onChange={e => setForm(f => ({ ...f, overhead_sub_id: e.target.value }))}>
                  <option value="">-- Pilih --</option>
                  {subList.map(s => <option key={s.id} value={s.id}>{s.nama}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>Nilai kontrak (Rp) *</label>
                <input className={`${inputCls} w-full`} inputMode="numeric" placeholder="mis. 45.000.000"
                  value={form.nominal ? Number(form.nominal).toLocaleString('id-ID') : ''}
                  onChange={e => setForm(f => ({ ...f, nominal: e.target.value.replace(/\D/g, '').replace(/^0+/, '') }))} />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className={labelCls}>Mulai *</label>
                  <input type="date" className={`${inputCls} w-full`} value={form.tanggal_mulai} onChange={e => setMulai(e.target.value)} />
                </div>
                <div>
                  <label className={labelCls}>Selesai *</label>
                  <input type="date" className={`${inputCls} w-full`} value={form.tanggal_selesai}
                    onChange={e => setForm(f => ({ ...f, tanggal_selesai: e.target.value }))} />
                </div>
              </div>
              <div className="sm:col-span-2">
                <label className={labelCls}>Catatan</label>
                <input className={`${inputCls} w-full`} placeholder="opsional"
                  value={form.catatan} onChange={e => setForm(f => ({ ...f, catatan: e.target.value }))} />
              </div>
            </div>
            {nominal > 0 && hari > 0 && (
              <p className="text-[11px] text-[#e5c17b]">
                {hari} hari → {idr(nominal / hari)}/hari · ±{idr((nominal / hari) * 30)}/bulan
              </p>
            )}
            <div className="flex gap-2 justify-end">
              <Button variant="ghost" onClick={() => setFormBuka(false)} className="h-9 text-xs text-[#9aa0a6]">Batal</Button>
              <Button onClick={kirim} disabled={simpan} className="h-9 bg-[#e5c17b] hover:bg-[#d4b06a] text-black font-bold text-xs">
                {simpan && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
                {editId ? 'Simpan perubahan' : 'Simpan'}
              </Button>
            </div>
          </div>
        ) : (
          <Button variant="ghost" onClick={bukaBaru} className="h-8 px-2 text-xs text-[#e5c17b] hover:bg-[#e5c17b]/10">
            + Tambah biaya tetap
          </Button>
        )}
      </div>
    </Panel>
  );
}

function PerluDirapikan({ entri, subList, onSelesai }: {
  entri: BukuKasEntry[]; subList: BiayaOverheadData['subList']; onSelesai: () => void;
}) {
  const [pilihan, setPilihan] = useState<Record<string, string>>({});
  const [simpan, setSimpan] = useState<string | null>(null);

  const simpanSatu = async (id: string) => {
    const subId = pilihan[id];
    if (!subId) { toast.error('Pilih sub-kelompok dulu'); return; }
    setSimpan(id);
    const res = await aturSubOverhead(id, subId);
    setSimpan(null);
    if (!res.success) { toast.error(res.error || 'Gagal menyimpan'); return; }
    toast.success('Sub-kelompok disimpan');
    onSelesai();
  };

  return (
    <Panel judul={`Perlu dirapikan — ${entri.length} entri overhead tanpa sub-kelompok`}
      ket="Entri sejak 14 Nov 2026 yang belum punya sub-kelompok. Pilihkan sub-kelompoknya agar ikut terkelompok.">
      <div className="divide-y divide-[#2A2D31]">
        {entri.map(e => (
          <div key={e.id} className="flex flex-wrap items-center gap-2 px-4 py-2">
            <span className="text-[11px] text-[#9aa0a6] w-24 shrink-0">{tgl(e.tanggal)}</span>
            <span className="text-xs text-[#e8eaed] flex-1 min-w-[140px]">{e.keterangan}</span>
            <span className="text-xs font-semibold text-[#e8eaed] w-28 text-right">{idr(e.nominal)}</span>
            <select
              className="h-8 px-2 rounded-lg bg-[#1E2124] border border-[#2A2D31] text-xs text-[#e8eaed] outline-none"
              value={pilihan[e.id] ?? ''}
              onChange={ev => setPilihan(p => ({ ...p, [e.id]: ev.target.value }))}
            >
              <option value="">-- Pilih --</option>
              {subList.map(s => <option key={s.id} value={s.id}>{s.nama}</option>)}
            </select>
            <Button onClick={() => simpanSatu(e.id)} disabled={simpan === e.id}
              className="h-8 px-3 bg-[#2A2D31] text-[#e8eaed] hover:bg-[#3A3D41] text-xs">
              {simpan === e.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Simpan'}
            </Button>
          </div>
        ))}
      </div>
    </Panel>
  );
}
