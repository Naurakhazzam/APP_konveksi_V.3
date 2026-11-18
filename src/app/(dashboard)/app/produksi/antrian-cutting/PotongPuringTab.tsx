'use client';

import React, { useMemo, useState } from 'react';
import { Loader2, Scissors, Undo2 } from 'lucide-react';
import { toast } from 'sonner';
import { potongPuring, batalPotongPuring, type PuringData } from '@/lib/actions/produksi/potong-puring.actions';
import { UKURAN_POTONG } from '@/lib/produksi/variasi';

interface Props {
  data: PuringData;
  isOwner: boolean;
  onChanged: () => void;
}

const rp = (n: number) => 'Rp' + Math.round(n).toLocaleString('id-ID');
const fmt = (n: number) => Number(n.toFixed(3)).toLocaleString('id-ID');

export default function PotongPuringTab({ data, isOwner, onChanged }: Props) {
  const [bahanId, setBahanId] = useState(data.bahan[0]?.id ?? '');
  const [habis, setHabis] = useState(true);
  const [kg, setKg] = useState('');
  const [perSize, setPerSize] = useState<Record<string, string>>({});
  const [catatan, setCatatan] = useState('');
  const [busy, setBusy] = useState(false);
  const [batalId, setBatalId] = useState<string | null>(null);
  const [alasan, setAlasan] = useState('');

  const bahan = useMemo(() => data.bahan.find(b => b.id === bahanId), [data.bahan, bahanId]);
  const kgPakai = habis ? (bahan?.stok_aktual ?? 0) : parseFloat(kg) || 0;
  const sizeNum = useMemo(() => Object.fromEntries(
    UKURAN_POTONG.map(s => [s, Math.max(0, parseInt(perSize[s] ?? '', 10) || 0)]),
  ) as Record<string, number>, [perSize]);
  const pcsNum = Object.values(sizeNum).reduce((s, n) => s + n, 0);

  // Perkiraan biaya FIFO: ambil dari LOT paling lama dulu (sama seperti di server)
  const biayaFifo = useMemo(() => {
    if (!bahan || kgPakai <= 0) return 0;
    let sisa = kgPakai, total = 0;
    for (const l of bahan.lot) {
      if (sisa <= 0) break;
      const ambil = Math.min(l.qty_sisa, sisa);
      total += ambil * l.harga_satuan;
      sisa -= ambil;
    }
    if (sisa > 0) total += sisa * bahan.harga_referensi;
    return total;
  }, [bahan, kgPakai]);

  const simpan = async () => {
    if (!bahan) { toast.error('Pilih bahan puring'); return; }
    if (kgPakai <= 0) { toast.error(habis ? `Stok ${bahan.nama} kosong — input belanja di Stok Masuk dulu` : 'Isi kg yang dipotong'); return; }
    if (kgPakai > bahan.stok_aktual + 0.0005) { toast.error(`Stok ${bahan.nama} hanya ${fmt(bahan.stok_aktual)} ${bahan.satuan}`); return; }
    if (pcsNum <= 0) { toast.error('Isi jumlah lembar puring per ukuran'); return; }
    setBusy(true);
    const res = await potongPuring({
      bahan_item_id: bahan.id, kg: kgPakai, pcs: pcsNum, habis_roll: habis, catatan,
      per_size: Object.fromEntries(Object.entries(sizeNum).filter(([, n]) => n > 0)),
    });
    setBusy(false);
    if (!res.success) { toast.error(res.error ?? 'Gagal menyimpan'); return; }
    toast.success(`${pcsNum} lembar puring masuk stok · ${rp(res.harga_per_pcs ?? 0)}/lembar`
      + ((res.qty_lunasi_tunggu ?? 0) > 0 ? ` · ${res.qty_lunasi_tunggu} lembar melunasi pemakaian yang menunggu harga` : ''));
    setKg(''); setPerSize({}); setCatatan('');
    onChanged();
  };

  const batal = async () => {
    if (!batalId) return;
    setBusy(true);
    const res = await batalPotongPuring(batalId, alasan);
    setBusy(false);
    if (!res.success) { toast.error(res.error ?? 'Gagal membatalkan'); return; }
    toast.success('Potong puring dibatalkan — stok kg dikembalikan');
    setBatalId(null); setAlasan('');
    onChanged();
  };

  const inputCls = 'h-9 rounded-md border border-[#2A2D31] bg-[#0D0E10] px-3 text-sm text-[#e8eaed] focus:outline-none focus:ring-1 focus:ring-[#e5c17b]';
  const card = 'rounded-xl border border-[#2A2D31] bg-[#1A1D1F]';

  return (
    <div className="space-y-6">
      {/* Ringkasan stok */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {data.bahan.map(b => (
          <div key={b.id} className={`${card} px-4 py-3`}>
            <div className="text-[10px] uppercase tracking-widest text-[#9aa0a6] font-bold">{b.nama}</div>
            <div className="text-lg font-bold text-[#e8eaed]">{fmt(b.stok_aktual)} <span className="text-xs text-[#9aa0a6] font-normal">{b.satuan}</span></div>
          </div>
        ))}
        <div className={`${card} px-4 py-3`}>
          <div className="text-[10px] uppercase tracking-widest text-[#9aa0a6] font-bold">Stok lembar puring</div>
          <div className="text-lg font-bold text-[#e5c17b]">{fmt(data.stok_puring)} <span className="text-xs text-[#9aa0a6] font-normal">pcs</span></div>
          <div className="text-[10px] text-[#9aa0a6]">{rp(data.harga_puring)}/lembar · terpakai otomatis saat jaket masuk jahit</div>
        </div>
      </div>

      {/* Form */}
      <div className={`${card} p-5 space-y-4`}>
        <div>
          <h3 className="text-sm font-bold text-[#e8eaed] flex items-center gap-2"><Scissors className="w-4 h-4 text-[#e5c17b]" /> Potong Puring</h3>
          <p className="text-xs text-[#9aa0a6] mt-0.5">Roll puring (kg) dipotong jadi lembaran. Biaya per lembar dihitung otomatis dari harga beli.</p>
        </div>

        {data.bahan.length === 0 ? (
          <p className="text-sm text-orange-300">Belum ada bahan puring di inventory.</p>
        ) : (
          <div className="grid md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs text-[#9aa0a6]">Bahan</label>
              <select value={bahanId} onChange={e => setBahanId(e.target.value)} className={`${inputCls} w-full`}>
                {data.bahan.map(b => <option key={b.id} value={b.id}>{b.nama} (stok {fmt(b.stok_aktual)} {b.satuan})</option>)}
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs text-[#9aa0a6]">Yang dipotong</label>
              <div className="flex items-center gap-4 h-9 text-sm">
                <label className="flex items-center gap-2 cursor-pointer text-[#e8eaed]">
                  <input type="radio" checked={habis} onChange={() => setHabis(true)} className="accent-[#e5c17b]" />
                  Habiskan semua ({fmt(bahan?.stok_aktual ?? 0)} {bahan?.satuan})
                </label>
                <label className="flex items-center gap-2 cursor-pointer text-[#e8eaed]">
                  <input type="radio" checked={!habis} onChange={() => setHabis(false)} className="accent-[#e5c17b]" />
                  Sebagian
                </label>
              </div>
            </div>

            {!habis && (
              <div className="space-y-1.5">
                <label className="text-xs text-[#9aa0a6]">Berat yang dipotong ({bahan?.satuan})</label>
                <input type="number" min={0} step={0.01} value={kg} onChange={e => setKg(e.target.value)}
                  placeholder="mis. 12.5" className={`${inputCls} w-full`} />
                <p className="text-[10px] text-[#9aa0a6]">Timbang sisa roll, lalu isi selisihnya.</p>
              </div>
            )}

            <div className="space-y-1.5 md:col-span-2">
              <label className="text-xs text-[#9aa0a6]">Jadi berapa lembar per ukuran</label>
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                {UKURAN_POTONG.map(s => (
                  <div key={s} className="space-y-1">
                    <div className="text-[11px] font-bold text-center text-[#9aa0a6]">{s}</div>
                    <input type="number" min={0} step={1} value={perSize[s] ?? ''}
                      onChange={e => setPerSize(p => ({ ...p, [s]: e.target.value }))}
                      placeholder="0" className={`${inputCls} w-full text-center`} />
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-[#9aa0a6]">Total <b className="text-[#e8eaed]">{pcsNum.toLocaleString('id-ID')} lembar</b></p>
            </div>

            <div className="space-y-1.5 md:col-span-2">
              <label className="text-xs text-[#9aa0a6]">Catatan (opsional)</label>
              <input value={catatan} onChange={e => setCatatan(e.target.value)} placeholder="mis. untuk PO-0101 Raizen"
                className={`${inputCls} w-full`} />
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-[#2A2D31]">
          <p className="text-xs text-[#9aa0a6]">
            {kgPakai > 0 && pcsNum > 0
              ? <>Pakai <b className="text-[#e8eaed]">{fmt(kgPakai)} {bahan?.satuan}</b> ({rp(biayaFifo)}) → <b className="text-[#e5c17b]">{pcsNum} lembar</b>
                  {' '}· <b className="text-[#e5c17b]">{rp(biayaFifo / pcsNum)}/lembar</b>
                  <span className="text-[#9aa0a6]"> ({fmt(kgPakai / pcsNum * 1000)} gram/lembar)</span></>
              : 'Isi data untuk melihat perhitungan'}
          </p>
          <button onClick={simpan} disabled={busy || data.bahan.length === 0}
            className="flex items-center gap-2 px-5 h-10 rounded-md bg-[#e5c17b] text-[#0D0E10] text-sm font-semibold hover:bg-[#d4b06a] disabled:opacity-30">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Scissors className="w-4 h-4" />} Simpan Potong Puring
          </button>
        </div>
      </div>

      {/* Riwayat */}
      <div className={`${card} overflow-hidden`}>
        <div className="px-5 py-3 border-b border-[#2A2D31] text-sm font-bold text-[#e8eaed]">Riwayat Potong Puring</div>
        <div className="overflow-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-[#16181A] text-[#9aa0a6] uppercase tracking-wider">
                <th className="text-left px-4 py-2">Tanggal</th>
                <th className="text-left px-4 py-2">Bahan</th>
                <th className="text-right px-4 py-2">Dipakai</th>
                <th className="text-right px-4 py-2">Lembar</th>
                <th className="text-right px-4 py-2">Biaya</th>
                <th className="text-right px-4 py-2">Per lembar</th>
                <th className="text-left px-4 py-2">Catatan</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#2A2D31]">
              {data.riwayat.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-[#9aa0a6]">Belum ada data</td></tr>
              )}
              {data.riwayat.map(r => (
                <tr key={r.id} className={r.dibatalkan_at ? 'opacity-40 line-through' : ''}>
                  <td className="px-4 py-2 text-[#e8eaed]">{new Date(r.tanggal).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' })}</td>
                  <td className="px-4 py-2 text-[#e8eaed]">{r.bahan_nama}{r.habis_roll && <span className="ml-1 text-[10px] text-emerald-400 no-underline">habis</span>}</td>
                  <td className="px-4 py-2 text-right text-[#e8eaed]">{fmt(r.kg_pakai)} kg</td>
                  <td className="px-4 py-2 text-right font-bold text-[#e5c17b]">
                    {r.pcs_hasil}
                    {r.per_size && (
                      <span className="block text-[10px] font-normal text-[#9aa0a6] whitespace-nowrap">
                        {UKURAN_POTONG.filter(s => r.per_size?.[s]).map(s => `${s} ${r.per_size?.[s]}`).join(' · ')}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right text-[#e8eaed]">{rp(r.biaya_total)}</td>
                  <td className="px-4 py-2 text-right text-[#e8eaed]">{rp(r.harga_per_pcs)}</td>
                  <td className="px-4 py-2 text-[#9aa0a6]">{r.catatan ?? '-'}</td>
                  <td className="px-4 py-2 text-right">
                    {!r.dibatalkan_at && isOwner && (
                      <button onClick={() => { setBatalId(r.id); setAlasan(''); }}
                        className="inline-flex items-center gap-1 text-orange-400 hover:text-orange-300"><Undo2 className="w-3.5 h-3.5" /> Batal</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {batalId && (
        <div className="fixed inset-0 bg-black/75 flex items-center justify-center z-50 p-4">
          <div className="bg-[#1A1D1F] border border-[#2A2D31] rounded-xl w-full max-w-md p-5 space-y-4">
            <h3 className="text-base font-bold text-[#e8eaed]">Batalkan Potong Puring?</h3>
            <p className="text-xs text-[#9aa0a6]">Kg dikembalikan ke stok bahan puring, lembaran puring dikurangi.</p>
            <input value={alasan} onChange={e => setAlasan(e.target.value)} placeholder="Alasan (wajib)" className={`${inputCls} w-full`} />
            <div className="flex justify-end gap-2">
              <button onClick={() => setBatalId(null)} disabled={busy} className="px-4 h-9 rounded-md border border-[#2A2D31] text-sm text-[#e8eaed]">Tutup</button>
              <button onClick={batal} disabled={busy || !alasan.trim()}
                className="flex items-center gap-2 px-4 h-9 rounded-md bg-orange-500 text-[#0D0E10] text-sm font-semibold disabled:opacity-40">
                {busy && <Loader2 className="w-4 h-4 animate-spin" />} Batalkan
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
