'use client';

import { useState } from 'react';
import { recordReject } from '@/lib/actions/produksi/reject.actions';
import { toast } from 'sonner';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';

interface Props {
  gajiLedgerId: string | null;
  upahNominal: number;
  onDone: () => void; // dipanggil setelah berhasil atau user skip
}

const TIPE_OPTIONS = [
  { value: 'rework', label: 'Rework (Gaji Ditahan)', desc: 'Upah di-hold sampai rework selesai' },
  { value: 'cacat_bahan', label: 'Cacat Bahan (Potong 50%)', desc: '50% dari nilai upah bundle ini akan dipotong' },
  { value: 'permanen', label: 'Reject Permanen (Potong 100%)', desc: '100% nilai upah bundle ini dipotong' },
];

export default function RejectSection({ gajiLedgerId, upahNominal, onDone }: Props) {
  const [open, setOpen] = useState(false);
  const [tipe, setTipe] = useState<'rework' | 'cacat_bahan' | 'permanen'>('rework');
  const [qtyReject, setQtyReject] = useState(1);
  const [alasan, setAlasan] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  if (!gajiLedgerId) return null;
  if (done) return (
    <div className="mt-4 flex items-center gap-2 text-xs text-green-400 font-medium">
      <CheckCircle2 className="w-4 h-4" /> Reject berhasil dicatat.
    </div>
  );

  const formatIDR = (v: number) => v.toLocaleString('id-ID');
  const estimasiPotongan =
    tipe === 'rework' ? 0 :
    tipe === 'cacat_bahan' ? Math.round(upahNominal * 0.5) :
    upahNominal;

  const handleSubmit = async () => {
    if (!alasan.trim()) { toast.error('Alasan reject wajib diisi'); return; }
    setLoading(true);
    try {
      await recordReject({ gaji_ledger_id: gajiLedgerId, qty_reject: qtyReject, tipe_reject: tipe, alasan });
      toast.success('Reject berhasil dicatat');
      setDone(true);
    } catch (err: any) {
      toast.error(err.message || 'Gagal catat reject');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mt-4 border border-red-800/30 rounded-xl bg-red-950/20 overflow-hidden">
      {!open ? (
        <button
          onClick={() => setOpen(true)}
          className="w-full flex items-center gap-2 px-4 py-3 text-sm text-red-400 hover:bg-red-900/20 transition-colors"
        >
          <AlertTriangle className="w-4 h-4" />
          Ada reject pada bundle ini?
        </button>
      ) : (
        <div className="p-4 space-y-3">
          <p className="text-xs font-bold text-red-400 uppercase tracking-wide flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5" /> Catat Reject
          </p>

          <div className="space-y-1">
            <label className="text-[10px] text-[#9aa0a6] uppercase font-bold">Tipe Reject</label>
            <select
              value={tipe}
              onChange={(e) => setTipe(e.target.value as any)}
              className="w-full h-9 px-3 rounded-lg bg-[#16181A] border border-[#2A2D31] text-sm text-[#e8eaed] focus:ring-1 focus:ring-red-400 outline-none"
            >
              {TIPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <p className="text-[10px] text-[#9aa0a6] italic">{TIPE_OPTIONS.find(o => o.value === tipe)?.desc}</p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-[10px] text-[#9aa0a6] uppercase font-bold">Qty Reject</label>
              <input
                type="number" min={1} value={qtyReject}
                onChange={(e) => setQtyReject(Number(e.target.value))}
                className="w-full h-9 px-3 rounded-lg bg-[#16181A] border border-[#2A2D31] text-sm text-[#e8eaed] focus:ring-1 focus:ring-red-400 outline-none"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] text-[#9aa0a6] uppercase font-bold">Est. Potongan</label>
              <div className="h-9 px-3 rounded-lg bg-[#0D0E10] border border-[#2A2D31] text-sm text-red-400 font-bold flex items-center">
                {tipe === 'rework' ? 'Escrow' : `Rp ${formatIDR(estimasiPotongan)}`}
              </div>
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-[10px] text-[#9aa0a6] uppercase font-bold">Alasan</label>
            <input
              type="text" value={alasan} placeholder="Deskripsikan reject..."
              onChange={(e) => setAlasan(e.target.value)}
              className="w-full h-9 px-3 rounded-lg bg-[#16181A] border border-[#2A2D31] text-sm text-[#e8eaed] placeholder:text-[#9aa0a6]/40 focus:ring-1 focus:ring-red-400 outline-none"
            />
          </div>

          <div className="flex gap-2 pt-1">
            <button
              onClick={() => setOpen(false)}
              className="flex-1 h-9 rounded-lg border border-[#2A2D31] text-xs text-[#9aa0a6] hover:bg-[#2A2D31] transition-colors"
            >
              Batal
            </button>
            <button
              onClick={handleSubmit}
              disabled={loading}
              className="flex-1 h-9 rounded-lg bg-red-700 hover:bg-red-600 text-xs text-white font-bold disabled:opacity-50 transition-colors"
            >
              {loading ? 'Menyimpan...' : 'Catat Reject'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
