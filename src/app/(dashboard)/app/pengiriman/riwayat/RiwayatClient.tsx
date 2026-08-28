'use client';

import React, { useState, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Loader2, Trash2, AlertTriangle } from 'lucide-react';
import { batalSuratJalan, type SuratJalanRow } from '@/lib/actions/pengiriman/surat-jalan.actions';

export default function RiwayatClient({ initialData }: { initialData: SuratJalanRow[] }) {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [batalTarget, setBatalTarget] = useState<SuratJalanRow | null>(null);

  const filteredData = useMemo(() => {
    const q = search.toLowerCase();
    return initialData.filter(sj => 
      sj.nomor_sj.toLowerCase().includes(q) || 
      sj.klien_nama.toLowerCase().includes(q)
    );
  }, [initialData, search]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row justify-between gap-4">
        <input 
          type="text" 
          placeholder="Cari Nomor SJ atau Nama Klien..." 
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full sm:max-w-xs bg-[#1A1D1F] border border-[#2A2D31] text-[#e8eaed] px-4 py-2 rounded-md text-sm focus:outline-none focus:border-[#e5c17b]"
        />
        <Link 
          href="/app/pengiriman/buat-surat-jalan"
          className="bg-[#e5c17b] text-[#0D0E10] px-4 py-2 rounded-md font-bold text-sm hover:bg-[#d4b06a] transition-colors uppercase tracking-wider text-center"
        >
          + Buat Surat Jalan
        </Link>
      </div>

      <div className="bg-[#1A1D1F] border border-[#2A2D31] rounded-lg overflow-x-auto">
        <table className="w-full text-sm text-left">
          <thead className="text-xs text-[#9aa0a6] uppercase bg-[#0D0E10] border-b border-[#2A2D31]">
            <tr>
              <th className="px-6 py-4">Nomor SJ</th>
              <th className="px-6 py-4">Klien</th>
              <th className="px-6 py-4">Tanggal</th>
              <th className="px-6 py-4">Bundle</th>
              <th className="px-6 py-4">Total QTY</th>
              <th className="px-6 py-4 text-center">Status</th>
              <th className="px-6 py-4 text-right">Aksi</th>
            </tr>
          </thead>
          <tbody>
            {filteredData.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-6 py-12 text-center text-[#9aa0a6]">
                  {search ? 'Tidak ada surat jalan yang cocok dengan pencarian.' : 'Belum ada riwayat surat jalan.'}
                </td>
              </tr>
            ) : (
              filteredData.map(sj => (
                <tr key={sj.id} className="border-b border-[#2A2D31] hover:bg-[#0D0E10]/50 transition-colors">
                  <td className="px-6 py-4 font-mono font-medium text-[#e8eaed]">{sj.nomor_sj}</td>
                  <td className="px-6 py-4 text-[#e8eaed]">{sj.klien_nama}</td>
                  <td className="px-6 py-4 text-[#9aa0a6]">
                    {new Date(sj.tanggal).toLocaleDateString('id-ID', { year: 'numeric', month: 'long', day: 'numeric' })}
                  </td>
                  <td className="px-6 py-4 text-[#e8eaed]">{sj.total_bundle} <span className="text-[#9aa0a6] text-xs">Bundle</span></td>
                  <td className="px-6 py-4 text-[#e8eaed]">{sj.total_qty} <span className="text-[#9aa0a6] text-xs">Pcs</span></td>
                  <td className="px-6 py-4 text-center">
                    <span className="inline-block px-2 py-1 text-[10px] font-bold tracking-widest uppercase rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                      {sj.status}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center justify-end gap-4">
                      <Link
                        href={`/app/pengiriman/riwayat/${sj.id}`}
                        className="text-[#e5c17b] hover:text-[#d4b06a] text-xs font-medium uppercase tracking-wider whitespace-nowrap"
                      >
                        Lihat Detail &rarr;
                      </Link>
                      <button
                        onClick={() => setBatalTarget(sj)}
                        title="Batalkan surat jalan"
                        className="text-[#9aa0a6] hover:text-red-400 transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {batalTarget && (
        <ModalBatalSuratJalan
          sj={batalTarget}
          onClose={() => setBatalTarget(null)}
          onSuccess={() => { setBatalTarget(null); router.refresh(); }}
        />
      )}
    </div>
  );
}

// ─── Modal pembatalan ─────────────────────────────────────────────────────────

function ModalBatalSuratJalan({
  sj, onClose, onSuccess,
}: {
  sj: SuratJalanRow;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [pin, setPin] = useState('');
  const [alasan, setAlasan] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const bisaKirim = /^\d{4}$/.test(pin) && alasan.trim().length > 0;

  const handleSubmit = async () => {
    if (!bisaKirim) return;
    setIsSubmitting(true);
    try {
      const hasil = await batalSuratJalan(sj.id, pin, alasan);
      toast.success(
        `${hasil.nomor_sj} dibatalkan — ${hasil.total_qty} pcs kembali ke daftar siap kirim`
      );
      onSuccess();
    } catch (e: any) {
      toast.error(e.message ?? 'Gagal membatalkan surat jalan');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/75 flex items-center justify-center z-50 p-4">
      <div className="bg-[#1A1D1F] border border-[#2A2D31] rounded-xl w-full max-w-md shadow-2xl">
        <div className="px-6 py-5">
          <div className="flex items-start gap-3 mb-4">
            <div className="w-9 h-9 rounded-lg bg-red-500/10 flex items-center justify-center flex-shrink-0 mt-0.5">
              <AlertTriangle className="w-5 h-5 text-red-400" />
            </div>
            <div>
              <h3 className="text-base font-bold text-[#e8eaed]">Batalkan Surat Jalan</h3>
              <p className="text-xs text-[#9aa0a6] mt-1">Tindakan ini tidak bisa dikembalikan</p>
            </div>
          </div>

          <div className="bg-[#16181A] border border-[#2A2D31] rounded-lg px-4 py-3 text-sm text-[#e8eaed] leading-relaxed mb-4">
            <span className="font-mono text-[#e5c17b] font-bold">{sj.nomor_sj}</span>{' '}
            ({sj.total_bundle} bundle · {sj.total_qty} pcs) akan dihapus, dan{' '}
            <span className="font-semibold">invoice-nya ikut dibatalkan</span>.
            Barangnya kembali ke daftar siap kirim.
            <p className="text-[10px] text-[#9aa0a6] mt-2">
              Nomor {sj.nomor_sj} tidak akan dipakai lagi — surat jalan berikutnya tetap lanjut ke nomor baru.
            </p>
          </div>

          <div className="mb-3">
            <label className="block text-[10px] uppercase tracking-widest text-[#9aa0a6] font-bold mb-2">
              Alasan pembatalan
            </label>
            <input
              type="text"
              value={alasan}
              onChange={(e) => setAlasan(e.target.value)}
              placeholder="Contoh: salah pilih bundle"
              className="w-full bg-[#16181A] border border-[#2A2D31] rounded-lg px-3 py-2 text-sm text-[#e8eaed] placeholder-[#9aa0a6]/50 outline-none focus:border-[#e5c17b]"
            />
          </div>

          <div className="mb-5">
            <label className="block text-[10px] uppercase tracking-widest text-[#9aa0a6] font-bold mb-2">
              PIN Owner
            </label>
            <input
              type="password"
              inputMode="numeric"
              maxLength={4}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
              placeholder="4 digit"
              className="w-32 bg-[#16181A] border border-[#2A2D31] rounded-lg px-3 py-2 text-sm text-[#e8eaed] text-center tracking-[0.4em] placeholder-[#9aa0a6]/50 placeholder:tracking-normal outline-none focus:border-[#e5c17b]"
            />
          </div>

          <div className="flex items-center justify-end gap-3">
            <button
              onClick={onClose}
              disabled={isSubmitting}
              className="px-4 h-9 rounded-lg border border-[#2A2D31] text-[#e8eaed] text-sm hover:bg-[#2A2D31] transition-colors disabled:opacity-50"
            >
              Batal
            </button>
            <button
              onClick={handleSubmit}
              disabled={!bisaKirim || isSubmitting}
              className="flex items-center gap-2 px-4 h-9 rounded-lg bg-red-500 hover:bg-red-600 text-white text-sm font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
              Ya, Batalkan
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
