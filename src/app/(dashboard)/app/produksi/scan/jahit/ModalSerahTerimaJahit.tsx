'use client';

import React, { useState, useEffect } from 'react';
import { type AntrianJahitBundle } from '@/lib/actions/produksi/scan.actions';
import { scanJahitTerima } from '@/lib/actions/produksi/scan-mutations.actions';
import { getAksesoriForKartuKerja, type ModelAksesori } from '@/lib/actions/produksi/model-aksesori.actions';
import { getBenangItems, submitBenangSerahTerima, type BenangItem } from '@/lib/actions/inventory/benang.actions';
import PrintKartuKerjaLayout, { type KartuBundle, type AksesoriItem } from '@/app/(dashboard)/app/produksi/antrian-cutting/PrintKartuKerjaLayout';
import { X, User, Printer, Loader2, AlertCircle, Tag, PackageCheck, Wind, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

interface Props {
  selectedBundles: AntrianJahitBundle[];
  karyawanList: { id: string; nama: string }[];
  onSuccess: () => void;
  onClose: () => void;
}

// Aggregated aksesori per item (gabungan semua bundle)
interface AggregatedAksesori {
  inventory_item_id: string;
  item_nama: string;
  satuan: string;
  qty_per_pcs: number;
  total_qty: number;
  tahap_pakai: string;
}

// Row benang yang dipilih user
interface BenangRow {
  uid              : string;  // key lokal
  inventory_item_id: string;
  nama             : string;
  satuan           : string;
  qty              : string;  // string agar input bisa kosong
}

function genUid() {
  return Math.random().toString(36).slice(2);
}

export default function ModalSerahTerimaJahit({ selectedBundles, karyawanList, onSuccess, onClose }: Props) {
  const [karyawanId, setKaryawanId]     = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [kartuData, setKartuData]       = useState<KartuBundle[]>([]);
  const [aksesoriMap, setAksesoriMap]   = useState<Record<string, ModelAksesori[]>>({});
  const [loadingAksesori, setLoadingAksesori] = useState(true);

  // State benang
  const [benangItems, setBenangItems]   = useState<BenangItem[]>([]);
  const [loadingBenang, setLoadingBenang] = useState(true);
  const [benangRows, setBenangRows]     = useState<BenangRow[]>([]);

  // Load aksesori + benang saat modal dibuka
  useEffect(() => {
    if (!selectedBundles.length) return;

    // Load aksesori
    const poItemIds = [...new Set(selectedBundles.map(b => b.po_item_id))];
    setLoadingAksesori(true);
    getAksesoriForKartuKerja(poItemIds)
      .then(map => setAksesoriMap(map))
      .catch(() => setAksesoriMap({}))
      .finally(() => setLoadingAksesori(false));

    // Load daftar item benang dari inventory
    setLoadingBenang(true);
    getBenangItems()
      .then(items => setBenangItems(items))
      .catch(() => setBenangItems([]))
      .finally(() => setLoadingBenang(false));
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  // ── Agregasi aksesori jahit ──────────────────────────────────────────────
  const aggregatedAksesori: AggregatedAksesori[] = (() => {
    const map: Record<string, AggregatedAksesori> = {};
    for (const bundle of selectedBundles) {
      const items = (aksesoriMap[bundle.po_item_id] ?? [])
        .filter(a => a.tahap_pakai === 'jahit');
      for (const item of items) {
        const key = item.inventory_item_id;
        if (!map[key]) {
          map[key] = {
            inventory_item_id: item.inventory_item_id,
            item_nama         : item.inventory_item_nama,
            satuan            : item.satuan,
            qty_per_pcs       : item.qty_per_pcs,
            total_qty         : 0,
            tahap_pakai       : item.tahap_pakai,
          };
        }
        map[key].total_qty += item.qty_per_pcs * bundle.qty_per_bundle;
      }
    }
    return Object.values(map).sort((a, b) => a.item_nama.localeCompare(b.item_nama));
  })();

  const totalPcs = selectedBundles.reduce((s, b) => s + b.qty_per_bundle, 0);

  // ── Handlers benang rows ─────────────────────────────────────────────────
  function addBenangRow() {
    setBenangRows(prev => [...prev, { uid: genUid(), inventory_item_id: '', nama: '', satuan: '', qty: '' }]);
  }

  function removeBenangRow(uid: string) {
    setBenangRows(prev => prev.filter(r => r.uid !== uid));
  }

  function updateBenangRowItem(uid: string, itemId: string) {
    const item = benangItems.find(b => b.id === itemId);
    setBenangRows(prev => prev.map(r =>
      r.uid === uid
        ? { ...r, inventory_item_id: itemId, nama: item?.nama ?? '', satuan: item?.satuan ?? '', qty: r.qty }
        : r
    ));
  }

  function updateBenangRowQty(uid: string, qty: string) {
    setBenangRows(prev => prev.map(r => r.uid === uid ? { ...r, qty } : r));
  }

  // ── Submit ───────────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    if (!karyawanId) {
      toast.error('Pilih karyawan penjahit terlebih dahulu');
      return;
    }

    // Validasi benang rows — item harus dipilih dan qty harus diisi (min 0)
    for (const row of benangRows) {
      if (!row.inventory_item_id) {
        toast.error('Pilih item benang atau hapus baris yang kosong');
        return;
      }
      if (row.qty === '' || row.qty === null || isNaN(parseFloat(row.qty)) || parseFloat(row.qty) < 0) {
        toast.error(`Qty benang untuk ${row.nama || 'item'} harus diisi (minimal 0)`);
        return;
      }
    }

    const selectedKaryawan = karyawanList.find(k => k.id === karyawanId);
    if (!selectedKaryawan) return;

    setIsSubmitting(true);
    try {
      // 1. Process scan terima untuk setiap bundle
      const warnings: string[] = [];
      for (const bundle of selectedBundles) {
        const res = await scanJahitTerima({
          barcode    : bundle.barcode,
          karyawan_id: karyawanId,
          qty        : bundle.qty_per_bundle
        });
        if (res.stok_warnings?.length > 0) {
          res.stok_warnings.forEach((w: any) => {
            warnings.push(`${w.item_nama} kurang ${w.qty_kurang}`);
          });
        }
      }

      if (warnings.length > 0) {
        toast.warning(`Beberapa stok aksesori kurang: ${warnings.join(', ')}`);
      }

      // 2. Catat serah terima benang (jika ada)
      if (benangRows.length > 0) {
        const bundleIds = selectedBundles.map(b => b.id);
        const today     = new Date().toISOString().split('T')[0];

        // Hanya submit row dengan qty > 0 (qty 0 = tidak diserahkan, tidak perlu dicatat)
        const benangToSubmit = benangRows.filter(r => parseFloat(r.qty) > 0);
        if (benangToSubmit.length > 0) {
          await submitBenangSerahTerima(
            benangToSubmit.map(row => ({
              karyawan_id       : karyawanId,
              inventory_item_id : row.inventory_item_id,
              qty               : parseFloat(row.qty),
              tanggal           : today,
              bundle_ids        : bundleIds,
              keterangan        : `Serah terima jahit – ${selectedBundles.map(b => b.barcode).join(', ')}`,
            }))
          );
        }
      }

      // 3. Siapkan data untuk kartu kerja
      const dataToPrint: KartuBundle[] = selectedBundles.map((b) => {
        const aks: AksesoriItem[] = (aksesoriMap[b.po_item_id] ?? []).map(item => ({
          nama        : item.inventory_item_nama,
          qty_per_pcs : item.qty_per_pcs,
          satuan      : item.satuan,
          tahap_pakai : item.tahap_pakai,
        }));

        let parsedUrut = 0;
        const bMatch = b.barcode.match(/bdl(\d+)$/i);
        if (bMatch && bMatch[1]) parsedUrut = parseInt(bMatch[1], 10);

        return {
          id             : b.id,
          barcode        : b.barcode,
          no_urut        : parsedUrut,
          po_id          : '',
          po_item_id     : b.po_item_id,
          no_po          : b.no_po,
          tanggal_order  : '',
          tanggal_target : '',
          po_catatan     : null,
          klien_nama     : b.klien_nama,
          model_nama     : b.model_nama,
          warna          : b.warna,
          size           : b.size,
          qty_per_bundle : b.qty_per_bundle,
          aksesori       : aks,
          nama_penjahit  : selectedKaryawan.nama,
        };
      });

      setKartuData(dataToPrint);

      // 4. Trigger print
      setTimeout(() => {
        window.print();
        toast.success(`Berhasil serah terima ${selectedBundles.length} bundle`);
        onSuccess();
      }, 500);

    } catch (err: any) {
      toast.error(err.message || 'Gagal memproses serah terima');
    } finally {
      setIsSubmitting(false);
    }
  };

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <>
      <div className="fixed inset-0 bg-black/75 flex items-center justify-center z-50 p-4 print:hidden">
        <div className="bg-[#1A1D1F] border border-[#2A2D31] rounded-2xl w-full max-w-2xl shadow-2xl flex flex-col max-h-[90vh]">

          {/* Header */}
          <div className="px-6 py-5 border-b border-[#2A2D31] flex items-center justify-between">
            <div>
              <h2 className="text-xl font-bold text-[#e8eaed]">Serah Terima Jahit</h2>
              <p className="text-sm text-[#9aa0a6] mt-1">
                {selectedBundles.length} bundle · {totalPcs} pcs total
              </p>
            </div>
            <button
              onClick={onClose}
              disabled={isSubmitting}
              className="w-8 h-8 flex items-center justify-center rounded-lg text-[#9aa0a6] hover:text-[#e8eaed] hover:bg-[#2A2D31] transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto p-6 space-y-5">

            {/* Karyawan Penjahit */}
            <div className="space-y-2">
              <label className="text-[10px] font-black uppercase tracking-[0.2em] text-[#e5c17b] flex items-center gap-2">
                <User size={14} /> Karyawan Penjahit
              </label>
              <select
                value={karyawanId}
                onChange={(e) => setKaryawanId(e.target.value)}
                disabled={isSubmitting}
                className="w-full bg-[#16181A] border border-[#2A2D31] rounded-xl px-4 py-3 text-[#e8eaed] focus:ring-1 focus:ring-[#e5c17b] outline-none transition-all text-sm"
              >
                <option value="">-- Pilih Penjahit --</option>
                {karyawanList.map(k => (
                  <option key={k.id} value={k.id}>{k.nama}</option>
                ))}
              </select>
            </div>

            {/* Daftar Bundle */}
            <div className="space-y-2">
              <label className="text-[10px] font-black uppercase tracking-[0.2em] text-[#9aa0a6] flex items-center gap-2">
                <AlertCircle size={14} /> Daftar Bundle
              </label>
              <div className="border border-[#2A2D31] rounded-xl overflow-hidden bg-[#16181A]">
                <div className="max-h-40 overflow-y-auto">
                  <table className="w-full text-sm text-left">
                    <thead className="bg-[#1A1D1F] border-b border-[#2A2D31] sticky top-0">
                      <tr>
                        <th className="px-4 py-2 text-[10px] uppercase text-[#9aa0a6] font-bold">Barcode</th>
                        <th className="px-4 py-2 text-[10px] uppercase text-[#9aa0a6] font-bold">Warna/Size</th>
                        <th className="px-4 py-2 text-[10px] uppercase text-[#9aa0a6] font-bold text-center">QTY</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#2A2D31]">
                      {selectedBundles.map(b => (
                        <tr key={b.id} className="hover:bg-[#2A2D31]/30">
                          <td className="px-4 py-2 font-mono text-[#e5c17b] text-xs">{b.barcode}</td>
                          <td className="px-4 py-2 text-[#e8eaed]">{b.warna} / {b.size}</td>
                          <td className="px-4 py-2 text-center text-[#e8eaed] font-bold">{b.qty_per_bundle}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            {/* Aksesori yang Diserahkan */}
            <div className="space-y-2">
              <label className="text-[10px] font-black uppercase tracking-[0.2em] text-[#e5c17b] flex items-center gap-2">
                <Tag size={14} /> Aksesori yang Diserahkan
                <span className="text-[#9aa0a6] font-normal normal-case tracking-normal">(untuk {totalPcs} pcs)</span>
              </label>

              {loadingAksesori ? (
                <div className="flex items-center justify-center py-6 border border-[#2A2D31] rounded-xl bg-[#16181A]">
                  <Loader2 className="w-5 h-5 animate-spin text-[#9aa0a6]" />
                  <span className="ml-2 text-sm text-[#9aa0a6]">Memuat aksesori...</span>
                </div>
              ) : aggregatedAksesori.length === 0 ? (
                <div className="border border-dashed border-[#2A2D31] rounded-xl p-5 text-center bg-[#16181A]">
                  <PackageCheck className="w-8 h-8 text-[#9aa0a6] mx-auto mb-2" />
                  <p className="text-xs text-[#9aa0a6]">Tidak ada aksesori tambahan untuk tahap jahit pada model ini.</p>
                  <p className="text-xs text-[#9aa0a6]/60 mt-1">Pastikan setup model sudah dikonfigurasi di Master → Setup Model.</p>
                </div>
              ) : (
                <div className="border border-[#2A2D31] rounded-xl overflow-hidden bg-[#16181A]">
                  <table className="w-full text-sm">
                    <thead className="bg-[#1A1D1F] border-b border-[#2A2D31]">
                      <tr>
                        <th className="px-4 py-2.5 text-left text-[10px] uppercase tracking-wider text-[#9aa0a6] font-bold">Aksesori</th>
                        <th className="px-4 py-2.5 text-right text-[10px] uppercase tracking-wider text-[#9aa0a6] font-bold">Per Pcs</th>
                        <th className="px-4 py-2.5 text-right text-[10px] uppercase tracking-wider text-[#9aa0a6] font-bold">Total Diserahkan</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#2A2D31]">
                      {aggregatedAksesori.map((item, idx) => (
                        <tr key={item.inventory_item_id} className={idx % 2 === 0 ? 'bg-[#16181A]' : 'bg-[#1A1D1F]'}>
                          <td className="px-4 py-2.5 text-[#e8eaed] font-medium">{item.item_nama}</td>
                          <td className="px-4 py-2.5 text-right text-[#9aa0a6] text-xs">
                            {item.qty_per_pcs} {item.satuan}
                          </td>
                          <td className="px-4 py-2.5 text-right font-bold text-[#e5c17b]">
                            {item.total_qty} {item.satuan}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* ── Benang yang Diserahkan ── */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-[10px] font-black uppercase tracking-[0.2em] text-[#e5c17b] flex items-center gap-2">
                  <Wind size={14} /> Benang yang Diserahkan
                </label>
                <button
                  type="button"
                  onClick={addBenangRow}
                  disabled={isSubmitting || loadingBenang}
                  className="flex items-center gap-1 text-xs font-semibold text-[#e5c17b] hover:text-[#d4b06a] disabled:opacity-50 transition-colors"
                >
                  <Plus size={14} /> Tambah Benang
                </button>
              </div>

              {loadingBenang ? (
                <div className="flex items-center justify-center py-4 border border-[#2A2D31] rounded-xl bg-[#16181A]">
                  <Loader2 className="w-4 h-4 animate-spin text-[#9aa0a6]" />
                  <span className="ml-2 text-xs text-[#9aa0a6]">Memuat daftar benang...</span>
                </div>
              ) : benangRows.length === 0 ? (
                <button
                  type="button"
                  onClick={addBenangRow}
                  disabled={isSubmitting}
                  className="w-full border border-dashed border-[#2A2D31] rounded-xl p-4 text-center bg-[#16181A] hover:border-[#e5c17b]/40 hover:bg-[#1e2022] transition-colors group"
                >
                  <Wind className="w-7 h-7 text-[#9aa0a6] group-hover:text-[#e5c17b]/60 mx-auto mb-1.5 transition-colors" />
                  <p className="text-xs text-[#9aa0a6] group-hover:text-[#e8eaed] transition-colors">
                    Klik untuk menambahkan benang yang diserahkan
                  </p>
                  <p className="text-[10px] text-[#9aa0a6]/50 mt-0.5">Opsional — stok akan berkurang saat submit</p>
                </button>
              ) : (
                <div className="border border-[#2A2D31] rounded-xl overflow-hidden bg-[#16181A]">
                  {/* Header */}
                  <div className="grid grid-cols-[1fr_120px_32px] gap-2 px-4 py-2 bg-[#1A1D1F] border-b border-[#2A2D31]">
                    <span className="text-[10px] uppercase tracking-wider text-[#9aa0a6] font-bold">Item Benang</span>
                    <span className="text-[10px] uppercase tracking-wider text-[#9aa0a6] font-bold text-center">Qty</span>
                    <span />
                  </div>

                  {/* Rows */}
                  <div className="divide-y divide-[#2A2D31]">
                    {benangRows.map((row) => {
                      const selectedItem = benangItems.find(b => b.id === row.inventory_item_id);
                      return (
                        <div key={row.uid} className="grid grid-cols-[1fr_120px_32px] gap-2 px-4 py-2.5 items-center">
                          {/* Pilih item */}
                          <select
                            value={row.inventory_item_id}
                            onChange={e => updateBenangRowItem(row.uid, e.target.value)}
                            disabled={isSubmitting}
                            className="bg-[#0D0E10] border border-[#2A2D31] rounded-lg px-3 py-1.5 text-[#e8eaed] text-xs focus:ring-1 focus:ring-[#e5c17b] outline-none w-full"
                          >
                            <option value="">-- Pilih benang --</option>
                            {benangItems.map(b => (
                              <option key={b.id} value={b.id}>
                                {b.nama} {b.stok_aktual < 0 ? `⚠ stok ${b.stok_aktual}` : `(stok: ${b.stok_aktual} ${b.satuan})`}
                              </option>
                            ))}
                          </select>

                          {/* Qty + satuan */}
                          <div className="flex items-center gap-1">
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={row.qty}
                              onChange={e => updateBenangRowQty(row.uid, e.target.value)}
                              disabled={isSubmitting}
                              placeholder="wajib isi"
                              className={`bg-[#0D0E10] border rounded-lg px-2 py-1.5 text-[#e8eaed] text-xs focus:ring-1 focus:ring-[#e5c17b] outline-none w-full text-right ${
                                row.qty === '' ? 'border-red-500/60' : 'border-[#2A2D31]'
                              }`}
                            />
                            {selectedItem && (
                              <span className="text-[10px] text-[#9aa0a6] shrink-0">{selectedItem.satuan}</span>
                            )}
                          </div>

                          {/* Hapus */}
                          <button
                            type="button"
                            onClick={() => removeBenangRow(row.uid)}
                            disabled={isSubmitting}
                            className="flex items-center justify-center w-7 h-7 rounded-lg text-[#9aa0a6] hover:text-[#e65c5c] hover:bg-[#2A2D31] transition-colors"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      );
                    })}
                  </div>

                  {/* Tombol tambah di bawah */}
                  <button
                    type="button"
                    onClick={addBenangRow}
                    disabled={isSubmitting}
                    className="w-full px-4 py-2 text-xs text-[#9aa0a6] hover:text-[#e5c17b] hover:bg-[#1A1D1F] transition-colors flex items-center gap-1 justify-center border-t border-[#2A2D31]"
                  >
                    <Plus size={12} /> Tambah baris
                  </button>
                </div>
              )}
            </div>

          </div>

          {/* Footer */}
          <div className="px-6 py-4 border-t border-[#2A2D31] flex justify-end gap-3 bg-[#16181A] rounded-b-2xl">
            <button
              onClick={onClose}
              disabled={isSubmitting}
              className="px-6 py-2.5 rounded-xl border border-[#2A2D31] text-sm font-bold text-[#e8eaed] hover:bg-[#2A2D31] transition-colors disabled:opacity-50"
            >
              Batal
            </button>
            <button
              onClick={handleSubmit}
              disabled={isSubmitting || !karyawanId}
              className="flex items-center gap-2 bg-[#e5c17b] hover:bg-[#d4b06a] text-[#0D0E10] px-6 py-2.5 rounded-xl text-sm font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Printer className="w-4 h-4" />}
              {isSubmitting ? 'Memproses...' : 'Print & Mulai Jahit'}
            </button>
          </div>
        </div>
      </div>

      {kartuData.length > 0 && (
        <PrintKartuKerjaLayout
          bundles={kartuData}
          tglCetak={new Date().toLocaleString('id-ID', {
            day: '2-digit', month: 'short', year: 'numeric',
            hour: '2-digit', minute: '2-digit'
          })}
        />
      )}
    </>
  );
}
