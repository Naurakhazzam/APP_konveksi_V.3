'use client';

import React, { useState } from 'react';
import { toast } from 'sonner';
import { Search, Loader2, PackageSearch, FileSearch } from 'lucide-react';
import {
  getLotUsageByPO,
  getPOsUsingLot,
  type BahanBakuOption,
  type PoLotUsageResult,
  type PoUsingLot,
} from '@/lib/actions/inventory/lot-detail.actions';
import { getInventoryBatches, type InventoryBatch } from '@/lib/actions/inventory/inventory.actions';

type Mode = 'per_po' | 'per_lot';

function formatTanggal(iso: string | null): string {
  if (!iso) return '-';
  return new Date(iso).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function DetailLotClient({ bahanList }: { bahanList: BahanBakuOption[] }) {
  const [mode, setMode] = useState<Mode>('per_po');

  // --- Mode: Cari per PO ---
  const [noPo, setNoPo] = useState('');
  const [poLoading, setPoLoading] = useState(false);
  const [poResult, setPoResult] = useState<PoLotUsageResult | null>(null);
  const [poNotFound, setPoNotFound] = useState(false);

  const handleCariPO = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!noPo.trim()) return;
    setPoLoading(true);
    setPoResult(null);
    setPoNotFound(false);
    try {
      const result = await getLotUsageByPO(noPo.trim());
      if (!result) {
        setPoNotFound(true);
      } else {
        setPoResult(result);
      }
    } catch (err: any) {
      toast.error(err.message || 'Gagal mencari PO');
    } finally {
      setPoLoading(false);
    }
  };

  // --- Mode: Cari per LOT ---
  const [selectedBahanId, setSelectedBahanId] = useState('');
  const [batchOptions, setBatchOptions] = useState<InventoryBatch[]>([]);
  const [batchLoading, setBatchLoading] = useState(false);
  const [selectedBatchId, setSelectedBatchId] = useState('');
  const [lotResult, setLotResult] = useState<PoUsingLot[] | null>(null);
  const [lotResultLoading, setLotResultLoading] = useState(false);

  const handlePilihBahan = async (itemId: string) => {
    setSelectedBahanId(itemId);
    setSelectedBatchId('');
    setLotResult(null);
    setBatchOptions([]);
    if (!itemId) return;
    setBatchLoading(true);
    try {
      const batches = await getInventoryBatches(itemId);
      setBatchOptions(batches);
    } catch (err: any) {
      toast.error(err.message || 'Gagal memuat daftar LOT');
    } finally {
      setBatchLoading(false);
    }
  };

  const handlePilihLot = async (batchId: string) => {
    setSelectedBatchId(batchId);
    setLotResult(null);
    if (!batchId) return;
    setLotResultLoading(true);
    try {
      const result = await getPOsUsingLot(batchId);
      setLotResult(result);
    } catch (err: any) {
      toast.error(err.message || 'Gagal mencari pemakaian LOT');
    } finally {
      setLotResultLoading(false);
    }
  };

  const selectedBahan = bahanList.find(b => b.id === selectedBahanId);

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Mode toggle */}
      <div className="flex p-1 bg-[#16181A] rounded-lg w-fit border border-[#2A2D31]">
        <button
          onClick={() => setMode('per_po')}
          className={'flex items-center gap-2 px-4 py-1.5 rounded-md text-sm font-medium transition-all ' +
            (mode === 'per_po' ? 'bg-[#e5c17b] text-[#0D0E10]' : 'text-[#9aa0a6] hover:text-[#e8eaed]')}
        >
          <FileSearch className="w-4 h-4" /> Cari per PO
        </button>
        <button
          onClick={() => setMode('per_lot')}
          className={'flex items-center gap-2 px-4 py-1.5 rounded-md text-sm font-medium transition-all ' +
            (mode === 'per_lot' ? 'bg-[#e5c17b] text-[#0D0E10]' : 'text-[#9aa0a6] hover:text-[#e8eaed]')}
        >
          <PackageSearch className="w-4 h-4" /> Cari per LOT
        </button>
      </div>

      {mode === 'per_po' && (
        <div className="space-y-4">
          <form onSubmit={handleCariPO} className="flex gap-2">
            <input
              value={noPo}
              onChange={(e) => setNoPo(e.target.value)}
              placeholder="Contoh: PO-0077"
              disabled={poLoading}
              className="flex-1 bg-[#0D0E10] border border-[#2A2D31] rounded-xl px-4 py-2.5 text-sm text-[#e8eaed] outline-none focus:border-[#e5c17b]"
            />
            <button
              type="submit"
              disabled={poLoading}
              className="px-5 py-2.5 rounded-xl bg-[#e5c17b] hover:bg-[#d4b16a] text-[#0D0E10] text-sm font-bold disabled:opacity-40 transition-all flex items-center gap-2"
            >
              {poLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
              Cari
            </button>
          </form>

          {poNotFound && (
            <div className="bg-[#1A1D1F] border border-red-500/20 rounded-2xl p-6 text-center text-sm text-[#9aa0a6]">
              PO tidak ditemukan. Pastikan nomor PO sudah benar.
            </div>
          )}

          {poResult && (
            <div className="bg-[#1A1D1F] border border-[#2A2D31] rounded-2xl overflow-hidden">
              <div className="px-5 py-4 border-b border-[#2A2D31] bg-[#2A2D31]/30">
                <div className="text-sm font-bold text-[#e5c17b]">{poResult.no_po}</div>
                <div className="text-xs text-[#9aa0a6]">{poResult.klien_nama}</div>
              </div>
              <table className="w-full text-xs">
                <thead className="bg-[#16181A] text-[#9aa0a6]">
                  <tr>
                    <th className="p-3 text-left">Artikel</th>
                    <th className="p-3 text-left">Bahan</th>
                    <th className="p-3 text-center">LOT</th>
                    <th className="p-3 text-right">Qty Pakai</th>
                    <th className="p-3 text-left">No. Faktur</th>
                  </tr>
                </thead>
                <tbody>
                  {poResult.artikel.map((a) => (
                    <tr key={a.po_item_id} className="border-t border-[#2A2D31]">
                      <td className="p-3 text-[#e8eaed]">{a.model_nama ?? '-'} / {a.warna} / {a.size}</td>
                      <td className="p-3 text-[#e8eaed]">{a.bahan_nama ?? <span className="text-[#5f6368]">Belum dicutting</span>}</td>
                      <td className="p-3 text-center">
                        {a.lot_number ? (
                          <span className="font-mono font-bold text-[#e5c17b]">LOT-{a.lot_number}</span>
                        ) : (
                          <span className="text-[#5f6368]">-</span>
                        )}
                      </td>
                      <td className="p-3 text-right text-[#e8eaed]">
                        {a.qty_pakai != null ? `${a.qty_pakai.toLocaleString('id-ID')} ${a.satuan ?? ''}` : '-'}
                      </td>
                      <td className="p-3 text-[#9aa0a6] font-mono">{a.no_faktur ?? '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {mode === 'per_lot' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-[10px] text-[#9aa0a6] uppercase font-bold tracking-widest">Pilih Bahan</label>
              <select
                value={selectedBahanId}
                onChange={(e) => handlePilihBahan(e.target.value)}
                className="w-full h-10 px-3 rounded-md bg-[#16181A] border border-[#2A2D31] text-sm text-[#e8eaed] focus:ring-1 focus:ring-[#e5c17b] outline-none"
              >
                <option value="">— Pilih bahan baku —</option>
                {bahanList.map((b) => (
                  <option key={b.id} value={b.id}>{b.nama}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] text-[#9aa0a6] uppercase font-bold tracking-widest">Pilih LOT</label>
              <select
                value={selectedBatchId}
                onChange={(e) => handlePilihLot(e.target.value)}
                disabled={!selectedBahanId || batchLoading}
                className="w-full h-10 px-3 rounded-md bg-[#16181A] border border-[#2A2D31] text-sm text-[#e8eaed] focus:ring-1 focus:ring-[#e5c17b] outline-none disabled:opacity-40"
              >
                <option value="">
                  {batchLoading ? 'Memuat...' : batchOptions.length === 0 ? '— Belum ada LOT —' : '— Pilih LOT —'}
                </option>
                {batchOptions.map((b, idx) => (
                  <option key={b.id} value={b.id}>
                    LOT-{idx + 1} · {formatTanggal(b.tanggal_masuk)} · sisa {b.qty_sisa.toLocaleString('id-ID')}/{b.qty_awal.toLocaleString('id-ID')}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {lotResultLoading && (
            <div className="flex items-center gap-2 text-sm text-[#9aa0a6] py-4">
              <Loader2 className="w-4 h-4 animate-spin" /> Mencari pemakaian LOT...
            </div>
          )}

          {!lotResultLoading && lotResult && (
            <div className="bg-[#1A1D1F] border border-[#2A2D31] rounded-2xl overflow-hidden">
              {lotResult.length === 0 ? (
                <div className="p-6 text-center text-sm text-[#9aa0a6]">
                  LOT ini belum tercatat dipakai untuk artikel/PO manapun.
                </div>
              ) : (
                <table className="w-full text-xs">
                  <thead className="bg-[#16181A] text-[#9aa0a6]">
                    <tr>
                      <th className="p-3 text-left">No. PO</th>
                      <th className="p-3 text-left">Klien</th>
                      <th className="p-3 text-left">Artikel</th>
                      <th className="p-3 text-right">Qty Pakai</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lotResult.map((r, idx) => (
                      <tr key={idx} className="border-t border-[#2A2D31]">
                        <td className="p-3 font-mono font-bold text-[#e5c17b]">{r.no_po}</td>
                        <td className="p-3 text-[#9aa0a6]">{r.klien_nama}</td>
                        <td className="p-3 text-[#e8eaed]">{r.model_nama ?? '-'} / {r.warna} / {r.size}</td>
                        <td className="p-3 text-right text-[#e8eaed]">
                          {r.qty_pakai.toLocaleString('id-ID')} {selectedBahan?.satuan ?? ''}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
