'use client';

import React, { useState, useEffect } from 'react';
import { type AntrianJahitBundle } from '@/lib/actions/produksi/scan.actions';
import { serahTerimaJahitBatch } from '@/lib/actions/produksi/jahit.actions';
import { getAlasanQty, type AlasanQty } from '@/lib/actions/produksi/qty-approval.actions';
import { getAksesoriForKartuKerja, type ModelAksesori } from '@/lib/actions/produksi/model-aksesori.actions';
import PrintKartuKerjaLayout, { type KartuBundle, type AksesoriItem } from '@/app/(dashboard)/app/produksi/antrian-cutting/PrintKartuKerjaLayout';
import { X, User, Printer, Loader2, AlertCircle, Tag, PackageCheck, CheckCircle } from 'lucide-react';
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

export default function ModalSerahTerimaJahit({ selectedBundles, karyawanList, onSuccess, onClose }: Props) {
  const [karyawanId, setKaryawanId]     = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [kartuData, setKartuData]       = useState<KartuBundle[]>([]);
  const [aksesoriMap, setAksesoriMap]   = useState<Record<string, ModelAksesori[]>>({});
  const [loadingAksesori, setLoadingAksesori] = useState(true);

  // Input susulan: barang sudah jadi → terima + selesai sekaligus
  const [langsungSelesai, setLangsungSelesai] = useState(false);
  const [printKartu, setPrintKartu]           = useState(true);
  const [alasanList, setAlasanList]           = useState<AlasanQty[]>([]);
  const [qtySelesai, setQtySelesai] = useState<Record<string, string>>(
    () => Object.fromEntries(selectedBundles.map(b => [b.id, String(b.qty_per_bundle)])),
  );
  const [alasanQty, setAlasanQty] = useState<Record<string, string>>({});

  const toggleLangsungSelesai = (v: boolean) => {
    setLangsungSelesai(v);
    // Barang sudah jadi → kartu kerja biasanya tidak perlu dicetak lagi
    setPrintKartu(!v);
    if (v && alasanList.length === 0) getAlasanQty().then(setAlasanList).catch(() => {});
  };

  // Validasi qty selesai per bundle (hanya bila langsung selesai)
  const errorSelesai: Record<string, string | null> = {};
  for (const b of selectedBundles) {
    if (!langsungSelesai) { errorSelesai[b.id] = null; continue; }
    const q = parseInt(qtySelesai[b.id] ?? '') || 0;
    errorSelesai[b.id] =
      q < 1 ? 'Min 1'
      : q > b.qty_per_bundle ? `Maks ${b.qty_per_bundle}`
      : q < b.qty_per_bundle && !alasanQty[b.id] ? 'Pilih alasan'
      : null;
  }
  const adaErrorSelesai = Object.values(errorSelesai).some(Boolean);

  // Load aksesori saat modal dibuka
  useEffect(() => {
    if (!selectedBundles.length) return;

    // Load aksesori
    const poItemIds = [...new Set(selectedBundles.map(b => b.po_item_id))];
    setLoadingAksesori(true);
    getAksesoriForKartuKerja(poItemIds)
      .then(map => setAksesoriMap(map))
      .catch(() => setAksesoriMap({}))
      .finally(() => setLoadingAksesori(false));

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

  // ── Submit ───────────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    if (!karyawanId) {
      toast.error('Pilih karyawan penjahit terlebih dahulu');
      return;
    }

    const selectedKaryawan = karyawanList.find(k => k.id === karyawanId);
    if (!selectedKaryawan) return;
    if (adaErrorSelesai) {
      toast.error('Periksa qty selesai — ada yang belum lengkap');
      return;
    }

    setIsSubmitting(true);
    try {
      // 1. Serah terima (+ selesai bila input susulan) — satu transaksi
      //    Benang tidak dicatat di sini lagi: belanja benang masuk saldo Bahan Pembantu (Buku Kas)
      const res = await serahTerimaJahitBatch({
        bundle_ids: selectedBundles.map(b => b.id),
        karyawan_id: karyawanId,
        langsung_selesai: langsungSelesai,
        items: langsungSelesai
          ? selectedBundles.map(b => ({
              bundle_id: b.id,
              qty_selesai: parseInt(qtySelesai[b.id]) || b.qty_per_bundle,
              alasan_qty_id: alasanQty[b.id] || null,
            }))
          : [],
        benang: [],
      });

      if (res.stok_warnings.length > 0) {
        toast.warning(`Beberapa stok aksesori kurang: ${res.stok_warnings.map(w => `${w.item_nama} kurang ${w.qty_kurang}`).join(', ')}`);
      }

      const pesan = langsungSelesai
        ? `${selectedBundles.length} bundle diserahkan & selesai dijahit (${selectedKaryawan.nama})`
        : `Berhasil serah terima ${selectedBundles.length} bundle ke ${selectedKaryawan.nama}`;

      if (!printKartu) {
        toast.success(pesan);
        onSuccess();
        return;
      }

      // 2. Siapkan data untuk kartu kerja
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
        toast.success(pesan);
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
                        {langsungSelesai && (
                          <th className="px-4 py-2 text-[10px] uppercase text-green-400 font-bold text-center">QTY Selesai</th>
                        )}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#2A2D31]">
                      {selectedBundles.map(b => {
                        const q = parseInt(qtySelesai[b.id] ?? '') || 0;
                        const kurang = langsungSelesai && q > 0 && q < b.qty_per_bundle;
                        return (
                        <tr key={b.id} className="hover:bg-[#2A2D31]/30 align-top">
                          <td className="px-4 py-2 font-mono text-[#e5c17b] text-xs">{b.barcode}</td>
                          <td className="px-4 py-2 text-[#e8eaed]">{b.warna} / {b.size}</td>
                          <td className="px-4 py-2 text-center text-[#e8eaed] font-bold">{b.qty_per_bundle}</td>
                          {langsungSelesai && (
                            <td className="px-4 py-2">
                              <div className="flex flex-col items-center gap-1">
                                <input
                                  type="number"
                                  min={1}
                                  max={b.qty_per_bundle}
                                  value={qtySelesai[b.id] ?? ''}
                                  onChange={e => setQtySelesai(p => ({ ...p, [b.id]: e.target.value }))}
                                  disabled={isSubmitting}
                                  className={`w-16 bg-[#0D0E10] border rounded-lg px-2 py-1 text-center text-xs font-bold text-[#e8eaed] outline-none focus:ring-1 focus:ring-[#e5c17b] ${
                                    errorSelesai[b.id] ? 'border-red-500/60' : 'border-[#2A2D31]'
                                  }`}
                                />
                                {kurang && (
                                  <select
                                    value={alasanQty[b.id] ?? ''}
                                    onChange={e => setAlasanQty(p => ({ ...p, [b.id]: e.target.value }))}
                                    disabled={isSubmitting}
                                    className="w-36 bg-[#0D0E10] border border-orange-500/40 rounded-lg px-2 py-1 text-[11px] text-[#e8eaed] outline-none"
                                  >
                                    <option value="">-- alasan kurang --</option>
                                    {alasanList.map(a => <option key={a.id} value={a.id}>{a.label}</option>)}
                                  </select>
                                )}
                                {errorSelesai[b.id] && !kurang && (
                                  <span className="text-[10px] text-red-400">{errorSelesai[b.id]}</span>
                                )}
                              </div>
                            </td>
                          )}
                        </tr>
                        );
                      })}
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

            {/* ── Input susulan ── */}
            <div className={`rounded-xl border p-4 space-y-2 transition-colors ${
              langsungSelesai ? 'border-green-500/40 bg-green-500/5' : 'border-[#2A2D31] bg-[#16181A]'
            }`}>
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={langsungSelesai}
                  onChange={e => toggleLangsungSelesai(e.target.checked)}
                  disabled={isSubmitting}
                  className="accent-green-500 w-4 h-4 mt-0.5"
                />
                <span>
                  <span className="text-sm font-bold text-[#e8eaed]">Sudah selesai dijahit (input susulan)</span>
                  <span className="block text-xs text-[#9aa0a6] mt-0.5">
                    Bundle langsung tercatat Terima + Selesai dan upah jahit langsung masuk.
                    Qty selesai bisa diubah per bundle di tabel di atas.
                  </span>
                </span>
              </label>
              <label className="flex items-center gap-3 cursor-pointer pl-7">
                <input
                  type="checkbox"
                  checked={printKartu}
                  onChange={e => setPrintKartu(e.target.checked)}
                  disabled={isSubmitting}
                  className="accent-[#e5c17b] w-4 h-4"
                />
                <span className="text-xs text-[#9aa0a6]">Print kartu kerja</span>
              </label>
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
              disabled={isSubmitting || !karyawanId || adaErrorSelesai}
              className={`flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                langsungSelesai ? 'bg-green-600 hover:bg-green-500 text-white' : 'bg-[#e5c17b] hover:bg-[#d4b06a] text-[#0D0E10]'
              }`}
            >
              {isSubmitting
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : printKartu ? <Printer className="w-4 h-4" /> : <CheckCircle className="w-4 h-4" />}
              {isSubmitting ? 'Memproses...'
                : langsungSelesai ? (printKartu ? 'Print & Simpan Selesai' : 'Simpan Selesai')
                : (printKartu ? 'Print & Mulai Jahit' : 'Mulai Jahit')}
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
