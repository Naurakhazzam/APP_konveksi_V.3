'use client';

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  AlertTriangle, CheckCircle2, Loader2, PackageX, Plus, RotateCcw,
  Trash2, Truck, Wrench, X, Ban, ShoppingBag,
} from 'lucide-react';
import type {
  RejectKantorRow, RejectKantorStatus, RejectTingkat, DataLaporReject,
} from '@/lib/actions/pengiriman/reject-kantor.actions';
import {
  laporRejectKantor, laporRejectBarangLama, ubahStatusRejectKantor, hapusRejectKantor,
  buatSjKirimUlang, rejectDibeliKantor, ubahTingkatRejectKantor,
} from '@/lib/actions/pengiriman/reject-kantor.actions';
import type { AlasanRejectOption } from '@/lib/actions/produksi/reject.actions';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const idr = (n: number) => 'Rp ' + Math.round(n).toLocaleString('id-ID');
const tgl = (iso: string) =>
  iso ? new Date(iso).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }) : '-';
const hariIni = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const STATUS_INFO: Record<RejectKantorStatus, { label: string; cls: string }> = {
  retur:      { label: 'Retur — belum diproses', cls: 'bg-red-900/30 text-red-300 border-red-700/40' },
  diperbaiki: { label: 'Sedang diperbaiki',      cls: 'bg-amber-900/30 text-amber-300 border-amber-700/40' },
  tidak_bisa: { label: 'Tidak bisa diperbaiki',  cls: 'bg-zinc-800 text-zinc-300 border-zinc-600/40' },
  dibeli_kantor: { label: 'Dibeli kantor',       cls: 'bg-sky-900/30 text-sky-300 border-sky-700/40' },
  selesai:    { label: 'Sudah dikirim ulang',    cls: 'bg-emerald-900/30 text-emerald-300 border-emerald-700/40' },
};

const TINGKAT_INFO: Record<RejectTingkat, { label: string; cls: string; ket: string }> = {
  minor: { label: 'Minor', cls: 'text-yellow-300 border-yellow-700/40 bg-yellow-900/20', ket: 'cacat kecil, mudah diperbaiki' },
  mayor: { label: 'Mayor', cls: 'text-orange-300 border-orange-700/40 bg-orange-900/20', ket: 'cacat jelas, perlu perbaikan' },
  parah: { label: 'Rusak parah', cls: 'text-red-300 border-red-700/40 bg-red-900/20', ket: 'sulit / tidak bisa diperbaiki' },
};
const TINGKAT_LIST: RejectTingkat[] = ['minor', 'mayor', 'parah'];

function TingkatPilih({ value, onChange }: { value: RejectTingkat; onChange: (t: RejectTingkat) => void }) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {TINGKAT_LIST.map(t => (
        <button key={t} type="button" onClick={() => onChange(t)}
          className={`rounded-lg border px-2 py-2 text-left transition-colors ${value === t ? TINGKAT_INFO[t].cls : 'border-[#2A2D31] text-[#9aa0a6] hover:text-[#e8eaed]'}`}>
          <div className="text-xs font-bold">{TINGKAT_INFO[t].label}</div>
          <div className="text-[10px] opacity-80">{TINGKAT_INFO[t].ket}</div>
        </button>
      ))}
    </div>
  );
}

function StatusPill({ status }: { status: RejectKantorStatus }) {
  const s = STATUS_INFO[status];
  return (
    <span className={`inline-flex whitespace-nowrap text-[10px] font-bold px-2 py-0.5 rounded border ${s.cls}`}>
      {s.label}
    </span>
  );
}

const inputCls =
  'w-full bg-[#0D0E10] border border-[#2A2D31] text-[#e8eaed] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#e5c17b] transition-colors';
const labelCls = 'block text-[10px] font-bold uppercase tracking-widest text-[#9aa0a6] mb-1.5';

function Modal({ title, onClose, children, wide }: {
  title: string; onClose: () => void; children: React.ReactNode; wide?: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className={`bg-[#1A1D1F] border border-[#2A2D31] rounded-2xl p-6 w-full ${wide ? 'max-w-2xl' : 'max-w-lg'} max-h-[90vh] overflow-y-auto shadow-2xl`}>
        <div className="flex items-start justify-between mb-4">
          <h3 className="text-base font-bold text-[#e8eaed]">{title}</h3>
          <button onClick={onClose} className="text-[#9aa0a6] hover:text-[#e8eaed]"><X className="w-4 h-4" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ─── Modal: Lapor Reject (belakangan) ─────────────────────────────────────────

function LaporModal({ data, alasanList, onClose, onDone }: {
  data: DataLaporReject; alasanList: AlasanRejectOption[]; onClose: () => void; onDone: () => void;
}) {
  const [mode, setMode] = useState<'sistem' | 'lama'>('sistem');
  const [cari, setCari] = useState('');
  const [produkId, setProdukId] = useState('');
  const [qty, setQty] = useState(1);
  const [alasanId, setAlasanId] = useState('');
  const [tingkat, setTingkat] = useState<RejectTingkat>('mayor');
  const [ket, setKet] = useState('');
  const [klienId, setKlienId] = useState(data.klien.length === 1 ? data.klien[0].id : '');
  const [harga, setHarga] = useState<number | ''>('');
  const [loading, setLoading] = useState(false);

  const q = cari.trim().toLowerCase();
  const fifoTampil = useMemo(
    () => (q ? data.fifo.filter(p => p.produk_nama.toLowerCase().includes(q)) : data.fifo),
    [q, data.fifo]);
  const masterTampil = useMemo(
    () => (q ? data.produkSemua.filter(p => p.nama.toLowerCase().includes(q)) : data.produkSemua).slice(0, 300),
    [q, data.produkSemua]);

  const fifo = data.fifo.find(p => p.produk_id === produkId);
  const master = data.produkSemua.find(p => p.id === produkId);
  const maks = mode === 'sistem' ? fifo?.sisa ?? 0 : Infinity;

  const gantiMode = (m: 'sistem' | 'lama') => { setMode(m); setProdukId(''); setQty(1); setHarga(''); };
  const pilihProduk = (id: string) => {
    setProdukId(id);
    setQty(1);
    const p = data.produkSemua.find(x => x.id === id);
    setHarga(p ? p.harga_jual : '');
  };

  const submit = async () => {
    if (!produkId) return toast.error('Pilih produk');
    if (qty < 1 || qty > maks) return toast.error(`Qty reject 1 – ${maks} pcs`);
    if (!alasanId) return toast.error('Pilih alasan reject');
    setLoading(true);
    if (mode === 'sistem') {
      const res = await laporRejectKantor({ produk_id: produkId, qty, alasan_reject_id: alasanId, tingkat, keterangan: ket });
      setLoading(false);
      if (res.error) return toast.error(res.error);
      const al = res.alokasi ?? [];
      const perSj = new Map<string, number>();
      al.forEach(a => perSj.set(a.nomor_sj, (perSj.get(a.nomor_sj) ?? 0) + a.qty));
      toast.success(`Reject ${qty} pcs tercatat — memotong tagihan ${[...perSj].map(([sj, n]) => `${sj} (${n} pcs)`).join(', ')}`);
    } else {
      if (!klienId) { setLoading(false); return toast.error('Pilih klien'); }
      const res = await laporRejectBarangLama({
        produk_id: produkId, klien_id: klienId, qty, alasan_reject_id: alasanId, tingkat,
        harga_satuan: harga === '' ? null : Number(harga), keterangan: ket,
      });
      setLoading(false);
      if (res.error) return toast.error(res.error);
      toast.success(`Reject barang lama ${res.nomor_reject} tercatat — tidak memotong invoice`);
    }
    onDone();
  };

  return (
    <Modal title="Lapor Reject dari Kantor" onClose={onClose}>
      <p className="text-xs text-[#9aa0a6] mb-4">
        Untuk reject yang ketemu <strong>setelah</strong> barang diterima. Reject yang ketemu saat menghitung barang
        datang dicatat langsung di halaman <Link href="/app/pengiriman/validasi" className="text-[#e5c17b] underline">Validasi Kirim</Link>.
      </p>
      <div className="grid grid-cols-2 gap-1 bg-[#0D0E10] border border-[#2A2D31] rounded-xl p-1 mb-4">
        {([['sistem', 'Kiriman di sistem'], ['lama', 'Barang lama (di luar sistem)']] as const).map(([m, l]) => (
          <button key={m} type="button" onClick={() => gantiMode(m)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${mode === m ? 'bg-[#e5c17b] text-[#0D0E10]' : 'text-[#9aa0a6] hover:text-[#e8eaed]'}`}>
            {l}
          </button>
        ))}
      </div>
      <div className="space-y-4">
        <div>
          <label className={labelCls}>Model / Warna / Size</label>
          <input value={cari} onChange={e => setCari(e.target.value)} placeholder="Cari produk…" className={inputCls + ' mb-2'} />
          <select value={produkId} onChange={e => pilihProduk(e.target.value)} className={inputCls}>
            <option value="">— Pilih produk —</option>
            {mode === 'sistem'
              ? fifoTampil.map(p => (
                  <option key={p.produk_id} value={p.produk_id}>
                    {p.produk_nama} — {p.sisa} pcs di {p.jumlah_sj} SJ
                  </option>
                ))
              : masterTampil.map(p => <option key={p.id} value={p.id}>{p.nama}</option>)}
          </select>
          {mode === 'sistem' && (
            <p className="text-[10px] text-[#9aa0a6] mt-1.5">
              {data.fifo.length === 0
                ? 'Belum ada kiriman periode baru yang sudah divalidasi kantor.'
                : 'Tidak perlu pilih surat jalan — sistem membebankan ke SJ terlama dulu (bisa terbagi ke beberapa SJ), dengan harga SJ asal.'}
            </p>
          )}
          {mode === 'lama' && (
            <p className="text-[10px] text-[#9aa0a6] mt-1.5">
              Barang dari kiriman sebelum sistem (PO lama). Tidak memotong invoice — langsung dicatat sebagai kerugian reject,
              batal kalau nanti dikirim ulang.
            </p>
          )}
        </div>
        {mode === 'lama' && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Klien</label>
              <select value={klienId} onChange={e => setKlienId(e.target.value)} className={inputCls}>
                <option value="">— Pilih —</option>
                {data.klien.map(k => <option key={k.id} value={k.id}>{k.nama}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Harga / pcs</label>
              <input type="number" min={0} value={harga} placeholder={master ? String(master.harga_jual) : ''}
                onChange={e => setHarga(e.target.value === '' ? '' : Math.max(0, Number(e.target.value)))} className={inputCls} />
            </div>
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Qty Reject {mode === 'sistem' && fifo ? `(maks ${maks})` : ''}</label>
            <input type="number" min={1} max={Number.isFinite(maks) ? maks || undefined : undefined} value={qty}
              onChange={e => setQty(Math.max(0, parseInt(e.target.value) || 0))} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Alasan</label>
            <select value={alasanId} onChange={e => setAlasanId(e.target.value)} className={inputCls}>
              <option value="">— Pilih —</option>
              {alasanList.map(a => <option key={a.id} value={a.id}>{a.jenis_nama} — {a.nama}</option>)}
            </select>
          </div>
        </div>
        <div>
          <label className={labelCls}>Tingkat Reject</label>
          <TingkatPilih value={tingkat} onChange={setTingkat} />
        </div>
        <div>
          <label className={labelCls}>Keterangan (opsional)</label>
          <input value={ket} onChange={e => setKet(e.target.value)} placeholder="mis. ketemu saat dicek ulang di gudang kantor" className={inputCls} />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="px-4 py-2 rounded-xl border border-[#2A2D31] text-xs font-semibold text-[#9aa0a6] hover:bg-[#2A2D31]">Batal</button>
          <button onClick={submit} disabled={loading}
            className="px-5 py-2 rounded-xl bg-[#e5c17b] hover:bg-[#d4b06a] text-[#0D0E10] text-xs font-black uppercase tracking-wider disabled:opacity-50 flex items-center gap-2">
            {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Simpan Reject
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Modal: Dibeli Kantor ─────────────────────────────────────────────────────

function DibeliModal({ row, hargaNormal, onClose, onDone }: {
  row: RejectKantorRow; hargaNormal: number; onClose: () => void; onDone: () => void;
}) {
  const [harga, setHarga] = useState<number>(hargaNormal || row.harga_satuan);
  const [loading, setLoading] = useState(false);
  const potongan = row.sisa * Math.max(row.harga_satuan - harga, 0);

  const submit = async () => {
    if (!(harga >= 0)) return toast.error('Harga beli tidak valid');
    setLoading(true);
    const res = await rejectDibeliKantor(row.id, harga);
    setLoading(false);
    if (res.error) return toast.error(res.error);
    toast.success(`${row.nomor_reject}: dibeli kantor`);
    onDone();
  };

  return (
    <Modal title={`Dibeli Kantor — ${row.nomor_reject}`} onClose={onClose}>
      <p className="text-xs text-[#9aa0a6] mb-4">
        Kantor tetap mengambil barang reject ini dengan harga yang disepakati. Barang tidak dikirim ulang.
        Isian awal = harga jual normal; ubah ke harga yang dibayar kantor.
      </p>
      <div className="grid grid-cols-2 gap-3 text-xs mb-4">
        <div className="bg-[#0D0E10] border border-[#2A2D31] rounded-lg p-3">
          <div className="text-[#9aa0a6]">Produk</div>
          <div className="text-[#e8eaed] font-semibold mt-0.5">{row.produk_nama}</div>
          <div className="text-[#9aa0a6] mt-1">{row.sisa} pcs · {row.nomor_sj}</div>
        </div>
        <div className="bg-[#0D0E10] border border-[#2A2D31] rounded-lg p-3">
          <div className="text-[#9aa0a6]">Harga di SJ</div>
          <div className="text-[#e8eaed] font-semibold mt-0.5">{idr(row.harga_satuan)} / pcs</div>
        </div>
      </div>
      <label className={labelCls}>Harga beli kantor / pcs</label>
      <input type="number" min={0} value={harga} onChange={e => setHarga(Math.max(0, Number(e.target.value) || 0))} className={inputCls} />
      <div className="mt-3 text-xs text-[#9aa0a6]">
        Potongan permanen: {row.sisa} × ({idr(row.harga_satuan)} − {idr(harga)}) = <strong className="text-red-400">{idr(potongan)}</strong>
        {row.sumber === 'barang_lama' && <span> (barang lama: dicatat sebagai kerugian, tidak memotong invoice)</span>}
      </div>
      <div className="flex justify-end gap-2 pt-4">
        <button onClick={onClose} className="px-4 py-2 rounded-xl border border-[#2A2D31] text-xs font-semibold text-[#9aa0a6] hover:bg-[#2A2D31]">Batal</button>
        <button onClick={submit} disabled={loading}
          className="px-5 py-2 rounded-xl bg-[#e5c17b] hover:bg-[#d4b06a] text-[#0D0E10] text-xs font-black uppercase tracking-wider disabled:opacity-50 flex items-center gap-2">
          {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Simpan
        </button>
      </div>
    </Modal>
  );
}

// ─── Modal: Buat SJ Kirim Ulang ───────────────────────────────────────────────

function KirimUlangModal({ rows, onClose, onDone }: {
  rows: RejectKantorRow[]; onClose: () => void; onDone: (id: string, nomor: string) => void;
}) {
  const [qtys, setQtys] = useState<Record<string, number>>(() =>
    Object.fromEntries(rows.map(r => [r.id, r.sisa])));
  const [tanggal, setTanggal] = useState(hariIni());
  const [catatan, setCatatan] = useState('');
  const [loading, setLoading] = useState(false);
  const total = rows.reduce((s, r) => s + (qtys[r.id] ?? 0), 0);

  const submit = async () => {
    const salah = rows.find(r => (qtys[r.id] ?? 0) < 1 || (qtys[r.id] ?? 0) > r.sisa);
    if (salah) return toast.error(`${salah.nomor_reject}: qty 1 – ${salah.sisa} pcs`);
    setLoading(true);
    const res = await buatSjKirimUlang({
      tanggal, catatan,
      items: rows.map(r => ({ reject_kantor_id: r.id, qty: qtys[r.id] })),
    });
    setLoading(false);
    if (res.error || !res.id) return toast.error(res.error ?? 'Gagal membuat surat jalan');
    onDone(res.id, res.nomor_sj ?? '');
  };

  return (
    <Modal title="Buat Surat Jalan Kirim Ulang" onClose={onClose} wide>
      <p className="text-xs text-[#9aa0a6] mb-4">
        Klien: <span className="text-[#e5c17b] font-semibold">{rows[0]?.klien_nama}</span>. Surat jalan ini tidak membuat
        invoice baru — pcs yang dikirim ulang membatalkan potongan tagihan di surat jalan asalnya.
      </p>
      <div className="overflow-x-auto rounded-lg border border-[#2A2D31] mb-4">
        <table className="w-full text-sm">
          <thead className="text-[10px] uppercase text-[#9aa0a6] bg-[#0D0E10]">
            <tr>
              <th className="px-3 py-2 text-left">Reject</th>
              <th className="px-3 py-2 text-left">Produk</th>
              <th className="px-3 py-2 text-right">Sisa</th>
              <th className="px-3 py-2 text-center w-24">Kirim</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#2A2D31]/60">
            {rows.map(r => (
              <tr key={r.id}>
                <td className="px-3 py-2">
                  <div className="font-mono text-xs text-[#e5c17b]">{r.nomor_reject}</div>
                  <div className="font-mono text-[10px] text-[#9aa0a6]">{r.nomor_sj}</div>
                </td>
                <td className="px-3 py-2 text-xs text-[#e8eaed]">{r.produk_nama}</td>
                <td className="px-3 py-2 text-right text-xs text-[#e8eaed]">{r.sisa}</td>
                <td className="px-3 py-2 text-center">
                  <input type="number" min={1} max={r.sisa} value={qtys[r.id] ?? 0}
                    onChange={e => setQtys(p => ({ ...p, [r.id]: Math.max(0, parseInt(e.target.value) || 0) }))}
                    className="w-16 bg-[#0D0E10] border border-[#2A2D31] text-[#e8eaed] rounded-lg px-2 py-1 text-xs text-center focus:outline-none focus:border-[#e5c17b]" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="grid grid-cols-2 gap-3 mb-4">
        <div>
          <label className={labelCls}>Tanggal Kirim</label>
          <input type="date" value={tanggal} onChange={e => setTanggal(e.target.value)} className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Catatan / Pengirim</label>
          <input value={catatan} onChange={e => setCatatan(e.target.value)} placeholder="opsional" className={inputCls} />
        </div>
      </div>
      <div className="flex items-center justify-between">
        <span className="text-xs text-[#9aa0a6]">Total <strong className="text-[#e8eaed]">{total} pcs</strong></span>
        <div className="flex gap-2">
          <button onClick={onClose} className="px-4 py-2 rounded-xl border border-[#2A2D31] text-xs font-semibold text-[#9aa0a6] hover:bg-[#2A2D31]">Batal</button>
          <button onClick={submit} disabled={loading}
            className="px-5 py-2 rounded-xl bg-[#e5c17b] hover:bg-[#d4b06a] text-[#0D0E10] text-xs font-black uppercase tracking-wider disabled:opacity-50 flex items-center gap-2">
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Truck className="w-3.5 h-3.5" />} Buat Surat Jalan
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Rekap ────────────────────────────────────────────────────────────────────

interface Agregat { key: string; label: string; sub?: string; pcs: number; kembali: number; tidakBisa: number; dibeli: number; sisa: number; potongan: number; }

function agregasi(rows: RejectKantorRow[], keyFn: (r: RejectKantorRow) => [string, string, string?]): Agregat[] {
  const m = new Map<string, Agregat>();
  rows.forEach(r => {
    const [key, label, sub] = keyFn(r);
    const a = m.get(key) ?? { key, label, sub, pcs: 0, kembali: 0, tidakBisa: 0, dibeli: 0, sisa: 0, potongan: 0 };
    a.pcs += r.qty;
    a.kembali += r.terkirim;
    if (r.status === 'tidak_bisa') a.tidakBisa += r.sisa;
    if (r.status === 'dibeli_kantor') a.dibeli += r.sisa;
    a.sisa += r.sisa;
    a.potongan += r.potongan;
    m.set(key, a);
  });
  return [...m.values()].sort((a, b) => b.pcs - a.pcs);
}

function TabelRekap({ judul, kolom, data }: { judul: string; kolom: string; data: Agregat[] }) {
  return (
    <div className="bg-[#1A1D1F] border border-[#2A2D31] rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-[#2A2D31] text-sm font-semibold text-[#e8eaed]">{judul}</div>
      {data.length === 0 ? (
        <div className="p-6 text-center text-xs text-[#9aa0a6]">Belum ada data</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-[10px] uppercase text-[#9aa0a6] bg-[#0D0E10]">
              <tr>
                <th className="px-4 py-2 text-left">{kolom}</th>
                <th className="px-3 py-2 text-right">Reject</th>
                <th className="px-3 py-2 text-right">Dikirim Ulang</th>
                <th className="px-3 py-2 text-right">Tdk Bisa</th>
                <th className="px-3 py-2 text-right">Dibeli Kantor</th>
                <th className="px-3 py-2 text-right">Belum Kembali</th>
                <th className="px-4 py-2 text-right">Potongan / Kerugian</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#2A2D31]/60">
              {data.map(a => (
                <tr key={a.key}>
                  <td className="px-4 py-2">
                    <div className="text-xs text-[#e8eaed]">{a.label}</div>
                    {a.sub && <div className="text-[10px] text-[#9aa0a6]">{a.sub}</div>}
                  </td>
                  <td className="px-3 py-2 text-right text-xs font-bold text-[#e8eaed]">{a.pcs}</td>
                  <td className="px-3 py-2 text-right text-xs text-emerald-400">{a.kembali || '—'}</td>
                  <td className="px-3 py-2 text-right text-xs text-zinc-400">{a.tidakBisa || '—'}</td>
                  <td className="px-3 py-2 text-right text-xs text-sky-400">{a.dibeli || '—'}</td>
                  <td className="px-3 py-2 text-right text-xs text-orange-400">{a.sisa - a.tidakBisa - a.dibeli || '—'}</td>
                  <td className="px-4 py-2 text-right text-xs font-mono text-red-400">{a.potongan ? idr(a.potongan) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Rekap({ rows }: { rows: RejectKantorRow[] }) {
  const bulanAda = useMemo(() => {
    const s = new Set(rows.map(r => r.tanggal.slice(0, 7)));
    return [...s].sort().reverse();
  }, [rows]);
  const [bulan, setBulan] = useState<string>(bulanAda[0] ?? '');
  const data = bulan ? rows.filter(r => r.tanggal.startsWith(bulan)) : rows;

  const tot = data.reduce((t, r) => ({
    pcs: t.pcs + r.qty, kembali: t.kembali + r.terkirim,
    tidakBisa: t.tidakBisa + (r.status === 'tidak_bisa' ? r.sisa : 0), potongan: t.potongan + r.potongan,
  }), { pcs: 0, kembali: 0, tidakBisa: 0, potongan: 0 });

  const namaBulan = (ym: string) => {
    const [y, m] = ym.split('-').map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <label className="text-xs text-[#9aa0a6]">Periode (tanggal lapor)</label>
        <select value={bulan} onChange={e => setBulan(e.target.value)}
          className="bg-[#0D0E10] border border-[#2A2D31] text-[#e8eaed] rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:border-[#e5c17b]">
          <option value="">Semua</option>
          {bulanAda.map(b => <option key={b} value={b}>{namaBulan(b)}</option>)}
        </select>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kartu label="Total Reject" nilai={`${tot.pcs} pcs`} sub={`${data.length} catatan`} />
        <Kartu label="Sudah Dikirim Ulang" nilai={`${tot.kembali} pcs`} warna="text-emerald-400" />
        <Kartu label="Tidak Bisa Diperbaiki" nilai={`${tot.tidakBisa} pcs`} warna="text-zinc-300" />
        <Kartu label="Potongan / Kerugian" nilai={idr(tot.potongan)} sub="termasuk barang lama & dibeli kantor" warna="text-red-400" />
      </div>
      <TabelRekap judul="Per Tingkat Reject" kolom="Tingkat"
        data={agregasi(data, r => [r.tingkat, TINGKAT_INFO[r.tingkat].label, TINGKAT_INFO[r.tingkat].ket])} />
      <div className="grid lg:grid-cols-2 gap-4">
        <TabelRekap judul="Per Model" kolom="Model" data={agregasi(data, r => [r.model_nama, r.model_nama])} />
        <TabelRekap judul="Per Alasan" kolom="Alasan" data={agregasi(data, r => [r.alasan_nama, r.alasan_nama, r.jenis_nama])} />
      </div>
      <TabelRekap judul="Per Surat Jalan" kolom="Surat Jalan"
        data={agregasi(data, r => [r.surat_jalan_id ?? 'barang_lama', r.nomor_sj, r.klien_nama])} />
      <TabelRekap judul="Per Produk (Model · Warna · Size)" kolom="Produk"
        data={agregasi(data, r => [r.produk_nama, r.produk_nama])} />
    </div>
  );
}

function Kartu({ label, nilai, sub, warna }: { label: string; nilai: string; sub?: string; warna?: string }) {
  return (
    <div className="bg-[#1A1D1F] border border-[#2A2D31] rounded-xl p-4">
      <div className="text-[10px] font-bold uppercase tracking-widest text-[#9aa0a6]">{label}</div>
      <div className={`text-lg font-bold mt-1 ${warna ?? 'text-[#e8eaed]'}`}>{nilai}</div>
      {sub && <div className="text-[10px] text-[#9aa0a6] mt-0.5">{sub}</div>}
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

type Tab = 'proses' | 'tidak_bisa' | 'dibeli' | 'selesai' | 'rekap';

export default function RejectKantorClient({ rows, dataLapor, alasanList, role }: {
  rows: RejectKantorRow[];
  dataLapor: DataLaporReject;
  alasanList: AlasanRejectOption[];
  role: string | null;
}) {
  const router = useRouter();
  const canLapor  = role === 'owner' || role === 'admin_keuangan' || role === 'admin_produksi';
  const canProses = role === 'owner' || role === 'admin_produksi';
  const canHapus  = role === 'owner' || role === 'admin_keuangan';
  const canBeli   = role === 'owner' || role === 'admin_keuangan';

  const [tab, setTab] = useState<Tab>('proses');
  const [showLapor, setShowLapor] = useState(false);
  const [showKirim, setShowKirim] = useState(false);
  const [dipilih, setDipilih] = useState<Set<string>>(new Set());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [dibeliRow, setDibeliRow] = useState<RejectKantorRow | null>(null);
  const hargaNormal = useMemo(() => new Map(dataLapor.produkSemua.map(p => [p.nama, p.harga_jual])), [dataLapor.produkSemua]);

  const proses    = rows.filter(r => r.status === 'retur' || r.status === 'diperbaiki');
  const tidakBisa = rows.filter(r => r.status === 'tidak_bisa');
  const dibeli    = rows.filter(r => r.status === 'dibeli_kantor');
  const selesai   = rows.filter(r => r.status === 'selesai');

  const belumKembali = proses.reduce((s, r) => s + r.sisa, 0);
  const potonganAktif = rows.filter(r => r.sumber === 'sj').reduce((s, r) => s + r.potongan, 0);

  const rowsDipilih = proses.filter(r => dipilih.has(r.id));
  const klienDipilih = new Set(rowsDipilih.map(r => r.klien_nama));

  const ubahTingkat = async (r: RejectKantorRow, tingkat: RejectTingkat) => {
    if (tingkat === r.tingkat) return;
    setBusyId(r.id);
    const res = await ubahTingkatRejectKantor(r.id, tingkat);
    setBusyId(null);
    if (res.error) return toast.error(res.error);
    toast.success(`${r.nomor_reject}: tingkat ${TINGKAT_INFO[tingkat].label}`);
    router.refresh();
  };

  const togglePilih = (id: string) => setDipilih(prev => {
    const n = new Set(prev);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });

  const ubahStatus = async (r: RejectKantorRow, status: 'retur' | 'diperbaiki' | 'tidak_bisa') => {
    setBusyId(r.id);
    const res = await ubahStatusRejectKantor(r.id, status);
    setBusyId(null);
    if (res.error) return toast.error(res.error);
    toast.success(`${r.nomor_reject}: ${STATUS_INFO[status].label}`);
    router.refresh();
  };

  const hapus = async (r: RejectKantorRow) => {
    if (!window.confirm(`Hapus catatan ${r.nomor_reject} (${r.qty} pcs ${r.produk_nama})? Potongan tagihannya ikut batal.`)) return;
    setBusyId(r.id);
    const res = await hapusRejectKantor(r.id);
    setBusyId(null);
    if (res.error) return toast.error(res.error);
    toast.success(`${r.nomor_reject} dihapus`);
    router.refresh();
  };

  const daftar = tab === 'proses' ? proses : tab === 'tidak_bisa' ? tidakBisa : tab === 'dibeli' ? dibeli : selesai;

  const TABS: { id: Tab; label: string; n?: number }[] = [
    { id: 'proses', label: 'Perlu Diproses', n: proses.length },
    { id: 'tidak_bisa', label: 'Tidak Bisa Diperbaiki', n: tidakBisa.length },
    { id: 'dibeli', label: 'Dibeli Kantor', n: dibeli.length },
    { id: 'selesai', label: 'Sudah Dikirim Ulang', n: selesai.length },
    { id: 'rekap', label: 'Rekap' },
  ];

  return (
    <div className="space-y-5">
      {showLapor && (
        <LaporModal data={dataLapor} alasanList={alasanList} onClose={() => setShowLapor(false)}
          onDone={() => { setShowLapor(false); router.refresh(); }} />
      )}
      {dibeliRow && (
        <DibeliModal row={dibeliRow} hargaNormal={hargaNormal.get(dibeliRow.produk_nama) ?? dibeliRow.harga_satuan}
          onClose={() => setDibeliRow(null)}
          onDone={() => { setDibeliRow(null); router.refresh(); }} />
      )}
      {showKirim && rowsDipilih.length > 0 && (
        <KirimUlangModal rows={rowsDipilih} onClose={() => setShowKirim(false)}
          onDone={(id, nomor) => {
            setShowKirim(false);
            setDipilih(new Set());
            toast.success(`Surat jalan kirim ulang ${nomor} dibuat`, {
              action: { label: 'Buka & Cetak', onClick: () => router.push(`/app/pengiriman/riwayat/${id}`) },
            });
            router.refresh();
          }} />
      )}

      {/* Ringkasan */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kartu label="Belum Kembali ke Kantor" nilai={`${belumKembali} pcs`} sub={`${proses.length} catatan perlu diproses`} warna="text-orange-400" />
        <Kartu label="Potongan Tagihan Aktif" nilai={idr(potonganAktif)} sub="kiriman di sistem · batal setelah dikirim ulang" warna="text-red-400" />
        <Kartu label="Tidak Bisa / Dibeli Kantor" nilai={`${tidakBisa.reduce((s, r) => s + r.sisa, 0)} / ${dibeli.reduce((s, r) => s + r.sisa, 0)} pcs`} warna="text-zinc-300" />
        <Kartu label="Sudah Dikirim Ulang" nilai={`${rows.reduce((s, r) => s + r.terkirim, 0)} pcs`} warna="text-emerald-400" />
      </div>

      {/* Tabs + tombol */}
      <div className="flex flex-wrap items-center gap-2 justify-between">
        <div className="flex flex-wrap gap-1 bg-[#0D0E10] border border-[#2A2D31] rounded-xl p-1">
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                tab === t.id ? 'bg-[#e5c17b] text-[#0D0E10]' : 'text-[#9aa0a6] hover:text-[#e8eaed]'}`}>
              {t.label}{t.n !== undefined && <span className="ml-1.5 opacity-70">{t.n}</span>}
            </button>
          ))}
        </div>
        {canLapor && (
          <button onClick={() => setShowLapor(true)}
            className="px-4 py-2 rounded-xl bg-[#e5c17b] hover:bg-[#d4b06a] text-[#0D0E10] text-xs font-black uppercase tracking-wider flex items-center gap-2">
            <Plus className="w-3.5 h-3.5" /> Lapor Reject
          </button>
        )}
      </div>

      {tab === 'rekap' ? <Rekap rows={rows} /> : (
        <>
          {tab === 'proses' && canProses && dipilih.size > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3 bg-[#e5c17b]/10 border border-[#e5c17b]/30 rounded-xl px-4 py-3">
              <span className="text-xs text-[#e8eaed]">
                <strong>{rowsDipilih.length}</strong> reject dipilih · {rowsDipilih.reduce((s, r) => s + r.sisa, 0)} pcs
                {klienDipilih.size > 1 && <span className="text-red-400 ml-2">— pilih reject dari satu klien saja</span>}
              </span>
              <div className="flex gap-2">
                <button onClick={() => setDipilih(new Set())} className="px-3 py-1.5 rounded-lg border border-[#2A2D31] text-xs text-[#9aa0a6]">Batal pilih</button>
                <button onClick={() => setShowKirim(true)} disabled={klienDipilih.size > 1}
                  className="px-4 py-1.5 rounded-lg bg-[#e5c17b] text-[#0D0E10] text-xs font-bold flex items-center gap-1.5 disabled:opacity-40">
                  <Truck className="w-3.5 h-3.5" /> Buat Surat Jalan Kirim Ulang
                </button>
              </div>
            </div>
          )}

          {daftar.length === 0 ? (
            <div className="bg-[#1A1D1F] border border-[#2A2D31] rounded-xl p-12 text-center">
              {tab === 'proses'
                ? <CheckCircle2 className="w-10 h-10 text-emerald-400 mx-auto mb-3" />
                : <PackageX className="w-10 h-10 text-[#9aa0a6] mx-auto mb-3" />}
              <p className="text-sm text-[#e8eaed] font-semibold">
                {tab === 'proses' ? 'Tidak ada reject yang perlu diproses' : 'Belum ada data'}
              </p>
            </div>
          ) : (
            <div className="bg-[#1A1D1F] border border-[#2A2D31] rounded-xl overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-[10px] uppercase text-[#9aa0a6] bg-[#0D0E10] border-b border-[#2A2D31]">
                  <tr>
                    {tab === 'proses' && canProses && <th className="px-3 py-2.5 w-8" />}
                    <th className="px-3 py-2.5 text-left">No. Reject</th>
                    <th className="px-3 py-2.5 text-left">SJ Asal</th>
                    <th className="px-3 py-2.5 text-left">Produk</th>
                    <th className="px-3 py-2.5 text-left">Alasan / Tingkat</th>
                    <th className="px-3 py-2.5 text-right">Qty</th>
                    <th className="px-3 py-2.5 text-right">Potongan</th>
                    <th className="px-3 py-2.5 text-left">Status</th>
                    <th className="px-3 py-2.5 text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#2A2D31]/60">
                  {daftar.map(r => (
                    <tr key={r.id} className={dipilih.has(r.id) ? 'bg-[#e5c17b]/5' : ''}>
                      {tab === 'proses' && canProses && (
                        <td className="px-3 py-2.5">
                          <input type="checkbox" checked={dipilih.has(r.id)} onChange={() => togglePilih(r.id)}
                            disabled={r.sisa <= 0} className="accent-[#e5c17b]" />
                        </td>
                      )}
                      <td className="px-3 py-2.5">
                        <div className="font-mono text-xs text-[#e5c17b]">{r.nomor_reject}</div>
                        <div className="text-[10px] text-[#9aa0a6]">
                          {tgl(r.tanggal)} · {r.waktu_temuan === 'saat_terima' ? 'saat terima' : 'belakangan'}
                        </div>
                      </td>
                      <td className="px-3 py-2.5">
                        {r.surat_jalan_id ? (
                          <Link href={`/app/pengiriman/riwayat/${r.surat_jalan_id}`} className="font-mono text-xs text-[#e8eaed] hover:text-[#e5c17b]">
                            {r.nomor_sj}
                          </Link>
                        ) : (
                          <span className="text-xs text-[#9aa0a6] italic" title="Kiriman lama di luar sistem — tidak memotong invoice">Barang lama</span>
                        )}
                        <div className="text-[10px] text-[#9aa0a6]">{r.klien_nama}</div>
                      </td>
                      <td className="px-3 py-2.5 text-xs text-[#e8eaed]">{r.produk_nama}</td>
                      <td className="px-3 py-2.5">
                        <div className="text-xs text-[#e8eaed]">{r.alasan_nama}</div>
                        {canLapor && r.status !== 'selesai' ? (
                          <select value={r.tingkat} onChange={e => ubahTingkat(r, e.target.value as RejectTingkat)}
                            className={`mt-1 text-[10px] font-bold rounded border px-1 py-0.5 bg-transparent ${TINGKAT_INFO[r.tingkat].cls}`}>
                            {TINGKAT_LIST.map(t => <option key={t} value={t} className="bg-[#1A1D1F] text-[#e8eaed]">{TINGKAT_INFO[t].label}</option>)}
                          </select>
                        ) : (
                          <span className={`inline-block mt-1 text-[10px] font-bold rounded border px-1.5 py-0.5 ${TINGKAT_INFO[r.tingkat].cls}`}>{TINGKAT_INFO[r.tingkat].label}</span>
                        )}
                        {r.keterangan && <div className="text-[10px] text-[#9aa0a6] max-w-[200px] truncate" title={r.keterangan}>{r.keterangan}</div>}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <div className="text-xs font-bold text-[#e8eaed]">{r.qty} pcs</div>
                        {r.terkirim > 0 && (
                          <div className="text-[10px] text-emerald-400" title={r.kirim_ulang.map(k => `${k.nomor_sj}: ${k.qty_diterima ?? k.qty} pcs`).join('\n')}>
                            {r.terkirim} dikirim ulang
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right text-xs font-mono text-red-400 whitespace-nowrap">
                        {r.potongan > 0 ? idr(r.potongan) : '—'}
                        {r.status === 'dibeli_kantor' && r.harga_beli_kantor != null && (
                          <div className="text-[10px] text-sky-400 font-sans">dibeli {idr(r.harga_beli_kantor)}/pcs</div>
                        )}
                        {r.sumber === 'barang_lama' && r.potongan > 0 && (
                          <div className="text-[10px] text-[#9aa0a6] font-sans">kerugian, bukan potongan invoice</div>
                        )}
                      </td>
                      <td className="px-3 py-2.5"><StatusPill status={r.status} /></td>
                      <td className="px-3 py-2.5">
                        <div className="flex justify-end gap-1">
                          {busyId === r.id ? <Loader2 className="w-4 h-4 animate-spin text-[#9aa0a6]" /> : (
                            <>
                              {canProses && r.status === 'retur' && (
                                <IconBtn title="Tandai sedang diperbaiki" onClick={() => ubahStatus(r, 'diperbaiki')}><Wrench className="w-3.5 h-3.5" /></IconBtn>
                              )}
                              {canProses && (r.status === 'retur' || r.status === 'diperbaiki') && (
                                <IconBtn title="Tidak bisa diperbaiki (potongan permanen)" onClick={() => ubahStatus(r, 'tidak_bisa')}><Ban className="w-3.5 h-3.5" /></IconBtn>
                              )}
                              {canBeli && ['retur', 'diperbaiki', 'tidak_bisa'].includes(r.status) && r.sisa > 0 && (
                                <IconBtn title="Dibeli kantor (harga lebih murah)" onClick={() => setDibeliRow(r)}><ShoppingBag className="w-3.5 h-3.5" /></IconBtn>
                              )}
                              {canBeli && r.status === 'dibeli_kantor' && (
                                <IconBtn title="Batalkan dibeli kantor" onClick={() => ubahStatus(r, 'diperbaiki')}><RotateCcw className="w-3.5 h-3.5" /></IconBtn>
                              )}
                              {canProses && r.status === 'tidak_bisa' && (
                                <IconBtn title="Kembalikan ke diperbaiki" onClick={() => ubahStatus(r, 'diperbaiki')}><RotateCcw className="w-3.5 h-3.5" /></IconBtn>
                              )}
                              {canHapus && r.kirim_ulang.length === 0 && (
                                <IconBtn title="Hapus (salah input)" danger onClick={() => hapus(r)}><Trash2 className="w-3.5 h-3.5" /></IconBtn>
                              )}
                              {r.kirim_ulang.map(k => (
                                <Link key={k.sj_id} href={`/app/pengiriman/riwayat/${k.sj_id}`}
                                  className="text-[10px] font-mono text-emerald-400 hover:underline px-1 self-center" title="Surat jalan kirim ulang">
                                  {k.nomor_sj}
                                </Link>
                              ))}
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {tab === 'proses' && (
            <div className="flex items-start gap-2 text-[11px] text-[#9aa0a6]">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>
                Alur: kantor lapor reject → potongan tagihan aktif → konveksi perbaiki → centang reject lalu
                <strong> Buat Surat Jalan Kirim Ulang</strong> → kantor validasi kiriman ulang → potongan batal.
                Yang tidak bisa diperbaiki ditandai <strong>Tidak bisa</strong> (potongan penuh); bila kantor tetap mengambil barangnya
                dengan harga lebih murah, pilih <strong>Dibeli kantor</strong> (potongan = selisih harga).
              </span>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function IconBtn({ title, onClick, children, danger }: {
  title: string; onClick: () => void; children: React.ReactNode; danger?: boolean;
}) {
  return (
    <button title={title} onClick={onClick}
      className={`p-1.5 rounded-lg border border-[#2A2D31] transition-colors ${
        danger ? 'text-red-400 hover:bg-red-500/10' : 'text-[#9aa0a6] hover:text-[#e8eaed] hover:bg-[#2A2D31]'}`}>
      {children}
    </button>
  );
}
