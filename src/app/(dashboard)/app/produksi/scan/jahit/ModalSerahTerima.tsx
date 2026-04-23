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
import { Printer, CheckCircle, XCircle, Info, Tag, Package } from 'lucide-react';
import type { BundleForScan } from '@/lib/actions/produksi/scan.actions';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bundle: BundleForScan;
  karyawanNama: string;
  inventoryItems: { id: string; nama: string; satuan: string }[];
  onApprove: () => void;
  disabled: boolean;
}

export default function ModalSerahTerima({
  open,
  onOpenChange,
  bundle,
  karyawanNama,
  inventoryItems,
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
        {/* Printable Area */}
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

          {/* Section Info Bundle */}
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

          {/* Section Aksesori */}
          <section className="space-y-3">
            <div className="flex items-center gap-2 text-[#e5c17b] mb-1">
                <Tag size={14} />
                <h3 className="text-[11px] font-bold uppercase tracking-widest">Aksesori yang Diserahkan</h3>
            </div>
            <div className="bg-[#1A1D1F] border border-[#2A2D31] border-dashed rounded-xl p-6 text-center">
                <p className="text-xs text-[#9aa0a6] italic">Tidak ada aksesori yang perlu di-track.</p>
            </div>
          </section>

          {/* Section Bahan Pendukung */}
          <section className="space-y-3">
            <div className="flex items-center gap-2 text-[#e5c17b] mb-1">
                <Package size={14} />
                <h3 className="text-[11px] font-bold uppercase tracking-widest">Bahan Pendukung (Reminder)</h3>
            </div>
            <div className="bg-[#1A1D1F] border border-[#2A2D31] rounded-xl p-4">
               {inventoryItems.length > 0 ? (
                 <div className="grid grid-cols-2 gap-2">
                    {inventoryItems.map(item => (
                        <div key={item.id} className="flex items-center gap-2 text-[13px] text-[#e8eaed]">
                            <div className="w-1 h-1 rounded-full bg-[#e5c17b]" />
                            {item.nama}
                        </div>
                    ))}
                 </div>
               ) : (
                 <p className="text-xs text-[#9aa0a6] text-center italic py-2">Tidak ada bahan pendukung.</p>
               )}
            </div>
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
            variant="outline"
            disabled={disabled}
            onClick={() => window.print()}
            className="border-[#2A2D31] text-[#e8eaed] bg-[#2A2D31]/50 hover:bg-[#2A2D31]"
          >
            <Printer className="w-4 h-4 mr-2" />
            Print
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
