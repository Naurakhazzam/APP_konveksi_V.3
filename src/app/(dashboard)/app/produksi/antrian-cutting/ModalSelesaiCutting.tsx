'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { X, CheckCircle2, AlertTriangle, Loader2, Plus, Trash2, ArrowUp, ArrowDown } from 'lucide-react';
import { toast } from 'sonner';
import {
  getInventoryItemsForCutting,
  getKaryawanCutting,
  type InventoryItemOption,
  type KaryawanOption,
} from '@/lib/actions/produksi/cutting.actions';
import {
  getBundlesForSelesai,
  getBahanDefaults,
  getPatokanArtikel,
  selesaiCuttingV2,
  type BundleSelesai,
  type SelesaiResult,
  type PatokanArtikel,
} from '@/lib/actions/produksi/cutting-v2.actions';
import {
  isBahanUtama, statusPemakaian, persenSelisih, STATUS_LABEL, STATUS_CLASS,
} from '@/lib/produksi/patokan-bahan';

interface BahanRow {
  rowId: string;
  inventory_item_id: string;
  rate_per_pcs: number;
  /** Label asal isian otomatis — hilang begitu diubah manual */
  sumber: string | null;
}

interface Props {
  selectedBundleIds: string[];
  onSuccess: () => void;
  onClose: () => void;
}

const uid = () => crypto.randomUUID();

export default function ModalSelesaiCutting({ selectedBundleIds, onSuccess, onClose }: Props) {
  const [bundles, setBundles] = useState<BundleSelesai[]>([]);
  const [inventory, setInventory] = useState<InventoryItemOption[]>([]);
  const [karyawanList, setKaryawanList] = useState<KaryawanOption[]>([]);
  const [karyawanId, setKaryawanId] = useState('');
  const [hasil, setHasil] = useState<Record<string, number>>({});
  const [bahan, setBahan] = useState<Record<string, BahanRow[]>>({});
  const [patokan, setPatokan] = useState<Record<string, PatokanArtikel>>({});
  const [kurangiSisa, setKurangiSisa] = useState(true);
  const [konfirmLebih, setKonfirmLebih] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [stokWarnings, setStokWarnings] = useState<SelesaiResult['stok_warnings']>([]);

  // ─── Muat data + isi bahan otomatis ──────────────────────────────────────
  useEffect(() => {
    let batal = false;
    (async () => {
      try {
        const [b, inv, kar] = await Promise.all([
          getBundlesForSelesai(selectedBundleIds),
          getInventoryItemsForCutting(),
          getKaryawanCutting(),
        ]);
        const poItemIds = [...new Set(b.map(x => x.po_item_id))];
        const [defaults, pat] = await Promise.all([getBahanDefaults(poItemIds), getPatokanArtikel(poItemIds)]);
        if (batal) return;
        setPatokan(pat);

        setBundles(b);
        setInventory(inv);
        setKaryawanList(kar);
        const operator = kar.filter(k => /cutting|potong/i.test(k.jabatan));
        if (operator.length === 1) setKaryawanId(operator[0].id);
        setHasil(Object.fromEntries(b.map(x => [x.id, x.qty_rencana])));

        const init: Record<string, BahanRow[]> = {};
        for (const poItemId of new Set(b.map(x => x.po_item_id))) {
          const d = defaults[poItemId] ?? [];
          init[poItemId] = d.length
            ? d.map(x => ({
                rowId: uid(),
                inventory_item_id: x.inventory_item_id,
                rate_per_pcs: x.rate_per_pcs ?? 0,
                sumber: [
                  x.sumber_bahan === 'riwayat' ? 'bahan: riwayat' : 'bahan: kategori+warna',
                  x.sumber_rate === 'standar' ? 'pemakaian: patokan HPP' : null,
                ].filter(Boolean).join(' · '),
              }))
            : [{ rowId: uid(), inventory_item_id: '', rate_per_pcs: 0, sumber: null }];
        }
        setBahan(init);
      } catch (e) {
        if (!batal) toast.error('Gagal memuat data: ' + (e instanceof Error ? e.message : String(e)));
      } finally {
        if (!batal) setIsLoading(false);
      }
    })();
    return () => { batal = true; };
  }, [selectedBundleIds]);

  // ─── Turunan ─────────────────────────────────────────────────────────────
  const artikel = useMemo(() => {
    const map = new Map<string, { po_item_id: string; nama: string; bundles: BundleSelesai[] }>();
    for (const b of bundles) {
      if (!map.has(b.po_item_id)) map.set(b.po_item_id, { po_item_id: b.po_item_id, nama: b.produk_nama, bundles: [] });
      map.get(b.po_item_id)!.bundles.push(b);
    }
    return [...map.values()];
  }, [bundles]);

  const qtyOf = (b: BundleSelesai) => hasil[b.id] ?? b.qty_rencana;
  const qtyArtikel = (poItemId: string) =>
    bundles.filter(b => b.po_item_id === poItemId).reduce((s, b) => s + (qtyOf(b) || 0), 0);

  const adaLebih   = bundles.some(b => qtyOf(b) > b.qty_rencana);
  const totalHasil = bundles.reduce((s, b) => s + (qtyOf(b) || 0), 0);
  const totalKurang = bundles.reduce((s, b) => s + Math.max(b.qty_rencana - (qtyOf(b) || 0), 0), 0);

  const ringkasanBahan = useMemo(() => {
    const m: Record<string, { nama: string; satuan: string; total: number }> = {};
    for (const a of artikel) {
      const q = qtyArtikel(a.po_item_id);
      for (const r of bahan[a.po_item_id] ?? []) {
        const item = inventory.find(i => i.id === r.inventory_item_id);
        if (!item || r.rate_per_pcs <= 0) continue;
        m[item.id] ??= { nama: item.nama, satuan: item.satuan, total: 0 };
        m[item.id].total += r.rate_per_pcs * q;
      }
    }
    return Object.values(m);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [artikel, bahan, hasil, inventory]);

  // ─── Handler bahan ───────────────────────────────────────────────────────
  const ubahBahan = (poItemId: string, rowId: string, patch: Partial<BahanRow>) =>
    setBahan(p => ({
      ...p,
      [poItemId]: (p[poItemId] ?? []).map(r => r.rowId === rowId ? { ...r, ...patch, sumber: null } : r),
    }));
  const tambahBahan = (poItemId: string) =>
    setBahan(p => ({ ...p, [poItemId]: [...(p[poItemId] ?? []), { rowId: uid(), inventory_item_id: '', rate_per_pcs: 0, sumber: null }] }));
  const hapusBahan = (poItemId: string, rowId: string) =>
    setBahan(p => ({ ...p, [poItemId]: (p[poItemId] ?? []).filter(r => r.rowId !== rowId) }));

  // ─── Validasi & simpan ───────────────────────────────────────────────────
  const validasi = (): string | null => {
    for (const b of bundles) {
      const q = qtyOf(b);
      if (!Number.isInteger(q) || q < 0) return `Hasil bundle ${b.barcode} tidak valid`;
    }
    for (const a of artikel) {
      if (qtyArtikel(a.po_item_id) === 0) continue;
      const rows = (bahan[a.po_item_id] ?? []).filter(r => r.inventory_item_id);
      if (!rows.length) return `${a.nama}: pilih minimal 1 bahan`;
      for (const r of rows) {
        const item = inventory.find(i => i.id === r.inventory_item_id);
        if (!(r.rate_per_pcs > 0)) return `${a.nama}: isi pemakaian per pcs untuk ${item?.nama ?? 'bahan'}`;
        if (r.rate_per_pcs > 3) return `${a.nama}: pemakaian ${item?.nama} ${r.rate_per_pcs} ${item?.satuan}/pcs melebihi batas 3 — periksa lagi`;
      }
    }
    if (adaLebih && !konfirmLebih) return 'Centang konfirmasi hasil lebih dulu';
    return null;
  };

  const simpan = async () => {
    const err = validasi();
    if (err) { toast.error(err); return; }
    setIsSubmitting(true);
    setStokWarnings([]);

    const pemakaian = artikel.flatMap(a =>
      (bahan[a.po_item_id] ?? [])
        .filter(r => r.inventory_item_id && r.rate_per_pcs > 0)
        .map(r => ({ po_item_id: a.po_item_id, inventory_item_id: r.inventory_item_id, rate_per_pcs: r.rate_per_pcs })));

    const res = await selesaiCuttingV2(
      bundles.map(b => ({ bundle_id: b.id, qty_aktual: qtyOf(b) })),
      pemakaian, kurangiSisa, karyawanId || null);
    setIsSubmitting(false);

    if (!res.success) { toast.error(res.error ?? 'Gagal menyimpan'); return; }

    const bagian = [`${res.total_qty} pcs selesai dipotong`];
    if (res.sisa.length) bagian.push(`${res.sisa.reduce((s, x) => s + x.qty, 0)} pcs kekurangan kembali ke Menunggu`);
    if (res.kembali_antri) bagian.push(`${res.kembali_antri} bundle dikembalikan ke Menunggu`);
    if (res.lebih.length) bagian.push(`lebih ${res.lebih.reduce((s, x) => s + x.lebih, 0)} pcs`);
    if (res.total_upah > 0) bagian.push(`upah Rp${res.total_upah.toLocaleString('id-ID')}`);
    toast.success(bagian.join(' · '));
    if (res.stok_warnings.length) {
      setStokWarnings(res.stok_warnings);
      toast.warning(`${res.stok_warnings.length} bahan stoknya kurang — tetap dicatat`);
    }
    onSuccess();
  };

  // ─── Render ──────────────────────────────────────────────────────────────
  const inputCls = 'h-8 rounded-md border border-[#2A2D31] bg-[#0D0E10] px-2 text-sm text-[#e8eaed] focus:outline-none focus:ring-1 focus:ring-[#e5c17b]';
  const h3 = 'text-[10px] uppercase tracking-widest text-[#9aa0a6] font-bold mb-3';

  return (
    <div className="fixed inset-0 bg-black/75 flex items-center justify-center z-50 p-4 print:hidden">
      <div className="bg-[#1A1D1F] border border-[#2A2D31] rounded-xl w-full max-w-3xl max-h-[90vh] flex flex-col shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#2A2D31]">
          <div>
            <h2 className="text-base font-bold text-[#e8eaed]">Selesai Cutting</h2>
            <p className="text-xs text-[#9aa0a6] mt-0.5">{selectedBundleIds.length} bundle dipilih</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg text-[#9aa0a6] hover:text-[#e8eaed] hover:bg-[#2A2D31]">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-20 gap-3 text-[#9aa0a6]">
              <Loader2 className="w-8 h-8 animate-spin text-[#e5c17b]" />
              <span className="text-sm">Memuat data & menyiapkan bahan...</span>
            </div>
          ) : (
            <>
              {/* Tukang potong */}
              <section>
                <h3 className={h3}>Tukang Potong</h3>
                <select value={karyawanId} onChange={e => setKaryawanId(e.target.value)}
                  className="w-full sm:w-72 bg-[#16181A] border border-[#2A2D31] rounded-lg px-3 py-2 text-sm text-[#e8eaed] outline-none focus:border-[#e5c17b]">
                  <option value="">— Pilih tukang potong —</option>
                  {karyawanList.map(k => <option key={k.id} value={k.id}>{k.nama}{k.jabatan !== '-' ? ` · ${k.jabatan}` : ''}</option>)}
                </select>
                <p className="text-[10px] text-[#9aa0a6] mt-2">
                  {karyawanId ? 'Upah cutting otomatis terhitung dari tarif HPP.' : 'Tanpa tukang potong, upah cutting tidak terbentuk.'}
                </p>
              </section>

              {/* A. Hasil per bundle */}
              <section>
                <h3 className={h3}>A — Hasil Potong per Bundle</h3>
                <div className="rounded-lg border border-[#2A2D31] overflow-hidden">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-[#16181A] border-b border-[#2A2D31] text-[#9aa0a6] uppercase tracking-wider">
                        <th className="text-left px-3 py-2 font-bold">Barcode</th>
                        <th className="text-left px-3 py-2 font-bold">Artikel</th>
                        <th className="text-center px-3 py-2 font-bold">Dimulai</th>
                        <th className="text-center px-3 py-2 font-bold">Hasil</th>
                        <th className="text-left px-3 py-2 font-bold">Keterangan</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#2A2D31]">
                      {bundles.map(b => {
                        const q = qtyOf(b);
                        const selisih = (q || 0) - b.qty_rencana;
                        return (
                          <tr key={b.id}>
                            <td className="px-3 py-2 font-mono text-[#e5c17b]">{b.barcode}</td>
                            <td className="px-3 py-2 text-[#e8eaed]">{b.produk_nama}</td>
                            <td className="px-3 py-2 text-center text-[#9aa0a6]">{b.qty_rencana}</td>
                            <td className="px-3 py-2 text-center">
                              <input type="number" min={0} step={1}
                                value={Number.isNaN(q) ? '' : q}
                                onChange={e => setHasil(p => ({ ...p, [b.id]: parseInt(e.target.value, 10) }))}
                                className={`${inputCls} w-20 text-center`} />
                            </td>
                            <td className="px-3 py-2">
                              {q === 0
                                ? <span className="text-[#9aa0a6]">Kembali ke Menunggu</span>
                                : selisih > 0
                                ? <span className="flex items-center gap-1 text-sky-400 font-bold"><ArrowUp className="w-3 h-3" />+{selisih} lebih</span>
                                : selisih < 0
                                ? <span className="flex items-center gap-1 text-orange-400 font-bold"><ArrowDown className="w-3 h-3" />{-selisih} kembali ke Menunggu</span>
                                : <span className="text-green-400 font-bold">Sesuai</span>}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {adaLebih && (
                  <div className="mt-3 rounded-lg border border-sky-500/30 bg-sky-500/5 p-3 space-y-2 text-xs">
                    <label className="flex items-start gap-2 text-[#e8eaed] cursor-pointer">
                      <input type="checkbox" checked={kurangiSisa} onChange={e => setKurangiSisa(e.target.checked)} className="accent-[#e5c17b] mt-0.5" />
                      <span>Kurangi bundle sisa artikel yang sama di Menunggu sebanyak kelebihannya
                        <span className="block text-[10px] text-[#9aa0a6]">Kalau tidak ada sisa, kelebihan dicatat sebagai lebih dari order.</span></span>
                    </label>
                    <label className="flex items-start gap-2 text-sky-300 font-semibold cursor-pointer">
                      <input type="checkbox" checked={konfirmLebih} onChange={e => setKonfirmLebih(e.target.checked)} className="accent-sky-400 mt-0.5" />
                      Saya pastikan hasil lebih ini benar (bukan salah ketik)
                    </label>
                  </div>
                )}
              </section>

              {/* B. Bahan per artikel */}
              <section>
                <h3 className={h3}>B — Pemakaian Bahan per Artikel</h3>
                <div className="space-y-3">
                  {artikel.map(a => {
                    const q = qtyArtikel(a.po_item_id);
                    const rows = bahan[a.po_item_id] ?? [];
                    const pat = patokan[a.po_item_id];
                    // Patokan = total bahan utama per pcs (2 warna dijumlah)
                    const totalUtama = rows
                      .filter(r => r.inventory_item_id && isBahanUtama(inventory.find(i => i.id === r.inventory_item_id)?.nama ?? '', pat?.jenis_bahan))
                      .reduce((sum, r) => sum + (r.rate_per_pcs || 0), 0);
                    const st = totalUtama > 0 ? statusPemakaian(totalUtama, pat?.patokan) : null;
                    return (
                      <div key={a.po_item_id} className="rounded-lg border border-[#2A2D31] overflow-hidden">
                        <div className="px-4 py-2.5 bg-[#16181A] border-b border-[#2A2D31] text-sm flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="font-bold text-[#e8eaed]">{a.nama}</span>
                          <span className="text-[10px] text-[#9aa0a6]">{a.bundles.length} bundle · hasil <b className="text-[#e5c17b]">{q}</b> pcs</span>
                          <span className="ml-auto flex items-center gap-2 text-[10px]">
                            <span className="text-[#9aa0a6]">
                              Patokan HPP{' '}
                              <b className="text-[#e8eaed]">{pat?.patokan != null ? pat.patokan.toFixed(2) : '—'}</b>
                              {totalUtama > 0 && <> · dipakai <b className="text-[#e8eaed]">{Number(totalUtama.toFixed(3))}</b></>}
                            </span>
                            {st && (
                              <span className={`px-1.5 py-0.5 rounded border font-bold ${STATUS_CLASS[st]}`}>
                                {STATUS_LABEL[st]}
                                {(st === 'irit' || st === 'boros') && pat?.patokan ? ` ${Math.abs(persenSelisih(totalUtama, pat.patokan))}%` : ''}
                              </span>
                            )}
                          </span>
                        </div>
                        <div className="px-4 py-3 space-y-2">
                          {rows.map(r => {
                            const item = inventory.find(i => i.id === r.inventory_item_id);
                            const rateKosong = !(r.rate_per_pcs > 0);
                            return (
                              <div key={r.rowId}>
                                <div className="grid grid-cols-[1fr_110px_90px_32px] gap-2 items-center">
                                  <select className={`${inputCls} w-full`} value={r.inventory_item_id}
                                    onChange={e => ubahBahan(a.po_item_id, r.rowId, { inventory_item_id: e.target.value })}>
                                    <option value="">— Pilih bahan —</option>
                                    {inventory.map(i => <option key={i.id} value={i.id}>{i.nama} (stok {i.stok_aktual} {i.satuan})</option>)}
                                  </select>
                                  <div className="flex items-center gap-1">
                                    <input type="number" min={0} step={0.01} placeholder="isi"
                                      value={r.rate_per_pcs || ''}
                                      onChange={e => ubahBahan(a.po_item_id, r.rowId, { rate_per_pcs: parseFloat(e.target.value) || 0 })}
                                      className={`${inputCls} w-full text-center ${rateKosong && r.inventory_item_id ? 'border-orange-500/60' : ''}`} />
                                    <span className="text-[10px] text-[#9aa0a6]">{item?.satuan ?? ''}</span>
                                  </div>
                                  <div className="text-center text-xs font-bold text-[#e5c17b]">
                                    {r.rate_per_pcs > 0 ? (r.rate_per_pcs * q).toFixed(2) : '—'}
                                  </div>
                                  <button onClick={() => hapusBahan(a.po_item_id, r.rowId)}
                                    className="w-8 h-8 flex items-center justify-center text-[#9aa0a6] hover:text-red-400 hover:bg-red-400/10 rounded">
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                                {(r.sumber || (rateKosong && r.inventory_item_id)) && (
                                  <p className="text-[10px] mt-0.5 text-[#9aa0a6]">
                                    {r.sumber && <span>otomatis — {r.sumber}</span>}
                                    {rateKosong && r.inventory_item_id && <span className="text-orange-400"> · belum ada patokan, isi manual</span>}
                                  </p>
                                )}
                              </div>
                            );
                          })}
                          <button onClick={() => tambahBahan(a.po_item_id)}
                            className="flex items-center gap-1.5 text-xs text-[#9aa0a6] hover:text-[#e5c17b] border border-dashed border-[#2A2D31] hover:border-[#e5c17b] px-3 py-1 rounded-md">
                            <Plus className="w-3.5 h-3.5" /> Tambah Bahan
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>

              {/* C. Ringkasan */}
              <section className="rounded-lg border border-[#2A2D31] bg-[#16181A] px-5 py-4 space-y-3">
                <h3 className="text-[10px] uppercase tracking-widest text-[#9aa0a6] font-bold">C — Ringkasan</h3>
                <div className="flex flex-wrap gap-6 text-sm">
                  <div><div className="text-[10px] text-[#9aa0a6] uppercase">Hasil</div><div className="text-green-400 font-bold text-lg">{totalHasil} pcs</div></div>
                  {totalKurang > 0 && <div><div className="text-[10px] text-[#9aa0a6] uppercase">Kembali ke Menunggu</div><div className="text-orange-400 font-bold text-lg">{totalKurang} pcs</div></div>}
                </div>
                {ringkasanBahan.length > 0 && (
                  <div className="space-y-1">
                    <div className="text-[10px] text-[#9aa0a6] uppercase">Bahan yang dikurangi</div>
                    {ringkasanBahan.map(d => (
                      <div key={d.nama} className="flex justify-between text-xs">
                        <span className="text-[#e8eaed]">{d.nama}</span>
                        <span className="text-[#e5c17b] font-bold">{d.total.toFixed(2)} <span className="text-[#9aa0a6] font-normal">{d.satuan}</span></span>
                      </div>
                    ))}
                  </div>
                )}
                {stokWarnings.length > 0 && (
                  <div className="rounded-lg border border-[#e5c17b]/30 bg-[#e5c17b]/5 p-3 text-[10px] text-[#e5c17b]">
                    <div className="flex items-center gap-2 font-semibold text-xs mb-1"><AlertTriangle className="w-3.5 h-3.5" />Peringatan Stok</div>
                    {stokWarnings.map((w, i) => <p key={i}>{w.item_nama} — kurang {w.qty_kurang}, sisa stok {w.sisa_stok}</p>)}
                  </div>
                )}
              </section>
            </>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-[#2A2D31]">
          <button onClick={onClose} disabled={isSubmitting}
            className="px-5 h-9 rounded-lg border border-[#2A2D31] text-[#e8eaed] text-sm hover:bg-[#2A2D31] disabled:opacity-40">Batal</button>
          <button onClick={simpan} disabled={isLoading || isSubmitting}
            className="flex items-center gap-2 px-5 h-9 rounded-lg bg-[#e5c17b] text-[#0D0E10] text-sm font-bold hover:bg-[#d4b06a] disabled:opacity-40 disabled:cursor-not-allowed">
            {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
            {isSubmitting ? 'Menyimpan...' : 'Selesai Cutting'}
          </button>
        </div>
      </div>
    </div>
  );
}
