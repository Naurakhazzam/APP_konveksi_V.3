'use client';

import React, { useState, useTransition } from 'react';
import { toast } from 'sonner';
import {
  BenangItem,
  RiwayatAmbilBenang,
  OverheadBenangInfo,
  catatAmbilBenang,
  hapusAmbilBenang,
} from '@/lib/actions/inventory/benang.actions';
import { useRouter } from 'next/navigation';

// ─── Props ───────────────────────────────────────────────────────────────────

interface Props {
  items           : BenangItem[];
  initialRiwayat  : RiwayatAmbilBenang[];
  initialOverhead : OverheadBenangInfo;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatRp(n: number) {
  return 'Rp ' + n.toLocaleString('id-ID');
}

function today() {
  return new Date().toISOString().split('T')[0];
}

// ─── Component ───────────────────────────────────────────────────────────────

export function AmbilBenangClient({ items, initialRiwayat, initialOverhead }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // Form state
  const [selectedItemId, setSelectedItemId] = useState('');
  const [inputMode, setInputMode]           = useState<'pcs' | 'beli'>('pcs');
  const [qtyPcs, setQtyPcs]                 = useState('');
  const [qtyBeli, setQtyBeli]               = useState('');
  const [tanggal, setTanggal]               = useState(today());
  const [keterangan, setKeterangan]         = useState('');

  const selectedItem = items.find(i => i.id === selectedItemId) ?? null;
  const hasKonversi  = !!selectedItem?.satuan_beli && !!selectedItem?.faktor_konversi;
  const faktor       = selectedItem?.faktor_konversi ?? 1;

  // Kalkulasi qty pcs dari input
  const resolvedQtyPcs: number = (() => {
    if (inputMode === 'beli' && hasKonversi) {
      return (parseFloat(qtyBeli) || 0) * faktor;
    }
    return parseFloat(qtyPcs) || 0;
  })();

  const estimasiHarga = resolvedQtyPcs * (selectedItem?.harga_referensi ?? 0);

  function handleItemChange(id: string) {
    setSelectedItemId(id);
    setQtyPcs('');
    setQtyBeli('');
    setInputMode('pcs');
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedItemId) { toast.error('Pilih item benang'); return; }
    if (resolvedQtyPcs <= 0) { toast.error('Qty harus lebih dari 0'); return; }

    startTransition(async () => {
      try {
        await catatAmbilBenang({
          inventory_item_id : selectedItemId,
          qty               : resolvedQtyPcs,
          tanggal,
          keterangan        : keterangan || null,
        });
        toast.success('Pengambilan benang berhasil dicatat');
        setSelectedItemId('');
        setQtyPcs('');
        setQtyBeli('');
        setKeterangan('');
        router.refresh();
      } catch (err: any) {
        toast.error(err.message ?? 'Gagal mencatat pengambilan');
      }
    });
  }

  async function handleHapus(id: string) {
    if (!confirm('Hapus catatan ini? Stok akan dikembalikan.')) return;
    startTransition(async () => {
      try {
        await hapusAmbilBenang(id);
        toast.success('Catatan dihapus, stok dikembalikan');
        router.refresh();
      } catch (err: any) {
        toast.error(err.message ?? 'Gagal menghapus');
      }
    });
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground">Ambil Benang</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Catat setiap pengambilan benang dari stok. Biaya benang dihitung sebagai overhead jahit.
        </p>
      </div>

      {/* Overhead Info Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-card border rounded-xl p-4">
          <p className="text-xs text-muted-foreground">Total Biaya Benang</p>
          <p className="text-lg font-bold text-foreground mt-1">
            {formatRp(initialOverhead.total_biaya_benang)}
          </p>
        </div>
        <div className="bg-card border rounded-xl p-4">
          <p className="text-xs text-muted-foreground">Total Pcs Dijahit</p>
          <p className="text-lg font-bold text-foreground mt-1">
            {initialOverhead.total_pcs_jahit.toLocaleString('id-ID')} pcs
          </p>
        </div>
        <div className="bg-card border rounded-xl p-4">
          <p className="text-xs text-muted-foreground">Rate Benang / Pcs</p>
          <p className="text-lg font-bold text-primary mt-1">
            {formatRp(initialOverhead.rate_per_pcs)}
          </p>
        </div>
        <div className="bg-card border rounded-xl p-4">
          <p className="text-xs text-muted-foreground">Jumlah Catatan</p>
          <p className="text-lg font-bold text-foreground mt-1">
            {initialOverhead.record_count} record
          </p>
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Form Ambil Benang */}
        <div className="bg-card border rounded-xl p-6">
          <h2 className="font-semibold text-foreground mb-4">Catat Pengambilan</h2>
          <form onSubmit={handleSubmit} className="space-y-4">

            {/* Pilih Item */}
            <div>
              <label className="text-sm font-medium text-foreground">Item Benang</label>
              <select
                value={selectedItemId}
                onChange={e => handleItemChange(e.target.value)}
                className="mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                required
              >
                <option value="">-- Pilih benang --</option>
                {items.map(item => (
                  <option key={item.id} value={item.id}>
                    {item.nama}
                    {item.stok_aktual < 0 ? ` ⚠ stok ${item.stok_aktual}` : ` (stok: ${item.stok_aktual} ${item.satuan})`}
                  </option>
                ))}
              </select>
            </div>

            {/* Info item & mode input */}
            {selectedItem && (
              <div className="rounded-lg bg-muted/50 px-4 py-3 text-sm space-y-1">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Satuan pakai</span>
                  <span className="font-medium">{selectedItem.satuan}</span>
                </div>
                {hasKonversi && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Konversi</span>
                    <span className="font-medium">1 {selectedItem.satuan_beli} = {faktor} {selectedItem.satuan}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Harga referensi</span>
                  <span className="font-medium">{formatRp(selectedItem.harga_referensi)}/{selectedItem.satuan}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Stok saat ini</span>
                  <span className={`font-medium ${selectedItem.stok_aktual < 0 ? 'text-red-500' : ''}`}>
                    {selectedItem.stok_aktual} {selectedItem.satuan}
                  </span>
                </div>

                {/* Mode toggle jika ada konversi */}
                {hasKonversi && (
                  <div className="flex gap-2 pt-2">
                    <button
                      type="button"
                      onClick={() => setInputMode('pcs')}
                      className={`flex-1 rounded-md py-1 text-xs font-medium transition-colors ${
                        inputMode === 'pcs'
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-background border text-muted-foreground'
                      }`}
                    >
                      Input per {selectedItem.satuan}
                    </button>
                    <button
                      type="button"
                      onClick={() => setInputMode('beli')}
                      className={`flex-1 rounded-md py-1 text-xs font-medium transition-colors ${
                        inputMode === 'beli'
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-background border text-muted-foreground'
                      }`}
                    >
                      Input per {selectedItem.satuan_beli}
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Input qty */}
            {selectedItem && (
              <>
                {inputMode === 'pcs' || !hasKonversi ? (
                  <div>
                    <label className="text-sm font-medium text-foreground">
                      Qty ({selectedItem.satuan})
                    </label>
                    <input
                      type="number"
                      min="0.01"
                      step="0.01"
                      value={qtyPcs}
                      onChange={e => setQtyPcs(e.target.value)}
                      placeholder={`Jumlah dalam ${selectedItem.satuan}`}
                      className="mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                      required
                    />
                  </div>
                ) : (
                  <div>
                    <label className="text-sm font-medium text-foreground">
                      Qty ({selectedItem.satuan_beli})
                    </label>
                    <input
                      type="number"
                      min="0.01"
                      step="0.01"
                      value={qtyBeli}
                      onChange={e => setQtyBeli(e.target.value)}
                      placeholder={`Jumlah dalam ${selectedItem.satuan_beli}`}
                      className="mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                      required
                    />
                    {qtyBeli && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        = {resolvedQtyPcs.toLocaleString('id-ID')} {selectedItem.satuan}
                      </p>
                    )}
                  </div>
                )}
              </>
            )}

            {/* Preview estimasi harga */}
            {resolvedQtyPcs > 0 && (
              <div className="rounded-lg border border-primary/20 bg-primary/5 px-4 py-3">
                <p className="text-xs text-muted-foreground">Estimasi biaya</p>
                <p className="text-base font-bold text-primary">{formatRp(Math.round(estimasiHarga))}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {resolvedQtyPcs} {selectedItem?.satuan} × {formatRp(selectedItem?.harga_referensi ?? 0)}
                </p>
              </div>
            )}

            {/* Tanggal */}
            <div>
              <label className="text-sm font-medium text-foreground">Tanggal</label>
              <input
                type="date"
                value={tanggal}
                onChange={e => setTanggal(e.target.value)}
                className="mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                required
              />
            </div>

            {/* Keterangan */}
            <div>
              <label className="text-sm font-medium text-foreground">
                Keterangan <span className="text-muted-foreground font-normal">(opsional)</span>
              </label>
              <input
                type="text"
                value={keterangan}
                onChange={e => setKeterangan(e.target.value)}
                placeholder="Misal: untuk PO-XXX, mesin jahit A..."
                className="mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>

            <button
              type="submit"
              disabled={isPending || resolvedQtyPcs <= 0 || !selectedItemId}
              className="w-full rounded-lg bg-primary py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {isPending ? 'Menyimpan...' : 'Catat Pengambilan'}
            </button>
          </form>
        </div>

        {/* Riwayat */}
        <div className="bg-card border rounded-xl p-6">
          <h2 className="font-semibold text-foreground mb-4">Riwayat Pengambilan</h2>
          {initialRiwayat.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <p className="text-muted-foreground text-sm">Belum ada catatan pengambilan benang</p>
            </div>
          ) : (
            <div className="space-y-2 max-h-[520px] overflow-y-auto pr-1">
              {initialRiwayat.map(r => (
                <div key={r.id} className="flex items-start justify-between rounded-lg border px-3 py-2.5 hover:bg-muted/30 transition-colors group">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground truncate">{r.item_nama}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {r.qty} {r.satuan}
                      {r.satuan_beli && r.faktor_konversi && (
                        <span className="text-muted-foreground/60">
                          {' '}({(r.qty / r.faktor_konversi).toFixed(2)} {r.satuan_beli})
                        </span>
                      )}
                      {' · '}{new Date(r.tanggal).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' })}
                    </p>
                    {r.keterangan && (
                      <p className="text-xs text-muted-foreground/70 italic truncate mt-0.5">{r.keterangan}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 ml-3 shrink-0">
                    <span className="text-sm font-semibold text-foreground">{formatRp(Math.round(r.subtotal))}</span>
                    <button
                      onClick={() => handleHapus(r.id)}
                      disabled={isPending}
                      className="opacity-0 group-hover:opacity-100 text-destructive hover:text-destructive/80 text-xs transition-opacity disabled:opacity-50"
                      title="Hapus"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
