'use client';

import React, { useState } from 'react';
import { type AntrianJahitBundle } from '@/lib/actions/produksi/scan.actions';
import { getSelesaiPerTahap, type SelesaiBundleItem } from '@/lib/actions/produksi/stage-bundles.actions';
import StageStatusBadge from '@/components/produksi/StageStatusBadge';
import StagePagination from '@/components/produksi/StagePagination';
import ModalSerahTerimaJahit from './ModalSerahTerimaJahit';
import { Package, Clock, User, Loader2, Users, Printer } from 'lucide-react';
import { toast } from 'sonner';
import { getAksesoriForKartuKerja } from '@/lib/actions/produksi/model-aksesori.actions';
import PrintKartuKerjaLayout, { type KartuBundle, type AksesoriItem } from '@/app/(dashboard)/app/produksi/antrian-cutting/PrintKartuKerjaLayout';

interface Props {
  initialAntrian: AntrianJahitBundle[];
  initialSelesai: { data: SelesaiBundleItem[]; total: number };
  karyawanList: { id: string; nama: string }[];
}

export default function JahitListClient({ initialAntrian, initialSelesai, karyawanList }: Props) {
  const [activeTab, setActiveTab] = useState<'antrian' | 'selesai'>('antrian');
  
  // Antrian Data (Not Paginated)
  const [antrianData, setAntrianData] = useState<AntrianJahitBundle[]>(initialAntrian);
  
  // Selesai Data (Paginated)
  const [selesaiData, setSelesaiData] = useState<SelesaiBundleItem[]>(initialSelesai.data);
  const [selesaiTotal, setSelesaiTotal] = useState(initialSelesai.total);
  const [selesaiPage, setSelesaiPage] = useState(1);
  const pageSize = 20;

  const [printUlangData, setPrintUlangData] = useState<KartuBundle[] | null>(null);

  const [isLoading, setIsLoading] = useState(false);
  const [selectedBundleIds, setSelectedBundleIds] = useState<Set<string>>(new Set());
  const [showModalSerahTerima, setShowModalSerahTerima] = useState(false);

  const handleSerahTerimaSuccess = () => {
    setShowModalSerahTerima(false);
    setSelectedBundleIds(new Set());
    window.location.reload();
  };

  const handlePrintUlang = async (bundle: AntrianJahitBundle) => {
    const aksesoriMap = await getAksesoriForKartuKerja([bundle.po_item_id]);
    const aks: AksesoriItem[] = (aksesoriMap[bundle.po_item_id] ?? []).map((item: any) => ({
      nama: item.inventory_item_nama,
      qty_per_pcs: item.qty_per_pcs,
      satuan: item.satuan,
      tahap_pakai: item.tahap_pakai,
    }));
    let parsedUrut = 0;
    const bMatch = bundle.barcode.match(/bdl(\d+)$/i);
    if (bMatch) parsedUrut = parseInt(bMatch[1], 10);
    const karyawanNama = karyawanList.find(
      k => k.id === ((bundle as any).status_tahap?.['jahit'])?.karyawan_id
    )?.nama ?? '';
    setPrintUlangData([{
      id: bundle.id, barcode: bundle.barcode, no_urut: parsedUrut,
      po_id: '', po_item_id: bundle.po_item_id, no_po: bundle.no_po,
      tanggal_order: '', tanggal_target: '', po_catatan: null,
      klien_nama: bundle.klien_nama, model_nama: bundle.model_nama,
      warna: bundle.warna, size: bundle.size,
      qty_per_bundle: bundle.qty_per_bundle,
      aksesori: aks, nama_penjahit: karyawanNama,
    }]);
    setTimeout(() => { window.print(); setPrintUlangData(null); }, 500);
  };

  const handleSelesaiPageChange = async (newPage: number) => {
    setSelesaiPage(newPage);
    setIsLoading(true);
    try {
      const res = await getSelesaiPerTahap('jahit', newPage, pageSize);
      setSelesaiData(res.data);
      setSelesaiTotal(res.total);
    } catch (error: any) {
      toast.error('Gagal mengambil data selesai: ' + error.message);
    } finally {
      setIsLoading(false);
    }
  };

  const totalSelesaiPages = Math.ceil(selesaiTotal / pageSize);

  const toggleSelectAll = () => {
    if (selectedBundleIds.size === antrianData.length) {
      setSelectedBundleIds(new Set());
    } else {
      setSelectedBundleIds(new Set(antrianData.map(b => b.id)));
    }
  };

  const toggleSelectBundle = (id: string) => {
    const newSet = new Set(selectedBundleIds);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    setSelectedBundleIds(newSet);
  };

  const TableHeader = ({ children, className = "" }: { children: React.ReactNode, className?: string }) => (
    <th className={`px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-[#9aa0a6] bg-[#16181A] border-b border-[#2A2D31] ${className}`}>
      {children}
    </th>
  );

  const formatDateTime = (dateStr: string) => {
    if (dateStr === '-' || !dateStr) return '-';
    return new Date(dateStr).toLocaleString('id-ID', {
      day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit'
    });
  };

  return (
    <div className="mt-2 pt-6 border-t border-[#2A2D31]">
      <div className="mb-6 px-1 flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-[#e8eaed] flex items-center gap-3">
            Monitoring Jahit
            <span className="text-[9px] uppercase font-black text-[#e5c17b] px-2 py-0.5 bg-[#e5c17b]/10 border border-[#e5c17b]/20 rounded tracking-[0.2em] shadow-[0_0_15px_rgba(229,193,123,0.1)]">
              Live Queue
            </span>
          </h2>
          <p className="text-[#9aa0a6] text-[13px] mt-1.5 leading-relaxed">
            Pantau antrean bundle dan hasil pengerjaan secara real-time di stasiun <span className="text-[#e8eaed] font-bold capitalize">Jahit</span>.
          </p>
        </div>
        
        {/* Toolbar Serah Terima */}
        {activeTab === 'antrian' && selectedBundleIds.size > 0 && (
          <button 
            onClick={() => setShowModalSerahTerima(true)}
            className="flex items-center gap-2 bg-[#e5c17b] hover:bg-[#d4b06a] text-[#0D0E10] px-4 py-2 rounded-lg font-bold transition-colors shadow-lg"
          >
            <Users className="w-4 h-4" />
            Serah Terima ({selectedBundleIds.size} Bundle)
          </button>
        )}
      </div>

      <div className="space-y-4">
        {/* Tab Switcher */}
        <div className="flex p-1 bg-[#1A1D1F] rounded-xl border border-[#2A2D31] w-fit">
          <button
            onClick={() => setActiveTab('antrian')}
            className={`px-6 py-2 rounded-lg text-xs font-bold transition-all ${
              activeTab === 'antrian' ? 'bg-[#e5c17b] text-[#0D0E10]' : 'text-[#9aa0a6] hover:text-[#e8eaed]'
            }`}
          >
            ANTRIAN <span className="ml-1 opacity-50">({antrianData.length})</span>
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
                      <TableHeader className="w-12 text-center">
                        <input 
                          type="checkbox" 
                          checked={selectedBundleIds.size === antrianData.length && antrianData.length > 0}
                          onChange={toggleSelectAll}
                          className="accent-[#e5c17b] w-4 h-4 rounded border-[#2A2D31] cursor-pointer"
                        />
                      </TableHeader>
                      <TableHeader>No.</TableHeader>
                      <TableHeader>No. PO</TableHeader>
                      <TableHeader>Artikel</TableHeader>
                      <TableHeader>Warna / Size</TableHeader>
                      <TableHeader>Barcode</TableHeader>
                      <TableHeader>QTY</TableHeader>
                      <TableHeader>Status</TableHeader>
                      <TableHeader>Aksi</TableHeader>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#2A2D31]">
                    {antrianData.length === 0 ? (
                      <tr>
                        <td colSpan={9} className="px-4 py-12 text-center text-[#9aa0a6]">
                          <Package className="w-8 h-8 mx-auto mb-2 opacity-20" />
                          Tidak ada antrian di tahap jahit
                        </td>
                      </tr>
                    ) : (
                      antrianData.map((item, idx) => (
                        <tr key={item.id} className="hover:bg-[#2A2D31]/40 transition-colors">
                          <td className="px-4 py-3 text-center">
                            <input 
                              type="checkbox" 
                              checked={selectedBundleIds.has(item.id)}
                              onChange={() => toggleSelectBundle(item.id)}
                              className="accent-[#e5c17b] w-4 h-4 rounded border-[#2A2D31] cursor-pointer"
                            />
                          </td>
                          <td className="px-4 py-3 text-xs font-bold text-[#9aa0a6]">
                            {idx + 1}
                          </td>
                          <td className="px-4 py-3">
                            <span className="font-mono font-bold text-[#e5c17b]">{item.no_po}</span>
                            <div className="text-[10px] text-[#9aa0a6]">{item.klien_nama}</div>
                          </td>
                          <td className="px-4 py-3 font-medium text-[#e8eaed]">{item.model_nama ?? '-'}</td>
                          <td className="px-4 py-3 text-[#9aa0a6]">
                            {item.warna} <span className="mx-1">/</span> {item.size}
                          </td>
                          <td className="px-4 py-3 font-mono text-xs text-[#9aa0a6]">{item.barcode}</td>
                          <td className="px-4 py-3 font-mono text-[#e8eaed]">
                            {item.qty_per_bundle} <span className="text-[10px] text-[#9aa0a6]">pcs</span>
                          </td>
                          <td className="px-4 py-3">
                            <StageStatusBadge status="menunggu" />
                          </td>
                          <td className="px-4 py-3">
                            {((item as any).status_tahap?.['jahit'])?.status === 'terima' && (
                              <button onClick={() => handlePrintUlang(item)}
                                className="flex items-center gap-1 text-[10px] font-bold text-[#9aa0a6] hover:text-[#e5c17b] border border-[#2A2D31] px-2 py-1 rounded-lg transition-colors">
                                <Printer className="w-3 h-3" /> Print Ulang
                              </button>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
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
                          Belum ada bundle yang selesai di tahap jahit
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

      {showModalSerahTerima && (
        <ModalSerahTerimaJahit
          selectedBundles={antrianData.filter(b => selectedBundleIds.has(b.id))}
          karyawanList={karyawanList}
          onSuccess={handleSerahTerimaSuccess}
          onClose={() => setShowModalSerahTerima(false)}
        />
      )}

      {printUlangData && printUlangData.length > 0 && (
        <PrintKartuKerjaLayout
          bundles={printUlangData}
          tglCetak={new Date().toLocaleString('id-ID', {
            day:'2-digit', month:'short', year:'numeric',
            hour:'2-digit', minute:'2-digit'
          })}
        />
      )}
    </div>
  );
}
