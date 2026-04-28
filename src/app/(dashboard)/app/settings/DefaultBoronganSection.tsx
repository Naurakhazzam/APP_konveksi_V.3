'use client';

import React, { useState, useTransition } from 'react';
import { Users, Loader2 } from 'lucide-react';
import { updateDefaultBorongan } from '@/lib/actions/settings/settings.actions';
import { toast } from 'sonner';

interface Props {
  currentId: string | null;
  karyawan: { id: string; nama: string; jabatan: string }[];
}

export default function DefaultBoronganSection({ currentId, karyawan }: Props) {
  const [selectedId, setSelectedId] = useState<string>(currentId ?? '');
  const [isPending, startTransition] = useTransition();

  const handleSave = () => {
    startTransition(async () => {
      try {
        await updateDefaultBorongan(selectedId || null);
        toast.success('Default borongan berhasil disimpan');
      } catch (err: any) {
        toast.error(err.message || 'Gagal menyimpan default borongan');
      }
    });
  };

  const activeEmployee = currentId ? karyawan.find((k) => k.id === currentId) : null;

  return (
    <div
      className="rounded-2xl overflow-hidden mt-8"
      style={{ background: '#16181A', border: '1px solid #2A2D31' }}
    >
      {/* Header */}
      <div className="px-6 py-5 border-b border-[#2A2D31]">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[rgba(229,193,123,0.12)] border border-[rgba(229,193,123,0.2)]">
            <Users className="w-5 h-5 text-[#e5c17b]" />
          </div>
          <div>
            <h2 className="text-[16px] font-bold text-[#e8eaed]">Default Karyawan Borongan</h2>
            <p className="text-[13px] text-[#9aa0a6] mt-0.5 leading-relaxed max-w-xl">
              Karyawan yang otomatis terpilih sebagai penerima upah borongan saat proses scan produksi.
            </p>
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="p-6 space-y-6">
        <div className="space-y-4 max-w-md">
          <div className="space-y-1.5">
            <label className="text-[13px] font-medium text-[#e8eaed]">
              Pilih Karyawan
            </label>
            <select
              value={selectedId}
              onChange={(e) => setSelectedId(e.target.value)}
              disabled={isPending}
              className="w-full h-10 rounded-xl px-3 text-[13px] text-[#e8eaed] outline-none transition-colors disabled:opacity-50"
              style={{
                background: '#0D0E10',
                border: '1px solid #2A2D31',
                appearance: 'none',
              }}
            >
              <option value="">— Tidak ada default —</option>
              {karyawan.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.nama} ({k.jabatan})
                </option>
              ))}
            </select>
          </div>

          {currentId && (
            <div
              className="rounded-xl px-4 py-3"
              style={{ background: '#0D0E10', border: '1px solid #2A2D31' }}
            >
              <p className="text-[12px] text-[#9aa0a6]">
                Karyawan aktif saat ini:
                <br />
                <span className="text-[13px] font-medium text-[#e5c17b] mt-1 inline-block">
                  {activeEmployee ? `${activeEmployee.nama} (${activeEmployee.jabatan})` : 'ID tidak ditemukan'}
                </span>
              </p>
            </div>
          )}

          <button
            onClick={handleSave}
            disabled={isPending}
            className="flex items-center justify-center gap-2 h-10 px-6 rounded-xl text-[13px] font-bold transition-all disabled:opacity-60 disabled:cursor-not-allowed"
            style={{ background: '#e5c17b', color: '#0D0E10' }}
          >
            {isPending ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Menyimpan...
              </>
            ) : (
              'Simpan Pengaturan'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
