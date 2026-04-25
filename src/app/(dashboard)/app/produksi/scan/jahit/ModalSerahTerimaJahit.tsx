'use client';

import React, { useState } from 'react';
import { type AntrianJahitBundle } from '@/lib/actions/produksi/scan.actions';
import { scanJahitTerima } from '@/lib/actions/produksi/scan-mutations.actions';
import { getAksesoriForKartuKerja } from '@/lib/actions/produksi/model-aksesori.actions';
import PrintKartuKerjaLayout, { type KartuBundle, type AksesoriItem } from '@/app/(dashboard)/app/produksi/antrian-cutting/PrintKartuKerjaLayout';
import { X, User, Printer, Loader2, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';

interface Props {
  selectedBundles: AntrianJahitBundle[];
  karyawanList: { id: string; nama: string }[];
  onSuccess: () => void;
  onClose: () => void;
}

export default function ModalSerahTerimaJahit({ selectedBundles, karyawanList, onSuccess, onClose }: Props) {
  const [karyawanId, setKaryawanId] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [kartuData, setKartuData] = useState<KartuBundle[]>([]);

  const handleSubmit = async () => {
    if (!karyawanId) {
      toast.error('Pilih karyawan penjahit terlebih dahulu');
      return;
    }

    const selectedKaryawan = karyawanList.find(k => k.id === karyawanId);
    if (!selectedKaryawan) return;

    setIsSubmitting(true);
    try {
      // 1. Process submit scan
      const warnings: string[] = [];
      for (const bundle of selectedBundles) {
        const res = await scanJahitTerima({
          barcode: bundle.barcode,
          karyawan_id: karyawanId,
          qty: bundle.qty_per_bundle
        });
        if (res.stok_warnings?.length > 0) {
           res.stok_warnings.forEach(w => {
               warnings.push(`${w.item_nama} kurang ${w.qty_kurang}`);
           });
        }
      }

      if (warnings.length > 0) {
         toast.warning(`Beberapa stok kurang: ${warnings.join(', ')}`);
      }

      // 2. Prepare print data
      const poItemIds = [...new Set(selectedBundles.map(b => b.po_item_id))];
      const aksesoriMap = await getAksesoriForKartuKerja(poItemIds);

      const dataToPrint: KartuBundle[] = selectedBundles.map((b) => {
        const aks: AksesoriItem[] = (aksesoriMap[b.po_item_id] ?? []).map(item => ({
          nama: item.inventory_item_nama,
          qty_per_pcs: item.qty_per_pcs,
          satuan: item.satuan,
          tahap_pakai: item.tahap_pakai,
        }));

        // Parsing no_urut dari barcode kalau formatnya PO-XXX-0001-bdl01
        let parsedUrut = 0;
        const bMatch = b.barcode.match(/bdl(\d+)$/i);
        if (bMatch && bMatch[1]) {
          parsedUrut = parseInt(bMatch[1], 10);
        }

        return {
          id: b.id,
          barcode: b.barcode,
          no_urut: parsedUrut,
          po_id: '', 
          po_item_id: b.po_item_id,
          no_po: b.no_po,
          tanggal_order: '',
          tanggal_target: '',
          po_catatan: null,
          klien_nama: b.klien_nama,
          model_nama: b.model_nama,
          warna: b.warna,
          size: b.size,
          qty_per_bundle: b.qty_per_bundle,
          aksesori: aks,
          nama_penjahit: selectedKaryawan.nama,
        };
      });

      setKartuData(dataToPrint);

      // 3. Trigger Print
      setTimeout(() => {
        window.print();
        toast.success(`Berhasil serah terima ${selectedBundles.length} bundle`);
        onSuccess();
      }, 500);

    } catch (err: any) {
      toast.error(err.message || 'Gagal memproses serah terima');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <div className="fixed inset-0 bg-black/75 flex items-center justify-center z-50 p-4 print:hidden">
        <div className="bg-[#1A1D1F] border border-[#2A2D31] rounded-2xl w-full max-w-2xl shadow-2xl flex flex-col max-h-[90vh]">
          {/* Header */}
          <div className="px-6 py-5 border-b border-[#2A2D31] flex items-center justify-between">
            <div>
              <h2 className="text-xl font-bold text-[#e8eaed]">Serah Terima Jahit</h2>
              <p className="text-sm text-[#9aa0a6] mt-1">{selectedBundles.length} bundle dipilih</p>
            </div>
            <button 
              onClick={onClose}
              disabled={isSubmitting}
              className="w-8 h-8 flex items-center justify-center rounded-lg text-[#9aa0a6] hover:text-[#e8eaed] hover:bg-[#2A2D31] transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            <div className="space-y-2">
              <label className="text-[10px] font-black uppercase tracking-[0.2em] text-[#e5c17b] flex items-center gap-2">
                <User size={14} /> Karyawan Penjahit
              </label>
              <select
                value={karyawanId}
                onChange={(e) => setKaryawanId(e.target.value)}
                disabled={isSubmitting}
                className="w-full bg-[#16181A] border border-[#2A2D31] rounded-xl px-4 py-3 text-[#e8eaed] focus:ring-1 focus:ring-[#e5c17b] outline-none transition-all text-sm"
              >
                <option value="">-- Pilih Penjahit --</option>
                {karyawanList.map(k => (
                  <option key={k.id} value={k.id}>{k.nama}</option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-black uppercase tracking-[0.2em] text-[#9aa0a6] flex items-center gap-2">
                <AlertCircle size={14} /> Daftar Bundle
              </label>
              <div className="border border-[#2A2D31] rounded-xl overflow-hidden bg-[#16181A]">
                <div className="max-h-60 overflow-y-auto">
                  <table className="w-full text-sm text-left">
                    <thead className="bg-[#1A1D1F] border-b border-[#2A2D31] sticky top-0">
                      <tr>
                        <th className="px-4 py-2 text-[10px] uppercase text-[#9aa0a6] font-bold">Barcode</th>
                        <th className="px-4 py-2 text-[10px] uppercase text-[#9aa0a6] font-bold">Warna/Size</th>
                        <th className="px-4 py-2 text-[10px] uppercase text-[#9aa0a6] font-bold text-center">QTY</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#2A2D31]">
                      {selectedBundles.map(b => (
                        <tr key={b.id} className="hover:bg-[#2A2D31]/30">
                          <td className="px-4 py-2 font-mono text-[#e5c17b]">{b.barcode}</td>
                          <td className="px-4 py-2 text-[#e8eaed]">{b.warna} / {b.size}</td>
                          <td className="px-4 py-2 text-center text-[#e8eaed] font-bold">{b.qty_per_bundle}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="px-6 py-4 border-t border-[#2A2D31] flex justify-end gap-3 bg-[#16181A] rounded-b-2xl">
            <button
              onClick={onClose}
              disabled={isSubmitting}
              className="px-6 py-2.5 rounded-xl border border-[#2A2D31] text-sm font-bold text-[#e8eaed] hover:bg-[#2A2D31] transition-colors disabled:opacity-50"
            >
              Batal
            </button>
            <button
              onClick={handleSubmit}
              disabled={isSubmitting || !karyawanId}
              className="flex items-center gap-2 bg-[#e5c17b] hover:bg-[#d4b06a] text-[#0D0E10] px-6 py-2.5 rounded-xl text-sm font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Printer className="w-4 h-4" />}
              {isSubmitting ? 'Memproses...' : 'Print & Mulai Jahit'}
            </button>
          </div>
        </div>
      </div>

      {kartuData.length > 0 && (
        <PrintKartuKerjaLayout 
          bundles={kartuData}
          tglCetak={new Date().toLocaleString('id-ID', {
            day: '2-digit', month: 'short', year: 'numeric',
            hour: '2-digit', minute: '2-digit'
          })}
        />
      )}
    </>
  );
}
