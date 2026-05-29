'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { 
  Dialog as AlertDialog, 
  DialogClose as AlertDialogCancel,
  DialogContent as AlertDialogContent, 
  DialogDescription as AlertDialogDescription, 
  DialogFooter as AlertDialogFooter, 
  DialogHeader as AlertDialogHeader, 
  DialogTitle as AlertDialogTitle, 
  DialogTrigger as AlertDialogTrigger 
} from '@/components/ui/dialog';
import { cancelPo } from '@/lib/actions/produksi/po-mutations.actions'; 
import type { getPoDetail } from '@/lib/actions/produksi/po.actions';

type PoDetail = Awaited<ReturnType<typeof getPoDetail>>;

export function BackButton() {
  const router = useRouter();
  return (
    <button
      onClick={() => router.back()}
      className="flex items-center gap-1.5 text-sm font-medium text-[#9aa0a6] hover:text-[#e8eaed] transition-colors"
    >
      <ArrowLeft className="w-4 h-4" />
      Kembali
    </button>
  );
}

export function PoDetailActions({ po }: { po: NonNullable<PoDetail> }) {
  const router = useRouter();
  const [isCanceling, setIsCanceling] = useState(false);
  const [open, setOpen] = useState(false);

  const handleCancel = async () => {
    setIsCanceling(true);
    try {
      await cancelPo(po.id);
      toast.success('PO berhasil dibatalkan');
      router.push('/app/produksi/monitoring');
      router.refresh();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Gagal membatalkan PO');
    } finally {
      setIsCanceling(false);
      setOpen(false);
    }
  };

  if (po.status === 'dibatalkan' || po.status === 'selesai') {
    return null;
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger 
        render={
          <Button variant="outline" className="border-red-500/30 text-red-500 hover:bg-red-500/10 hover:text-red-600 transition-colors" />
        }
      >
        Batalkan PO
      </AlertDialogTrigger>
      <AlertDialogContent className="sm:max-w-[425px] bg-[#16181A] border-[#2A2D31] text-[#e8eaed]">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-[#e8eaed]">Batalkan Purchase Order?</AlertDialogTitle>
          <AlertDialogDescription className="text-[#9aa0a6] mt-2">
            PO {po.no_po} akan dibatalkan. Barcode yang sudah digenerate tetap tersimpan.
            Aksi ini tidak dapat dibatalkan.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="mt-6 flex flex-row items-center justify-end gap-2 pr-0 mr-0 pb-0 border-t-0 bg-transparent">
          <AlertDialogCancel 
            render={<Button variant="outline" disabled={isCanceling} className="border-[#2A2D31] text-[#e8eaed] bg-transparent hover:bg-[#2A2D31]" />}
          >
            Tidak, Kembali
          </AlertDialogCancel>
          <Button 
            variant="default" 
            disabled={isCanceling} 
            onClick={handleCancel}
            className="bg-red-500 hover:bg-red-600 text-white font-medium shadow-none"
          >
            {isCanceling ? 'Memproses...' : 'Ya, Batalkan PO'}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function PoDetailTable({ items }: { items: NonNullable<PoDetail>['po_item'] }) {
  return (
    <div className="rounded-xl border border-[#2A2D31] bg-[#1A1D1F] overflow-hidden shadow-lg">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm text-[#9aa0a6]">
          <thead className="bg-[#2A2D31]/30 border-b border-[#2A2D31]">
            <tr className="hover:bg-transparent">
              <th className="p-4 font-medium text-[#9aa0a6]">MODEL</th>
              <th className="p-4 font-medium text-[#9aa0a6]">WARNA</th>
              <th className="p-4 font-medium text-[#9aa0a6]">SIZE</th>
              <th className="p-4 font-medium text-[#9aa0a6]">QTY ORDER</th>
              <th className="p-4 font-medium text-[#9aa0a6]">ISI/BUNDLE</th>
              <th className="p-4 font-medium text-[#9aa0a6]">TOTAL BUNDLE</th>
              <th className="p-4 font-medium text-[#9aa0a6]">RANGE URUTAN</th>
            </tr>
          </thead>
          <tbody>
            {!items || items.length === 0 ? (
              <tr>
                <td colSpan={7} className="p-8 text-center text-[#9aa0a6]">Belum ada data artikel.</td>
              </tr>
            ) : (
              items.map((item, idx) => {
                const totalBundle = Math.ceil((item.qty_order || 0) / (item.qty_per_bundle || 12));
                return (
                  <tr key={item.id || idx} className="border-b border-[#2A2D31] hover:bg-[#2A2D31]/20 transition-colors last:border-0">
                    <td className="p-4 font-medium text-[#e8eaed]">{item.model_nama}</td>
                    <td className="p-4 text-[#e8eaed]">{item.warna}</td>
                    <td className="p-4 text-[#e8eaed]">{item.size}</td>
                    <td className="p-4 text-[#e8eaed]">{item.qty_order}</td>
                    <td className="p-4 text-[#e8eaed]">{item.qty_per_bundle}</td>
                    <td className="p-4 text-[#e8eaed]">{totalBundle}</td>
                    <td className="p-4">
                      {item.range ? (
                        <span className="inline-flex items-center rounded-md px-2 py-1 text-xs font-mono font-medium ring-1 ring-inset bg-[#e5c17b]/10 text-[#e5c17b] ring-[#e5c17b]/20">{item.range}</span>
                      ) : (
                        <span className="text-[#9aa0a6]">—</span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
            </tbody>
          </table>
        </div>
      </div>
    );
}
