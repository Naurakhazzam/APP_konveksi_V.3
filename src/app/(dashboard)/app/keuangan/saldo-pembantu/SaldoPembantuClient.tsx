'use client';

import React, { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Trash2, Plus, Loader2 } from 'lucide-react';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  tambahSaldoAwalPembantu, hapusSaldoAwalPembantu, tambahCekFisikPembantu, hapusCekFisikPembantu,
  type SaldoPembantuData,
} from '@/lib/actions/keuangan/saldo-pembantu.actions';

const BULAN = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];

const idr = (n: number) => 'Rp ' + Math.round(Math.abs(n)).toLocaleString('id-ID');
const tgl = (d: string) =>
  new Date(d).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
const bulanLabel = (ym: string) => `${BULAN[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;

type Tab = 'saldo' | 'fisik' | 'awal' | 'penghematan' | 'riwayat';

const inputCls = 'w-full h-9 px-3 rounded-lg bg-[#1E2124] border border-[#2A2D31] text-sm text-[#e8eaed] outline-none focus:border-[#e5c17b]';

export default function SaldoPembantuClient({ data, bolehUbah = false }: { data: SaldoPembantuData; bolehUbah?: boolean }) {
  const [tab, setTab] = useState<Tab>('saldo');
  const [filterJenis, setFilterJenis] = useState('');

  const sisaBelanja = Math.max(0, data.total_saldo - data.total_sisa_modal);
  const nyata = data.total_selisih_fisik;
  const jenisHemat = data.jenis.filter(j => j.penghematan > 0);
  const mutasi = filterJenis ? data.mutasi.filter(m => m.jenis_id === filterJenis) : data.mutasi;

  const tabCls = (t: Tab) =>
    `px-4 h-9 rounded-lg text-xs font-bold transition-colors ${
      tab === t ? 'bg-[#e5c17b] text-[#16181A]' : 'bg-[#1E2124] text-[#9aa0a6] hover:text-[#e8eaed]'
    }`;

  return (
    <div className="space-y-6">
      {/* ─── KESIMPULAN ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kartu judul="Total Belanja" nilai={idr(data.total_beli)} warna="text-[#e8eaed]" ket="dari Buku Kas" />
        <Kartu judul="Total Jatah HPP" nilai={idr(data.total_jatah)} warna="text-[#e8eaed]" ket="tarif HPP × pcs selesai jahit" />
        <Kartu judul="Persediaan di Rak (catatan)" nilai={idr(data.total_saldo)} warna="text-orange-300"
          ket={`barang lama ${idr(data.total_sisa_modal)} + belanja baru ${idr(sisaBelanja)} — bukan boros`} />
        <Kartu judul="Penghematan Tercatat" nilai={idr(data.total_penghematan)} warna="text-green-400"
          ket="jatah yang tidak perlu dibelanjakan" />
      </div>

      <div className="p-4 rounded-xl bg-[#1A1D1F] border border-[#2A2D31] flex flex-wrap items-center justify-between gap-3">
        <div className="max-w-2xl">
          <p className="text-[10px] uppercase tracking-widest text-[#9aa0a6] font-bold">Hemat / Boros Nyata (cek fisik)</p>
          <p className="text-[11px] text-[#5f6368] mt-0.5">
            Barang yang masih di rak bukan pemborosan. Hemat atau boros yang sebenarnya baru diketahui setelah sisa di rak dicek:
            jatah HPP − (barang masuk − sisa fisik).
            {data.jenis_dicek > 0 && ` Dari ${data.jenis_dicek} dari ${data.jenis_bisa_dicek} jenis yang sudah dicek.`}
          </p>
        </div>
        {data.jenis_dicek === 0 ? (
          <button onClick={() => setTab('fisik')}
            className="text-sm font-bold text-[#e5c17b] hover:underline">Belum ada cek fisik — isi di tab Cek Fisik</button>
        ) : (
          <p className={`text-xl font-bold ${nyata >= 0 ? 'text-green-400' : 'text-red-400'}`}>
            {nyata >= 0 ? 'Hemat ' : 'Boros '}{idr(nyata)}
          </p>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <button className={tabCls('saldo')} onClick={() => setTab('saldo')}>Saldo per Jenis</button>
        <button className={tabCls('fisik')} onClick={() => setTab('fisik')}>Cek Fisik</button>
        <button className={tabCls('awal')} onClick={() => setTab('awal')}>Barang Lama (Saldo Awal)</button>
        <button className={tabCls('penghematan')} onClick={() => setTab('penghematan')}>Penghematan</button>
        <button className={tabCls('riwayat')} onClick={() => setTab('riwayat')}>Riwayat</button>
      </div>

      {/* ─── SALDO PER JENIS ────────────────────────────────────────── */}
      {tab === 'saldo' && (
        <div className="rounded-xl border border-[#2A2D31] overflow-hidden bg-[#16181A]">
          <Table>
            <TableHeader className="bg-[#1A1C1E]">
              <TableRow className="border-[#2A2D31] hover:bg-transparent">
                <TableHead className="text-[#9aa0a6]">Jenis Bahan</TableHead>
                <TableHead className="text-[#9aa0a6] text-right">Pcs Dijahit</TableHead>
                <TableHead className="text-[#9aa0a6] text-right">Barang Lama</TableHead>
                <TableHead className="text-[#9aa0a6] text-right">Belanja</TableHead>
                <TableHead className="text-[#9aa0a6] text-right">Jatah HPP</TableHead>
                <TableHead className="text-[#9aa0a6] text-right">Saldo (catatan)</TableHead>
                <TableHead className="text-[#9aa0a6] text-right">Penghematan</TableHead>
                <TableHead className="text-[#9aa0a6] text-right">Sisa Fisik</TableHead>
                <TableHead className="text-[#9aa0a6] text-right">Hemat / Boros Nyata</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.jenis.map(j => (
                <TableRow key={j.id} className="border-[#2A2D31] hover:bg-[#1A1C1E]">
                  <TableCell className="text-sm text-[#e8eaed]">
                    {j.nama}
                    {j.tanpa_barang && <span className="ml-2 text-[10px] text-[#5f6368]">(tanpa belanja)</span>}
                  </TableCell>
                  <TableCell className="text-sm text-right text-[#9aa0a6]">{j.pcs.toLocaleString('id-ID')}</TableCell>
                  <TableCell className="text-sm text-right text-sky-300">{j.total_modal > 0 ? idr(j.total_modal) : '-'}</TableCell>
                  <TableCell className="text-sm text-right text-[#e8eaed]">{j.tanpa_barang ? '-' : idr(j.total_beli)}</TableCell>
                  <TableCell className="text-sm text-right text-[#e8eaed]">{idr(j.total_jatah)}</TableCell>
                  <TableCell className={`text-sm text-right font-bold ${j.saldo > 0 ? 'text-orange-300' : 'text-[#5f6368]'}`}>
                    {j.tanpa_barang ? '-' : idr(j.saldo)}
                  </TableCell>
                  <TableCell className={`text-sm text-right font-bold ${j.penghematan > 0 ? 'text-green-400' : 'text-[#5f6368]'}`}>
                    {idr(j.penghematan)}
                  </TableCell>
                  <TableCell className="text-sm text-right text-[#e8eaed] whitespace-nowrap">
                    {j.tanpa_barang ? '-' : j.cek_terakhir ? (
                      <>{idr(j.cek_terakhir.nilai_sisa)}<span className="block text-[10px] text-[#5f6368]">{tgl(j.cek_terakhir.tanggal)}</span></>
                    ) : <span className="text-[11px] text-[#5f6368]">belum dicek</span>}
                  </TableCell>
                  <TableCell className="text-sm text-right font-bold whitespace-nowrap">
                    {j.cek_terakhir ? <Selisih n={j.cek_terakhir.selisih} /> : <span className="text-[#5f6368]">-</span>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p className="px-4 py-3 text-[11px] text-[#5f6368] border-t border-[#2A2D31]">
            Saldo (catatan) = barang masuk − jatah HPP, tidak pernah minus; bila jatah melebihi saldo, kelebihannya dicatat sebagai
            penghematan (barang yang masuk belakangan menutupnya dulu). Catatan ini memakai tarif HPP, bukan pemakaian nyata —
            jadi bandingkan dengan sisa fisik di rak (tab Cek Fisik) untuk tahu hemat/boros yang sebenarnya.
          </p>
        </div>
      )}

      {/* ─── CEK FISIK ──────────────────────────────────────────────── */}
      {tab === 'fisik' && <CekFisik data={data} bolehUbah={bolehUbah} />}

      {/* ─── BARANG LAMA / SALDO AWAL ────────────────────────────────── */}
      {tab === 'awal' && <SaldoAwal data={data} bolehUbah={bolehUbah} />}

      {/* ─── PENGHEMATAN PER BULAN ──────────────────────────────────── */}
      {tab === 'penghematan' && (
        <div className="rounded-xl border border-[#2A2D31] overflow-x-auto bg-[#16181A]">
          <Table>
            <TableHeader className="bg-[#1A1C1E]">
              <TableRow className="border-[#2A2D31] hover:bg-transparent">
                <TableHead className="text-[#9aa0a6]">Bulan</TableHead>
                {jenisHemat.map(j => (
                  <TableHead key={j.id} className="text-[#9aa0a6] text-right whitespace-nowrap">{j.nama}</TableHead>
                ))}
                <TableHead className="text-[#9aa0a6] text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.penghematan_bulanan.length === 0 ? (
                <TableRow className="hover:bg-transparent border-[#2A2D31]">
                  <TableCell colSpan={jenisHemat.length + 2} className="h-24 text-center text-[#5f6368]">
                    Belum ada penghematan
                  </TableCell>
                </TableRow>
              ) : (
                <>
                  {data.penghematan_bulanan.map(b => (
                    <TableRow key={b.bulan} className="border-[#2A2D31] hover:bg-[#1A1C1E]">
                      <TableCell className="text-sm text-[#e8eaed] whitespace-nowrap">{bulanLabel(b.bulan)}</TableCell>
                      {jenisHemat.map(j => (
                        <TableCell key={j.id} className="text-sm text-right text-[#9aa0a6]">
                          {b.per_jenis[j.id] ? idr(b.per_jenis[j.id]) : '-'}
                        </TableCell>
                      ))}
                      <TableCell className="text-sm text-right font-bold text-green-400">{idr(b.total)}</TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="border-[#2A2D31] bg-[#1A1C1E] hover:bg-[#1A1C1E]">
                    <TableCell className="text-sm font-bold text-[#e8eaed]">Total</TableCell>
                    {jenisHemat.map(j => (
                      <TableCell key={j.id} className="text-sm text-right font-bold text-[#e8eaed]">{idr(j.penghematan)}</TableCell>
                    ))}
                    <TableCell className="text-sm text-right font-bold text-green-400">{idr(data.total_penghematan)}</TableCell>
                  </TableRow>
                </>
              )}
            </TableBody>
          </Table>
        </div>
      )}

      {/* ─── RIWAYAT MUTASI ─────────────────────────────────────────── */}
      {tab === 'riwayat' && (
        <div className="space-y-3">
          <select
            className="h-9 px-3 rounded-lg bg-[#1E2124] border border-[#2A2D31] text-sm text-[#e8eaed] outline-none"
            value={filterJenis}
            onChange={e => setFilterJenis(e.target.value)}
          >
            <option value="">Semua jenis</option>
            {data.jenis.map(j => <option key={j.id} value={j.id}>{j.nama}</option>)}
          </select>
          <div className="rounded-xl border border-[#2A2D31] overflow-hidden bg-[#16181A]">
            <Table>
              <TableHeader className="bg-[#1A1C1E]">
                <TableRow className="border-[#2A2D31] hover:bg-transparent">
                  <TableHead className="text-[#9aa0a6]">Tanggal</TableHead>
                  <TableHead className="text-[#9aa0a6]">Jenis</TableHead>
                  <TableHead className="text-[#9aa0a6]">Mutasi</TableHead>
                  <TableHead className="text-[#9aa0a6] text-right">Nominal</TableHead>
                  <TableHead className="text-[#9aa0a6] text-right">Ke Penghematan</TableHead>
                  <TableHead className="text-[#9aa0a6] text-right">Saldo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {mutasi.length === 0 ? (
                  <TableRow className="hover:bg-transparent border-[#2A2D31]">
                    <TableCell colSpan={6} className="h-24 text-center text-[#5f6368]">Belum ada mutasi</TableCell>
                  </TableRow>
                ) : mutasi.map((m, i) => (
                  <TableRow key={i} className="border-[#2A2D31] hover:bg-[#1A1C1E]">
                    <TableCell className="text-sm text-[#e8eaed] whitespace-nowrap">{tgl(m.tanggal)}</TableCell>
                    <TableCell className="text-sm text-[#9aa0a6]">{m.jenis}</TableCell>
                    <TableCell className="text-sm">
                      {m.tipe === 'modal'
                        ? <span className="text-sky-300">Saldo awal (barang lama)</span>
                        : m.tipe === 'beli'
                        ? <span className="text-orange-300">Belanja</span>
                        : <span className="text-[#9aa0a6]">
                            Jatah {m.pcs?.toLocaleString('id-ID')} pcs
                            {m.ke_modal < 0 && <span className="block text-[10px] text-sky-300/80">{idr(m.ke_modal)} dari barang lama</span>}
                          </span>}
                    </TableCell>
                    <TableCell className="text-sm text-right text-[#e8eaed]">{idr(m.nominal)}</TableCell>
                    <TableCell className={`text-sm text-right ${m.ke_hemat < 0 ? 'text-red-300' : 'text-green-400'}`}>
                      {m.ke_hemat > 0 ? idr(m.ke_hemat) : m.ke_hemat < 0
                        ? <span title="Barang ini menutup jatah sebelumnya yang tadinya dihitung penghematan">{idr(m.ke_hemat)}<span className="block text-[10px] text-red-300/70">koreksi penghematan</span></span>
                        : '-'}
                    </TableCell>
                    <TableCell className="text-sm text-right text-[#e8eaed]">{idr(m.saldo)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
    </div>
  );
}

function Kartu({ judul, nilai, warna, ket }: { judul: string; nilai: string; warna: string; ket: string }) {
  return (
    <div className="p-4 rounded-xl bg-[#1A1D1F] border border-[#2A2D31]">
      <p className="text-[10px] uppercase tracking-widest text-[#9aa0a6] font-bold">{judul}</p>
      <p className={`text-sm font-bold mt-1 ${warna}`}>{nilai}</p>
      <p className="text-[10px] text-[#5f6368] mt-1">{ket}</p>
    </div>
  );
}

function Selisih({ n }: { n: number }) {
  if (Math.round(n) === 0) return <span className="text-[#9aa0a6]">Pas</span>;
  return <span className={n > 0 ? 'text-green-400' : 'text-red-400'}>{n > 0 ? 'Hemat ' : 'Boros '}{idr(n)}</span>;
}

const hariIni = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

function CekFisik({ data, bolehUbah }: { data: SaldoPembantuData; bolehUbah: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [hapusId, setHapusId] = useState<string | null>(null);
  const [jenisId, setJenisId] = useState('');
  const [qty, setQty] = useState('');
  const [satuan, setSatuan] = useState('');
  const [harga, setHarga] = useState('');
  const [nilaiManual, setNilaiManual] = useState('');
  const [tanggal, setTanggal] = useState(hariIni());
  const [keterangan, setKeterangan] = useState('');

  const jenisBarang = data.jenis.filter(j => !j.tanpa_barang);
  const pilih = data.jenis.find(j => j.id === jenisId);
  const dariQty = (parseFloat(qty) || 0) * (parseFloat(harga) || 0);
  // Qty × harga bila keduanya diisi; kalau tidak, pakai nilai yang diketik langsung.
  const nilai = dariQty > 0 ? Math.round(dariQty) : Math.round(parseFloat(nilaiManual) || 0);
  const adaNilai = dariQty > 0 || nilaiManual.trim() !== '';

  const simpan = () => {
    if (!jenisId) { toast.error('Pilih jenis bahan'); return; }
    if (!adaNilai) { toast.error('Isi qty × harga, atau langsung nilai sisa (0 bila habis)'); return; }
    startTransition(async () => {
      try {
        await tambahCekFisikPembantu({
          jenis_id: jenisId, tanggal, nilai_sisa: nilai, keterangan, satuan,
          qty: dariQty > 0 ? parseFloat(qty) : null,
          harga_satuan: dariQty > 0 ? parseFloat(harga) : null,
        });
        toast.success(`Cek fisik dicatat: sisa ${idr(nilai)}`);
        setQty(''); setSatuan(''); setHarga(''); setNilaiManual(''); setKeterangan('');
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Gagal menyimpan');
      }
    });
  };

  const hapus = (id: string) => {
    setHapusId(id);
    startTransition(async () => {
      try {
        await hapusCekFisikPembantu(id);
        toast.success('Cek fisik dihapus');
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Gagal menghapus');
      } finally {
        setHapusId(null);
      }
    });
  };

  return (
    <div className="space-y-4">
      <div className="p-4 rounded-xl bg-[#e5c17b]/5 border border-[#e5c17b]/20 text-xs text-[#9aa0a6] space-y-1">
        <p className="text-sm font-bold text-[#e5c17b]">Cara membaca cek fisik</p>
        <p>
          Hitung sisa barang di rak per jenis, isi nilainya (qty × harga, atau langsung nilai rupiahnya; isi 0 bila habis).
        </p>
        <p>
          <b className="text-[#e8eaed]">Pemakaian nyata</b> = barang masuk (barang lama + belanja s.d. tanggal cek) − sisa fisik.{' '}
          <b className="text-[#e8eaed]">Hemat/boros</b> = jatah HPP s.d. tanggal cek − pemakaian nyata.
          Cek terakhir per jenis yang dipakai di ringkasan. Data ini hanya untuk analisa — tidak mengubah saldo, Buku Kas, maupun laba.
        </p>
      </div>

      {bolehUbah && (
        <div className="p-4 rounded-xl bg-[#1A1D1F] border border-[#2A2D31] space-y-3">
          <p className="text-sm font-bold text-[#e8eaed]">Catat cek fisik</p>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <label className="space-y-1 text-[11px] text-[#9aa0a6]">Jenis bahan
              <select className={inputCls} value={jenisId} onChange={e => setJenisId(e.target.value)} disabled={pending}>
                <option value="">Pilih jenis</option>
                {jenisBarang.map(j => <option key={j.id} value={j.id}>{j.nama}</option>)}
              </select>
            </label>
            <label className="space-y-1 text-[11px] text-[#9aa0a6]">Tanggal cek
              <input className={inputCls} type="date" value={tanggal} onChange={e => setTanggal(e.target.value)} disabled={pending} />
            </label>
            <label className="space-y-1 text-[11px] text-[#9aa0a6]">Qty sisa (opsional)
              <input className={inputCls} type="number" min={0} step="any" value={qty} onChange={e => setQty(e.target.value)} disabled={pending} />
            </label>
            <label className="space-y-1 text-[11px] text-[#9aa0a6]">Satuan
              <input className={inputCls} value={satuan} onChange={e => setSatuan(e.target.value)}
                placeholder="kg / roll / cone / gross" disabled={pending} />
            </label>
            <label className="space-y-1 text-[11px] text-[#9aa0a6]">Harga / satuan (Rp, opsional)
              <input className={inputCls} type="number" min={0} step="any" value={harga} onChange={e => setHarga(e.target.value)} disabled={pending} />
            </label>
            <label className="space-y-1 text-[11px] text-[#9aa0a6]">…atau nilai sisa langsung (Rp)
              <input className={inputCls} type="number" min={0} step="any" value={dariQty > 0 ? String(Math.round(dariQty)) : nilaiManual}
                onChange={e => setNilaiManual(e.target.value)} disabled={pending || dariQty > 0} />
            </label>
            <label className="space-y-1 text-[11px] text-[#9aa0a6] col-span-2">Keterangan (opsional)
              <input className={inputCls} value={keterangan} onChange={e => setKeterangan(e.target.value)}
                placeholder="mis. 4,85 kg karet hitam" disabled={pending} />
            </label>
          </div>
          {pilih && (
            <p className="text-[11px] text-[#5f6368]">
              Catatan saat ini untuk {pilih.nama}: saldo {idr(pilih.saldo)} (barang lama {idr(pilih.total_modal)} + belanja {idr(pilih.total_beli)} − jatah {idr(pilih.total_jatah)}).
            </p>
          )}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-[#9aa0a6]">Nilai sisa: <b className="text-[#e5c17b]">{adaNilai ? idr(nilai) : '-'}</b></p>
            <button onClick={simpan} disabled={pending || !jenisId || !adaNilai}
              className="h-9 px-4 rounded-lg bg-[#e5c17b] text-[#16181A] text-xs font-bold inline-flex items-center gap-2 disabled:opacity-50">
              {pending && !hapusId ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Simpan
            </button>
          </div>
        </div>
      )}

      <div className="rounded-xl border border-[#2A2D31] overflow-x-auto bg-[#16181A]">
        <Table>
          <TableHeader className="bg-[#1A1C1E]">
            <TableRow className="border-[#2A2D31] hover:bg-transparent">
              <TableHead className="text-[#9aa0a6]">Tanggal</TableHead>
              <TableHead className="text-[#9aa0a6]">Jenis</TableHead>
              <TableHead className="text-[#9aa0a6] text-right">Barang Masuk</TableHead>
              <TableHead className="text-[#9aa0a6] text-right">Sisa Fisik</TableHead>
              <TableHead className="text-[#9aa0a6] text-right">Pemakaian Nyata</TableHead>
              <TableHead className="text-[#9aa0a6] text-right">Jatah HPP</TableHead>
              <TableHead className="text-[#9aa0a6] text-right">Hemat / Boros</TableHead>
              {bolehUbah && <TableHead className="w-10" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.cek_fisik.length === 0 ? (
              <TableRow className="hover:bg-transparent border-[#2A2D31]">
                <TableCell colSpan={bolehUbah ? 8 : 7} className="h-24 text-center text-[#5f6368]">Belum ada cek fisik</TableCell>
              </TableRow>
            ) : data.cek_fisik.map(c => (
              <TableRow key={c.id} className="border-[#2A2D31] hover:bg-[#1A1C1E]">
                <TableCell className="text-sm text-[#e8eaed] whitespace-nowrap">{tgl(c.tanggal)}</TableCell>
                <TableCell className="text-sm text-[#9aa0a6]">
                  {c.jenis}
                  {(c.qty != null || c.keterangan) && (
                    <span className="block text-[10px] text-[#5f6368]">
                      {c.qty != null && `${c.qty.toLocaleString('id-ID')} ${c.satuan ?? ''} × ${idr(c.harga_satuan ?? 0)}`}
                      {c.qty != null && c.keterangan && ' · '}
                      {c.keterangan}
                    </span>
                  )}
                </TableCell>
                <TableCell className="text-sm text-right text-[#9aa0a6]">{idr(c.masuk)}</TableCell>
                <TableCell className="text-sm text-right text-[#e8eaed]">
                  {idr(c.nilai_sisa)}
                  <span className="block text-[10px] text-[#5f6368]">catatan {idr(c.saldo_catatan)}</span>
                </TableCell>
                <TableCell className="text-sm text-right text-[#e8eaed]">{c.pakai_nyata < 0 ? '−' : ''}{idr(c.pakai_nyata)}</TableCell>
                <TableCell className="text-sm text-right text-[#9aa0a6]">{idr(c.jatah)}</TableCell>
                <TableCell className="text-sm text-right font-bold whitespace-nowrap"><Selisih n={c.selisih} /></TableCell>
                {bolehUbah && (
                  <TableCell className="text-right">
                    <button onClick={() => hapus(c.id)} disabled={pending} title="Hapus cek fisik"
                      className="p-1.5 rounded-md text-red-400 hover:bg-red-500/10 disabled:opacity-50">
                      {hapusId === c.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                    </button>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <p className="px-4 py-3 text-[11px] text-[#5f6368] border-t border-[#2A2D31]">
          Pemakaian nyata minus berarti sisa fisik lebih besar dari barang yang tercatat masuk — cek apakah ada belanja atau barang lama yang belum dicatat.
        </p>
      </div>
    </div>
  );
}

function SaldoAwal({ data, bolehUbah }: { data: SaldoPembantuData; bolehUbah: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [hapusId, setHapusId] = useState<string | null>(null);
  const [jenisId, setJenisId] = useState('');
  const [namaBarang, setNamaBarang] = useState('');
  const [qty, setQty] = useState('');
  const [satuan, setSatuan] = useState('');
  const [harga, setHarga] = useState('');
  const [tanggal, setTanggal] = useState(data.saldo_awal[0]?.tanggal ?? '2026-11-14');
  const [keterangan, setKeterangan] = useState('');

  const jenisBarang = data.jenis.filter(j => !j.tanpa_barang);
  const nominal = Math.round((parseFloat(qty) || 0) * (parseFloat(harga) || 0));

  const simpan = () => {
    if (!jenisId) { toast.error('Pilih jenis bahan'); return; }
    if (!(parseFloat(qty) > 0)) { toast.error('Isi qty'); return; }
    if (!(parseFloat(harga) > 0)) { toast.error('Isi harga perkiraan'); return; }
    startTransition(async () => {
      try {
        await tambahSaldoAwalPembantu({
          jenis_id: jenisId, tanggal, nama_barang: namaBarang, qty: parseFloat(qty),
          satuan, harga_satuan: parseFloat(harga), keterangan,
        });
        toast.success(`Barang lama dicatat: ${idr(nominal)}`);
        setNamaBarang(''); setQty(''); setHarga(''); setKeterangan('');
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Gagal menyimpan');
      }
    });
  };

  const hapus = (id: string) => {
    setHapusId(id);
    startTransition(async () => {
      try {
        await hapusSaldoAwalPembantu(id);
        toast.success('Baris dihapus');
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Gagal menghapus');
      } finally {
        setHapusId(null);
      }
    });
  };

  return (
    <div className="space-y-4">
      <div className="p-4 rounded-xl bg-sky-500/5 border border-sky-500/20 text-xs text-[#9aa0a6] space-y-1">
        <p className="text-sm font-bold text-sky-300">Bahan pembantu lama = setoran modal berupa barang</p>
        <p>
          Isi barang yang sudah ada di rak sebelum periode baru, dengan <b className="text-[#e8eaed]">harga perkiraan</b>.
          Tidak masuk Buku Kas (tidak ada uang keluar). Jatah HPP menghabiskan barang lama ini lebih dulu, baru belanja baru.
        </p>
        <p>
          Di Kinerja Keuangan: sisanya tampil sebagai aset <b className="text-[#e8eaed]">Persediaan bahan pembantu (barang lama)</b>;
          yang sudah terpakai jadi biaya overhead produksi di bulan pemakaiannya.
        </p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        <Kartu judul="Total Barang Lama" nilai={idr(data.total_modal)} warna="text-sky-300" ket="nilai perkiraan saat dimasukkan" />
        <Kartu judul="Sudah Terpakai" nilai={idr(data.total_modal - data.total_sisa_modal)} warna="text-[#e8eaed]" ket="ditutup jatah HPP → jadi biaya" />
        <Kartu judul="Sisa (Aset)" nilai={idr(data.total_sisa_modal)} warna="text-green-400" ket="masih dianggap ada di rak" />
      </div>

      {bolehUbah && (
        <div className="p-4 rounded-xl bg-[#1A1D1F] border border-[#2A2D31] space-y-3">
          <p className="text-sm font-bold text-[#e8eaed]">Tambah barang lama</p>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <label className="space-y-1 text-[11px] text-[#9aa0a6]">Jenis bahan
              <select className={inputCls} value={jenisId} onChange={e => setJenisId(e.target.value)} disabled={pending}>
                <option value="">Pilih jenis</option>
                {jenisBarang.map(j => <option key={j.id} value={j.id}>{j.nama}</option>)}
              </select>
            </label>
            <label className="space-y-1 text-[11px] text-[#9aa0a6]">Nama barang (opsional)
              <input className={inputCls} value={namaBarang} onChange={e => setNamaBarang(e.target.value)}
                placeholder="mis. Kancing kemeja putih" disabled={pending} />
            </label>
            <label className="space-y-1 text-[11px] text-[#9aa0a6]">Qty
              <input className={inputCls} type="number" min={0} step="any" value={qty} onChange={e => setQty(e.target.value)} disabled={pending} />
            </label>
            <label className="space-y-1 text-[11px] text-[#9aa0a6]">Satuan
              <input className={inputCls} value={satuan} onChange={e => setSatuan(e.target.value)}
                placeholder="gross / roll / meter / pcs" disabled={pending} />
            </label>
            <label className="space-y-1 text-[11px] text-[#9aa0a6]">Harga perkiraan / satuan (Rp)
              <input className={inputCls} type="number" min={0} step="any" value={harga} onChange={e => setHarga(e.target.value)} disabled={pending} />
            </label>
            <label className="space-y-1 text-[11px] text-[#9aa0a6]">Tanggal
              <input className={inputCls} type="date" value={tanggal} onChange={e => setTanggal(e.target.value)} disabled={pending} />
            </label>
            <label className="space-y-1 text-[11px] text-[#9aa0a6] col-span-2">Keterangan (opsional)
              <input className={inputCls} value={keterangan} onChange={e => setKeterangan(e.target.value)} disabled={pending} />
            </label>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-[#9aa0a6]">Nilai: <b className="text-sky-300">{idr(nominal)}</b></p>
            <button onClick={simpan} disabled={pending || nominal <= 0}
              className="h-9 px-4 rounded-lg bg-[#e5c17b] text-[#16181A] text-xs font-bold inline-flex items-center gap-2 disabled:opacity-50">
              {pending && !hapusId ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Simpan
            </button>
          </div>
        </div>
      )}

      <div className="rounded-xl border border-[#2A2D31] overflow-x-auto bg-[#16181A]">
        <Table>
          <TableHeader className="bg-[#1A1C1E]">
            <TableRow className="border-[#2A2D31] hover:bg-transparent">
              <TableHead className="text-[#9aa0a6]">Tanggal</TableHead>
              <TableHead className="text-[#9aa0a6]">Jenis</TableHead>
              <TableHead className="text-[#9aa0a6]">Barang</TableHead>
              <TableHead className="text-[#9aa0a6] text-right">Qty</TableHead>
              <TableHead className="text-[#9aa0a6] text-right">Harga</TableHead>
              <TableHead className="text-[#9aa0a6] text-right">Nilai</TableHead>
              {bolehUbah && <TableHead className="w-10" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.saldo_awal.length === 0 ? (
              <TableRow className="hover:bg-transparent border-[#2A2D31]">
                <TableCell colSpan={bolehUbah ? 7 : 6} className="h-24 text-center text-[#5f6368]">Belum ada barang lama dicatat</TableCell>
              </TableRow>
            ) : data.saldo_awal.map(a => (
              <TableRow key={a.id} className="border-[#2A2D31] hover:bg-[#1A1C1E]">
                <TableCell className="text-sm text-[#e8eaed] whitespace-nowrap">{tgl(a.tanggal)}</TableCell>
                <TableCell className="text-sm text-[#9aa0a6]">{a.jenis}</TableCell>
                <TableCell className="text-sm text-[#e8eaed]">
                  {a.nama_barang ?? '-'}
                  {a.keterangan && <span className="block text-[10px] text-[#5f6368]">{a.keterangan}</span>}
                </TableCell>
                <TableCell className="text-sm text-right text-[#9aa0a6] whitespace-nowrap">
                  {a.qty.toLocaleString('id-ID')} {a.satuan ?? ''}
                </TableCell>
                <TableCell className="text-sm text-right text-[#9aa0a6]">{idr(a.harga_satuan)}</TableCell>
                <TableCell className="text-sm text-right font-bold text-sky-300">{idr(a.nominal)}</TableCell>
                {bolehUbah && (
                  <TableCell className="text-right">
                    <button onClick={() => hapus(a.id)} disabled={pending} title="Hapus baris"
                      className="p-1.5 rounded-md text-red-400 hover:bg-red-500/10 disabled:opacity-50">
                      {hapusId === a.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                    </button>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
