'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Search, X, Eye, Barcode as BarcodeIcon, Ticket, Loader2, ChevronLeft, ChevronRight, Printer } from 'lucide-react';
import { toast } from 'sonner';
import type { PoArtikelRow, DaftarPoScope } from '@/lib/actions/produksi/daftar-po.actions';
import { getBundlesForPrint } from '@/lib/actions/produksi/daftar-po.actions';
import type { AntrianBundle } from '@/lib/actions/produksi/antrian.actions';
import PoItemDetailModal from '@/app/(dashboard)/app/produksi/po/[poNumber]/PoItemDetailModal';
import PrintLabelLayout from '@/app/(dashboard)/app/produksi/antrian-cutting/PrintLabelLayout';
import PrintCuttingTicketLayout from './PrintCuttingTicketLayout';

interface Props {
  aktifData: PoArtikelRow[];
  semuaData: PoArtikelRow[];
}

type PrintMode = 'barcode' | 'cutting';

const STICKY_HEAD = 'sticky top-0 z-20 bg-[#1A1D1F]';
const PAGE_SIZE = 20;

export default function DaftarPoClient({ aktifData, semuaData }: Props) {
  const [scope, setScope] = useState<DaftarPoScope>('aktif');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [detailItem, setDetailItem] = useState<PoArtikelRow | null>(null);

  // Pilihan item untuk cetak massal. Sengaja TIDAK direset saat search atau
  // ganti halaman/tab — pilihan bertahan sampai pengguna mengosongkannya.
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Status cetak
  const [printMode, setPrintMode] = useState<PrintMode | null>(null);
  const [printBundles, setPrintBundles] = useState<AntrianBundle[]>([]);
  const [printingId, setPrintingId] = useState<string | null>(null);

  const source = scope === 'aktif' ? aktifData : semuaData;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return source;
    return source.filter((r) =>
      r.no_po.toLowerCase().includes(q) ||
      r.model_nama.toLowerCase().includes(q) ||
      r.warna.toLowerCase().includes(q) ||
      r.size.toLowerCase().includes(q) ||
      r.klien_nama.toLowerCase().includes(q)
    );
  }, [source, search]);

  // Kembali ke halaman 1 setiap kali tab atau kata kunci berubah.
  useEffect(() => {
    setPage(1);
  }, [scope, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const paged = useMemo(
    () => filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE),
    [filtered, currentPage]
  );
  const rangeStart = filtered.length === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1;
  const rangeEnd = Math.min(currentPage * PAGE_SIZE, filtered.length);

  // Inti cetak: kumpulkan bundle dari satu/banyak po_item lalu panggil print.
  const runPrint = async (ids: string[], mode: PrintMode, busyKey: string) => {
    if (ids.length === 0) return;
    setPrintingId(busyKey);
    try {
      const results = await Promise.all(ids.map((id) => getBundlesForPrint(id)));
      const bundles = results.flat();
      if (bundles.length === 0) {
        toast.error('Belum ada bundle untuk item terpilih — cutting belum dibuat.');
        return;
      }
      setPrintBundles(bundles);
      setPrintMode(mode);
      // Beri waktu React me-render layout cetak sebelum dialog print muncul.
      setTimeout(() => {
        window.print();
        setPrintMode(null);
        setPrintBundles([]);
      }, 600);
    } catch (e: any) {
      toast.error(e?.message ?? 'Gagal menyiapkan data cetak');
    } finally {
      setPrintingId(null);
    }
  };

  const handlePrint = (row: PoArtikelRow, mode: PrintMode) =>
    runPrint([row.po_item_id], mode, `${row.po_item_id}:${mode}`);

  const handlePrintSelected = (mode: PrintMode) =>
    runPrint([...selected], mode, `selected:${mode}`);

  // --- Seleksi ---
  const toggleOne = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const filteredIds = useMemo(() => filtered.map((r) => r.po_item_id), [filtered]);
  const allFilteredSelected = filteredIds.length > 0 && filteredIds.every((id) => selected.has(id));
  const someFilteredSelected = filteredIds.some((id) => selected.has(id));

  const toggleAllFiltered = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (allFilteredSelected) filteredIds.forEach((id) => next.delete(id));
      else filteredIds.forEach((id) => next.add(id));
      return next;
    });

  const TabTrigger = ({ id, label, count }: { id: DaftarPoScope; label: string; count: number }) => (
    <button
      onClick={() => setScope(id)}
      className={`px-4 py-2 text-xs font-bold uppercase tracking-widest transition-all border-b-2 ${
        scope === id
          ? 'border-[#e5c17b] text-[#e5c17b]'
          : 'border-transparent text-[#9aa0a6] hover:text-[#e8eaed]'
      }`}
    >
      {label} <span className="ml-1 opacity-50">({count})</span>
    </button>
  );

  const PrintButtons = ({ row, compact = false }: { row: PoArtikelRow; compact?: boolean }) => {
    const busyBarcode = printingId === `${row.po_item_id}:barcode`;
    const busyCutting = printingId === `${row.po_item_id}:cutting`;
    return (
      <>
        <button
          onClick={() => handlePrint(row, 'barcode')}
          disabled={!!printingId}
          title="Cetak label barcode semua bundle"
          className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg text-[11px] font-bold text-[#22d3ee] hover:bg-[#22d3ee]/10 border border-[#22d3ee]/20 disabled:opacity-40 transition-colors"
        >
          {busyBarcode ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <BarcodeIcon className="w-3.5 h-3.5" />}
          {!compact && 'Barcode'}
        </button>
        <button
          onClick={() => handlePrint(row, 'cutting')}
          disabled={!!printingId}
          title="Cetak tiket nomor cutting"
          className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg text-[11px] font-bold text-[#e5c17b] hover:bg-[#e5c17b]/10 border border-[#e5c17b]/20 disabled:opacity-40 transition-colors"
        >
          {busyCutting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Ticket className="w-3.5 h-3.5" />}
          {!compact && 'Tiket Cutting'}
        </button>
      </>
    );
  };

  return (
    <div className="space-y-4">
      {/* Tabs + search */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#2A2D31]">
        <div className="flex gap-4 px-2">
          <TabTrigger id="aktif" label="PO Aktif" count={aktifData.length} />
          <TabTrigger id="semua" label="Semua PO" count={semuaData.length} />
        </div>
        <div className="relative mb-1 sm:mb-0 sm:mr-2">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#9aa0a6] pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cari No. PO / artikel / warna / size..."
            className="bg-[#16181A] border border-[#2A2D31] rounded-lg pl-8 pr-8 py-1.5 text-xs text-[#e8eaed] placeholder-[#9aa0a6]/50 focus:outline-none focus:border-[#e5c17b] w-64 transition-colors"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-[#9aa0a6] hover:text-[#e8eaed] transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {search.trim() && (
        <p className="text-xs text-[#9aa0a6] px-1">
          Menampilkan <span className="text-[#e8eaed] font-medium">{filtered.length}</span> hasil untuk &quot;
          <span className="text-[#e5c17b]">{search}</span>&quot;
        </p>
      )}

      {/* Toolbar seleksi — cetak massal (bertahan lintas search & halaman) */}
      {selected.size > 0 && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-4 py-2.5 bg-[#e5c17b]/10 border border-[#e5c17b]/30 rounded-xl">
          <p className="text-xs font-bold text-[#e5c17b]">
            {selected.size} artikel dipilih
          </p>
          <div className="flex items-center gap-1.5 flex-wrap">
            <button
              onClick={() => handlePrintSelected('barcode')}
              disabled={!!printingId}
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-[11px] font-bold text-[#22d3ee] bg-[#22d3ee]/10 border border-[#22d3ee]/30 hover:bg-[#22d3ee]/20 disabled:opacity-40 transition-colors"
            >
              {printingId === 'selected:barcode' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <BarcodeIcon className="w-3.5 h-3.5" />}
              Print Barcode ({selected.size})
            </button>
            <button
              onClick={() => handlePrintSelected('cutting')}
              disabled={!!printingId}
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-[11px] font-bold text-[#e5c17b] bg-[#e5c17b]/15 border border-[#e5c17b]/40 hover:bg-[#e5c17b]/25 disabled:opacity-40 transition-colors"
            >
              {printingId === 'selected:cutting' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Printer className="w-3.5 h-3.5" />}
              Print Tiket Cutting ({selected.size})
            </button>
            <button
              onClick={() => setSelected(new Set())}
              disabled={!!printingId}
              className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg text-[11px] font-bold text-[#9aa0a6] hover:text-[#e8eaed] hover:bg-[#2A2D31] disabled:opacity-40 transition-colors"
            >
              <X className="w-3.5 h-3.5" /> Kosongkan
            </button>
          </div>
        </div>
      )}

      {/* Tabel */}
      <div className="bg-[#1A1D1F] border border-[#2A2D31] rounded-2xl overflow-hidden shadow-sm">
        <div className="overflow-auto max-h-[68vh] text-[#e8eaed]">
          <table className="w-full caption-bottom text-sm">
            <thead>
              <tr className="border-b border-[#2A2D31]">
                <th className={`${STICKY_HEAD} text-center px-3 py-3 w-10`}>
                  <input
                    type="checkbox"
                    aria-label="Pilih semua hasil"
                    checked={allFilteredSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = !allFilteredSelected && someFilteredSelected;
                    }}
                    onChange={toggleAllFiltered}
                    className="w-4 h-4 accent-[#e5c17b] cursor-pointer align-middle"
                  />
                </th>
                <th className={`${STICKY_HEAD} text-left px-4 py-3 text-[#9aa0a6] font-semibold text-xs`}>NO. PO</th>
                <th className={`${STICKY_HEAD} text-left px-4 py-3 text-[#9aa0a6] font-semibold text-xs`}>KLIEN</th>
                <th className={`${STICKY_HEAD} text-left px-4 py-3 text-[#9aa0a6] font-semibold text-xs`}>MODEL / ARTIKEL</th>
                <th className={`${STICKY_HEAD} text-left px-4 py-3 text-[#9aa0a6] font-semibold text-xs`}>WARNA</th>
                <th className={`${STICKY_HEAD} text-center px-4 py-3 text-[#9aa0a6] font-semibold text-xs`}>SIZE</th>
                <th className={`${STICKY_HEAD} text-center px-4 py-3 text-[#9aa0a6] font-semibold text-xs`}>QTY</th>
                <th className={`${STICKY_HEAD} text-right px-4 py-3 text-[#9aa0a6] font-semibold text-xs`}>AKSI</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-20 text-center text-[#9aa0a6]">
                    {search.trim() ? (
                      <>
                        <Search className="w-8 h-8 mx-auto mb-3 opacity-30" />
                        <p className="font-medium text-[#e8eaed]">Tidak ada hasil untuk &quot;{search}&quot;</p>
                        <p className="text-sm mt-1">Coba kata kunci lain atau hapus pencarian</p>
                      </>
                    ) : (
                      <p>Tidak ada artikel PO di kategori ini.</p>
                    )}
                  </td>
                </tr>
              ) : (
                paged.map((row) => (
                  <tr
                    key={row.po_item_id}
                    className={`border-b border-[#2A2D31] transition-colors ${
                      selected.has(row.po_item_id) ? 'bg-[#e5c17b]/5' : 'hover:bg-[#2A2D31]/40'
                    }`}
                  >
                    <td className="px-3 py-2.5 text-center">
                      <input
                        type="checkbox"
                        aria-label={`Pilih ${row.no_po} ${row.model_nama}`}
                        checked={selected.has(row.po_item_id)}
                        onChange={() => toggleOne(row.po_item_id)}
                        className="w-4 h-4 accent-[#e5c17b] cursor-pointer align-middle"
                      />
                    </td>
                    <td className="px-4 py-2.5 font-mono font-bold text-[#e5c17b]">{row.no_po}</td>
                    <td className="px-4 py-2.5 text-sm">{row.klien_nama}</td>
                    <td className="px-4 py-2.5 text-sm font-medium">{row.model_nama}</td>
                    <td className="px-4 py-2.5 text-sm">{row.warna}</td>
                    <td className="px-4 py-2.5 text-center text-sm font-mono">{row.size}</td>
                    <td className="px-4 py-2.5 text-center font-mono font-bold">{row.qty_order}</td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center justify-end gap-1.5">
                        <PrintButtons row={row} compact />
                        <button
                          onClick={() => setDetailItem(row)}
                          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-[11px] font-bold text-[#e8eaed] bg-[#2A2D31] hover:bg-[#363a3e] transition-colors"
                        >
                          <Eye className="w-3.5 h-3.5" /> Detail
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {filtered.length > 0 && (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-4 py-3 border-t border-[#2A2D31]">
            <p className="text-xs text-[#9aa0a6]">
              Menampilkan <span className="text-[#e8eaed] font-medium">{rangeStart}–{rangeEnd}</span> dari{' '}
              <span className="text-[#e8eaed] font-medium">{filtered.length}</span> artikel
            </p>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={currentPage <= 1}
                className="inline-flex items-center gap-1 h-8 px-2.5 rounded-lg text-xs font-bold text-[#e8eaed] bg-[#2A2D31] hover:bg-[#363a3e] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronLeft className="w-3.5 h-3.5" /> Sebelumnya
              </button>
              <span className="px-3 text-xs text-[#9aa0a6]">
                Hal. <span className="text-[#e5c17b] font-bold">{currentPage}</span> / {totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage >= totalPages}
                className="inline-flex items-center gap-1 h-8 px-2.5 rounded-lg text-xs font-bold text-[#e8eaed] bg-[#2A2D31] hover:bg-[#363a3e] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                Berikutnya <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Modal detail — tahapan kerja per bundle + tombol cetak di header */}
      {detailItem && (
        <PoItemDetailModal
          poItemId={detailItem.po_item_id}
          artikelInfo={{
            model_nama: detailItem.model_nama,
            warna: detailItem.warna,
            size: detailItem.size,
            total_bundle: detailItem.total_bundle,
            qty_order: detailItem.qty_order,
          }}
          onClose={() => setDetailItem(null)}
          actions={<div className="flex items-center gap-1.5"><PrintButtons row={detailItem} /></div>}
        />
      )}

      {/* Layout cetak — tersembunyi kecuali saat window.print() */}
      {printMode === 'barcode' && printBundles.length > 0 && <PrintLabelLayout bundles={printBundles} />}
      {printMode === 'cutting' && printBundles.length > 0 && <PrintCuttingTicketLayout bundles={printBundles} />}
    </div>
  );
}
