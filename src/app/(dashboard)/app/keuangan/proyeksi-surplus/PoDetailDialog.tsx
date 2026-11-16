'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { getProyeksiPoDetail, type ProyeksiArtikel, type ProyeksiTahap } from '@/lib/actions/keuangan/proyeksi-surplus.actions';

export interface PoDipilih {
  po_id: string;
  no_po: string;
  klien: string;
}

const LABEL_TAHAP: Record<string, string> = {
  cutting: 'Cutting', jahit: 'Jahit', lubang_kancing: 'Lubang Kancing', buang_benang: 'Buang Benang',
  qc: 'QC', steam: 'Steam', packing: 'Packing',
};
const labelTahap = (t: string) => LABEL_TAHAP[t] ?? t.replace(/_/g, ' ');
const angka = (n: number) => n.toLocaleString('id-ID');

/** Ringkasan posisi barang: tahap yang sedang dikerjakan, atau tahap pertama yang belum selesai */
function posisi(a: ProyeksiArtikel): { teks: string; kelas: string } {
  const proses = a.tahap.filter(t => t.proses > 0);
  if (proses.length) {
    return {
      teks: proses.map(t => `${angka(t.proses)} pcs sedang di ${labelTahap(t.tahap)}`).join(' · '),
      kelas: 'text-amber-300',
    };
  }
  const belum = a.tahap.find(t => t.selesai < a.pcs_potong);
  if (belum) return { teks: `Menunggu ${labelTahap(belum.tahap)}`, kelas: 'text-[#9aa0a6]' };
  if (a.pcs_kirim >= a.pcs_potong) return { teks: 'Sudah terkirim semua', kelas: 'text-green-300' };
  return { teks: `Semua tahap selesai — siap kirim ${angka(a.pcs_potong - a.pcs_kirim)} pcs`, kelas: 'text-sky-300' };
}

function Tahap({ t, total }: { t: ProyeksiTahap; total: number }) {
  const pSelesai = total > 0 ? (t.selesai / total) * 100 : 0;
  const pProses = total > 0 ? (t.proses / total) * 100 : 0;
  const beres = total > 0 && t.selesai >= total;
  return (
    <div className="min-w-0">
      <div className="flex justify-between gap-1 text-[11px] mb-1">
        <span className={beres ? 'text-green-300' : t.proses > 0 ? 'text-amber-300' : 'text-[#9aa0a6]'}>{labelTahap(t.tahap)}</span>
        <span className="text-[#9aa0a6] font-mono">{angka(t.selesai)}/{angka(total)}</span>
      </div>
      <div className="h-1.5 rounded-full bg-[#2A2D31] overflow-hidden flex">
        <div className="bg-green-500" style={{ width: `${pSelesai}%` }} />
        <div className="bg-amber-400" style={{ width: `${pProses}%` }} />
      </div>
    </div>
  );
}

export default function PoDetailDialog({ po, onClose }: { po: PoDipilih | null; onClose: () => void }) {
  // Hasil disimpan bersama po_id-nya; data PO lain (klik sebelumnya) tidak ditampilkan
  const [hasil, setHasil] = useState<{ poId: string; data?: ProyeksiArtikel[]; error?: string } | null>(null);

  useEffect(() => {
    if (!po) return;
    let batal = false;
    getProyeksiPoDetail(po.po_id)
      .then(d => { if (!batal) setHasil({ poId: po.po_id, data: d }); })
      .catch(e => { if (!batal) setHasil({ poId: po.po_id, error: String(e?.message ?? e) }); });
    return () => { batal = true; };
  }, [po]);

  const cocok = hasil && po && hasil.poId === po.po_id ? hasil : null;
  const data = cocok?.data ?? null;
  const error = cocok?.error ?? null;

  const totalPotong = data?.reduce((s, a) => s + a.pcs_potong, 0) ?? 0;
  const totalKirim = data?.reduce((s, a) => s + a.pcs_kirim, 0) ?? 0;

  return (
    <Dialog open={!!po} onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="bg-[#1A1D1F] border-[#2A2D31] text-[#e8eaed] sm:max-w-[640px] max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-mono">{po?.no_po}</DialogTitle>
          <DialogDescription className="text-[#9aa0a6]">
            {po?.klien}
            {data && <> · {angka(totalPotong)} pcs dipotong · {angka(totalKirim)} pcs terkirim</>}
          </DialogDescription>
        </DialogHeader>

        {error && <p className="text-sm text-red-400">Gagal memuat: {error}</p>}
        {!data && !error && (
          <div className="flex items-center gap-2 text-sm text-[#9aa0a6] py-6 justify-center">
            <Loader2 className="h-4 w-4 animate-spin" /> Memuat…
          </div>
        )}
        {data && data.length === 0 && <p className="text-sm text-[#9aa0a6]">Belum ada hasil potong.</p>}

        {data && data.length > 0 && (
          <div className="space-y-3">
            {data.map(a => {
              const pos = posisi(a);
              return (
                <div key={a.po_item_id} className="rounded-lg border border-[#2A2D31] p-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 mb-1">
                    <span className="text-sm font-semibold">
                      {a.model} <span className="text-[#9aa0a6] font-normal">— {a.warna} · {a.size}</span>
                    </span>
                    <span className="text-xs text-[#9aa0a6]">
                      {angka(a.pcs_potong)} pcs dipotong
                      {a.qty_order > 0 && a.qty_order !== a.pcs_potong && <> (order {angka(a.qty_order)})</>}
                      {' · '}{angka(a.pcs_kirim)} terkirim
                    </span>
                  </div>
                  <p className={`text-xs mb-3 ${pos.kelas}`}>{pos.teks}</p>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2.5">
                    {a.tahap.map(t => <Tahap key={t.tahap} t={t} total={a.pcs_potong} />)}
                  </div>
                </div>
              );
            })}
            <p className="flex items-center gap-3 text-[11px] text-[#5f6368]">
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-green-500" /> selesai</span>
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-amber-400" /> sedang dikerjakan</span>
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-[#2A2D31]" /> belum</span>
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
