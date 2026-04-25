'use client';

import React from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { CheckCircle, XCircle, Info, Tag } from 'lucide-react';
import type { BundleForScan } from '@/lib/actions/produksi/scan.actions';
import type { ModelAksesori } from '@/lib/actions/produksi/model-aksesori.actions';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bundle: BundleForScan;
  karyawanNama: string;
  aksesori: ModelAksesori[];
  onApprove: () => void;
  disabled: boolean;
}

export default function ModalSerahTerima({
  open,
  onOpenChange,
  bundle,
  karyawanNama,
  aksesori,
  onApprove,
  disabled
}: Props) {

  const formatDate = (date: Date) => {
    return date.toLocaleDateString('id-ID', {
      day: '2-digit',
      month: 'long',
      year: 'numeric'
    });
  };

  const today = formatDate(new Date());

  const InfoBlock = ({ label, value }: { label: string; value: string | number }) => (
    <div className="bg-[#1A1D1F] p-3 rounded-lg border border-[#2A2D31]">
      <p className="text-[10px] uppercase tracking-wider text-[#9aa0a6] mb-1 font-bold">{label}</p>
      <p className="text-sm font-semibold text-[#e8eaed]">{value}</p>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-[#16181A] border border-[#2A2D31] text-[#e8eaed] sm:max-w-2xl p-0 overflow-hidden">
        <div className="p-6 space-y-6 max-h-[85vh] overflow-y-auto print:p-0 print:overflow-visible">
          <DialogHeader className="border-b border-[#2A2D31] pb-4">
            <div className="flex items-center justify-between">
              <DialogTitle className="text-xl font-black italic tracking-tight text-[#e5c17b]">
                SURAT SERAH TERIMA KERJA
              </DialogTitle>
              <div className="text-[10px] font-mono text-[#9aa0a6] border border-[#2A2D31] px-2 py-1 rounded">
                {bundle.barcode}
              </div>
            </div>
          </DialogHeader>

          {/* Info Bundle */}
          <section className="space-y-3">
            <div className="flex items-center gap-2 text-[#e5c17b] mb-1">
              <Info size={14} />
              <h3 className="text-[11px] font-bold uppercase tracking-widest">Informasi Produksi</h3>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <InfoBlock label="No. PO" value={bundle.no_po} />
              <InfoBlock label="Tanggal" value={today} />
              <InfoBlock label="Model" value={bundle.model_nama ?? '-'} />
              <InfoBlock label="Warna" value={bundle.warna} />
              <InfoBlock label="Size" value={bundle.size} />
              <InfoBlock label="QTY Bundle" value={`${bundle.qty_per_bundle} pcs`} />
            </div>
            <div className="grid grid-cols-1">
              <InfoBlock label="Penjahit / Penerima" value={karyawanNama || '-'} />
            </div>
          </section>

          {/* Aksesori yang Diserahkan */}
          <section className="space-y-3">
            <div className="flex items-center gap-2 text-[#e5c17b] mb-1">
              <Tag size={14} />
              <h3 className="text-[11px] font-bold uppercase tracking-widest">Aksesori yang Diserahkan</h3>
            </div>
            {aksesori.length > 0 ? (
              <div className="bg-[#1A1D1F] border border-[#2A2D31] rounded-xl overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[#2A2D31]">
                      <th className="text-left px-4 py-2 text-[10px] uppercase tracking-wider text-[#9aa0a6] font-bold">Aksesori</th>
                      <th className="text-right px-4 py-2 text-[10px] uppercase tracking-wider text-[#9aa0a6] font-bold">QTY / Pcs</th>
                      <th className="text-right px-4 py-2 text-[10px] uppercase tracking-wider text-[#9aa0a6] font-bold">Total ({bundle.qty_per_bundle} pcs)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {aksesori.map((item, idx) => (
                      <tr key={item.id} className={idx % 2 === 0 ? 'bg-[#1A1D1F]' : 'bg-[#16181A]'}>
                        <td className="px-4 py-2 text-[#e8eaed] font-medium">{item.inventory_item_nama}</td>
                        <td className="px-4 py-2 text-right text-[#9aa0a6]">{item.qty_per_pcs} {item.satuan}</td>
                        <td className="px-4 py-2 text-right font-bold text-[#e5c17b]">
                          {item.qty_per_pcs * bundle.qty_per_bundle} {item.satuan}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="bg-[#1A1D1F] border border-[#2A2D31] border-dashed rounded-xl p-6 text-center">
                <p className="text-xs text-[#9aa0a6] italic">Tidak ada aksesori yang perlu diserahkan untuk tahap ini.</p>
              </div>
            )}
          </section>
        </div>

        {/* Footer */}
        <DialogFooter className="bg-[#1A1D1F] border-t border-[#2A2D31] p-4 flex flex-row justify-end gap-2 print:hidden">
          <Button
            type="button"
            variant="outline"
            disabled={disabled}
            onClick={() => onOpenChange(false)}
            className="border-[#2A2D31] text-[#9aa0a6] bg-transparent hover:bg-[#2A2D31] hover:text-[#e8eaed]"
          >
            <XCircle className="w-4 h-4 mr-2" />
            Batal
          </Button>
          <Button
            type="button"
            disabled={disabled}
            onClick={onApprove}
            className="bg-[#e5c17b] text-[#0D0E10] hover:bg-[#e5c17b]/90 font-bold shadow-[0_0_20px_rgba(229,193,123,0.15)]"
          >
            <CheckCircle className="w-4 h-4 mr-2" />
            Approve & Serahkan
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
