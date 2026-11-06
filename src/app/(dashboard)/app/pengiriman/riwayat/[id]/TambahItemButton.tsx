'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Loader2, Plus, Search, X } from 'lucide-react';
import {
  getBundlesReadyToShip,
  tambahItemSuratJalan,
  type BundleReadyToShip,
} from '@/lib/actions/pengiriman/surat-jalan.actions';
import { matchesBundleSearch, tokenizeSearch } from '@/lib/search/bundle-search';
import { ErrorAlert } from '@/components/ui/ErrorAlert';

/**
 * Tambah barang yang tertinggal ke surat jalan yang sudah dibuat. Pilihan
 * barangnya sama dengan Buat Surat Jalan (sudah packing, masih ada sisa),
 * disaring ke klien surat jalan ini.
 */
export default function TambahItemButton({
  sjId, nomorSj, klienId,
}: {
  sjId: string;
  nomorSj: string;
  klienId: string;
}) {
  const [terbuka, setTerbuka] = useState(false);

  return (
    <>
      <button
        onClick={() => setTerbuka(true)}
        className="inline-flex items-center gap-2 px-3 py-2 rounded-md border border-[#2A2D31] text-[#e8eaed] text-sm hover:bg-[#2A2D31] transition-colors"
      >
        <Plus className="w-3.5 h-3.5" />
        Tambah Item
      </button>
      {terbuka && (
        <ModalTambahItem sjId={sjId} nomorSj={nomorSj} klienId={klienId} onClose={() => setTerbuka(false)} />
      )}
    </>
  );
}

function ModalTambahItem({
  sjId, nomorSj, klienId, onClose,
}: {
  sjId: string;
  nomorSj: string;
  klienId: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [daftar, setDaftar] = useState<BundleReadyToShip[] | null>(null);
  const memuat = daftar === null;
  const [dipilih, setDipilih] = useState<Set<string>>(new Set());
  const [qty, setQty] = useState<Record<string, number>>({});
  const [alasanLebih, setAlasanLebih] = useState<Record<string, string>>({});
  const [cari, setCari] = useState('');
  const [alasan, setAlasan] = useState('');
  const [menyimpan, setMenyimpan] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Dimuat sekali saat jendela dibuka.
  useEffect(() => {
    let batal = false;
    getBundlesReadyToShip()
      .then(semua => { if (!batal) setDaftar(semua.filter(b => b.klien_id === klienId)); })
      .catch((e: unknown) => {
        if (batal) return;
        toast.error(e instanceof Error ? e.message : 'Gagal memuat barang siap kirim');
        setDaftar([]);
      });
    return () => { batal = true; };
  }, [klienId]);

  const tampil = useMemo(() => {
    const tokens = tokenizeSearch(cari);
    const semua = daftar ?? [];
    return tokens.length === 0 ? semua : semua.filter(b => matchesBundleSearch(b, tokens));
  }, [daftar, cari]);

  const terpilih = (daftar ?? []).filter(b => dipilih.has(b.id));
  const qtyDari = (b: BundleReadyToShip) => qty[b.id] ?? b.qty_per_bundle;
  const kurangAlasanLebih = terpilih.some(b => qtyDari(b) > b.qty_per_bundle && !alasanLebih[b.id]?.trim());
  const qtyTidakValid = terpilih.some(b => !(qtyDari(b) > 0));
  const bisaSimpan = terpilih.length > 0 && alasan.trim().length > 0 && !kurangAlasanLebih && !qtyTidakValid;

  const toggle = (id: string) => {
    setDipilih(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const simpan = async () => {
    if (!bisaSimpan) return;
    setMenyimpan(true);
    setErrorMessage(null);
    try {
      const hasil = await tambahItemSuratJalan(
        sjId,
        terpilih.map(b => ({
          bundle_id: b.id,
          qty_kirim: qtyDari(b),
          ...(qtyDari(b) > b.qty_per_bundle ? { alasan_lebih: alasanLebih[b.id]?.trim() } : {}),
        })),
        alasan,
      );
      toast.success(`${hasil.jumlah_bundle} barang (${hasil.total_qty} pcs) ditambahkan ke ${hasil.nomor_sj || nomorSj}`);
      onClose();
      router.refresh();
    } catch (e: unknown) {
      setErrorMessage(e instanceof Error ? e.message : 'Gagal menambah barang');
    } finally {
      setMenyimpan(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/75 flex items-center justify-center z-50 p-4">
      <div className="bg-[#1A1D1F] border border-[#2A2D31] rounded-xl w-full max-w-3xl shadow-2xl max-h-[90vh] flex flex-col">
        <div className="px-6 py-4 border-b border-[#2A2D31] flex items-start justify-between gap-4">
          <div>
            <h3 className="text-base font-bold text-[#e8eaed]">Tambah Item ke {nomorSj}</h3>
            <p className="text-xs text-[#9aa0a6] mt-0.5">
              Barang siap kirim milik klien yang sama. Total invoice ikut dihitung ulang.
            </p>
          </div>
          <button onClick={onClose} disabled={menyimpan} className="text-[#9aa0a6] hover:text-[#e8eaed] transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 pt-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#9aa0a6] pointer-events-none" />
            <input
              type="text"
              value={cari}
              onChange={e => setCari(e.target.value)}
              placeholder="Cari model, warna, size, no PO, barcode..."
              className="w-full bg-[#0D0E10] border border-[#2A2D31] rounded-lg pl-8 pr-3 py-2 text-xs text-[#e8eaed] placeholder-[#9aa0a6]/50 focus:outline-none focus:border-[#e5c17b]"
            />
          </div>
        </div>

        <div className="overflow-y-auto flex-1 px-6 py-3">
          {memuat ? (
            <div className="flex items-center justify-center gap-2 py-12 text-[#9aa0a6] text-sm">
              <Loader2 className="w-5 h-5 animate-spin text-[#e5c17b]" /> Memuat barang siap kirim...
            </div>
          ) : tampil.length === 0 ? (
            <div className="py-12 text-center text-sm text-[#9aa0a6]">
              {daftar.length === 0 ? 'Tidak ada barang siap kirim untuk klien ini.' : 'Tidak ada yang cocok dengan pencarian.'}
            </div>
          ) : (
            <div className="divide-y divide-[#2A2D31] border border-[#2A2D31] rounded-lg">
              {tampil.map(b => {
                const aktif = dipilih.has(b.id);
                const q = qtyDari(b);
                return (
                  <div key={b.id} className={`px-3 py-2.5 ${aktif ? 'bg-[#e5c17b]/5' : ''}`}>
                    <div className="flex items-center gap-3">
                      <input
                        type="checkbox"
                        checked={aktif}
                        onChange={() => toggle(b.id)}
                        className="w-4 h-4 accent-[#e5c17b] shrink-0"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-medium text-[#e8eaed] truncate">
                          {b.model_nama ?? '-'} · {b.warna} · {b.size}
                        </div>
                        <div className="text-[10px] text-[#9aa0a6] truncate">
                          <span className="font-mono">{b.barcode}</span> · {b.no_po} · sisa {b.qty_per_bundle} pcs
                          {b.qty_sudah_kirim > 0 && ` (sudah terkirim ${b.qty_sudah_kirim})`}
                        </div>
                      </div>
                      {aktif && (
                        <input
                          type="number"
                          min={1}
                          value={q}
                          onChange={e => setQty(prev => ({ ...prev, [b.id]: Math.max(0, parseInt(e.target.value, 10) || 0) }))}
                          className="w-20 bg-[#0D0E10] border border-[#2A2D31] rounded-md px-2 py-1 text-sm text-right text-[#e8eaed] focus:outline-none focus:border-[#e5c17b]"
                        />
                      )}
                    </div>
                    {aktif && q > b.qty_per_bundle && (
                      <input
                        type="text"
                        value={alasanLebih[b.id] ?? ''}
                        onChange={e => setAlasanLebih(prev => ({ ...prev, [b.id]: e.target.value }))}
                        placeholder={`Alasan melebihi sisa (${q} > ${b.qty_per_bundle}) — perlu approval`}
                        className="mt-2 ml-7 w-[calc(100%-1.75rem)] bg-[#0D0E10] border border-orange-500/40 rounded-md px-2 py-1 text-xs text-[#e8eaed] focus:outline-none focus:border-orange-400"
                      />
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="px-6 py-3 border-t border-[#2A2D31] space-y-3">
          {errorMessage && <ErrorAlert pesan={errorMessage} onClose={() => setErrorMessage(null)} />}
          <div>
            <label className="text-[10px] uppercase tracking-wider text-[#9aa0a6] font-bold">Alasan *</label>
            <input
              type="text"
              value={alasan}
              onChange={e => setAlasan(e.target.value)}
              placeholder="mis. Barang tertinggal, ikut pengiriman yang sama"
              className="mt-1 w-full bg-[#0D0E10] border border-[#2A2D31] rounded-lg px-3 py-2 text-sm text-[#e8eaed] focus:outline-none focus:border-[#e5c17b]/60"
            />
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-[11px] text-[#9aa0a6]">
              {terpilih.length} barang dipilih · {terpilih.reduce((s, b) => s + qtyDari(b), 0)} pcs
            </span>
            <div className="flex gap-3">
              <button
                onClick={onClose}
                disabled={menyimpan}
                className="px-4 h-9 rounded-lg border border-[#2A2D31] text-[#e8eaed] text-sm hover:bg-[#2A2D31] transition-colors"
              >
                Batal
              </button>
              <button
                onClick={simpan}
                disabled={!bisaSimpan || menyimpan}
                className="flex items-center gap-2 px-4 h-9 rounded-lg bg-[#e5c17b] hover:bg-[#f0d194] text-[#16181A] text-sm font-bold transition-colors disabled:opacity-50"
              >
                {menyimpan ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                Tambahkan
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
