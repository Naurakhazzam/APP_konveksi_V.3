'use client';

import React, { useRef, useState } from 'react';
import { toast } from 'sonner';
import { Search, Loader2, Hash, PackageCheck, Truck, Scissors, Barcode as BarcodeIcon } from 'lucide-react';
import { lacakBarcode, type LacakBarcodeResult } from '@/lib/actions/produksi/lacak-barcode.actions';

type ViewState =
  | { phase: 'idle' }
  | { phase: 'loading' }
  | { phase: 'not_found' }
  | { phase: 'found'; data: LacakBarcodeResult };

function formatTanggal(iso: string | null): string {
  if (!iso) return '-';
  return new Date(iso).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatWaktu(iso: string | null): string {
  if (!iso) return '-';
  return new Date(iso).toLocaleString('id-ID', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

export default function LacakBarcodeClient() {
  const [barcode, setBarcode] = useState('');
  const [state, setState] = useState<ViewState>({ phase: 'idle' });
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSearch = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!barcode.trim()) return;
    setState({ phase: 'loading' });
    try {
      const result = await lacakBarcode(barcode.trim());
      if (!result) {
        setState({ phase: 'not_found' });
        return;
      }
      setState({ phase: 'found', data: result });
    } catch (err: any) {
      toast.error(err.message || 'Gagal mencari barcode');
      setState({ phase: 'idle' });
    }
  };

  const resetSearch = () => {
    setState({ phase: 'idle' });
    setBarcode('');
    inputRef.current?.focus();
  };

  return (
    <div className="max-w-2xl mx-auto">
      <div className="bg-[#1A1D1F] border border-[#2A2D31] rounded-3xl p-8 mb-6 shadow-xl">
        <div className="flex items-center gap-4 mb-6">
          <div className="w-12 h-12 rounded-2xl bg-[#e5c17b]/10 flex items-center justify-center ring-1 ring-[#e5c17b]/20">
            <Search className="text-[#e5c17b] w-6 h-6" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-[#e8eaed]">Cari Barcode</h2>
            <p className="text-[#9aa0a6] text-sm">Scan atau ketik barcode bundle untuk cek statusnya</p>
          </div>
        </div>

        <form onSubmit={handleSearch} className="relative group">
          <input
            ref={inputRef}
            type="text"
            value={barcode}
            onChange={(e) => setBarcode(e.target.value)}
            placeholder="Masukkan barcode bundle..."
            disabled={state.phase === 'loading'}
            autoFocus
            className="w-full bg-[#0D0E10] border-2 border-[#2A2D31] rounded-2xl py-4 px-14 text-lg font-bold text-[#e8eaed] placeholder:text-[#9aa0a6]/30 focus:border-[#e5c17b] focus:ring-4 focus:ring-[#e5c17b]/5 outline-none transition-all"
          />
          <div className="absolute left-5 top-1/2 -translate-y-1/2 text-[#9aa0a6]/50 group-focus-within:text-[#e5c17b] transition-colors">
            <Hash size={20} />
          </div>
          {state.phase === 'loading' ? (
            <div className="absolute right-5 top-1/2 -translate-y-1/2">
              <Loader2 className="w-6 h-6 text-[#e5c17b] animate-spin" />
            </div>
          ) : (
            <button
              type="submit"
              className="absolute right-3 top-1/2 -translate-y-1/2 bg-[#e5c17b] hover:bg-[#d4b16a] text-[#0D0E10] px-4 py-2 rounded-xl text-xs font-black shadow-lg transition-transform active:scale-95"
            >
              CARI
            </button>
          )}
        </form>
      </div>

      {state.phase === 'not_found' && (
        <div className="bg-[#1A1D1F] border border-red-500/20 rounded-3xl p-8 text-center">
          <p className="text-[#e8eaed] font-bold mb-1">Barcode Tidak Ditemukan</p>
          <p className="text-[#9aa0a6] text-sm mb-4">Pastikan barcode yang di-scan sudah benar.</p>
          <button onClick={resetSearch} className="text-[#e5c17b] text-sm font-bold hover:underline">
            Cari Ulang
          </button>
        </div>
      )}

      {state.phase === 'found' && (
        <div className="bg-[#1A1D1F] border border-[#2A2D31] rounded-3xl overflow-hidden shadow-xl animate-in fade-in slide-in-from-bottom-4 duration-300">
          <div className="bg-[#2A2D31]/50 px-6 py-4 flex items-center justify-between border-b border-[#2A2D31]">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-[#e5c17b]/10 flex items-center justify-center">
                <BarcodeIcon className="w-4 h-4 text-[#e5c17b]" />
              </div>
              <div className="text-sm font-bold text-[#e8eaed] font-mono">{state.data.barcode}</div>
            </div>
            <button onClick={resetSearch} className="text-xs text-[#9aa0a6] hover:text-[#e5c17b] underline">
              Cari Lagi
            </button>
          </div>

          <div className="p-6 grid grid-cols-2 md:grid-cols-3 gap-6 border-b border-[#2A2D31]">
            <InfoItem label="No. PO" value={state.data.no_po} color="#e5c17b" />
            <InfoItem label="Klien" value={state.data.klien_nama || '-'} />
            <InfoItem label="Model" value={state.data.model_nama ?? '-'} />
            <InfoItem label="Warna" value={state.data.warna} />
            <InfoItem label="Size" value={state.data.size} />
            <InfoItem label="Qty/Bundle" value={`${state.data.qty_per_bundle} pcs`} />
          </div>

          <div className="p-6 space-y-4">
            {/* Tahap sekarang */}
            <div className="flex items-center gap-3 p-4 bg-[#0D0E10] border border-[#2A2D31] rounded-2xl">
              <div className="w-10 h-10 rounded-full bg-[#e5c17b]/10 flex items-center justify-center shrink-0">
                <PackageCheck className="w-5 h-5 text-[#e5c17b]" />
              </div>
              <div>
                <div className="text-[10px] text-[#9aa0a6] uppercase font-bold tracking-wider">Posisi Sekarang</div>
                <div className="text-sm font-bold text-[#e8eaed]">{state.data.tahap_sekarang}</div>
              </div>
            </div>

            {/* Status kirim */}
            <div className="flex items-center gap-3 p-4 bg-[#0D0E10] border border-[#2A2D31] rounded-2xl">
              <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${
                state.data.status_kirim === 'sudah_dikirim' ? 'bg-green-500/10' : 'bg-[#2A2D31]'
              }`}>
                <Truck className={`w-5 h-5 ${state.data.status_kirim === 'sudah_dikirim' ? 'text-green-400' : 'text-[#9aa0a6]'}`} />
              </div>
              <div>
                <div className="text-[10px] text-[#9aa0a6] uppercase font-bold tracking-wider">Status Pengiriman</div>
                {state.data.status_kirim === 'sudah_dikirim' ? (
                  <div className="text-sm font-bold text-green-400">
                    Sudah Dikirim — {state.data.nomor_sj} ({formatTanggal(state.data.tanggal_kirim)})
                  </div>
                ) : (
                  <div className="text-sm font-bold text-[#9aa0a6]">Belum Dikirim</div>
                )}
              </div>
            </div>

            {/* Penjahit */}
            <div className="flex items-center gap-3 p-4 bg-[#0D0E10] border border-[#2A2D31] rounded-2xl">
              <div className="w-10 h-10 rounded-full bg-[#e5c17b]/10 flex items-center justify-center shrink-0">
                <Scissors className="w-5 h-5 text-[#e5c17b]" />
              </div>
              <div>
                <div className="text-[10px] text-[#9aa0a6] uppercase font-bold tracking-wider">Penjahit</div>
                {state.data.penjahit_nama ? (
                  <div className="text-sm font-bold text-[#e8eaed]">
                    {state.data.penjahit_nama}
                    <span className="text-[#9aa0a6] font-normal text-xs ml-2">{formatWaktu(state.data.penjahit_waktu)}</span>
                  </div>
                ) : (
                  <div className="text-sm font-bold text-[#9aa0a6]">Belum Dijahit / Belum Tercatat</div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function InfoItem({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="space-y-1">
      <div className="text-[11px] text-[#9aa0a6] font-medium uppercase tracking-tight">{label}</div>
      <div className="text-sm font-bold text-[#e8eaed]" style={color ? { color } : {}}>
        {value}
      </div>
    </div>
  );
}
