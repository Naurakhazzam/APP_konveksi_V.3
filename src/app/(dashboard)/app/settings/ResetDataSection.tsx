'use client';

import React, { useState, useTransition } from 'react';
import { AlertTriangle, Trash2, Loader2, ShieldAlert } from 'lucide-react';
import { resetAllData } from '@/lib/actions/settings/reset.actions';
import { toast } from 'sonner';

export default function ResetDataSection() {
  const [step, setStep] = useState<'idle' | 'confirm' | 'typing'>('idle');
  const [inputValue, setInputValue] = useState('');
  const [isPending, startTransition] = useTransition();

  const CONFIRM_WORD = 'RESET';
  const isConfirmValid = inputValue === CONFIRM_WORD;

  const handleFirstClick = () => {
    setStep('confirm');
  };

  const handleCancel = () => {
    setStep('idle');
    setInputValue('');
  };

  const handleProceedToType = () => {
    setStep('typing');
    setInputValue('');
  };

  const handleReset = () => {
    if (!isConfirmValid) return;

    startTransition(async () => {
      try {
        await resetAllData();
        toast.success('Reset berhasil. Semua data transaksi telah dihapus.', {
          duration: 6000,
        });
        setStep('idle');
        setInputValue('');
      } catch (err: any) {
        toast.error(err.message || 'Reset gagal. Coba lagi.');
        setStep('idle');
        setInputValue('');
      }
    });
  };

  return (
    <div
      className="rounded-2xl overflow-hidden mt-8"
      style={{ background: '#16181A', border: '1px solid #3d1a1a' }}
    >
      {/* Header */}
      <div className="px-6 py-5 border-b border-[#3d1a1a]">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[rgba(239,68,68,0.12)] border border-[rgba(239,68,68,0.25)]">
            <ShieldAlert className="w-5 h-5 text-red-400" />
          </div>
          <div>
            <h2 className="text-[16px] font-bold text-red-400">Danger Zone — Reset Data</h2>
            <p className="text-[13px] text-[#9aa0a6] mt-0.5 leading-relaxed max-w-xl">
              Hapus semua data transaksi dan mulai dari awal. Tindakan ini tidak bisa dibatalkan.
            </p>
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="p-6">

        {/* Daftar apa yang akan dihapus */}
        <div
          className="rounded-xl px-5 py-4 mb-6"
          style={{ background: '#0D0E10', border: '1px solid #2A2D31' }}
        >
          <p className="text-[12px] font-semibold text-[#9aa0a6] uppercase tracking-wider mb-3">
            Yang akan dihapus
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-1.5 text-[13px] text-[#e8eaed]">
            {[
              'Semua PO & po_item',
              'Semua Bundle produksi',
              'Scan log (jahit, obras, dll)',
              'Ledger & pembayaran gaji',
              'Pemakaian aksesori & bahan',
              'Surat jalan & invoice',
              'Kalkulasi HPP (hpp_item)',
              'Jurnal entri & buku kas',
              'Kasbon karyawan',
              'Reject log',
              'Audit log aktivitas',
              'Data pembelian inventory (batch)',
            ].map((item) => (
              <div key={item} className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" />
                <span>{item}</span>
              </div>
            ))}
          </div>
          <div className="mt-4 pt-4 border-t border-[#2A2D31]">
            <p className="text-[12px] font-semibold text-[#9aa0a6] uppercase tracking-wider mb-2">
              Yang TIDAK dihapus (aman)
            </p>
            <p className="text-[13px] text-[#6fcf97]">
              Karyawan, klien, produk, inventory item, aksesori, warna, size, jabatan, HPP komponen, pengaturan, dan semua data master lainnya.
              Stok inventory di-reset ke 0. Nomor urut global mulai dari 1 lagi.
            </p>
          </div>
        </div>

        {/* Step 1: Tombol awal */}
        {step === 'idle' && (
          <button
            onClick={handleFirstClick}
            className="flex items-center gap-2 h-10 px-6 rounded-xl text-[13px] font-bold transition-all"
            style={{
              background: 'rgba(239,68,68,0.12)',
              border: '1px solid rgba(239,68,68,0.35)',
              color: '#f87171',
            }}
          >
            <Trash2 className="w-4 h-4" />
            Reset Semua Data Transaksi
          </button>
        )}

        {/* Step 2: Konfirmasi pertama (warning) */}
        {step === 'confirm' && (
          <div
            className="rounded-xl px-5 py-4 space-y-4"
            style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.3)' }}
          >
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-red-400 mt-0.5 shrink-0" />
              <div>
                <p className="text-[14px] font-bold text-red-400 mb-1">Anda yakin ingin melakukan reset?</p>
                <p className="text-[13px] text-[#9aa0a6] leading-relaxed">
                  Semua data PO, produksi, gaji, dan transaksi akan <strong className="text-[#e8eaed]">terhapus permanen</strong>.
                  Data master (karyawan, produk, dll) tetap aman. Pastikan Anda sudah melakukan backup jika diperlukan.
                </p>
              </div>
            </div>
            <div className="flex gap-3">
              <button
                onClick={handleCancel}
                className="h-9 px-5 rounded-xl text-[13px] font-medium text-[#9aa0a6] transition-colors"
                style={{ background: '#1e2124', border: '1px solid #2A2D31' }}
              >
                Batal
              </button>
              <button
                onClick={handleProceedToType}
                className="h-9 px-5 rounded-xl text-[13px] font-bold text-red-400 transition-colors"
                style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.35)' }}
              >
                Ya, saya mengerti — lanjutkan
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Ketik RESET untuk konfirmasi final */}
        {step === 'typing' && (
          <div
            className="rounded-xl px-5 py-4 space-y-4"
            style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.3)' }}
          >
            <div>
              <p className="text-[13px] text-[#e8eaed] mb-3">
                Ketik <span className="font-mono font-bold text-red-400 bg-[rgba(239,68,68,0.12)] px-1.5 py-0.5 rounded">RESET</span> untuk mengkonfirmasi:
              </p>
              <input
                type="text"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                placeholder="Ketik RESET di sini"
                disabled={isPending}
                autoFocus
                className="w-full max-w-xs h-10 rounded-xl px-3 text-[13px] font-mono text-[#e8eaed] outline-none transition-colors disabled:opacity-50"
                style={{
                  background: '#0D0E10',
                  border: `1px solid ${isConfirmValid ? 'rgba(239,68,68,0.6)' : '#2A2D31'}`,
                }}
              />
            </div>
            <div className="flex gap-3">
              <button
                onClick={handleCancel}
                disabled={isPending}
                className="h-9 px-5 rounded-xl text-[13px] font-medium text-[#9aa0a6] transition-colors disabled:opacity-50"
                style={{ background: '#1e2124', border: '1px solid #2A2D31' }}
              >
                Batal
              </button>
              <button
                onClick={handleReset}
                disabled={!isConfirmValid || isPending}
                className="flex items-center gap-2 h-9 px-6 rounded-xl text-[13px] font-bold transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                style={{
                  background: isConfirmValid ? '#dc2626' : 'rgba(239,68,68,0.12)',
                  color: isConfirmValid ? '#fff' : '#f87171',
                  border: '1px solid rgba(239,68,68,0.35)',
                }}
              >
                {isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Mereset data...
                  </>
                ) : (
                  <>
                    <Trash2 className="w-4 h-4" />
                    Hapus Semua Data
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
