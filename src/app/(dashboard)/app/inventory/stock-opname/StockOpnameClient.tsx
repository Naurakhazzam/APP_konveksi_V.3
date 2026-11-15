'use client';

import React, { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, ClipboardCheck } from 'lucide-react';
import { toast } from 'sonner';
import { simpanStockOpname, type OpnameItem, type OpnameRiwayat } from '@/lib/actions/inventory/stock-opname.actions';

interface Props {
  data: { items: OpnameItem[]; riwayat: OpnameRiwayat[] };
  hariIni: string;
  bulanIni: string;
}

const rp = (n: number) => (n < 0 ? '-' : '') + 'Rp' + Math.abs(Math.round(n)).toLocaleString('id-ID');
const fmt = (n: number) => Number(n.toFixed(3)).toLocaleString('id-ID');

export default function StockOpnameClient({ data, hariIni, bulanIni }: Props) {
  const router = useRouter();
  const [jenis, setJenis] = useState<'pembantu' | 'utama'>('pembantu');
  const [cari, setCari] = useState('');
  const [fisik, setFisik] = useState<Record<string, string>>({});
  const [tanggal, setTanggal] = useState(hariIni);
  const [catatan, setCatatan] = useState('');
  const [busy, setBusy] = useState(false);

  const items = useMemo(() => data.items
    .filter(i => i.jenis === jenis)
    .filter(i => !cari || i.nama.toLowerCase().includes(cari.toLowerCase())), [data.items, jenis, cari]);

  const diisi = Object.entries(fisik).filter(([, v]) => v.trim() !== '' && !Number.isNaN(Number(v)));
  const itemMap = useMemo(() => new Map(data.items.map(i => [i.id, i])), [data.items]);

  // Pemakaian bahan pembantu bulan ini (dari opname)
  const terpakaiBulanIni = data.riwayat
    .filter(r => r.tanggal.startsWith(bulanIni) && r.nilai_selisih < 0)
    .reduce((s, r) => s - r.nilai_selisih, 0);

  const simpan = async () => {
    if (!diisi.length) { toast.error('Isi stok fisik minimal satu barang'); return; }
    setBusy(true);
    const res = await simpanStockOpname(
      diisi.map(([id, v]) => ({ inventory_item_id: id, stok_fisik: Number(v) })), tanggal, catatan);
    setBusy(false);
    if (!res.success) { toast.error(res.error ?? 'Gagal menyimpan'); return; }
    toast.success(`${res.jumlah} barang tersimpan · nilai selisih ${rp(res.nilai_selisih ?? 0)}`);
    setFisik({}); setCatatan('');
    router.refresh();
  };

  const inputCls = 'h-9 rounded-md border border-[#2A2D31] bg-[#0D0E10] px-3 text-sm text-[#e8eaed] focus:outline-none focus:ring-1 focus:ring-[#e5c17b]';
  const card = 'rounded-xl border border-[#2A2D31] bg-[#1A1D1F]';

  return (
    <div className="space-y-6 mt-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className={`${card} px-4 py-3`}>
          <div className="text-[10px] uppercase tracking-widest text-[#9aa0a6] font-bold">Bahan pembantu terpakai bulan ini</div>
          <div className="text-lg font-bold text-[#e5c17b]">{rp(terpakaiBulanIni)}</div>
          <div className="text-[10px] text-[#9aa0a6]">dari selisih stock opname (modal FIFO)</div>
        </div>
        <div className={`${card} px-4 py-3 md:col-span-2 text-xs text-[#9aa0a6] leading-relaxed`}>
          <b className="text-[#e8eaed]">Cara pakai:</b> beli bahan lewat <b>Stok Masuk</b> seperti biasa. Di akhir periode (mis. akhir bulan),
          hitung sisa fisiknya lalu isi kolom <b>Stok Fisik</b>. Selisihnya dicatat sebagai bahan terpakai (atau hilang/rusak).
          Barang yang tidak diisi tidak diubah.
        </div>
      </div>

      <div className={`${card} p-4 space-y-4`}>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex p-1 bg-[#16181A] rounded-lg border border-[#2A2D31]">
            {(['pembantu', 'utama'] as const).map(j => (
              <button key={j} onClick={() => setJenis(j)}
                className={'px-4 py-1.5 rounded-md text-sm font-medium ' + (jenis === j ? 'bg-[#e5c17b] text-[#0D0E10]' : 'text-[#9aa0a6] hover:text-[#e8eaed]')}>
                {j === 'pembantu' ? 'Bahan Pembantu' : 'Bahan Utama'}
              </button>
            ))}
          </div>
          <input value={cari} onChange={e => setCari(e.target.value)} placeholder="Cari barang..." className={`${inputCls} w-56`} />
          <div className="ml-auto flex items-end gap-2">
            <div>
              <div className="text-[10px] uppercase tracking-widest text-[#9aa0a6] font-bold mb-1">Tanggal hitung</div>
              <input type="date" value={tanggal} onChange={e => setTanggal(e.target.value)} className={inputCls} />
            </div>
          </div>
        </div>

        <div className="overflow-auto max-h-[55vh] rounded-lg border border-[#2A2D31]">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-[#16181A] text-[10px] uppercase tracking-widest text-[#9aa0a6]">
              <tr>
                <th className="text-left px-3 py-2">Barang</th>
                <th className="text-right px-3 py-2">Stok Sistem</th>
                <th className="text-right px-3 py-2 w-40">Stok Fisik</th>
                <th className="text-right px-3 py-2">Selisih</th>
                <th className="text-left px-3 py-2">Opname Terakhir</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#2A2D31]">
              {items.length === 0 && (
                <tr><td colSpan={5} className="px-3 py-8 text-center text-[#9aa0a6]">Tidak ada barang</td></tr>
              )}
              {items.map(i => {
                const v = fisik[i.id] ?? '';
                const sel = v.trim() !== '' && !Number.isNaN(Number(v)) ? Number(v) - i.stok_aktual : null;
                return (
                  <tr key={i.id}>
                    <td className="px-3 py-2 text-[#e8eaed]">{i.nama}</td>
                    <td className="px-3 py-2 text-right text-[#9aa0a6]">{fmt(i.stok_aktual)} {i.satuan}</td>
                    <td className="px-3 py-2 text-right">
                      <input type="number" min={0} step="any" value={v}
                        onChange={e => setFisik(p => ({ ...p, [i.id]: e.target.value }))}
                        className={`${inputCls} w-28 text-right`} placeholder="—" />
                    </td>
                    <td className={`px-3 py-2 text-right font-bold ${sel == null ? 'text-[#5f6368]' : sel < 0 ? 'text-orange-400' : sel > 0 ? 'text-sky-400' : 'text-green-400'}`}>
                      {sel == null ? '—' : `${sel > 0 ? '+' : ''}${fmt(sel)}`}
                    </td>
                    <td className="px-3 py-2 text-[#9aa0a6] text-xs">{i.terakhir ? new Date(i.terakhir).toLocaleDateString('id-ID') : 'belum pernah'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <input value={catatan} onChange={e => setCatatan(e.target.value)} placeholder="Catatan (opsional), mis. opname akhir November"
            className={`${inputCls} flex-1 min-w-[240px]`} />
          <span className="text-xs text-[#9aa0a6]">{diisi.length} barang diisi</span>
          <button onClick={simpan} disabled={busy || !diisi.length}
            className="flex items-center gap-2 px-5 h-10 rounded-md bg-[#e5c17b] text-[#0D0E10] text-sm font-semibold hover:bg-[#d4b06a] disabled:opacity-30">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ClipboardCheck className="w-4 h-4" />} Simpan Opname
          </button>
        </div>
        {diisi.length > 0 && (
          <p className="text-[11px] text-[#9aa0a6]">
            Barang yang diisi: {diisi.map(([id]) => itemMap.get(id)?.nama).filter(Boolean).slice(0, 6).join(', ')}{diisi.length > 6 ? ', …' : ''}
          </p>
        )}
      </div>

      <div className={`${card} overflow-hidden`}>
        <div className="px-4 py-3 border-b border-[#2A2D31] text-sm font-bold text-[#e8eaed]">Riwayat Stock Opname</div>
        <div className="overflow-auto max-h-[45vh]">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-[#16181A] text-[#9aa0a6] uppercase tracking-wider">
              <tr>
                <th className="text-left px-4 py-2">Tanggal</th>
                <th className="text-left px-4 py-2">Barang</th>
                <th className="text-right px-4 py-2">Sistem</th>
                <th className="text-right px-4 py-2">Fisik</th>
                <th className="text-right px-4 py-2">Selisih</th>
                <th className="text-right px-4 py-2">Nilai</th>
                <th className="text-left px-4 py-2">Catatan</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#2A2D31]">
              {data.riwayat.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-[#9aa0a6]">Belum ada stock opname</td></tr>
              )}
              {data.riwayat.map(r => (
                <tr key={r.id}>
                  <td className="px-4 py-2 text-[#e8eaed]">{new Date(r.tanggal).toLocaleDateString('id-ID')}</td>
                  <td className="px-4 py-2 text-[#e8eaed]">{r.nama}</td>
                  <td className="px-4 py-2 text-right text-[#9aa0a6]">{fmt(r.stok_sistem)}</td>
                  <td className="px-4 py-2 text-right text-[#e8eaed]">{fmt(r.stok_fisik)} {r.satuan}</td>
                  <td className={`px-4 py-2 text-right font-bold ${r.selisih < 0 ? 'text-orange-400' : r.selisih > 0 ? 'text-sky-400' : 'text-green-400'}`}>
                    {r.selisih > 0 ? '+' : ''}{fmt(r.selisih)}
                  </td>
                  <td className="px-4 py-2 text-right text-[#e8eaed]">{rp(r.nilai_selisih)}</td>
                  <td className="px-4 py-2 text-[#9aa0a6]">{r.catatan ?? '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
