'use client';

import React, { useState, useEffect } from 'react';
import { 
  getAntrianPerTahap, 
  getSelesaiPerTahap,
  AntrianBundleItem, 
  SelesaiBundleItem 
} from '@/lib/actions/produksi/stage-bundles.actions';
import { type TahapKey } from '@/modules/produksi/constants/tahap';
import StageStatusBadge from './StageStatusBadge';
import StagePagination from './StagePagination';
import { Package, Clock, User, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

interface Props {
  tahap: TahapKey;
  antrianData: AntrianBundleItem[];
  antrianTotal: number;
  selesaiData: SelesaiBundleItem[];
  selesaiTotal: number;
  pageSize?: number;
}

export default function StageListSection({
  tahap,
  antrianData: initialAntrianData,
  antrianTotal: initialAntrianTotal,
  selesaiData: initialSelesaiData,
  selesaiTotal: initialSelesaiTotal,
  pageSize = 20
}: Props) {
  const [activeTab, setActiveTab] = useState<'antrian' | 'selesai'>('antrian');
  
  // Local Data & Pagination State
  const [antrianData, setAntrianData] = useState<AntrianBundleItem[]>(initialAntrianData);
  const [antrianTotal, setAntrianTotal] = useState(initialAntrianTotal);
  const [antrianPage, setAntrianPage] = useState(1);
  
  const [selesaiData, setSelesaiData] = useState<SelesaiBundleItem[]>(initialSelesaiData);
  const [selesaiTotal, setSelesaiTotal] = useState(initialSelesaiTotal);
  const [selesaiPage, setSelesaiPage] = useState(1);
  
  const [isLoading, setIsLoading] = useState(false);

  // Sync with initial props if they change (e.g. after a new scan)
  useEffect(() => {
    setAntrianData(initialAntrianData);
    setAntrianTotal(initialAntrianTotal);
  }, [initialAntrianData, initialAntrianTotal]);

  useEffect(() => {
    setSelesaiData(initialSelesaiData);
    setSelesaiTotal(initialSelesaiTotal);
  }, [initialSelesaiData, initialSelesaiTotal]);

  const handleAntrianPageChange = async (newPage: number) => {
    setAntrianPage(newPage);
    setIsLoading(true);
    try {
      const res = await getAntrianPerTahap(tahap, newPage, pageSize);
      setAntrianData(res.data);
      setAntrianTotal(res.total);
    } catch (error: any) {
      toast.error('Gagal mengambil data antrian');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSelesaiPageChange = async (newPage: number) => {
    setSelesaiPage(newPage);
    setIsLoading(true);
    try {
      const res = await getSelesaiPerTahap(tahap, newPage, pageSize);
      setSelesaiData(res.data);
      setSelesaiTotal(res.total);
    } catch (error: any) {
      toast.error('Gagal mengambil data selesai');
    } finally {
      setIsLoading(false);
    }
  };

  const totalAntrianPages = Math.ceil(antrianTotal / pageSize);
  const totalSelesaiPages = Math.ceil(selesaiTotal / pageSize);

  const formatDateTime = (dateStr: string) => {
    if (dateStr === '-' || !dateStr) return '-';
    return new Date(dateStr).toLocaleString('id-ID', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const TableHeader = ({ children }: { children: React.ReactNode }) => (
    <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-[#9aa0a6] bg-[#16181A] border-b border-[#2A2D31]">
      {children}
    </th>
  );

  return (
    <div className="space-y-4">
      {/* Tab Switcher */}
      <div className="flex p-1 bg-[#1A1D1F] rounded-xl border border-[#2A2D31] w-fit">
        <button
          onClick={() => setActiveTab('antrian')}
          className={`px-6 py-2 rounded-lg text-xs font-bold transition-all ${
            activeTab === 'antrian' ? 'bg-[#e5c17b] text-[#0D0E10]' : 'text-[#9aa0a6] hover:text-[#e8eaed]'
          }`}
        >
          ANTRIAN <span className="ml-1 opacity-50">({antrianTotal})</span>
        </button>
        <button
          onClick={() => setActiveTab('selesai')}
          className={`px-6 py-2 rounded-lg text-xs font-bold transition-all ${
            activeTab === 'selesai' ? 'bg-[#e5c17b] text-[#0D0E10]' : 'text-[#9aa0a6] hover:text-[#e8eaed]'
          }`}
        >
          SELESAI <span className="ml-1 opacity-50">({selesaiTotal})</span>
        </button>
      </div>

      {/* Content */}
      <div className="bg-[#1A1D1F] border border-[#2A2D31] rounded-2xl overflow-hidden shadow-sm relative">
        {isLoading && (
          <div className="absolute inset-0 bg-[#0D0E10]/40 backdrop-blur-[1px] z-10 flex items-center justify-center">
            <Loader2 className="w-8 h-8 text-[#e5c17b] animate-spin" />
          </div>
        )}

        {activeTab === 'antrian' ? (
          <div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr>
                    <TableHeader>No.</TableHeader>
                    <TableHeader>No. PO</TableHeader>
                    <TableHeader>Artikel</TableHeader>
                    <TableHeader>Warna / Size</TableHeader>
                    <TableHeader>Barcode</TableHeader>
                    <TableHeader>QTY</TableHeader>
                    <TableHeader>Status</TableHeader>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#2A2D31]">
                  {antrianData.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-12 text-center text-[#9aa0a6]">
                        <Package className="w-8 h-8 mx-auto mb-2 opacity-20" />
                        Tidak ada antrian di tahap {tahap}
                      </td>
                    </tr>
                  ) : (
                    antrianData.map((item, idx) => (
                      <tr key={item.id} className="hover:bg-[#2A2D31]/40 transition-colors">
                        <td className="px-4 py-3 text-xs font-bold text-[#9aa0a6]">
                          {(antrianPage - 1) * pageSize + idx + 1}
                        </td>
                        <td className="px-4 py-3">
                          <span className="font-mono font-bold text-[#e5c17b]">{item.no_po}</span>
                          <div className="text-[10px] text-[#9aa0a6]">{item.klien_nama}</div>
                        </td>
                        <td className="px-4 py-3 font-medium text-[#e8eaed]">{item.model_nama}</td>
                        <td className="px-4 py-3 text-[#9aa0a6]">
                          {item.warna} <span className="mx-1">/</span> {item.size}
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-[#9aa0a6]">{item.barcode}</td>
                        <td className="px-4 py-3 font-mono text-[#e8eaed]">
                          {item.qty_per_bundle} <span className="text-[10px] text-[#9aa0a6]">pcs</span>
                        </td>
                        <td className="px-4 py-3">
                          <StageStatusBadge status={item.status} />
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <div className="p-4 border-t border-[#2A2D31]">
                <StagePagination 
                    page={antrianPage} 
                    totalPages={totalAntrianPages} 
                    onPageChange={handleAntrianPageChange} 
                />
            </div>
          </div>
        ) : (
          <div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr>
                    <TableHeader>No.</TableHeader>
                    <TableHeader>No. PO</TableHeader>
                    <TableHeader>Artikel</TableHeader>
                    <TableHeader>Warna / Size</TableHeader>
                    <TableHeader>Barcode</TableHeader>
                    <TableHeader>QTY</TableHeader>
                    <TableHeader>Karyawan</TableHeader>
                    <TableHeader>Waktu Selesai</TableHeader>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#2A2D31]">
                  {selesaiData.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-4 py-12 text-center text-[#9aa0a6]">
                        <Package className="w-8 h-8 mx-auto mb-2 opacity-20" />
                        Belum ada bundle yang selesai di tahap {tahap}
                      </td>
                    </tr>
                  ) : (
                    selesaiData.map((item, idx) => (
                      <tr key={item.id} className="hover:bg-[#2A2D31]/40 transition-colors">
                        <td className="px-4 py-3 text-xs font-bold text-[#9aa0a6]">
                          {(selesaiPage - 1) * pageSize + idx + 1}
                        </td>
                        <td className="px-4 py-3">
                          <span className="font-mono font-bold text-[#e5c17b]">{item.no_po}</span>
                          <div className="text-[10px] text-[#9aa0a6]">{item.klien_nama}</div>
                        </td>
                        <td className="px-4 py-3 font-medium text-[#e8eaed]">{item.model_nama}</td>
                        <td className="px-4 py-3 text-[#9aa0a6]">
                          {item.warna} <span className="mx-1">/</span> {item.size}
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-[#9aa0a6]">{item.barcode}</td>
                        <td className="px-4 py-3 font-mono text-[#e8eaed]">
                          {item.qty_per_bundle} <span className="text-[10px] text-[#9aa0a6]">pcs</span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                             <div className="w-7 h-7 rounded-full bg-[#e5c17b]/10 flex items-center justify-center">
                                <User className="w-3.5 h-3.5 text-[#e5c17b]" />
                             </div>
                             <span className="text-xs font-medium text-[#e8eaed]">{item.karyawan_nama}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                            <div className="flex items-center gap-2 text-[#9aa0a6]">
                                <Clock size={12} />
                                <span className="text-xs">{formatDateTime(item.waktu_selesai)}</span>
                            </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <div className="p-4 border-t border-[#2A2D31]">
                <StagePagination 
                    page={selesaiPage} 
                    totalPages={totalSelesaiPages} 
                    onPageChange={handleSelesaiPageChange} 
                />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
