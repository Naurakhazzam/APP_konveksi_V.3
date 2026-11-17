'use client';

import React, { useMemo, useState } from 'react';
import { Loader2, Scissors, Undo2 } from 'lucide-react';
import { toast } from 'sonner';
import { potongVariasi, batalPotongVariasi, type VariasiData } from '@/lib/actions/produksi/potong-variasi.actions';
import { UKURAN_POTONG, MODEL_VARIASI } from '@/lib/produksi/variasi';

interface Props {
  data: VariasiData;
  isOwner: boolean;
  onChanged: () => void;
}


const rp = (n: number) => 'Rp' + Math.round(n).toLocaleString('id-ID');
const fmt = (n: number) => Number(n.toFixed(3)).toLocaleString('id-ID');

export default function PotongVariasiTab({ data, isOwner, onChanged }: Props) {
  const [bahanId, setBahanId] = useState(data.bahan[0]?.id ?? '');
  const [untuk, setUntuk] = useState<string>('');
  const [habis, setHabis] = useState(false);
  const [qty, setQty] = useState('');
  const [perSize, setPerSize] = useState<Record<string, string>>({});
  const [catatan, setCatatan] = useState('');
  const [busy, setBusy] = useState(false);
  const [batalId, setBatalId] = useState<string | null>(null);
  const [alasan, setAlasan] = useState('');

  const bahan = useMemo(() => data.bahan.find(b => b.id === bahanId), [data.bahan, bahanId]);
  const qtyPakai = habis ? (bahan?.stok_aktual ?? 0) : parseFloat(qty) || 0;
  const sizeNum = useMemo(() => Object.fromEntries(
    UKURAN_POTONG.map(s => [s, Math.max(0, parseInt(perSize[s] ?? '', 10) || 0)]),
  ) as Record<string, number>, [perSize]);
  const totalPcs = Object.values(sizeNum).reduce((s, n) => s + n, 0);

  const biayaFifo = useMemo(() => {
    if (!bahan || qtyPakai <= 0) return 0;
    let sisa = qtyPakai, total = 0;
    for (const l of bahan.lot) {
      if (sisa <= 0) break;
      const ambil = Math.min(l.qty_sisa, sisa);
      total += ambil * l.harga_satuan;
      sisa -= ambil;
    }
    if (sisa > 0) total += sisa * bahan.harga_referensi;
    return total;
  }, [bahan, qtyPakai]);

  const simpan = async () => {
    if (!bahan) { toast.error('Pilih bahan'); return; }
    if (!untuk) { toast.error('Pilih variasi untuk model apa'); return; }
    if (qtyPakai <= 0) { toast.error(habis ? `Stok ${bahan.nama} kosong` : 'Isi jumlah bahan yang dipotong'); return; }
    if (qtyPakai > bahan.stok_aktual + 0.0005) { toast.error(`Stok ${bahan.nama} hanya ${fmt(bahan.stok_aktual)} ${bahan.satuan}`); return; }
    if (totalPcs <= 0) { toast.error('Isi jumlah pcs variasi per ukuran'); return; }
    setBusy(true);
    const res = await potongVariasi({
      bahan_item_id: bahan.id, qty: qtyPakai, habis_roll: habis, untuk_model: untuk,
      per_size: Object.fromEntries(Object.entries(sizeNum).filter(([, n]) => n > 0)), catatan,
    });
    setBusy(false);
    if (!res.success) { toast.error(res.error ?? 'Gagal menyimpan'); return; }
    toast.success(`${fmt(qtyPakai)} ${bahan.satuan} ${bahan.nama} → saldo Variasi ${rp(res.biaya_total ?? 0)}`);
    setQty(''); setPerSize({}); setCatatan(''); setHabis(false);
    onChanged();
  };

  const batal = async () => {
    if (!batalId) return;
    setBusy(true);
    const res = await batalPotongVariasi(batalId, alasan);
    setBusy(false);
    if (!res.success) { toast.error(res.error ?? 'Gagal membatalkan'); return; }
    toast.success('Potong variasi dibatalkan — stok bahan dikembalikan');
    setBatalId(null); setAlasan('');
    onChanged();
  };

  const inputCls = 'h-9 rounded-md border border-[#2A2D31] bg-[#0D0E10] px-3 text-sm text-[#e8eaed] focus:outline-none focus:ring-1 focus:ring-[#e5c17b]';
  const card = 'rounded-xl border border-[#2A2D31] bg-[#1A1D1F]';

  return (
    <div className="space-y-6">
      {/* Stok Drill */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {data.bahan.map(b => (
          <button key={b.id} type="button" onClick={() => setBahanId(b.id)}
            className={`${card} px-4 py-3 text-left transition-colors ${b.id === bahanId ? 'ring-1 ring-[#e5c17b]' : 'hover:bg-[#202326]'}`}>
            <div className="text-[10px] uppercase tracking-widest text-[#9aa0a6] font-bold">{b.nama}</div>
            <div className={`text-lg font-bold ${b.stok_aktual > 0 ? 'text-[#e8eaed]' : 'text-[#5f6368]'}`}>
              {fmt(b.stok_aktual)} <span className="text-xs text-[#9aa0a6] font-normal">{b.satuan}</span>
            </div>
          </button>
        ))}
      </div>

      {/* Form */}
      <div className={`${card} p-5 space-y-4`}>
        <div>
          <h3 className="text-sm font-bold text-[#e8eaed] flex items-center gap-2"><Scissors className="w-4 h-4 text-[#e5c17b]" /> Potong Variasi Mandiri</h3>
          <p className="text-xs text-[#9aa0a6] mt-0.5">
            Hanya untuk Drill yang dipotong khusus variasi. Variasi dari celah pola celana tidak perlu dicatat.
            Stok Drill berkurang dan nilainya masuk saldo bahan pembantu <b className="text-[#e8eaed]">Variasi</b> (tanpa Buku Kas).
          </p>
        </div>

        {data.bahan.length === 0 ? (
          <p className="text-sm text-orange-300">Belum ada bahan Drill di inventory.</p>
        ) : (
          <div className="grid md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs text-[#9aa0a6]">Bahan</label>
              <select value={bahanId} onChange={e => setBahanId(e.target.value)} className={`${inputCls} w-full`}>
                {data.bahan.map(b => <option key={b.id} value={b.id}>{b.nama} — stok {fmt(b.stok_aktual)} {b.satuan}</option>)}
              </select>
              {bahan && (
                <p className={`text-[11px] ${bahan.stok_aktual > 0 ? 'text-emerald-400' : 'text-orange-300'}`}>
                  Stok {bahan.nama}: <b>{fmt(bahan.stok_aktual)} {bahan.satuan}</b>
                  {bahan.stok_aktual <= 0 && ' — input belanja di Stok Masuk dulu'}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <label className="text-xs text-[#9aa0a6]">Variasi untuk</label>
              <div className="flex flex-wrap gap-2">
                {MODEL_VARIASI.map(m => (
                  <button key={m} type="button" onClick={() => setUntuk(m)}
                    className={`h-9 px-4 rounded-md border text-sm transition-colors ${untuk === m
                      ? 'border-[#e5c17b] bg-[#e5c17b]/15 text-[#e5c17b] font-semibold'
                      : 'border-[#2A2D31] text-[#e8eaed] hover:bg-[#202326]'}`}>
                    {m}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs text-[#9aa0a6]">Yang dipotong</label>
              <div className="flex items-center gap-4 h-9 text-sm">
                <label className="flex items-center gap-2 cursor-pointer text-[#e8eaed]">
                  <input type="radio" checked={!habis} onChange={() => setHabis(false)} className="accent-[#e5c17b]" />
                  Sebagian
                </label>
                <label className="flex items-center gap-2 cursor-pointer text-[#e8eaed]">
                  <input type="radio" checked={habis} onChange={() => setHabis(true)} className="accent-[#e5c17b]" />
                  Habiskan semua ({fmt(bahan?.stok_aktual ?? 0)} {bahan?.satuan})
                </label>
              </div>
            </div>

            {!habis && (
              <div className="space-y-1.5">
                <label className="text-xs text-[#9aa0a6]">Jumlah bahan dipotong ({bahan?.satuan})</label>
                <input type="number" min={0} step={0.01} value={qty} onChange={e => setQty(e.target.value)}
                  placeholder="mis. 5" className={`${inputCls} w-full`} />
              </div>
            )}

            <div className="space-y-1.5 md:col-span-2">
              <label className="text-xs text-[#9aa0a6]">Jadi berapa pcs variasi per ukuran</label>
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
              <p className="text-[11px] text-[#9aa0a6]">Total <b className="text-[#e8eaed]">{totalPcs.toLocaleString('id-ID')} pcs</b></p>
            </div>

            <div className="space-y-1.5 md:col-span-2">
              <label className="text-xs text-[#9aa0a6]">Catatan (opsional)</label>
              <input value={catatan} onChange={e => setCatatan(e.target.value)} placeholder="mis. untuk PO-0105"
                className={`${inputCls} w-full`} />
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-[#2A2D31]">
          <div className="text-xs text-[#9aa0a6] space-y-0.5">
            {qtyPakai > 0
              ? <p>Pakai <b className="text-[#e8eaed]">{fmt(qtyPakai)} {bahan?.satuan}</b> → masuk saldo Variasi <b className="text-[#e5c17b]">{rp(biayaFifo)}</b>
                  {totalPcs > 0 && <> · <b className="text-[#e5c17b]">{rp(biayaFifo / totalPcs)}/pcs</b>
                    <span> ({fmt(qtyPakai / totalPcs)} {bahan?.satuan}/pcs)</span></>}</p>
              : <p>Isi data untuk melihat perhitungan</p>}
            <p className="text-[11px] text-[#5f6368]">
              Hemat/boros variasi dinilai gabungan Zubair + Arslan di Keuangan › Saldo Bahan Pembantu › Variasi (HPP 0,10/baju adalah rata-rata keduanya).
            </p>
          </div>
          <button onClick={simpan} disabled={busy || data.bahan.length === 0}
            className="flex items-center gap-2 px-5 h-10 rounded-md bg-[#e5c17b] text-[#0D0E10] text-sm font-semibold hover:bg-[#d4b06a] disabled:opacity-30">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Scissors className="w-4 h-4" />} Simpan Potong Variasi
          </button>
        </div>
      </div>

      {/* Riwayat */}
      <div className={`${card} overflow-hidden`}>
        <div className="px-5 py-3 border-b border-[#2A2D31] text-sm font-bold text-[#e8eaed]">Riwayat Potong Variasi</div>
        <div className="overflow-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-[#16181A] text-[#9aa0a6] uppercase tracking-wider">
                <th className="text-left px-4 py-2">Tanggal</th>
                <th className="text-left px-4 py-2">Bahan</th>
                <th className="text-left px-4 py-2">Untuk</th>
                <th className="text-right px-4 py-2">Dipakai</th>
                <th className="text-left px-4 py-2">Per ukuran</th>
                <th className="text-right px-4 py-2">Nilai</th>
                <th className="text-left px-4 py-2">Catatan</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#2A2D31]">
              {data.riwayat.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-[#9aa0a6]">Belum ada data</td></tr>
              )}
              {data.riwayat.map(r => {
                const ps = r.per_size ?? {};
                const total = Object.values(ps).reduce((s, n) => s + Number(n), 0);
                return (
                  <tr key={r.id} className={r.dibatalkan_at ? 'opacity-40 line-through' : ''}>
                    <td className="px-4 py-2 text-[#e8eaed] whitespace-nowrap">{new Date(r.tanggal).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' })}</td>
                    <td className="px-4 py-2 text-[#e8eaed]">{r.bahan_nama}{r.habis_roll && <span className="ml-1 text-[10px] text-emerald-400">habis</span>}</td>
                    <td className="px-4 py-2 text-[#e8eaed]">{r.untuk_model ?? '-'}</td>
                    <td className="px-4 py-2 text-right text-[#e8eaed] whitespace-nowrap">{fmt(r.qty_pakai)} {r.satuan}</td>
                    <td className="px-4 py-2 text-[#9aa0a6]">
                      {total > 0
                        ? <>{UKURAN_POTONG.filter(s => ps[s]).map(s => `${s} ${ps[s]}`).join(' · ')} <b className="text-[#e8eaed]">({total} pcs · {fmt(r.qty_pakai / total)} {r.satuan}/pcs)</b></>
                        : '-'}
                    </td>
                    <td className="px-4 py-2 text-right text-[#e5c17b] font-bold">{rp(r.biaya_total)}</td>
                    <td className="px-4 py-2 text-[#9aa0a6]">{r.catatan ?? '-'}</td>
                    <td className="px-4 py-2 text-right">
                      {!r.dibatalkan_at && isOwner && (
                        <button onClick={() => { setBatalId(r.id); setAlasan(''); }}
                          className="inline-flex items-center gap-1 text-orange-400 hover:text-orange-300"><Undo2 className="w-3.5 h-3.5" /> Batal</button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {batalId && (
        <div className="fixed inset-0 bg-black/75 flex items-center justify-center z-50 p-4">
          <div className="bg-[#1A1D1F] border border-[#2A2D31] rounded-xl w-full max-w-md p-5 space-y-4">
            <h3 className="text-base font-bold text-[#e8eaed]">Batalkan Potong Variasi?</h3>
            <p className="text-xs text-[#9aa0a6]">Bahan dikembalikan ke stok, dan nilainya keluar dari saldo Variasi.</p>
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
