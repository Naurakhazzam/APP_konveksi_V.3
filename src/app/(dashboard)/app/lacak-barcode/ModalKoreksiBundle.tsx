'use client';

import React, { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, X, Scissors, Undo2, PencilLine, AlertTriangle, ListChecks } from 'lucide-react';
import {
  bukaKembaliCutting,
  kembalikanTahapBundle,
  koreksiQtyTahap,
  koreksiQtyBerantai,
  type LacakBarcodeResult,
  type TahapKoreksi,
  type TahapBundle,
} from '@/lib/actions/produksi/lacak-barcode.actions';

type Mode = 'buka_cutting' | 'berantai' | 'kembalikan' | 'qty';

interface Props {
  data: LacakBarcodeResult;
  onClose: () => void;
  onSuccess: () => void | Promise<void>;
}

const inputCls = 'w-full bg-[#0D0E10] border border-[#2A2D31] rounded-xl px-3 py-2.5 text-sm text-[#e8eaed] focus:border-[#e5c17b] outline-none';
const labelCls = 'block text-[11px] font-bold text-[#9aa0a6] uppercase tracking-wider mb-1.5';

export default function ModalKoreksiBundle({ data, onClose, onSuccess }: Props) {
  const tahapList = data.tahap_detail;
  const terkirim = data.pengiriman.length > 0;
  const totalKirim = data.pengiriman.reduce((s, p) => s + p.qty_kirim, 0);
  const bisaBukaCutting = data.sisa_cutting_ditutup > 0;
  const bisaBerantai = data.qty_cutting != null && !data.punya_split;

  // ── Kembalikan ke tahap ──
  // Tujuan yang masuk akal: ada yang bisa dibatalkan setelahnya (tahap
  // sesudahnya / status selesai / sudah terkirim). Cutting = kembali antre
  // di Antrian Jahit.
  const opsiKembali: { tahap: TahapBundle; label: string; qty: number | null }[] = [
    ...(tahapList.length > 0
      ? [{ tahap: 'cutting' as const, label: 'Cutting (kembali ke Antrian Jahit)', qty: data.qty_cutting }]
      : []),
    ...tahapList
      .filter((t, i) => i < tahapList.length - 1 || t.status === 'selesai' || terkirim)
      .map(t => ({ tahap: t.tahap as TahapBundle, label: t.label, qty: t.qty_terima })),
  ];

  // ── Samakan qty berantai ──
  const opsiMulai: { tahap: TahapBundle; label: string; qty: number | null }[] = [
    ...(data.qty_cutting != null ? [{ tahap: 'cutting' as const, label: 'Cutting', qty: data.qty_cutting }] : []),
    ...tahapList.map(t => ({ tahap: t.tahap as TahapBundle, label: t.label, qty: t.qty_selesai ?? t.qty_terima })),
  ];

  const [mode, setMode] = useState<Mode>(
    bisaBukaCutting ? 'buka_cutting' : bisaBerantai ? 'berantai' : opsiKembali.length > 0 ? 'kembalikan' : 'qty');
  const [alasan, setAlasan] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [tahapTujuan, setTahapTujuan] = useState<TahapBundle | ''>(
    opsiKembali.find(t => t.tahap === 'jahit')?.tahap ?? opsiKembali[0]?.tahap ?? '');

  const dampakKembali = useMemo(() => {
    if (!tahapTujuan) return null;
    if (tahapTujuan === 'cutting') return { tujuanLabel: 'Antrian Jahit', tujuanQty: data.qty_cutting, dihapus: tahapList };
    const idx = tahapList.findIndex(t => t.tahap === tahapTujuan);
    if (idx < 0) return null;
    return { tujuanLabel: tahapList[idx].label, tujuanQty: tahapList[idx].qty_terima, dihapus: tahapList.slice(idx + 1) };
  }, [tahapList, tahapTujuan, data.qty_cutting]);

  const [tahapMulai, setTahapMulai] = useState<TahapBundle | ''>(opsiMulai[0]?.tahap ?? '');
  const [qtyBerantai, setQtyBerantai] = useState<number>(opsiMulai[0]?.qty ?? 1);

  const pilihTahapMulai = (t: TahapBundle) => {
    setTahapMulai(t);
    setQtyBerantai(opsiMulai.find(o => o.tahap === t)?.qty ?? 1);
  };

  // Pratinjau: baris mana saja yang berubah jadi qtyBerantai.
  const pratinjauBerantai = useMemo(() => {
    const idxMulai = opsiMulai.findIndex(o => o.tahap === tahapMulai);
    if (idxMulai < 0) return [];
    const baris: { label: string; lama: string; ubah: boolean }[] = [];
    for (const o of opsiMulai.slice(idxMulai)) {
      if (o.tahap === 'cutting') {
        baris.push({ label: 'Cutting', lama: `${data.qty_cutting}`, ubah: data.qty_cutting !== qtyBerantai });
      } else {
        const t = tahapList.find(x => x.tahap === o.tahap)!;
        const lama = t.status === 'selesai' ? `${t.qty_terima} / ${t.qty_selesai}` : `${t.qty_terima}`;
        const ubah = t.qty_terima !== qtyBerantai || (t.status === 'selesai' && t.qty_selesai !== qtyBerantai);
        baris.push({ label: t.label, lama, ubah });
      }
    }
    if (terkirim && totalKirim > qtyBerantai && tahapList.some(t => t.tahap === 'packing')) {
      baris.push({ label: `Dikirim (${data.pengiriman.map(p => p.nomor_sj).join(', ')})`, lama: `${totalKirim}`, ubah: true });
    }
    return baris;
  }, [opsiMulai, tahapMulai, qtyBerantai, tahapList, data.qty_cutting, data.pengiriman, terkirim, totalKirim]);

  const sisaPartial = tahapMulai === 'cutting' && qtyBerantai < data.qty_rencana && data.sisa_cutting_ditutup === 0
    && data.qty_cutting !== qtyBerantai;

  // ── Betulkan qty satu tahap ──
  const [tahapQty, setTahapQty] = useState<TahapKoreksi | ''>(tahapList[tahapList.length - 1]?.tahap ?? '');
  const infoQty = tahapList.find(t => t.tahap === tahapQty);
  const [qtyTerima, setQtyTerima] = useState<number>(infoQty?.qty_terima ?? 0);
  const [qtySelesai, setQtySelesai] = useState<number>(infoQty?.qty_selesai ?? 0);

  const pilihTahapQty = (t: TahapKoreksi) => {
    setTahapQty(t);
    const info = tahapList.find(x => x.tahap === t);
    setQtyTerima(info?.qty_terima ?? 0);
    setQtySelesai(info?.qty_selesai ?? 0);
  };

  const jahitTerimaTerkunci = infoQty?.tahap === 'jahit' && infoQty.status === 'selesai';
  const selesaiBisaDiubah = infoQty?.status === 'selesai';

  const handleSubmit = async () => {
    if (!alasan.trim()) {
      toast.error('Alasan wajib diisi');
      return;
    }
    setSubmitting(true);
    try {
      if (mode === 'buka_cutting') {
        const r = await bukaKembaliCutting(data.bundle_id, alasan.trim());
        toast.success(`Cutting dibuka kembali — sisa ${r.sisa} pcs muncul lagi di Pending Cutting`);
      } else if (mode === 'berantai') {
        if (!tahapMulai) return;
        const r = await koreksiQtyBerantai({
          bundle_id: data.bundle_id, tahap_mulai: tahapMulai, qty: qtyBerantai, alasan: alasan.trim(),
        });
        const sj = r.surat_jalan.map(s => `${s.nomor_sj} ${s.qty_lama}→${s.qty_baru}`).join(', ');
        toast.success(`${r.jumlah_tahap} tahap disamakan jadi ${qtyBerantai} pcs${sj ? ` · ${sj}` : ''}`);
      } else if (mode === 'kembalikan') {
        if (!tahapTujuan) return;
        const r = await kembalikanTahapBundle(data.bundle_id, tahapTujuan, alasan.trim());
        const sj = r.surat_jalan.map(s => s.nomor_sj + (s.sj_dihapus ? ' (dihapus)' : '')).join(', ');
        toast.success(`Bundle dikembalikan ke ${dampakKembali?.tujuanLabel}${sj ? ` · ditarik dari ${sj}` : ''}`);
      } else {
        if (!tahapQty || !infoQty) return;
        await koreksiQtyTahap({
          bundle_id: data.bundle_id,
          tahap: tahapQty,
          qty_terima: qtyTerima,
          qty_selesai: selesaiBisaDiubah ? qtySelesai : null,
          alasan: alasan.trim(),
          penjahit_id: data.penjahit_id,
          qty_terima_lama: infoQty.qty_terima,
        });
        toast.success(`Qty ${infoQty.label} dibetulkan`);
      }
      await onSuccess();
    } catch (err: any) {
      toast.error(err.message || 'Gagal menyimpan koreksi');
    } finally {
      setSubmitting(false);
    }
  };

  const tabs: { key: Mode; label: string; icon: React.ReactNode; show: boolean }[] = [
    { key: 'buka_cutting', label: 'Buka Kembali Cutting', icon: <Scissors className="w-3.5 h-3.5" />, show: bisaBukaCutting },
    { key: 'berantai', label: 'Samakan Qty', icon: <ListChecks className="w-3.5 h-3.5" />, show: data.qty_cutting != null },
    { key: 'kembalikan', label: 'Kembalikan ke Tahap', icon: <Undo2 className="w-3.5 h-3.5" />, show: opsiKembali.length > 0 },
    { key: 'qty', label: 'Betulkan Qty 1 Tahap', icon: <PencilLine className="w-3.5 h-3.5" />, show: tahapList.length > 0 },
  ];

  const bisaSubmit =
    !!alasan.trim() && !submitting &&
    (mode === 'buka_cutting' ||
     (mode === 'berantai' && bisaBerantai && !!tahapMulai && qtyBerantai >= 1 && pratinjauBerantai.some(b => b.ubah)) ||
     (mode === 'kembalikan' && !!tahapTujuan) ||
     (mode === 'qty' && !!infoQty && !terkirim && qtyTerima >= 1 && (!selesaiBisaDiubah || (qtySelesai >= 1 && qtySelesai <= qtyTerima))));

  return (
    <div className="fixed inset-0 bg-black/75 flex items-center justify-center z-50 p-4">
      <div className="bg-[#1A1D1F] border border-[#2A2D31] rounded-2xl w-full max-w-lg shadow-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#2A2D31]">
          <div>
            <h3 className="text-base font-bold text-[#e8eaed]">Koreksi Bundle</h3>
            <p className="text-xs text-[#e5c17b] font-mono">{data.barcode}</p>
          </div>
          <button onClick={onClose} className="text-[#9aa0a6] hover:text-[#e8eaed]" aria-label="Tutup">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 pt-4 flex flex-wrap gap-2">
          {tabs.filter(t => t.show).map(t => (
            <button
              key={t.key}
              onClick={() => setMode(t.key)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors ${
                mode === t.key
                  ? 'bg-[#e5c17b]/10 border-[#e5c17b]/40 text-[#e5c17b]'
                  : 'border-[#2A2D31] text-[#9aa0a6] hover:text-[#e8eaed]'
              }`}
            >
              {t.icon}{t.label}
            </button>
          ))}
        </div>

        <div className="px-6 py-4 space-y-4 overflow-y-auto">
          {mode === 'buka_cutting' && (
            <div className="bg-[#0D0E10] border border-[#2A2D31] rounded-xl px-4 py-3 text-sm text-[#e8eaed] leading-relaxed">
              Sisa <span className="font-bold text-orange-400">{data.sisa_cutting_ditutup} pcs</span> yang dulu ditutup
              akan muncul lagi di <b>Antrian Cutting → Pending</b>. Dari sana pakai <b>Lanjut Cutting</b> untuk
              mencatat potongannya. Hasilnya jadi bundle susulan baru yang masuk Antrian Jahit sendiri.
              Bundle ini sendiri tidak berubah{terkirim ? ' dan tetap tercatat terkirim' : ''}.
            </div>
          )}

          {mode === 'berantai' && (
            !bisaBerantai ? (
              <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl px-4 py-3 text-xs text-amber-200">
                Bundle ini pernah di-Split, jadi qty-nya terbagi ke bundle pecahan. Betulkan per tahap saja.
              </div>
            ) : (
              <>
                <p className="text-xs text-[#9aa0a6] leading-relaxed">
                  Untuk qty yang salah sejak awal lalu terbawa ke semua tahap, misalnya tercatat 10 sampai kirim padahal
                  nyatanya 5. Qty di tahap yang dipilih <b>dan semua tahap sesudahnya</b> disamakan, tanpa scan ulang.
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={labelCls}>Mulai dari tahap</label>
                    <select value={tahapMulai} onChange={(e) => pilihTahapMulai(e.target.value as TahapBundle)} className={inputCls}>
                      {opsiMulai.map(o => <option key={o.tahap} value={o.tahap}>{o.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className={labelCls}>Qty yang benar</label>
                    <input
                      type="number" min={1} value={qtyBerantai}
                      onChange={(e) => setQtyBerantai(Number(e.target.value))}
                      className={`${inputCls} text-center text-lg font-bold py-2`}
                    />
                  </div>
                </div>

                <div className="rounded-xl border border-[#2A2D31] overflow-hidden">
                  {pratinjauBerantai.map((b, i) => (
                    <div key={i} className={`flex items-center justify-between px-4 py-2 text-xs ${i > 0 ? 'border-t border-[#2A2D31]' : ''} ${b.ubah ? 'bg-amber-500/5' : 'bg-[#0D0E10]'}`}>
                      <span className="text-[#e8eaed]">{b.label}</span>
                      <span className={b.ubah ? 'text-amber-300 font-bold' : 'text-[#5f6368]'}>
                        {b.ubah ? `${b.lama} → ${qtyBerantai}` : 'tetap'}
                      </span>
                    </div>
                  ))}
                </div>

                <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl px-4 py-3 text-xs text-[#e8eaed] space-y-1.5">
                  <div className="flex items-center gap-1.5 font-bold text-amber-300">
                    <AlertTriangle className="w-3.5 h-3.5" /> Ikut disesuaikan
                  </div>
                  <div>• Upah tiap tahap dihitung ulang sesuai qty baru, termasuk yang tercatat lunas.</div>
                  <div>• Aksesori jahit dan lubang kancing dikembalikan ke stok atau dipotong lagi sesuai selisihnya.</div>
                  {terkirim && <div>• Qty di surat jalan dan total invoice ikut dibetulkan (SJ yang jadi kosong dihapus).</div>}
                  {sisaPartial && (
                    <div>• Cutting jadi <b>partial</b>: sisa {data.qty_rencana - qtyBerantai} pcs dari rencana muncul di Pending Cutting. Lanjutkan atau Tutup (dengan alasan) di sana.</div>
                  )}
                </div>
              </>
            )
          )}

          {mode === 'kembalikan' && (
            <>
              <div>
                <label className={labelCls}>Kembalikan ke tahap</label>
                <select value={tahapTujuan} onChange={(e) => setTahapTujuan(e.target.value as TahapBundle)} className={inputCls}>
                  {opsiKembali.map(t => <option key={t.tahap} value={t.tahap}>{t.label}</option>)}
                </select>
              </div>

              {dampakKembali && (
                <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl px-4 py-3 text-xs text-[#e8eaed] space-y-1.5">
                  <div className="flex items-center gap-1.5 font-bold text-amber-300">
                    <AlertTriangle className="w-3.5 h-3.5" /> Yang akan terjadi
                  </div>
                  {tahapTujuan === 'cutting' ? (
                    <div>• Bundle kembali antre di <b>Antrian Jahit</b> ({dampakKembali.tujuanQty ?? '-'} pcs hasil cutting), belum diserahterimakan ke penjahit.</div>
                  ) : (
                    <div>• Bundle berada di <b>{dampakKembali.tujuanLabel}</b> sebagai <i>sedang dikerjakan</i> ({dampakKembali.tujuanQty ?? '-'} pcs){tahapTujuan === 'jahit' && data.penjahit_nama ? `, tetap di ${data.penjahit_nama}` : ''}.</div>
                  )}
                  {dampakKembali.dihapus.length > 0 && (
                    <div>• Tahap dibatalkan: {dampakKembali.dihapus.map(t => t.label).join(', ')}. Scan tahap itu harus diulang.</div>
                  )}
                  {terkirim && (
                    <div>• Ditarik dari surat jalan: {data.pengiriman.map(p => `${p.nomor_sj} (${p.qty_kirim} pcs)`).join(', ')}. Invoice dihitung ulang; SJ yang jadi kosong ikut dihapus.</div>
                  )}
                  <div>• Upah tahap yang dibatalkan ikut dibatalkan di sistem (termasuk yang tercatat lunas), lalu terbentuk lagi saat tahapnya dikerjakan ulang.</div>
                  <div>• Aksesori tahap yang dibatalkan dikembalikan ke stok.</div>
                </div>
              )}
            </>
          )}

          {mode === 'qty' && (
            <>
              {terkirim ? (
                <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl px-4 py-3 text-xs text-amber-200">
                  Bundle ini sudah terkirim. Pakai <b>Samakan Qty</b> (surat jalan ikut dibetulkan) atau <b>Kembalikan ke Tahap</b>.
                </div>
              ) : (
                <>
                  <div>
                    <label className={labelCls}>Tahap</label>
                    <select value={tahapQty} onChange={(e) => pilihTahapQty(e.target.value as TahapKoreksi)} className={inputCls}>
                      {tahapList.map(t => (
                        <option key={t.tahap} value={t.tahap}>
                          {t.label} — terima {t.qty_terima ?? '-'}{t.status === 'selesai' ? ` / selesai ${t.qty_selesai ?? '-'}` : ' (sedang dikerjakan)'}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className={labelCls}>Qty terima</label>
                      <input
                        type="number" min={1} value={qtyTerima}
                        disabled={jahitTerimaTerkunci}
                        onChange={(e) => setQtyTerima(Number(e.target.value))}
                        className={`${inputCls} text-center text-lg font-bold py-2 disabled:opacity-40`}
                      />
                    </div>
                    <div>
                      <label className={labelCls}>Qty selesai</label>
                      <input
                        type="number" min={1} value={selesaiBisaDiubah ? qtySelesai : ''}
                        disabled={!selesaiBisaDiubah}
                        placeholder="belum selesai"
                        onChange={(e) => setQtySelesai(Number(e.target.value))}
                        className={`${inputCls} text-center text-lg font-bold py-2 placeholder:text-xs placeholder:font-normal placeholder:text-[#5f6368] disabled:opacity-40`}
                      />
                    </div>
                  </div>
                  {jahitTerimaTerkunci && (
                    <p className="text-[11px] text-[#9aa0a6]">
                      Qty terima Jahit hanya bisa diubah saat Jahit masih dikerjakan. Pakai Samakan Qty kalau perlu.
                    </p>
                  )}
                  <p className="text-[11px] text-[#9aa0a6]">
                    Tidak boleh melebihi hasil tahap sebelumnya, dan tidak boleh lebih kecil dari yang sudah diterima tahap sesudahnya.
                    Upah tahap ini ikut disesuaikan.
                  </p>
                </>
              )}
            </>
          )}

          <div>
            <label className={labelCls}>
              Alasan <span className="text-red-400">*</span>
            </label>
            <textarea
              value={alasan}
              onChange={(e) => setAlasan(e.target.value)}
              rows={2}
              placeholder="Misal: salah input, nyatanya cuma dipotong 5 pcs..."
              className={`${inputCls} py-2 placeholder:text-[#5f6368] resize-none`}
            />
            <p className="text-[11px] text-[#5f6368] mt-1">Tercatat di Riwayat Lengkap bundle ini.</p>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-[#2A2D31]">
          <button
            onClick={onClose}
            className="px-4 h-10 rounded-xl border border-[#2A2D31] text-[#e8eaed] text-sm hover:bg-[#2A2D31] transition-colors"
          >
            Batal
          </button>
          <button
            onClick={handleSubmit}
            disabled={!bisaSubmit}
            className="flex items-center gap-2 px-5 h-10 rounded-xl bg-[#e5c17b] hover:bg-[#d4b16a] disabled:opacity-40 disabled:cursor-not-allowed text-[#0D0E10] text-sm font-black transition-colors"
          >
            {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
            Simpan Koreksi
          </button>
        </div>
      </div>
    </div>
  );
}
