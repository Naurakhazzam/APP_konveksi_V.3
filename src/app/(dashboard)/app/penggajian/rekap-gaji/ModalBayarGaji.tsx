'use client';

import { useState } from 'react';
import { 
  prosesBayar, 
  type RekapGajiItem 
} from '@/lib/actions/penggajian/penggajian.actions';
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle, 
  DialogFooter 
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CreditCard, AlertCircle, Info, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  selectedKaryawan: RekapGajiItem | null;
  onSuccess: (karyawan_id: string) => void;
}

export default function ModalBayarGaji({ isOpen, onClose, selectedKaryawan, onSuccess }: Props) {
  const [hariKerja, setHariKerja] = useState(6);
  const [potongKasbon, setPotongKasbon] = useState(0);
  const [loading, setLoading] = useState(false);

  if (!selectedKaryawan) return null;

  // Re-calculate when modal opens or inputs change
  const gapok = Number(selectedKaryawan.gaji_pokok) || 0;
  const gapokProrata = (gapok / 6) * hariKerja;
  const totalDibayarkan = selectedKaryawan.upah_bersih + gapokProrata - potongKasbon;

  // Initialize potongKasbon to kasbon_sisa when modal opens for a new person
  // But we use a useEffect-like pattern or just handle it in the parent
  // For simplicity, let's just use the current values.

  const handleConfirm = async () => {
    if (totalDibayarkan < 0) {
      toast.error('Total dibayarkan tidak boleh negatif');
      return;
    }

    setLoading(true);
    try {
      await prosesBayar({
        karyawan_id: selectedKaryawan.karyawan_id,
        entry_ids: selectedKaryawan.entry_ids,
        hari_kerja: hariKerja,
        potong_kasbon: potongKasbon
      });
      
      toast.success(`Gaji ${selectedKaryawan.karyawan_nama} berhasil diproses`);
      onSuccess(selectedKaryawan.karyawan_id);
      onClose();
    } catch (err: any) {
      toast.error(err.message || 'Gagal memproses pembayaran');
    } finally {
      setLoading(false);
    }
  };

  const formatIDR = (val: number) => val.toLocaleString('id-ID');

  return (
    <Dialog open={isOpen} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="bg-[#1A1D1F] border border-[#2A2D31] text-[#e8eaed] max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-[#e5c17b]">
            <CreditCard className="w-5 h-5" />
            Bayar Gaji — {selectedKaryawan.karyawan_nama}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Breakdown Section */}
          <div className="space-y-2 text-sm p-4 rounded-lg bg-[#0D0E10] border border-[#2A2D31]">
            <div className="flex justify-between">
              <span className="text-[#9aa0a6]">Upah Produksi</span>
              <span className="font-semibold">Rp {formatIDR(selectedKaryawan.total_upah_kotor)}</span>
            </div>
            <div className="flex justify-between text-red-400">
              <span className="text-[#9aa0a6]">Potongan Reject</span>
              <span className="font-semibold">-(Rp {formatIDR(selectedKaryawan.total_potongan)})</span>
            </div>
            <div className="pt-2 border-t border-[#2A2D31] flex justify-between font-bold text-[#e5c17b]">
              <span>Subtotal Upah</span>
              <span>Rp {formatIDR(selectedKaryawan.upah_bersih)}</span>
            </div>
            <div className="flex justify-between text-orange-400/80 italic text-xs">
              <span>Sisa Kasbon Aktif</span>
              <span>Rp {formatIDR(selectedKaryawan.kasbon_sisa)}</span>
            </div>
          </div>

          {/* Inputs */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-xs text-[#9aa0a6]">Hari Kerja (0–6 hari)</Label>
              <Input 
                type="number"
                min={0}
                max={6}
                value={hariKerja}
                onChange={(e) => setHariKerja(Number(e.target.value))}
                className="bg-[#16181A] border-[#2A2D31] focus:ring-[#e5c17b]"
              />
              <p className="text-[10px] text-[#e5c17b] font-medium">Gapok: Rp {formatIDR(gapokProrata)}</p>
            </div>
            <div className="space-y-2">
              <Label className="text-xs text-[#9aa0a6]">Potong Kasbon (Rp)</Label>
              <Input 
                type="number"
                min={0}
                max={selectedKaryawan.kasbon_sisa}
                value={potongKasbon}
                onChange={(e) => setPotongKasbon(Number(e.target.value))}
                className="bg-[#16181A] border-[#2A2D31] focus:ring-[#e5c17b]"
              />
              <p className="text-[10px] text-[#9aa0a6]">Max: Rp {formatIDR(selectedKaryawan.kasbon_sisa)}</p>
            </div>
          </div>

          {/* Grand Total */}
          <div className="p-5 rounded-xl bg-[#e5c17b] text-[#0D0E10] text-center space-y-1 shadow-lg shadow-yellow-500/10">
            <p className="text-[10px] font-bold uppercase tracking-widest opacity-70">Total Dibayarkan</p>
            <p className="text-3xl font-black">Rp {formatIDR(totalDibayarkan)}</p>
            {totalDibayarkan < 0 && (
              <div className="flex items-center justify-center gap-1 text-red-700 font-bold text-xs mt-2">
                <AlertCircle className="w-3 h-3" />
                Total minus, periksa kasbon
              </div>
            )}
          </div>

          <div className="flex gap-2 text-[10px] text-[#9aa0a6] leading-relaxed bg-[#16181A] p-3 rounded border border-[#2A2D31]">
            <Info className="w-4 h-4 shrink-0 text-[#e5c17b]" />
            Pembayaran akan melunasi {selectedKaryawan.entry_ids.length} entri upah dan mencatat transaksi di jurnal keuangan.
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={onClose} className="text-[#9aa0a6] hover:bg-[#2A2D31]">Batal</Button>
          <Button 
            onClick={handleConfirm} 
            disabled={loading || totalDibayarkan < 0}
            className="bg-[#e5c17b] hover:bg-[#d4b06a] text-[#0D0E10] font-bold px-8 shadow-xl"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
            ✓ Konfirmasi Bayar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

