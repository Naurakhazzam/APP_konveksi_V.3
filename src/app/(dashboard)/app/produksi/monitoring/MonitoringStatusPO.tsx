'use client';

import React, { useState, useMemo } from 'react';
import { Trash2, ExternalLink, ChevronUp, ChevronDown, Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from '@/components/ui/table';
import { deletePoById } from '@/lib/actions/produksi/po.actions';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';
import type { PoGrouped, PoRow } from '@/lib/actions/produksi/monitoring.actions';
import Link from 'next/link';

interface Props {
  initialData: PoGrouped;
  role: string;
}

type SubTab = 'belum_mulai' | 'sedang_diproses' | 'selesai';
type SortKey = 'no_po' | 'klien' | 'total_bundle';
type SortDir = 'asc' | 'desc';

const STAGE_LABELS: Record<string, string> = {
  cutting: 'Cutting',
  jahit: 'Jahit',
  buang_benang: 'Buang Benang',
  lubang_kancing: 'Lubang Kancing',
  qc: 'QC',
  steam: 'Steam',
  packing: 'Packing'
};

const STAGE_ORDER = ['cutting', 'jahit', 'buang_benang', 'lubang_kancing', 'qc', 'steam', 'packing'];

export default function MonitoringStatusPO({ initialData, role }: Props) {
  const router = useRouter();
  const [activeSubTab, setActiveSubTab] = useState<SubTab>('sedang_diproses');
  const [isDeleting, setIsDeleting] = useState(false);

  // Sorting State
  const [sortKey, setSortKey] = useState<SortKey>('no_po');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [search, setSearch] = useState('');

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const sortedList = useMemo(() => {
    const list = [...(initialData[activeSubTab] || [])];
    
    // Always sort by NO. PO for 'sedang_diproses' or if no specific sort is active
    list.sort((a, b) => {
      let comparison = 0;
      
      if (sortKey === 'no_po') {
        comparison = a.no_po.localeCompare(b.no_po);
      } else if (sortKey === 'klien') {
        comparison = a.klien_nama.localeCompare(b.klien_nama);
      } else if (sortKey === 'total_bundle') {
        comparison = a.total_bundle - b.total_bundle;
      }

      return sortDir === 'asc' ? comparison : -comparison;
    });

    return list;
  }, [initialData, activeSubTab, sortKey, sortDir]);

  const filteredList = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return sortedList;
    return sortedList.filter(po =>
      po.no_po.toLowerCase().includes(q) ||
      po.klien_nama.toLowerCase().includes(q)
    );
  }, [sortedList, search]);

  const handleDelete = async (id: string, noPo: string) => {
    if (!window.confirm(`Hapus PO ${noPo}? Aksi ini bersifat permanen.`)) return;
    
    setIsDeleting(true);
    try {
      const res = await deletePoById(id);
      if (res.success) {
        toast.success(res.message);
        router.refresh();
      } else {
        toast.error(res.message);
      }
    } catch (err: any) {
      toast.error(err.message || 'Gagal menghapus PO');
    } finally {
      setIsDeleting(false);
    }
  };

  const getProgressColor = (done: number, total: number) => {
    if (total === 0) return 'bg-[#2A2D31]';
    if (done === total) return 'bg-[#22c55e]'; // Green
    if (done > 0) return 'bg-[#22d3ee]'; // Cyan
    return 'bg-[#2A2D31]'; // Muted
  };

  const renderTable = () => {
    const list = filteredList;

    if (list.length === 0) {
      return (
        <div className="py-20 text-center text-[#9aa0a6]">
          {search.trim() ? (
            <>
              <Search className="w-8 h-8 mx-auto mb-3 opacity-30" />
              <p className="font-medium text-[#e8eaed]">Tidak ada hasil untuk &quot;{search}&quot;</p>
              <p className="text-sm mt-1">Coba kata kunci lain atau hapus pencarian</p>
            </>
          ) : (
            <p>Tidak ada data PO di kategori ini.</p>
          )}
        </div>
      );
    }

    const SortIcon = ({ col }: { col: SortKey }) => {
      if (sortKey !== col) return <ChevronUp size={12} className="opacity-0 group-hover:opacity-50 text-[#9aa0a6]" />;
      return sortDir === 'asc' ? <ChevronUp size={12} className="text-[#e5c17b]" /> : <ChevronDown size={12} className="text-[#e5c17b]" />;
    };

    return (
      <div className="overflow-x-auto text-[#e8eaed]">
        <Table>
          <TableHeader>
            <TableRow className="border-[#2A2D31] hover:bg-transparent">
              <TableHead className="p-0">
                <button 
                  onClick={() => handleSort('no_po')}
                  className="flex items-center gap-1 w-full h-full px-4 py-3 text-[#9aa0a6] font-semibold hover:text-[#e8eaed] group transition-colors"
                >
                  NO. PO <SortIcon col="no_po" />
                </button>
              </TableHead>
              <TableHead className="p-0">
                <button 
                  onClick={() => handleSort('klien')}
                  className="flex items-center gap-1 w-full h-full px-4 py-3 text-[#9aa0a6] font-semibold hover:text-[#e8eaed] group transition-colors"
                >
                  KLIEN <SortIcon col="klien" />
                </button>
              </TableHead>
              
              {activeSubTab === 'sedang_diproses' ? (
                STAGE_ORDER.map(s => (
                  <TableHead key={s} className="text-[#9aa0a6] font-semibold text-center text-[10px] uppercase tracking-wider">
                    {STAGE_LABELS[s]}
                  </TableHead>
                ))
              ) : (
                <TableHead className="p-0">
                  <button 
                    onClick={() => handleSort('total_bundle')}
                    className="flex items-center gap-1 w-full h-full px-4 py-3 text-[#9aa0a6] font-semibold hover:text-[#e8eaed] group transition-colors justify-center"
                  >
                    TOTAL BUNDLE <SortIcon col="total_bundle" />
                  </button>
                </TableHead>
              )}
              
              <TableHead className="text-[#9aa0a6] font-semibold text-right px-4">AKSI</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.map((po) => (
              <TableRow key={po.id} className="border-[#2A2D31] hover:bg-[#2A2D31]/40 transition-colors">
                <TableCell>
                  <Link href={`/app/produksi/po/${po.no_po}`} className="font-mono font-bold text-[#e5c17b] hover:underline">
                    {po.no_po}
                  </Link>
                </TableCell>
                <TableCell className="text-[#e8eaed] text-sm">{po.klien_nama}</TableCell>
                
                {activeSubTab === 'sedang_diproses' ? (
                  STAGE_ORDER.map(s => {
                    const prog = po.progress[s] || { done: 0, total: 0 };
                    const percent = prog.total > 0 ? (prog.done / prog.total) * 100 : 0;
                    return (
                      <TableCell key={s} className="px-2">
                        <div className="space-y-1">
                          <div className="flex justify-between text-[9px] font-bold text-[#9aa0a6]">
                            <span>{prog.done}</span>
                            <span>{prog.total}</span>
                          </div>
                          <div className="h-1.5 w-full bg-[#0D0E10] rounded-full overflow-hidden">
                            <div 
                              className={`h-full transition-all duration-500 ${getProgressColor(prog.done, prog.total)}`}
                              style={{ width: `${percent}%` }}
                            />
                          </div>
                        </div>
                      </TableCell>
                    );
                  })
                ) : (
                  <TableCell className="text-center text-[#e8eaed] font-mono">{po.total_bundle}</TableCell>
                )}

                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-2">
                    {activeSubTab === 'belum_mulai' ? (
                      <>
                        <span className="text-[10px] font-bold text-[#9aa0a6] bg-[#2A2D31] px-2 py-0.5 rounded uppercase">Antri</span>
                        {role === 'owner' && (
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            className="h-8 w-8 text-[#9aa0a6] hover:text-[#ef4444] hover:bg-[#ef4444]/10"
                            onClick={() => handleDelete(po.id, po.no_po)}
                            disabled={isDeleting}
                          >
                            <Trash2 size={14} />
                          </Button>
                        )}
                      </>
                    ) : (
                      <Link href={`/app/produksi/po/${po.no_po}`}>
                        <Button variant="ghost" size="sm" className="h-8 text-[11px] font-bold text-[#e5c17b] hover:bg-[#e5c17b]/10 gap-1">
                          DETAIL <ExternalLink size={12} />
                        </Button>
                      </Link>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    );
  };

  const TabTrigger = ({ id, label, count }: { id: SubTab, label: string, count: number }) => (
    <button
      onClick={() => setActiveSubTab(id)}
      className={`
        px-4 py-2 text-xs font-bold uppercase tracking-widest transition-all border-b-2
        ${activeSubTab === id 
          ? 'border-[#e5c17b] text-[#e5c17b]' 
          : 'border-transparent text-[#9aa0a6] hover:text-[#e8eaed]'}
      `}
    >
      {label} <span className="ml-1 opacity-50">({count})</span>
    </button>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#2A2D31] pb-0">
        <div className="flex gap-6 px-2">
          <TabTrigger id="belum_mulai" label="Belum Mulai" count={initialData.belum_mulai.length} />
          <TabTrigger id="sedang_diproses" label="Sedang Dikerjakan" count={initialData.sedang_diproses.length} />
          <TabTrigger id="selesai" label="Selesai" count={initialData.selesai.length} />
        </div>
        <div className="relative mb-1 sm:mb-0 sm:mr-2">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#9aa0a6] pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Cari No. PO atau Klien..."
            className="bg-[#16181A] border border-[#2A2D31] rounded-lg pl-8 pr-8 py-1.5 text-xs text-[#e8eaed] placeholder-[#9aa0a6]/50 focus:outline-none focus:border-[#e5c17b] w-56 transition-colors"
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
          Menampilkan <span className="text-[#e8eaed] font-medium">{filteredList.length}</span> hasil untuk &quot;<span className="text-[#e5c17b]">{search}</span>&quot;
        </p>
      )}

      <div className="bg-[#1A1D1F] border border-[#2A2D31] rounded-2xl overflow-hidden shadow-sm">
        {renderTable()}
      </div>
    </div>
  );
}
