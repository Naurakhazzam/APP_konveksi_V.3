'use client';

import React, { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Save, Loader2, Info } from 'lucide-react';
import { type OverheadRateInfo, upsertOverheadPeriod } from '@/lib/actions/keuangan/overhead.actions';

interface Props {
  initialRateInfo: OverheadRateInfo;
}

const idrFmt = (n: number) =>
  'Rp ' + Math.abs(n).toLocaleString('id-ID', { minimumFractionDigits: 0 });

const dateFmt = (d: string) =>
  new Date(d).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });

export default function OverheadSettingClient({ initialRateInfo }: Props) {
  const [loading, setLoading] = useState(false);
  const [label, setLabel] = useState(initialRateInfo.period?.label || '');
  const [tanggalMulai, setTanggalMulai] = useState(initialRateInfo.period?.tanggal_mulai || '');
  const [tanggalAkhir, setTanggalAkhir] = useState(initialRateInfo.period?.tanggal_akhir || '');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!label || !tanggalMulai || !tanggalAkhir) {
      toast.error('Semua field harus diisi');
      return;
    }
    if (tanggalMulai > tanggalAkhir) {
      toast.error('Tanggal mulai tidak boleh lebih besar dari tanggal akhir');
      return;
    }

    setLoading(true);
    try {
      await upsertOverheadPeriod({
        label,
        tanggal_mulai: tanggalMulai,
        tanggal_akhir: tanggalAkhir,
      });
      toast.success('Periode overhead berhasil disimpan dan diaktifkan');
      // No need to set router.refresh() because upsert calls revalidatePath
    } catch (e: any) {
      toast.error(e.message || 'Gagal menyimpan periode overhead');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Current Active Info */}
      <div className="p-4 rounded-xl bg-[#1A1D1F] border border-[#2A2D31]">
        <div className="flex items-start gap-3">
          <div className="p-2 bg-[#2A2D31] rounded-lg">
            <Info className="h-5 w-5 text-[#9aa0a6]" />
          </div>
          <div className="flex-1">
            <h3 className="text-sm font-bold text-[#e8eaed] mb-1">Periode Overhead Aktif</h3>
            {initialRateInfo.period ? (
              <div className="space-y-2 mt-3">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="text-[10px] uppercase text-[#9aa0a6] tracking-widest font-bold mb-0.5">Label</p>
                    <p className="text-[#e8eaed]">{initialRateInfo.period.label}</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase text-[#9aa0a6] tracking-widest font-bold mb-0.5">Rentang</p>
                    <p className="text-[#e8eaed]">{dateFmt(initialRateInfo.period.tanggal_mulai)} - {dateFmt(initialRateInfo.period.tanggal_akhir)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase text-[#9aa0a6] tracking-widest font-bold mb-0.5">Total Overhead</p>
                    <p className="text-[#e5c17b] font-mono">{idrFmt(initialRateInfo.total_overhead)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase text-[#9aa0a6] tracking-widest font-bold mb-0.5">Total Shipped</p>
                    <p className="text-[#e8eaed] font-mono">{initialRateInfo.total_qty_shipped.toLocaleString('id-ID')} pcs</p>
                  </div>
                </div>
                <div className="pt-3 mt-3 border-t border-[#2A2D31]">
                  <p className="text-xs text-[#9aa0a6]">Overhead Rate saat ini:</p>
                  <p className="text-xl font-bold text-amber-400 mt-1">
                    {idrFmt(initialRateInfo.overhead_rate)} <span className="text-sm font-normal text-[#9aa0a6]">/ pcs</span>
                  </p>
                </div>
              </div>
            ) : (
              <p className="text-sm text-[#5f6368] mt-1">Belum ada periode overhead yang aktif.</p>
            )}
          </div>
        </div>
      </div>

      {/* Form Setup Baru */}
      <div className="p-4 rounded-xl bg-[#16181A] border border-[#2A2D31]">
        <h3 className="text-sm font-bold text-[#e8eaed] mb-4">Setel Periode Baru</h3>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-[10px] font-bold text-[#9aa0a6] uppercase tracking-widest mb-1">
              Label Periode
            </label>
            <input
              type="text"
              placeholder="Contoh: Tahun Fiskal 2026"
              className="w-full h-10 px-3 rounded-lg bg-[#1E2124] border border-[#2A2D31] text-sm text-[#e8eaed] outline-none focus:ring-1 focus:ring-[#e5c17b]"
              value={label}
              onChange={e => setLabel(e.target.value)}
              required
            />
          </div>
          
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-[10px] font-bold text-[#9aa0a6] uppercase tracking-widest mb-1">
                Tanggal Mulai
              </label>
              <input
                type="date"
                className="w-full h-10 px-3 rounded-lg bg-[#1E2124] border border-[#2A2D31] text-sm text-[#e8eaed] outline-none focus:ring-1 focus:ring-[#e5c17b] [color-scheme:dark]"
                value={tanggalMulai}
                onChange={e => setTanggalMulai(e.target.value)}
                required
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-[#9aa0a6] uppercase tracking-widest mb-1">
                Tanggal Akhir
              </label>
              <input
                type="date"
                className="w-full h-10 px-3 rounded-lg bg-[#1E2124] border border-[#2A2D31] text-sm text-[#e8eaed] outline-none focus:ring-1 focus:ring-[#e5c17b] [color-scheme:dark]"
                value={tanggalAkhir}
                onChange={e => setTanggalAkhir(e.target.value)}
                required
              />
            </div>
          </div>

          <div className="pt-2">
            <Button
              type="submit"
              disabled={loading}
              className="w-full h-10 bg-[#e5c17b] text-[#16181A] hover:bg-[#d4b06a] font-bold"
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Save className="h-4 w-4 mr-2" />
              )}
              Simpan & Aktifkan
            </Button>
            <p className="text-[11px] text-center text-[#5f6368] mt-3">
              Perhatian: Mengaktifkan periode baru akan otomatis menonaktifkan periode sebelumnya.
            </p>
          </div>
        </form>
      </div>
    </div>
  );
}
