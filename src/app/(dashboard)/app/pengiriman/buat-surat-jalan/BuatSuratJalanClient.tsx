'use client';

import React, { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { BundleReadyToShip, createSuratJalan } from '@/lib/actions/pengiriman/surat-jalan.actions';
import CartPanel from './CartPanel';

export default function BuatSuratJalanClient({ initialBundles }: { initialBundles: BundleReadyToShip[] }) {
  const router = useRouter();
  const [bundles, setBundles] = useState<BundleReadyToShip[]>(initialBundles);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [tanggal, setTanggal] = useState<string>(new Date().toISOString().split('T')[0]);
  const [catatan, setCatatan] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const selectedBundles = useMemo(() => 
    bundles.filter(b => selectedIds.has(b.id)),
  [bundles, selectedIds]);

  const currentKlienId = selectedBundles.length > 0 ? selectedBundles[0].klien_id : null;

  const handleToggleSelect = (id: string, klienId: string) => {
    if (currentKlienId && klienId !== currentKlienId && !selectedIds.has(id)) {
      toast.error('Klien berbeda! Satu Surat Jalan hanya untuk satu klien yang sama.');
      return;
    }

    const newSet = new Set(selectedIds);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    setSelectedIds(newSet);
  };

  const handleUpdateQty = (id: string, qty: number) => {
    setBundles(prev => prev.map(b => {
      if (b.id === id) {
        return { ...b, qty_kirim: Math.min(Math.max(1, qty), b.qty_per_bundle) };
      }
      return b;
    }));
  };

  const handleFinalize = async () => {
    if (selectedBundles.length === 0 || !currentKlienId) return;

    try {
      setIsSubmitting(true);
      const items = selectedBundles.map(b => ({
        bundle_id: b.id,
        qty_kirim: b.qty_kirim
      }));

      const nomorSj = await createSuratJalan({
        klien_id: currentKlienId,
        tanggal,
        catatan,
        bundles: items
      });

      toast.success(`Surat Jalan ${nomorSj} berhasil dibuat!`);
      // Reset
      setSelectedIds(new Set());
      setCatatan('');
      setTanggal(new Date().toISOString().split('T')[0]);
      router.refresh();
      // Boleh redirect ke detail SJ, tp sesuai instruksi kita biarkan / refresh aja
      // router.push(`/app/pengiriman/riwayat/${sjId}`) => Kita butuh ID, tp RPC return nomorSj
    } catch (error: any) {
      toast.error(error.message || 'Gagal membuat surat jalan');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="grid lg:grid-cols-3 gap-6">
      <div className="lg:col-span-2 space-y-4">
        <div className="bg-[#1A1D1F] border border-[#2A2D31] rounded-lg overflow-hidden">
          <div className="p-4 border-b border-[#2A2D31] flex justify-between items-center bg-[#0D0E10]">
            <h2 className="font-semibold text-[#e8eaed]">Pilih Bundle ({bundles.length})</h2>
          </div>
          <div className="overflow-x-auto max-h-[600px]">
            <table className="w-full text-sm text-left">
              <thead className="text-xs text-[#9aa0a6] uppercase bg-[#0D0E10] sticky top-0 border-b border-[#2A2D31] z-10">
                <tr>
                  <th className="px-4 py-3 w-10">Pilih</th>
                  <th className="px-4 py-3">Barcode</th>
                  <th className="px-4 py-3">Item Info</th>
                  <th className="px-4 py-3">Klien</th>
                  <th className="px-4 py-3">QTY</th>
                </tr>
              </thead>
              <tbody>
                {bundles.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-[#9aa0a6]">Tidak ada bundle siap kirim.</td>
                  </tr>
                ) : (
                  bundles.map(b => {
                    const isSelected = selectedIds.has(b.id);
                    const isDisabled = currentKlienId !== null && b.klien_id !== currentKlienId;
                    
                    return (
                      <tr 
                        key={b.id} 
                        className={`border-b border-[#2A2D31] transition-colors ${
                          isSelected ? 'bg-[#e5c17b]/10' : isDisabled ? 'opacity-50 grayscale bg-[#0D0E10]' : 'hover:bg-[#0D0E10]/50'
                        }`}
                      >
                        <td className="px-4 py-3">
                          <input 
                            type="checkbox"
                            checked={isSelected}
                            disabled={isDisabled && !isSelected}
                            onChange={() => handleToggleSelect(b.id, b.klien_id)}
                            className="w-4 h-4 rounded border-[#2A2D31] bg-[#0D0E10] text-[#e5c17b] focus:ring-[#e5c17b]"
                          />
                        </td>
                        <td className="px-4 py-3 font-mono text-xs">{b.barcode}</td>
                        <td className="px-4 py-3">
                          <div className="font-medium text-[#e8eaed]">{b.model_nama || '-'}</div>
                          <div className="text-xs text-[#9aa0a6]">{b.warna} - {b.size} | PO: {b.no_po}</div>
                        </td>
                        <td className="px-4 py-3 text-xs text-[#e8eaed]">
                          {b.klien_nama}
                          {isDisabled && !isSelected && <span className="block text-[10px] text-red-400 mt-1">Klien berbeda</span>}
                        </td>
                        <td className="px-4 py-3 font-medium text-[#e8eaed]">{b.qty_per_bundle}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="lg:col-span-1">
        <CartPanel 
          selectedBundles={selectedBundles}
          onUpdateQty={handleUpdateQty}
          onRemove={(id) => {
            const newSet = new Set(selectedIds);
            newSet.delete(id);
            setSelectedIds(newSet);
          }}
          tanggal={tanggal}
          setTanggal={setTanggal}
          catatan={catatan}
          setCatatan={setCatatan}
          onFinalize={handleFinalize}
          isSubmitting={isSubmitting}
        />
      </div>
    </div>
  );
}
