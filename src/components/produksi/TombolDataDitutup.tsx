'use client';

import React, { useCallback, useState } from 'react';
import { toast } from 'sonner';
import { Archive, Loader2, RotateCcw, X } from 'lucide-react';
import {
  getBundleDitutup, bukaBundleDitutup, type BundleDitutup,
} from '@/lib/actions/produksi/bundle-ditutup.actions';

const tanggal = (iso: string) =>
  new Date(iso).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });

/**
 * Tombol + jendela daftar bundle yang ditutup sebagai data lama, dengan
 * opsi membukanya lagi kalau ternyata salah tutup.
 */
export default function TombolDataDitutup({ onBerubah }: { onBerubah: () => void }) {
  const [buka, setBuka] = useState(false);
  const [data, setData] = useState<BundleDitutup[]>([]);
  const [memuat, setMemuat] = useState(false);
  const [sedangBuka, setSedangBuka] = useState<string | null>(null);

  const muat = useCallback(async () => {
    setMemuat(true);
    try {
      setData(await getBundleDitutup());
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Gagal memuat data');
    } finally {
      setMemuat(false);
    }
  }, []);

  const bukaJendela = () => {
    setBuka(true);
    muat();
  };

  const bukaLagi = async (b: BundleDitutup) => {
    if (!window.confirm(`Buka lagi ${b.barcode}? Bundle akan kembali muncul di antrian.`)) return;
    setSedangBuka(b.id);
    try {
      await bukaBundleDitutup(b.id);
      toast.success(`${b.barcode} dibuka lagi`);
      await muat();
      onBerubah();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Gagal membuka bundle');
    } finally {
      setSedangBuka(null);
    }
  };

  return (
    <>
      <button
        onClick={bukaJendela}
        title="Bundle data lama yang sudah ditutup — bisa dibuka lagi"
        className="flex items-center gap-2 h-9 px-3 rounded-lg border border-[#2A2D31] text-[#9aa0a6] text-xs font-medium hover:bg-[#2A2D31] hover:text-[#e8eaed] transition-colors"
      >
        <Archive className="w-3.5 h-3.5" />
        Data Ditutup
      </button>

      {buka && (
        <div className="fixed inset-0 bg-black/75 flex items-center justify-center z-50 p-4">
          <div className="bg-[#1A1D1F] border border-[#2A2D31] rounded-xl w-full max-w-4xl shadow-2xl max-h-[90vh] flex flex-col">
            <div className="px-6 py-4 border-b border-[#2A2D31] flex items-start justify-between gap-4">
              <div>
                <h3 className="text-base font-bold text-[#e8eaed]">Data Ditutup</h3>
                <p className="text-xs text-[#9aa0a6] mt-0.5">
                  Bundle data lama yang ditutup manual. Tidak muncul di antrian & tidak membuat upah.
                </p>
              </div>
              <button onClick={() => setBuka(false)} className="text-[#9aa0a6] hover:text-[#e8eaed] transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="overflow-y-auto flex-1">
              {memuat ? (
                <div className="flex items-center justify-center gap-2 py-16 text-[#9aa0a6] text-sm">
                  <Loader2 className="w-5 h-5 animate-spin text-[#e5c17b]" /> Memuat...
                </div>
              ) : data.length === 0 ? (
                <div className="py-16 text-center text-sm text-[#9aa0a6]">Belum ada bundle yang ditutup.</div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-[#0D0E10] text-[10px] uppercase tracking-widest text-[#9aa0a6] sticky top-0">
                    <tr>
                      <th className="px-4 py-3 text-left font-bold">Bundle</th>
                      <th className="px-4 py-3 text-left font-bold">Posisi Terakhir</th>
                      <th className="px-4 py-3 text-left font-bold">Alasan</th>
                      <th className="px-4 py-3 text-left font-bold">Ditutup</th>
                      <th className="px-4 py-3" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#2A2D31]">
                    {data.map(b => (
                      <tr key={b.id}>
                        <td className="px-4 py-3">
                          <div className="font-mono text-xs text-[#e5c17b]">{b.barcode}</div>
                          <div className="text-[10px] text-[#9aa0a6] mt-0.5">
                            {b.no_po} · {b.model_nama ?? '-'} {b.warna} {b.size}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-xs text-[#e8eaed] whitespace-nowrap">{b.posisi}</td>
                        <td className="px-4 py-3 text-xs text-[#9aa0a6]">{b.ditutup_alasan}</td>
                        <td className="px-4 py-3 text-xs text-[#9aa0a6] whitespace-nowrap">{tanggal(b.ditutup_at)}</td>
                        <td className="px-4 py-3 text-right">
                          <button
                            onClick={() => bukaLagi(b)}
                            disabled={sedangBuka !== null}
                            className="inline-flex items-center gap-1.5 px-2.5 h-8 rounded-lg border border-[#2A2D31] text-[11px] text-[#9aa0a6] hover:text-[#e8eaed] hover:bg-[#2A2D31] transition-colors disabled:opacity-40"
                          >
                            {sedangBuka === b.id
                              ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              : <RotateCcw className="w-3.5 h-3.5" />}
                            Buka Lagi
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="px-6 py-3 border-t border-[#2A2D31] flex items-center justify-between">
              <span className="text-[10px] text-[#9aa0a6]">{data.length} bundle ditutup</span>
              <button
                onClick={() => setBuka(false)}
                className="px-4 h-9 rounded-lg border border-[#2A2D31] text-[#e8eaed] text-sm hover:bg-[#2A2D31] transition-colors"
              >
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
