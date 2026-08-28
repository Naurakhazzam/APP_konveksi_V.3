'use client';

import React, { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Loader2, Pencil, RotateCcw } from 'lucide-react';
import {
  editSuratJalan,
  type SuratJalanDetailItem,
} from '@/lib/actions/pengiriman/surat-jalan.actions';

export default function EditItemButton({
  sjId, items,
}: {
  sjId: string;
  items: SuratJalanDetailItem[];
}) {
  const [terbuka, setTerbuka] = useState(false);

  return (
    <>
      <button
        onClick={() => setTerbuka(true)}
        className="inline-flex items-center gap-2 px-3 py-2 rounded-md border border-[#2A2D31] text-[#e8eaed] text-sm hover:bg-[#2A2D31] transition-colors"
      >
        <Pencil className="w-3.5 h-3.5" />
        Edit Item
      </button>

      {terbuka && (
        <ModalEditItem
          sjId={sjId}
          items={items}
          onClose={() => setTerbuka(false)}
        />
      )}
    </>
  );
}

function ModalEditItem({
  sjId, items, onClose,
}: {
  sjId: string;
  items: SuratJalanDetailItem[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [qty, setQty] = useState<Record<string, number>>(
    () => Object.fromEntries(items.map(i => [i.surat_jalan_item_id, i.qty_kirim])),
  );
  const [alasan, setAlasan] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Hanya item yang benar-benar berubah yang dikirim ke server.
  const perubahan = useMemo(
    () => items.filter(i => qty[i.surat_jalan_item_id] !== i.qty_kirim),
    [items, qty],
  );

  const adaMelebihi = items.some(
    i => (qty[i.surat_jalan_item_id] ?? 0) > i.qty_jadi,
  );
  const semuaNol = items.every(i => (qty[i.surat_jalan_item_id] ?? 0) === 0);

  const bisaSimpan =
    perubahan.length > 0 &&
    !adaMelebihi &&
    !semuaNol &&
    alasan.trim().length > 0;

  const handleSubmit = async () => {
    if (!bisaSimpan) return;
    setIsSubmitting(true);
    try {
      const hasil = await editSuratJalan(
        sjId,
        perubahan.map(i => ({
          surat_jalan_item_id: i.surat_jalan_item_id,
          qty_kirim: qty[i.surat_jalan_item_id],
        })),
        alasan,
      );

      const bagian = [
        hasil.item_diubah > 0 ? `${hasil.item_diubah} qty diperbaiki` : null,
        hasil.item_dihapus > 0 ? `${hasil.item_dihapus} barang dikeluarkan` : null,
      ].filter(Boolean).join(', ');

      toast.success(
        `${hasil.nomor_sj} diperbarui — ${bagian}. Tagihan jadi Rp${hasil.total_invoice.toLocaleString('id-ID')}. Menunggu konfirmasi Owner di halaman Validasi.`,
      );
      onClose();
      router.refresh();
    } catch (e: any) {
      toast.error(e.message ?? 'Gagal menyimpan perubahan');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/75 flex items-center justify-center z-50 p-4">
      <div className="bg-[#1A1D1F] border border-[#2A2D31] rounded-xl w-full max-w-2xl shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-5">
          <div className="flex items-start gap-3 mb-4">
            <div className="w-9 h-9 rounded-lg bg-[#e5c17b]/10 flex items-center justify-center flex-shrink-0 mt-0.5">
              <Pencil className="w-5 h-5 text-[#e5c17b]" />
            </div>
            <div>
              <h3 className="text-base font-bold text-[#e8eaed]">Perbaiki Qty Kirim</h3>
              <p className="text-xs text-[#9aa0a6] mt-1">
                Nomor surat jalan tetap. Isi <span className="text-[#e5c17b]">0</span> untuk mengeluarkan barang dari surat jalan ini.
              </p>
            </div>
          </div>

          {/* Daftar item */}
          <div className="border border-[#2A2D31] rounded-lg overflow-hidden mb-4">
            <table className="w-full text-sm">
              <thead className="bg-[#0D0E10] text-[10px] uppercase tracking-widest text-[#9aa0a6]">
                <tr>
                  <th className="px-3 py-2.5 text-left font-bold">Barang</th>
                  <th className="px-3 py-2.5 text-center font-bold">Jadi</th>
                  <th className="px-3 py-2.5 text-center font-bold">Qty Kirim</th>
                  <th className="px-3 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-[#2A2D31]">
                {items.map(item => {
                  const nilai = qty[item.surat_jalan_item_id] ?? 0;
                  const berubah = nilai !== item.qty_kirim;
                  const melebihi = nilai > item.qty_jadi;

                  return (
                    <tr key={item.surat_jalan_item_id} className="bg-[#1A1D1F]">
                      <td className="px-3 py-2.5">
                        <div className="font-medium text-[#e8eaed] text-xs">
                          {item.model_nama || '-'}
                        </div>
                        <div className="text-[10px] text-[#9aa0a6] mt-0.5">
                          {item.warna} · {item.size}
                          <span className="mx-1.5 text-[#2A2D31]">|</span>
                          {item.no_po}
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-center text-[#9aa0a6] text-xs">
                        {item.qty_jadi}
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        <input
                          type="number"
                          min={0}
                          max={item.qty_jadi}
                          value={nilai}
                          onChange={e =>
                            setQty(prev => ({
                              ...prev,
                              [item.surat_jalan_item_id]: Math.max(0, Number(e.target.value) || 0),
                            }))
                          }
                          className={`w-16 bg-[#16181A] border rounded-lg px-2 py-1.5 text-xs text-center font-bold outline-none transition-colors ${
                            melebihi
                              ? 'border-red-500/60 text-red-400'
                              : berubah
                                ? 'border-[#e5c17b]/60 text-[#e5c17b]'
                                : 'border-[#2A2D31] text-[#e8eaed] focus:border-[#e5c17b]'
                          }`}
                        />
                        {melebihi && (
                          <div className="text-[9px] text-red-400 mt-1">maks {item.qty_jadi}</div>
                        )}
                        {nilai === 0 && (
                          <div className="text-[9px] text-orange-400 mt-1">dikeluarkan</div>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        {berubah && (
                          <button
                            onClick={() =>
                              setQty(prev => ({
                                ...prev,
                                [item.surat_jalan_item_id]: item.qty_kirim,
                              }))
                            }
                            title={`Kembalikan ke ${item.qty_kirim}`}
                            className="text-[#9aa0a6] hover:text-[#e5c17b] transition-colors"
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {semuaNol && (
            <p className="text-xs text-red-400 mb-3">
              Semua barang dikeluarkan — surat jalan harus menyisakan minimal satu barang.
              Kalau memang seluruhnya salah, batalkan saja surat jalannya dari halaman Riwayat.
            </p>
          )}

          <div className="mb-5">
            <label className="block text-[10px] uppercase tracking-widest text-[#9aa0a6] font-bold mb-2">
              Alasan perubahan <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={alasan}
              onChange={e => setAlasan(e.target.value)}
              placeholder="Contoh: salah ketik qty, seharusnya 5"
              className="w-full bg-[#16181A] border border-[#2A2D31] rounded-lg px-3 py-2 text-sm text-[#e8eaed] placeholder-[#9aa0a6]/50 outline-none focus:border-[#e5c17b]"
            />
            <p className="text-[10px] text-[#9aa0a6] mt-2 leading-relaxed">
              Perubahan <span className="text-[#e8eaed]">langsung berlaku</span> — pengiriman tidak
              perlu menunggu PIN. Setelah disimpan, perubahannya masuk ke halaman{' '}
              <span className="text-[#e5c17b]">Validasi</span> untuk dikonfirmasi Owner. Alasan
              inilah yang dibacanya, jadi tulis sejelas mungkin.
            </p>
          </div>

          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-[#9aa0a6]">
              {perubahan.length > 0
                ? `${perubahan.length} baris berubah`
                : 'Belum ada perubahan'}
            </span>
            <div className="flex items-center gap-3">
              <button
                onClick={onClose}
                disabled={isSubmitting}
                className="px-4 h-9 rounded-lg border border-[#2A2D31] text-[#e8eaed] text-sm hover:bg-[#2A2D31] transition-colors disabled:opacity-50"
              >
                Batal
              </button>
              <button
                onClick={handleSubmit}
                disabled={!bisaSimpan || isSubmitting}
                className="flex items-center gap-2 px-4 h-9 rounded-lg bg-[#e5c17b] hover:bg-[#f0d194] text-[#16181A] text-sm font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Pencil className="w-4 h-4" />}
                Simpan Perubahan
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
