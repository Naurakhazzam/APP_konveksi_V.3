'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { X, Loader2, Save, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { getInventoryItemsForCutting, type InventoryItemOption } from '@/lib/actions/produksi/cutting.actions';
import { koreksiPemakaianBahan, type PemakaianCuttingRow } from '@/lib/actions/produksi/cutting-v2.actions';
import {
  isBahanUtama, statusPemakaian, persenSelisih, STATUS_LABEL, STATUS_CLASS,
} from '@/lib/produksi/patokan-bahan';

interface Props {
  judul: string;
  items: PemakaianCuttingRow[];
  onClose: () => void;
  onSaved: () => void;
}

interface Isian { inventory_item_id: string; rate: number }

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const fmt = (n: number) => n.toLocaleString('id-ID', { maximumFractionDigits: 3 });

/**
 * Koreksi pemakaian bahan hasil cutting. Bisa ganti bahan, ubah pemakaian per
 * pcs, atau isi 0 untuk menghapus catatan. Stok & LOT disesuaikan di server.
 */
export default function ModalEditPemakaian({ judul, items, onClose, onSaved }: Props) {
  const [inventory, setInventory] = useState<InventoryItemOption[]>([]);
  const [isian, setIsian] = useState<Record<string, Isian>>(() =>
    Object.fromEntries(items.map(r => [r.id, { inventory_item_id: r.inventory_item_id, rate: r.rate_per_pcs }])));
  const [alasan, setAlasan] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getInventoryItemsForCutting()
      .then(setInventory)
      .catch(e => toast.error('Gagal memuat bahan: ' + (e instanceof Error ? e.message : String(e))))
      .finally(() => setLoading(false));
  }, []);

  const namaBahan = (id: string) => inventory.find(i => i.id === id)?.nama ?? items.find(r => r.inventory_item_id === id)?.bahan_nama ?? '-';
  const satuanBahan = (id: string) => inventory.find(i => i.id === id)?.satuan ?? items.find(r => r.inventory_item_id === id)?.satuan ?? '';

  const berubah = useMemo(() => items.filter(r => {
    const v = isian[r.id];
    return v.inventory_item_id !== r.inventory_item_id || r3(v.rate) !== r3(r.rate_per_pcs);
  }), [items, isian]);

  /** Status per bundle memakai isian terbaru (bahan utama dijumlah). */
  const statusBundle = useMemo(() => {
    const m = new Map<string, { rate: number; patokan: number | null }>();
    for (const r of items) {
      const v = isian[r.id];
      if (!(v.rate > 0) || !isBahanUtama(namaBahan(v.inventory_item_id), r.jenis_bahan)) continue;
      const b = m.get(r.bundle_id) ?? { rate: 0, patokan: r.patokan };
      b.rate += v.rate;
      m.set(r.bundle_id, b);
    }
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, isian, inventory]);

  /** Perubahan stok per bahan: positif = stok berkurang lagi, negatif = dikembalikan. */
  const dampakStok = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of berubah) {
      const v = isian[r.id];
      m.set(r.inventory_item_id, (m.get(r.inventory_item_id) ?? 0) - r.qty_pakai);
      if (v.rate > 0) m.set(v.inventory_item_id, (m.get(v.inventory_item_id) ?? 0) + r3(v.rate * r.qty_potong));
    }
    return [...m].map(([id, d]) => ({ id, nama: namaBahan(id), satuan: satuanBahan(id), delta: r3(d) })).filter(x => x.delta !== 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [berubah, isian, inventory]);

  const validasi = (): string | null => {
    if (!berubah.length) return 'Belum ada yang diubah';
    for (const r of berubah) {
      const v = isian[r.id];
      if (!v.inventory_item_id) return `${r.barcode}: pilih bahan`;
      if (!(v.rate >= 0)) return `${r.barcode}: pemakaian tidak valid`;
      if (v.rate > 3) return `${r.barcode}: pemakaian ${v.rate} per pcs melebihi batas 3 — periksa lagi`;
    }
    // Satu bundle tidak boleh punya dua baris dengan bahan sama
    const kunci = new Set<string>();
    for (const r of items) {
      const v = isian[r.id];
      if (!(v.rate > 0)) continue;
      const k = `${r.bundle_id}|${v.inventory_item_id}`;
      if (kunci.has(k)) return `${r.barcode}: bahan ${namaBahan(v.inventory_item_id)} dipilih dua kali`;
      kunci.add(k);
    }
    if (!alasan.trim()) return 'Isi alasan koreksi';
    return null;
  };

  const simpan = async () => {
    const err = validasi();
    if (err) { toast.error(err); return; }
    setSaving(true);
    const res = await koreksiPemakaianBahan(
      berubah.map(r => ({ id: r.id, inventory_item_id: isian[r.id].inventory_item_id, rate_per_pcs: r3(isian[r.id].rate) })),
      alasan,
    );
    setSaving(false);
    if (!res.success) { toast.error(res.error ?? 'Gagal menyimpan koreksi'); return; }
    toast.success(`Koreksi tersimpan · ${res.diubah} diubah${res.dihapus ? ` · ${res.dihapus} dihapus` : ''}`);
    onSaved();
  };

  const inputCls = 'h-8 rounded-md border border-[#2A2D31] bg-[#0D0E10] px-2 text-xs text-[#e8eaed] focus:outline-none focus:ring-1 focus:ring-[#e5c17b]';

  return (
    <div className="fixed inset-0 bg-black/75 flex items-center justify-center z-50 p-4 print:hidden">
      <div className="bg-[#1A1D1F] border border-[#2A2D31] rounded-xl w-full max-w-5xl max-h-[90vh] flex flex-col shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#2A2D31]">
          <div>
            <h2 className="text-base font-bold text-[#e8eaed]">Edit Pemakaian Bahan</h2>
            <p className="text-xs text-[#9aa0a6] mt-0.5">{judul} · stok bahan ikut disesuaikan</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg text-[#9aa0a6] hover:text-[#e8eaed] hover:bg-[#2A2D31]">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-16 text-[#9aa0a6] text-sm">
              <Loader2 className="w-5 h-5 animate-spin text-[#e5c17b]" /> Memuat bahan...
            </div>
          ) : (
            <>
              <div className="rounded-lg border border-[#2A2D31] overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-[#16181A] border-b border-[#2A2D31] text-[#9aa0a6] uppercase tracking-wider">
                      <th className="text-left px-3 py-2 font-bold">Barcode</th>
                      <th className="text-left px-3 py-2 font-bold">Artikel</th>
                      <th className="text-center px-3 py-2 font-bold">Hasil</th>
                      <th className="text-left px-3 py-2 font-bold">Bahan</th>
                      <th className="text-center px-3 py-2 font-bold">Pakai/pcs</th>
                      <th className="text-right px-3 py-2 font-bold">Total</th>
                      <th className="text-right px-3 py-2 font-bold">Patokan</th>
                      <th className="text-left px-3 py-2 font-bold">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#2A2D31]">
                    {items.map(r => {
                      const v = isian[r.id];
                      const diubah = berubah.includes(r);
                      const hapus = v.rate === 0;
                      const bn = statusBundle.get(r.bundle_id);
                      const utama = isBahanUtama(namaBahan(v.inventory_item_id), r.jenis_bahan);
                      const st = utama && bn && !hapus ? statusPemakaian(bn.rate, bn.patokan) : null;
                      return (
                        <tr key={r.id} className={diubah ? 'bg-[#e5c17b]/5' : ''}>
                          <td className="px-3 py-2 font-mono text-[#e5c17b] whitespace-nowrap">{r.barcode}</td>
                          <td className="px-3 py-2 text-[#e8eaed] whitespace-nowrap">{r.warna} - {r.size}</td>
                          <td className="px-3 py-2 text-center text-[#e8eaed]">{r.qty_potong}</td>
                          <td className="px-3 py-2">
                            <select value={v.inventory_item_id} className={`${inputCls} w-56`}
                              onChange={e => setIsian(p => ({ ...p, [r.id]: { ...p[r.id], inventory_item_id: e.target.value } }))}>
                              {!inventory.some(i => i.id === v.inventory_item_id) && <option value={v.inventory_item_id}>{r.bahan_nama}</option>}
                              {inventory.map(i => <option key={i.id} value={i.id}>{i.nama} (stok {i.stok_aktual} {i.satuan})</option>)}
                            </select>
                          </td>
                          <td className="px-3 py-2 text-center">
                            <input type="number" min={0} step={0.01}
                              value={Number.isNaN(v.rate) ? '' : v.rate}
                              onChange={e => setIsian(p => ({ ...p, [r.id]: { ...p[r.id], rate: parseFloat(e.target.value) } }))}
                              className={`${inputCls} w-20 text-center`} />
                          </td>
                          <td className="px-3 py-2 text-right font-mono whitespace-nowrap">
                            {hapus
                              ? <span className="text-red-400 font-bold">dihapus</span>
                              : <span className="text-[#e8eaed]">{fmt(r3((v.rate || 0) * r.qty_potong))} <span className="text-[#9aa0a6]">{satuanBahan(v.inventory_item_id)}</span></span>}
                            {diubah && !hapus && <div className="text-[10px] text-[#9aa0a6] line-through">{fmt(r.qty_pakai)}</div>}
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-[#9aa0a6]">{utama && r.patokan != null ? r.patokan.toFixed(2) : '-'}</td>
                          <td className="px-3 py-2">
                            {st && (
                              <span className={`px-1.5 py-0.5 rounded border text-[10px] font-bold whitespace-nowrap ${STATUS_CLASS[st]}`}>
                                {STATUS_LABEL[st]}
                                {(st === 'irit' || st === 'boros') && bn?.patokan ? ` ${Math.abs(persenSelisih(bn.rate, bn.patokan))}%` : ''}
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="text-[10px] text-[#9aa0a6] -mt-3">Isi pemakaian 0 untuk menghapus catatan bahan itu. Stoknya dikembalikan.</p>

              {dampakStok.length > 0 && (
                <section className="rounded-lg border border-[#2A2D31] bg-[#16181A] px-4 py-3 space-y-1">
                  <h3 className="text-[10px] uppercase tracking-widest text-[#9aa0a6] font-bold mb-1">Perubahan stok</h3>
                  {dampakStok.map(d => (
                    <div key={d.id} className="flex justify-between text-xs">
                      <span className="text-[#e8eaed]">{d.nama}</span>
                      {d.delta > 0
                        ? <span className="text-orange-400 font-bold">stok berkurang {fmt(d.delta)} {d.satuan}</span>
                        : <span className="text-green-400 font-bold">dikembalikan {fmt(-d.delta)} {d.satuan}</span>}
                    </div>
                  ))}
                </section>
              )}

              <section>
                <label className="text-[10px] uppercase tracking-widest text-[#9aa0a6] font-bold">Alasan koreksi (wajib)</label>
                <textarea value={alasan} onChange={e => setAlasan(e.target.value)} rows={2}
                  placeholder="mis. salah input pemakaian, salah pilih warna bahan"
                  className="mt-1.5 w-full rounded-md border border-[#2A2D31] bg-[#0D0E10] px-3 py-2 text-sm text-[#e8eaed] focus:outline-none focus:ring-1 focus:ring-[#e5c17b]" />
              </section>

              <p className="flex items-start gap-2 text-[10px] text-[#9aa0a6]">
                <AlertTriangle className="w-3.5 h-3.5 text-[#e5c17b] shrink-0" />
                Koreksi tercatat di riwayat audit beserta nilai lama, nilai baru, dan alasannya.
              </p>
            </>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-[#2A2D31]">
          <span className="mr-auto text-xs text-[#9aa0a6]">{berubah.length} baris diubah</span>
          <button onClick={onClose} disabled={saving}
            className="px-5 h-9 rounded-lg border border-[#2A2D31] text-[#e8eaed] text-sm hover:bg-[#2A2D31] disabled:opacity-40">Batal</button>
          <button onClick={simpan} disabled={loading || saving || !berubah.length}
            className="flex items-center gap-2 px-5 h-9 rounded-lg bg-[#e5c17b] text-[#0D0E10] text-sm font-bold hover:bg-[#d4b06a] disabled:opacity-40 disabled:cursor-not-allowed">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {saving ? 'Menyimpan...' : 'Simpan Koreksi'}
          </button>
        </div>
      </div>
    </div>
  );
}
