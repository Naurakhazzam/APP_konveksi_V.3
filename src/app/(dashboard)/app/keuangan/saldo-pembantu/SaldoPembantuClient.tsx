'use client';

import React, { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Trash2, Plus, Loader2 } from 'lucide-react';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import {
  tambahSaldoAwalPembantu, hapusSaldoAwalPembantu,
  type SaldoPembantuData, type SaldoPembantuJenis, type RincianJatah,
} from '@/lib/actions/keuangan/saldo-pembantu.actions';
import { PanduanProvider, PanelPanduan, InfoIstilah, TombolPanduan } from '@/components/keuangan/panduan/Panduan';
import type { KunciIstilah } from '@/lib/keuangan/kamus';
import { buatPanduanSaldoPembantu } from './panduan-saldo-pembantu';

const BULAN = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];

const idr = (n: number) => 'Rp ' + Math.round(Math.abs(n)).toLocaleString('id-ID');
const tgl = (d: string) =>
  new Date(d).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
const bulanLabel = (ym: string) => `${BULAN[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
const angka = (n: number) => n.toLocaleString('id-ID', { maximumFractionDigits: 2 });

/** "× Rp 1.000" bila satu tarif; "× Rp 500 · 1.000 · 1.500" bila beberapa (detail per artikel di pop-up) */
function ringkasTarif(rincian: RincianJatah[]): string {
  const tarif = [...new Set(rincian.map(r => r.tarif))].sort((a, b) => a - b);
  return '× Rp ' + tarif.map(angka).join(' · ');
}

type Tab = 'saldo' | 'awal' | 'penghematan' | 'riwayat';

const inputCls = 'w-full h-9 px-3 rounded-lg bg-[#1E2124] border border-[#2A2D31] text-sm text-[#e8eaed] outline-none focus:border-[#e5c17b]';

export default function SaldoPembantuClient(props: { data: SaldoPembantuData; bolehUbah?: boolean }) {
  return (
    <PanduanProvider>
      <SaldoPembantuIsi {...props} />
    </PanduanProvider>
  );
}

/** Judul kolom + ikon ⓘ */
const KolomInfo = ({ judul, k }: { judul: string; k: KunciIstilah }) => (
  <span className="inline-flex items-center gap-1">{judul}<InfoIstilah k={k} /></span>
);

function SaldoPembantuIsi({ data, bolehUbah = false }: { data: SaldoPembantuData; bolehUbah?: boolean }) {
  const kontenPanduan = React.useMemo(() => buatPanduanSaldoPembantu(data), [data]);
  const [tab, setTab] = useState<Tab>('saldo');
  const [filterJenis, setFilterJenis] = useState('');
  const [rincianJenis, setRincianJenis] = useState<SaldoPembantuJenis | null>(null);

  const sisaBelanja = Math.max(0, data.total_saldo - data.total_sisa_modal);
  const jenisHemat = data.jenis.filter(j => j.penghematan > 0);
  const mutasi = filterJenis ? data.mutasi.filter(m => m.jenis_id === filterJenis) : data.mutasi;
  const belanjaPeringatan = data.mutasi.filter(m => m.tipe === 'beli' && m.peringatan);

  const tabCls = (t: Tab) =>
    `px-4 h-9 rounded-lg text-xs font-bold transition-colors ${
      tab === t ? 'bg-[#e5c17b] text-[#16181A]' : 'bg-[#1E2124] text-[#9aa0a6] hover:text-[#e8eaed]'
    }`;

  return (
    <div className="space-y-6">
      <PanelPanduan konten={kontenPanduan} />
      <div className="flex justify-end -mb-3"><TombolPanduan /></div>
      {/* ─── KESIMPULAN ─────────────────────────────────────────────── */}
      <div data-panduan="kartu-pembantu" className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kartu judul="Total Belanja" k="belanja_pembantu" nilai={idr(data.total_beli)} warna="text-[#e8eaed]" ket="dari Buku Kas" />
        <Kartu judul="Total Jatah HPP" k="jatah_hpp" nilai={idr(data.total_jatah)} warna="text-[#e8eaed]" ket="tarif HPP × pcs selesai jahit" />
        <Kartu judul="Persediaan di Rak (catatan)" k="saldo_rak" nilai={idr(data.total_saldo)} warna="text-orange-300"
          ket={`seharusnya ada di rak: barang lama ${idr(data.total_sisa_modal)} + belanja baru ${idr(sisaBelanja)}`} />
        <Kartu judul="Penghematan Tercatat" k="penghematan_pembantu" nilai={idr(data.total_penghematan)} warna="text-green-400"
          ket="jatah yang tidak perlu dibelanjakan" />
      </div>

      {belanjaPeringatan.length > 0 && (
        <div data-panduan="peringatan-belanja" className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-xs text-amber-200">
          <span className="font-bold">⚠ {belanjaPeringatan.length} belanja saat saldo masih banyak</span>{' '}<InfoIstilah k="peringatan_belanja" className="align-middle" />{' '}
          (saldo sebelum belanja &gt; jatah HPP 2 minggu terakhir):{' '}
          {belanjaPeringatan.slice(0, 5).map(m => `${m.jenis} ${tgl(m.tanggal)}`).join(', ')}
          {belanjaPeringatan.length > 5 && ', …'}.{' '}
          <span className="text-amber-200/70">Bisa berarti tarif HPP kemurahan (pemakaian nyata lebih besar), atau belanja terlalu dini. Rincian di tab Riwayat.</span>
        </div>
      )}

      <div data-panduan="tab-pembantu" className="flex flex-wrap gap-2">
        <button className={tabCls('saldo')} onClick={() => setTab('saldo')}>Saldo per Jenis</button>
        <button className={tabCls('awal')} onClick={() => setTab('awal')}>Barang Lama (Saldo Awal)</button>
        <button className={tabCls('penghematan')} onClick={() => setTab('penghematan')}>Penghematan</button>
        <button className={tabCls('riwayat')} onClick={() => setTab('riwayat')}>Riwayat</button>
      </div>

      {/* ─── SALDO PER JENIS ────────────────────────────────────────── */}
      {tab === 'saldo' && (
        <div data-panduan="tabel-saldo-jenis" className="rounded-xl border border-[#2A2D31] overflow-hidden bg-[#16181A]">
          <Table>
            <TableHeader className="bg-[#1A1C1E]">
              <TableRow className="border-[#2A2D31] hover:bg-transparent">
                <TableHead className="text-[#9aa0a6]">Jenis Bahan</TableHead>
                <TableHead className="text-[#9aa0a6] text-right"><KolomInfo judul="Pcs Dijahit" k="pcs_dijahit" /></TableHead>
                <TableHead className="text-[#9aa0a6] text-right"><KolomInfo judul="Barang Lama" k="barang_lama" /></TableHead>
                <TableHead className="text-[#9aa0a6] text-right"><KolomInfo judul="Belanja" k="belanja_pembantu" /></TableHead>
                <TableHead className="text-[#9aa0a6] text-right"><KolomInfo judul="Jatah HPP" k="jatah_hpp" /></TableHead>
                <TableHead className="text-[#9aa0a6] text-right"><KolomInfo judul="Saldo (catatan)" k="saldo_rak" /></TableHead>
                <TableHead className="text-[#9aa0a6] text-right"><KolomInfo judul="Penghematan" k="penghematan_pembantu" /></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.jenis.map(j => (
                <TableRow key={j.id} className="border-[#2A2D31] hover:bg-[#1A1C1E]">
                  <TableCell className="text-sm text-[#e8eaed]">
                    {j.nama}
                    {j.tanpa_barang && <span className="ml-2 text-[10px] text-[#5f6368]">(tanpa belanja)</span>}
                  </TableCell>
                  <TableCell className="text-sm text-right text-[#9aa0a6]">
                    {j.rincian.length === 0 ? j.pcs.toLocaleString('id-ID') : (
                      <button
                        type="button"
                        onClick={() => setRincianJenis(j)}
                        title="Lihat rincian per artikel"
                        className="inline-flex flex-col items-end gap-0.5 hover:text-[#e8eaed] group"
                      >
                        <span className="underline decoration-dotted underline-offset-4 decoration-[#5f6368] group-hover:decoration-[#e5c17b]">
                          {j.pcs.toLocaleString('id-ID')}
                        </span>
                        <span className="text-[10px] text-[#e5c17b]/80 whitespace-nowrap">
                          {ringkasTarif(j.rincian)}
                        </span>
                      </button>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-right text-sky-300">{j.total_modal > 0 ? idr(j.total_modal) : '-'}</TableCell>
                  <TableCell className="text-sm text-right text-[#e8eaed]">{j.tanpa_barang ? '-' : idr(j.total_beli)}</TableCell>
                  <TableCell className="text-sm text-right text-[#e8eaed]">{idr(j.total_jatah)}</TableCell>
                  <TableCell className={`text-sm text-right font-bold ${j.saldo > 0 ? 'text-orange-300' : 'text-[#5f6368]'}`}>
                    {j.tanpa_barang ? '-' : idr(j.saldo)}
                  </TableCell>
                  <TableCell className={`text-sm text-right font-bold ${j.penghematan > 0 ? 'text-green-400' : 'text-[#5f6368]'}`}>
                    {idr(j.penghematan)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p className="px-4 py-3 text-[11px] text-[#5f6368] border-t border-[#2A2D31]">
            Saldo = (barang lama + belanja) − jatah HPP = barang yang seharusnya masih di rak, tidak pernah minus. Bila jatah melebihi
            saldo, kelebihannya jadi penghematan permanen (margin); belanja berikutnya seluruhnya menambah saldo dan tidak
            menutup penghematan yang sudah tercatat. Karena itu tanggal belanja di Buku Kas harus tanggal sebenarnya.
            Karena tarif HPP sengaja di atas pemakaian nyata, isi rak biasanya sedikit lebih banyak dari saldo.
          </p>
        </div>
      )}

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
                        ? <span className="text-orange-300">
                            Belanja
                            {m.peringatan && (
                              <span className="block text-[10px] text-amber-400"
                                title="Saldo sebelum belanja lebih besar dari jatah HPP 2 minggu terakhir — tarif HPP mungkin kemurahan, atau belanja terlalu dini">
                                ⚠ saldo masih {idr(m.saldo - m.nominal)} &gt; jatah 2 minggu {idr(m.jatah_2minggu ?? 0)}
                              </span>
                            )}
                          </span>
                        : m.tipe === 'potong'
                        ? <span className="text-orange-300">Potong Drill mandiri <span className="text-[10px] text-[#9aa0a6]">({m.pcs?.toLocaleString('id-ID')} dari stok bahan)</span></span>
                        : <span className="text-[#9aa0a6]">
                            Jatah {m.pcs?.toLocaleString('id-ID')} pcs
                            {m.ke_modal < 0 && <span className="block text-[10px] text-sky-300/80">{idr(m.ke_modal)} dari barang lama</span>}
                          </span>}
                    </TableCell>
                    <TableCell className="text-sm text-right text-[#e8eaed]">{idr(m.nominal)}</TableCell>
                    <TableCell className="text-sm text-right text-green-400">
                      {m.ke_hemat > 0 ? idr(m.ke_hemat) : '-'}
                    </TableCell>
                    <TableCell className="text-sm text-right text-[#e8eaed]">{idr(m.saldo)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      <Dialog open={!!rincianJenis} onOpenChange={o => { if (!o) setRincianJenis(null); }}>
        <DialogContent className="bg-[#1A1D1F] border-[#2A2D31] text-[#e8eaed] sm:max-w-[640px]">
          {rincianJenis && (
            <>
              <DialogHeader>
                <DialogTitle>Rincian Jatah — {rincianJenis.nama}</DialogTitle>
                <DialogDescription className="text-[#9aa0a6]">
                  Jatah = pcs selesai jahit × tarif HPP per pcs, dipisah per artikel.
                </DialogDescription>
              </DialogHeader>
              <div className="max-h-[60vh] overflow-auto rounded-lg border border-[#2A2D31]">
                <table className="w-full text-sm">
                  <thead className="bg-[#16181A] text-[11px] uppercase tracking-wider text-[#9aa0a6] sticky top-0">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">Artikel</th>
                      <th className="px-3 py-2 text-right font-medium">Pcs</th>
                      <th className="px-3 py-2 text-right font-medium">× Tarif</th>
                      <th className="px-3 py-2 text-right font-medium">= Jatah</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rincianJenis.rincian.map((r, i) => (
                      <tr key={i} className="border-t border-[#2A2D31]">
                        <td className="px-3 py-2">
                          <div className="text-[#e8eaed]">{r.artikel}</div>
                          {r.ukuran && <div className="text-[10px] text-[#5f6368]">{r.ukuran}</div>}
                        </td>
                        <td className="px-3 py-2 text-right text-[#e8eaed]">{angka(r.pcs)}</td>
                        <td className="px-3 py-2 text-right text-[#e5c17b] whitespace-nowrap">Rp {angka(r.tarif)}</td>
                        <td className="px-3 py-2 text-right text-[#e8eaed] whitespace-nowrap">{idr(r.nominal)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-[#3A3D41] bg-[#16181A] font-bold">
                      <td className="px-3 py-2 text-[#9aa0a6]">Total</td>
                      <td className="px-3 py-2 text-right">{angka(rincianJenis.pcs)}</td>
                      <td />
                      <td className="px-3 py-2 text-right whitespace-nowrap">{idr(rincianJenis.total_jatah)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Kartu({ judul, nilai, warna, ket, k }: { judul: string; nilai: string; warna: string; ket: string; k?: KunciIstilah }) {
  return (
    <div className="p-4 rounded-xl bg-[#1A1D1F] border border-[#2A2D31]">
      <p className="flex items-center gap-1 text-[10px] uppercase tracking-widest text-[#9aa0a6] font-bold">{judul}{k && <InfoIstilah k={k} />}</p>
      <p className={`text-sm font-bold mt-1 ${warna}`}>{nilai}</p>
      <p className="text-[10px] text-[#5f6368] mt-1">{ket}</p>
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
        <Kartu judul="Total Barang Lama" k="barang_lama" nilai={idr(data.total_modal)} warna="text-sky-300" ket="nilai perkiraan saat dimasukkan" />
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
