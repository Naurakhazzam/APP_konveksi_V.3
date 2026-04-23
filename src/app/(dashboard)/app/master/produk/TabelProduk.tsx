'use client';

import React, { useState, useMemo } from 'react';
import { ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { toggleProdukAktif } from '@/lib/actions/master/produk.actions';
import { useRouter } from 'next/navigation';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface ProdukRow {
  id: string;
  sku_internal: string;
  sku_klien: string | null;
  nama: string;
  aktif: boolean;
  harga_jual: number;
  total_hpp: number;
  model_produk: { id: string; nama: string } | null;
  size: { id: string; nama: string; urutan: number } | null;
  warna: { id: string; nama: string; kode_hex: string | null } | null;
}

interface TabelProdukProps {
  produkList: ProdukRow[];
  onSelect: (id: string) => void;
  selectedId: string | null;
  canSeeFinance: boolean;
  canEdit: boolean;
}

type SortKey = 'sku_internal' | 'size' | 'warna' | 'total_hpp' | 'harga_jual' | 'margin';
type SortDir = 'asc' | 'desc';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const PAGE_SIZE = 20;

function formatRupiah(n: number) {
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(n);
}

function SortIcon({ colKey, sortKey, sortDir }: { colKey: SortKey; sortKey: SortKey | null; sortDir: SortDir }) {
  if (sortKey !== colKey) return <ArrowUpDown className="ml-1 h-3 w-3 text-[#5f6368]" />;
  return sortDir === 'asc'
    ? <ArrowUp className="ml-1 h-3 w-3 text-[#e5c17b]" />
    : <ArrowDown className="ml-1 h-3 w-3 text-[#e5c17b]" />;
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export function TabelProduk({ produkList, onSelect, selectedId, canSeeFinance, canEdit }: TabelProdukProps) {
  const router = useRouter();
  const [currentPage, setCurrentPage] = useState(1);
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [togglingId, setTogglingId] = useState<string | null>(null);

  // ── Sorting ───────────────────────────────────────────────────────────────
  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
    setCurrentPage(1);
  };

  const sorted = useMemo(() => {
    if (!sortKey) return produkList;
    return [...produkList].sort((a, b) => {
      let valA: string | number = 0;
      let valB: string | number = 0;
      if (sortKey === 'sku_internal') { valA = a.sku_internal; valB = b.sku_internal; }
      else if (sortKey === 'size') { valA = a.size?.urutan ?? 0; valB = b.size?.urutan ?? 0; }
      else if (sortKey === 'warna') { valA = a.warna?.nama ?? ''; valB = b.warna?.nama ?? ''; }
      else if (sortKey === 'total_hpp') { valA = a.total_hpp; valB = b.total_hpp; }
      else if (sortKey === 'harga_jual') { valA = a.harga_jual; valB = b.harga_jual; }
      else if (sortKey === 'margin') { valA = a.harga_jual - a.total_hpp; valB = b.harga_jual - b.total_hpp; }

      if (typeof valA === 'string') {
        return sortDir === 'asc' ? valA.localeCompare(valB as string) : (valB as string).localeCompare(valA);
      }
      return sortDir === 'asc' ? (valA as number) - (valB as number) : (valB as number) - (valA as number);
    });
  }, [produkList, sortKey, sortDir]);

  // ── Pagination ────────────────────────────────────────────────────────────
  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const pageStart  = (currentPage - 1) * PAGE_SIZE;
  const pageEnd    = Math.min(pageStart + PAGE_SIZE, sorted.length);
  const paginated  = sorted.slice(pageStart, pageEnd);

  // ── Toggle Aktif ──────────────────────────────────────────────────────────
  const handleTogglAktif = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setTogglingId(id);
    try {
      await toggleProdukAktif(id);
      router.refresh();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setTogglingId(null);
    }
  };

  // ── Empty state ───────────────────────────────────────────────────────────
  if (produkList.length === 0) {
    return (
      <div className="flex h-40 items-center justify-center rounded-xl border border-[#2A2D31] bg-[#16181A] text-sm text-[#9aa0a6]">
        Belum ada SKU dalam model ini. Klik <span className="mx-1 font-semibold text-[#e5c17b]">+ Tambah SKU Baru</span> untuk memulai.
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-[#2A2D31] bg-[#16181A] overflow-hidden shadow-lg">
      <Table>
        <TableHeader className="bg-[#2A2D31]/40">
          <TableRow className="border-[#2A2D31] hover:bg-transparent">
            <TableHead className="text-[#9aa0a6] w-10">#</TableHead>

            <TableHead
              className="text-[#9aa0a6] cursor-pointer select-none"
              onClick={() => handleSort('sku_internal')}
            >
              <div className="flex items-center">
                SKU Internal <SortIcon colKey="sku_internal" sortKey={sortKey} sortDir={sortDir} />
              </div>
            </TableHead>

            <TableHead className="text-[#9aa0a6]">SKU Klien</TableHead>

            <TableHead className="text-[#9aa0a6]">Nama Produk</TableHead>

            <TableHead
              className="text-[#9aa0a6] cursor-pointer select-none"
              onClick={() => handleSort('size')}
            >
              <div className="flex items-center">
                Size <SortIcon colKey="size" sortKey={sortKey} sortDir={sortDir} />
              </div>
            </TableHead>

            <TableHead
              className="text-[#9aa0a6] cursor-pointer select-none"
              onClick={() => handleSort('warna')}
            >
              <div className="flex items-center">
                Warna <SortIcon colKey="warna" sortKey={sortKey} sortDir={sortDir} />
              </div>
            </TableHead>

            {canSeeFinance && (
              <>
                <TableHead
                  className="text-[#9aa0a6] text-right cursor-pointer select-none"
                  onClick={() => handleSort('total_hpp')}
                >
                  <div className="flex items-center justify-end">
                    Total HPP <SortIcon colKey="total_hpp" sortKey={sortKey} sortDir={sortDir} />
                  </div>
                </TableHead>
                <TableHead
                  className="text-[#9aa0a6] text-right cursor-pointer select-none"
                  onClick={() => handleSort('harga_jual')}
                >
                  <div className="flex items-center justify-end">
                    Harga Jual <SortIcon colKey="harga_jual" sortKey={sortKey} sortDir={sortDir} />
                  </div>
                </TableHead>
                <TableHead
                  className="text-[#9aa0a6] text-right cursor-pointer select-none"
                  onClick={() => handleSort('margin')}
                >
                  <div className="flex items-center justify-end">
                    Margin <SortIcon colKey="margin" sortKey={sortKey} sortDir={sortDir} />
                  </div>
                </TableHead>
              </>
            )}

            <TableHead className="text-[#9aa0a6] text-center">Status</TableHead>
          </TableRow>
        </TableHeader>

        <TableBody>
          {paginated.map((row, idx) => {
            const margin    = row.harga_jual - row.total_hpp;
            const marginPct = row.harga_jual > 0 ? (margin / row.harga_jual * 100).toFixed(1) : '0.0';
            const isSelected = selectedId === row.id;

            return (
              <TableRow
                key={row.id}
                onClick={() => onSelect(row.id)}
                className={`border-[#2A2D31] cursor-pointer transition-colors ${
                  isSelected
                    ? 'bg-[#e5c17b]/8 border-l-2 border-l-[#e5c17b]'
                    : 'hover:bg-[#2A2D31]/20'
                }`}
              >
                {/* No */}
                <TableCell className="text-[#5f6368] text-xs tabular-nums">
                  {pageStart + idx + 1}
                </TableCell>

                {/* SKU Internal */}
                <TableCell>
                  <span className="font-mono text-sm text-[#e5c17b] tracking-wider">
                    {row.sku_internal}
                  </span>
                </TableCell>

                {/* SKU Klien */}
                <TableCell>
                  {row.sku_klien ? (
                    <span className="font-mono text-xs text-[#9aa0a6]">{row.sku_klien}</span>
                  ) : (
                    <span className="text-xs text-[#5f6368] italic">—</span>
                  )}
                </TableCell>

                {/* Nama Produk */}
                <TableCell>
                  <span className="text-sm text-[#e8eaed]">{row.nama}</span>
                </TableCell>

                {/* Size */}
                <TableCell>
                  <span className="inline-flex items-center rounded-md bg-[#2A2D31] px-2 py-0.5 text-xs font-medium text-[#e8eaed]">
                    {row.size?.nama ?? '—'}
                  </span>
                </TableCell>

                {/* Warna — dot + nama */}
                <TableCell>
                  <div className="flex items-center gap-1.5">
                    {row.warna?.kode_hex ? (
                      <span
                        className="h-3.5 w-3.5 rounded-full border border-white/10 flex-shrink-0"
                        style={{ backgroundColor: row.warna.kode_hex }}
                      />
                    ) : (
                      <span className="h-3.5 w-3.5 rounded-full border border-[#2A2D31] bg-[#2A2D31] flex-shrink-0" />
                    )}
                    <span className="text-sm text-[#e8eaed]">{row.warna?.nama ?? '—'}</span>
                  </div>
                </TableCell>

                {/* Finance columns */}
                {canSeeFinance && (
                  <>
                    <TableCell className="text-right tabular-nums">
                      <span className="text-sm text-[#9aa0a6]">{formatRupiah(row.total_hpp)}</span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      <span className="text-sm text-[#e8eaed] font-medium">{formatRupiah(row.harga_jual)}</span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      <div className="flex flex-col items-end">
                        <span className={`text-sm font-semibold ${margin >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                          {margin >= 0 ? '+' : ''}{formatRupiah(margin)}
                        </span>
                        <span className={`text-xs ${margin >= 0 ? 'text-green-500/70' : 'text-red-500/70'}`}>
                          {marginPct}%
                        </span>
                      </div>
                    </TableCell>
                  </>
                )}

                {/* Status toggle */}
                <TableCell className="text-center" onClick={(e) => e.stopPropagation()}>
                  <button
                    disabled={!canEdit || togglingId === row.id}
                    onClick={(e) => handleTogglAktif(e, row.id)}
                    className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium transition-all ${
                      canEdit ? 'cursor-pointer hover:opacity-80 active:scale-95' : 'cursor-default'
                    } ${
                      row.aktif
                        ? 'bg-green-500/10 text-green-400 hover:bg-green-500/20'
                        : 'bg-[#3a3d41] text-[#9aa0a6] hover:bg-[#4a4d51]'
                    } ${togglingId === row.id ? 'opacity-50' : ''}`}
                  >
                    {togglingId === row.id ? '...' : row.aktif ? 'Aktif' : 'NonAktif'}
                  </button>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      {/* Pagination footer */}
      <div className="flex items-center justify-between border-t border-[#2A2D31] px-4 py-3">
        <p className="text-xs text-[#9aa0a6]">
          Menampilkan <span className="font-medium text-[#e8eaed]">{pageStart + 1}–{pageEnd}</span> dari{' '}
          <span className="font-medium text-[#e8eaed]">{sorted.length}</span> produk
        </p>
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="sm"
            disabled={currentPage <= 1}
            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
            className="h-7 border-[#2A2D31] bg-transparent text-[#9aa0a6] hover:bg-[#2A2D31] hover:text-[#e8eaed] disabled:opacity-40"
          >
            ‹
          </Button>
          <span className="px-2 text-xs text-[#9aa0a6]">{currentPage} / {totalPages}</span>
          <Button
            variant="outline"
            size="sm"
            disabled={currentPage >= totalPages}
            onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
            className="h-7 border-[#2A2D31] bg-transparent text-[#9aa0a6] hover:bg-[#2A2D31] hover:text-[#e8eaed] disabled:opacity-40"
          >
            ›
          </Button>
        </div>
      </div>
    </div>
  );
}
