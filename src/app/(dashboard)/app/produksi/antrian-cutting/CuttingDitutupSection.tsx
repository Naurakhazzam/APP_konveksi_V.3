'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, RotateCcw, ChevronDown, Archive } from 'lucide-react';
import { toast } from 'sonner';
import { getClosedCuttingBundles, type ClosedCuttingBundle } from '@/lib/actions/produksi/cutting.actions';
import { bukaKembaliCutting } from '@/lib/actions/produksi/lacak-barcode.actions';

interface Props {
  /** Naik setiap kali ada bundle baru di-Close dari daftar Pending. */
  refreshKey: number;
  /** Dipanggil setelah Buka Kembali — bundle pindah ke daftar Pending. */
  onDibuka: () => void | Promise<void>;
}

function formatTanggal(iso: string | null): string {
  if (!iso) return '-';
  return new Date(iso).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function CuttingDitutupSection({ refreshKey, onDibuka }: Props) {
  const [rows, setRows] = useState<ClosedCuttingBundle[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [terbuka, setTerbuka] = useState(true);
  const [target, setTarget] = useState<ClosedCuttingBundle | null>(null);
  const [alasan, setAlasan] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    try {
      setRows(await getClosedCuttingBundles());
    } catch (e: any) {
      toast.error('Gagal memuat cutting yang ditutup: ' + e.message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData, refreshKey]);

  const handleBuka = async () => {
    if (!target || !alasan.trim()) return;
    setSubmitting(true);
    try {
      const r = await bukaKembaliCutting(target.id, alasan.trim());
      toast.success(`${target.barcode} dibuka kembali — sisa ${r.sisa} pcs masuk daftar Pending`);
      setTarget(null);
      setAlasan('');
      await fetchData();
      await onDibuka();
    } catch (e: any) {
      toast.error(e.message ?? 'Gagal membuka kembali');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mt-8">
      <button
        onClick={() => setTerbuka(v => !v)}
        className="flex items-center gap-2 mb-3 text-left"
      >
        <Archive className="w-4 h-4 text-[#9aa0a6]" />
        <span className="text-sm font-bold text-[#e8eaed]">Sudah Ditutup</span>
        {!isLoading && (
          <span className="text-[10px] font-bold text-[#9aa0a6] bg-[#2A2D31] px-1.5 py-0.5 rounded">{rows.length}</span>
        )}
        <ChevronDown className={`w-4 h-4 text-[#9aa0a6] transition-transform ${terbuka ? 'rotate-180' : ''}`} />
      </button>

      {terbuka && (
        <>
          <p className="text-xs text-[#9aa0a6] mb-3">
            Sisa potongan yang sudah di-Close dan dianggap batal. Kalau ternyata masih akan dipotong, buka kembali.
            Sisanya pindah ke daftar Pending di atas dan bisa dilanjutkan seperti biasa.
          </p>

          {isLoading ? (
            <div className="flex items-center gap-2 py-6 text-[#9aa0a6] text-sm">
              <Loader2 className="w-4 h-4 animate-spin text-[#e5c17b]" /> Memuat...
            </div>
          ) : rows.length === 0 ? (
            <div className="rounded-xl border border-[#2A2D31] bg-[#1A1D1F] px-4 py-8 text-center text-sm text-[#9aa0a6]">
              Tidak ada sisa cutting yang ditutup
            </div>
          ) : (
            <div className="rounded-xl border border-[#2A2D31] bg-[#1A1D1F] overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-[#16181A] border-b border-[#2A2D31]">
                    {['No PO', 'Barcode', 'Artikel', 'Warna', 'Size', 'Rencana', 'Terpotong', 'Sisa Ditutup', 'Ditutup', 'Aksi'].map((h, i) => (
                      <th key={h} className={`px-4 py-3 text-[10px] uppercase tracking-widest text-[#9aa0a6] font-bold ${i >= 5 ? 'text-center' : 'text-left'}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#2A2D31]">
                  {rows.map(b => (
                    <tr key={b.id} className="bg-[#1A1D1F] hover:bg-[#1E2124] transition-colors">
                      <td className="px-4 py-3 font-mono font-bold text-[#e5c17b] whitespace-nowrap">{b.no_po}</td>
                      <td className="px-4 py-3 font-mono text-xs text-[#e8eaed] whitespace-nowrap">
                        {b.barcode}
                        {b.terkirim && (
                          <div className="text-[10px] font-sans text-emerald-400 mt-0.5">sudah terkirim</div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-[#e8eaed]">{b.model_nama ?? '-'}</td>
                      <td className="px-4 py-3 text-[#9aa0a6]">{b.warna}</td>
                      <td className="px-4 py-3 text-[#9aa0a6]">{b.size}</td>
                      <td className="px-4 py-3 text-center text-[#e8eaed] font-semibold">{b.qty_order}</td>
                      <td className="px-4 py-3 text-center text-[#e8eaed]">{b.qty_terpotong}</td>
                      <td className="px-4 py-3 text-center">
                        <span className="inline-flex px-2 py-0.5 rounded-full bg-[#2A2D31] text-[#9aa0a6] text-[10px] font-bold whitespace-nowrap">
                          {b.sisa} pcs
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center text-xs text-[#9aa0a6] whitespace-nowrap">
                        {formatTanggal(b.closed_at)}
                        {b.closed_by_nama && <div className="text-[10px] text-[#5f6368]">{b.closed_by_nama}</div>}
                        {b.alasan && <div className="text-[10px] text-[#5f6368] max-w-[180px] truncate" title={b.alasan}>{b.alasan}</div>}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <button
                          onClick={() => { setTarget(b); setAlasan(''); }}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[#e5c17b]/10 text-[#e5c17b] border border-[#e5c17b]/20 text-xs font-semibold hover:bg-[#e5c17b]/20 transition-colors whitespace-nowrap"
                        >
                          <RotateCcw className="w-3.5 h-3.5" /> Buka Kembali
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {target && (
        <div className="fixed inset-0 bg-black/75 flex items-center justify-center z-50 p-4">
          <div className="bg-[#1A1D1F] border border-[#2A2D31] rounded-xl w-full max-w-md shadow-2xl px-6 py-5">
            <h3 className="text-base font-bold text-[#e8eaed]">Buka Kembali Cutting</h3>
            <div className="bg-[#16181A] border border-[#2A2D31] rounded-lg px-4 py-3 text-sm text-[#e8eaed] leading-relaxed mt-4">
              Sisa <span className="text-orange-400 font-bold">{target.sisa} pcs</span> dari bundle{' '}
              <span className="font-mono text-[#e5c17b] font-bold">{target.barcode}</span> akan muncul lagi di daftar Pending
              untuk di-Lanjut Cutting. Bundle ini sendiri tidak berubah.
            </div>
            <label className="block text-[11px] font-bold text-[#9aa0a6] uppercase tracking-wider mt-4 mb-1.5">
              Alasan <span className="text-red-400">*</span>
            </label>
            <textarea
              value={alasan}
              onChange={(e) => setAlasan(e.target.value)}
              rows={2}
              placeholder="Misal: sisa ternyata masih akan dipotong"
              className="w-full bg-[#16181A] border border-[#2A2D31] rounded-lg px-3 py-2 text-sm text-[#e8eaed] placeholder:text-[#5f6368] focus:border-[#e5c17b] outline-none resize-none"
            />
            <div className="flex items-center justify-end gap-3 mt-5">
              <button
                onClick={() => setTarget(null)}
                className="px-4 h-9 rounded-lg border border-[#2A2D31] text-[#e8eaed] text-sm hover:bg-[#2A2D31] transition-colors"
              >
                Batal
              </button>
              <button
                onClick={handleBuka}
                disabled={!alasan.trim() || submitting}
                className="flex items-center gap-2 px-4 h-9 rounded-lg bg-[#e5c17b] hover:bg-[#d4b16a] disabled:opacity-40 disabled:cursor-not-allowed text-[#0D0E10] text-sm font-bold transition-colors"
              >
                {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
                Ya, Buka Kembali
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
