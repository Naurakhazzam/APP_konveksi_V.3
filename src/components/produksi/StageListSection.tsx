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
import { Package, Clock, Loader2, CheckCircle, X, Search, Printer } from 'lucide-react';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';
import { scanLanjutTahap, scanSelesai } from '@/lib/actions/produksi/scan-mutations.actions';
import { getAlasanQty } from '@/lib/actions/produksi/qty-approval.actions';

interface Props {
  tahap: TahapKey;
  antrianData: AntrianBundleItem[];
  antrianTotal: number;
  selesaiData: SelesaiBundleItem[];
  selesaiTotal: number;
  pageSize?: number;
  onBulkSelesaiDone?: (selesaiBundles: AntrianBundleItem[]) => void;
  onBulkTerimaDone?: (bundles: AntrianBundleItem[]) => void;
  onReprintHangTag?: (bundle: SelesaiBundleItem) => void;
}

export default function StageListSection({
  tahap,
  antrianData: initialAntrianData,
  antrianTotal: initialAntrianTotal,
  selesaiData: initialSelesaiData,
  selesaiTotal: initialSelesaiTotal,
  pageSize = 20,
  onBulkSelesaiDone,
  onBulkTerimaDone,
  onReprintHangTag
}: Props) {
  const isPacking = tahap === 'packing';

  const [activeTab, setActiveTab] = useState<'antrian' | 'sedang_proses' | 'selesai'>(
    isPacking ? 'antrian' : 'sedang_proses'
  );

  // Local Data & Pagination State
  const [antrianData, setAntrianData] = useState<AntrianBundleItem[]>(initialAntrianData);
  const [antrianTotal, setAntrianTotal] = useState(initialAntrianTotal);
  const [antrianPage, setAntrianPage] = useState(1);

  const [selesaiData, setSelesaiData] = useState<SelesaiBundleItem[]>(initialSelesaiData);
  const [selesaiTotal, setSelesaiTotal] = useState(initialSelesaiTotal);
  const [selesaiPage, setSelesaiPage] = useState(1);

  const [isLoading, setIsLoading] = useState(false);

  // Search (khusus Packing) — mencocokkan per kata (bebas urutan) ke No PO,
  // Klien, Model, Warna, Size, Barcode; dikirim ke server supaya menjangkau
  // seluruh data, bukan cuma halaman yang sedang tampil.
  const [searchQuery, setSearchQuery] = useState('');
  
  // Selection & Modal State
  const [selectedAntrianIds, setSelectedAntrianIds] = useState<Set<string>>(new Set());
  const [selectedProsesIds, setSelectedProsesIds]   = useState<Set<string>>(new Set());
  const [isBulkLoading, setIsBulkLoading] = useState(false);
  const [isBulkTerimaLoading, setIsBulkTerimaLoading] = useState(false);
  
  const [showKonfirmasiModal, setShowKonfirmasiModal] = useState(false);
  const [alasanList, setAlasanList] = useState<{ id: string; label: string }[]>([]);
  const [qtyInputs, setQtyInputs] = useState<{
    bundleId: string;
    barcode: string;
    artikelNama: string;
    warna: string;
    size: string;
    qtyOrder: number;
    qtyAktual: number;
    alasanId: string | null;
  }[]>([]);

  const router = useRouter();

  // Clear selection saat pindah tab
  useEffect(() => {
    setSelectedAntrianIds(new Set());
    setSelectedProsesIds(new Set());
  }, [activeTab]);

  // Sync with initial props if they change — dilewati kalau sedang ada
  // pencarian aktif, supaya router.refresh() (misal setelah bulk action)
  // tidak menimpa balik hasil pencarian dengan data tak terfilter.
  useEffect(() => {
    if (searchQuery.trim()) return;
    setAntrianData(initialAntrianData);
    setAntrianTotal(initialAntrianTotal);
  }, [initialAntrianData, initialAntrianTotal, searchQuery]);

  useEffect(() => {
    if (searchQuery.trim()) return;
    setSelesaiData(initialSelesaiData);
    setSelesaiTotal(initialSelesaiTotal);
  }, [initialSelesaiData, initialSelesaiTotal, searchQuery]);

  // Debounce pencarian — refetch antrian & selesai (halaman 1) dari server
  // setiap kata kunci berubah. Khusus Packing.
  useEffect(() => {
    if (!isPacking) return;
    const handle = setTimeout(async () => {
      setIsLoading(true);
      try {
        const [antrianRes, selesaiRes] = await Promise.all([
          getAntrianPerTahap(tahap, 1, pageSize, searchQuery),
          getSelesaiPerTahap(tahap, 1, pageSize, searchQuery),
        ]);
        setAntrianData(antrianRes.data);
        setAntrianTotal(antrianRes.total);
        setAntrianPage(1);
        setSelesaiData(selesaiRes.data);
        setSelesaiTotal(selesaiRes.total);
        setSelesaiPage(1);
      } catch (e: any) {
        toast.error('Gagal mencari data');
      } finally {
        setIsLoading(false);
      }
    }, 350);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery, isPacking, tahap, pageSize]);

  const handleAntrianPageChange = async (newPage: number) => {
    setAntrianPage(newPage);
    setIsLoading(true);
    try {
      const res = await getAntrianPerTahap(tahap, newPage, pageSize, searchQuery);
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
      const res = await getSelesaiPerTahap(tahap, newPage, pageSize, searchQuery);
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

  // Filter antrianData
  const waitingData = isPacking ? antrianData.filter(b => b.status === 'menunggu') : [];
  const sedangProsesData = isPacking ? antrianData.filter(b => b.status === 'sedang_proses') : antrianData;

  const handleOpenModal = async () => {
    const selected = sedangProsesData.filter(b => selectedProsesIds.has(b.id));
    if (selected.length === 0) return;
    
    setIsLoading(true);
    try {
      const alasan = await getAlasanQty();
      setAlasanList(alasan);
      setQtyInputs(selected.map(b => ({
        bundleId: b.id,
        barcode: b.barcode,
        artikelNama: b.model_nama ?? '-',
        warna: b.warna,
        size: b.size,
        qtyOrder: b.qty_per_bundle,
        qtyAktual: b.qty_per_bundle,
        alasanId: null,
      })));
      setShowKonfirmasiModal(true);
    } catch (e: any) {
      toast.error('Gagal memuat alasan qty');
    } finally {
      setIsLoading(false);
    }
  };

  const handleQtyChange = (bundleId: string, newQty: number) => {
    setQtyInputs(prev => prev.map(item =>
      item.bundleId === bundleId
        ? { ...item, qtyAktual: newQty, alasanId: null }
        : item
    ));
  };

  const handleAlasanChange = (bundleId: string, alasanId: string) => {
    setQtyInputs(prev => prev.map(item =>
      item.bundleId === bundleId ? { ...item, alasanId } : item
    ));
  };

  const handleBulkTerima = async () => {
    const selected = waitingData.filter(b => selectedAntrianIds.has(b.id));
    if (selected.length === 0) return;

    setIsBulkTerimaLoading(true);
    const berhasilBundles: AntrianBundleItem[] = [];
    let gagal = 0;

    for (const bundle of selected) {
      try {
        await scanLanjutTahap({
          barcode: bundle.barcode,
          tahap_baru: tahap,
          karyawan_id: '',
          qty: bundle.qty_per_bundle,
        });
        berhasilBundles.push(bundle);
      } catch (err: any) {
        gagal++;
        toast.error(`Gagal terima: ${bundle.barcode} — ${err.message}`);
      }
    }

    setIsBulkTerimaLoading(false);

    if (berhasilBundles.length > 0) {
      toast.success(`${berhasilBundles.length} bundle berhasil diterima`);
      setSelectedAntrianIds(new Set());
      onBulkTerimaDone?.(berhasilBundles);
      router.refresh();
    }
  };

  const handleBulkSelesai = async () => {
    const adaYangBelumIsiAlasan = qtyInputs.some(
      item => item.qtyAktual < item.qtyOrder && !item.alasanId
    );
    if (adaYangBelumIsiAlasan) {
      toast.error('Semua reject wajib diisi alasan');
      return;
    }

    setIsBulkLoading(true);
    const berhasilBundles: AntrianBundleItem[] = [];
    let gagal = 0;

    for (const input of qtyInputs) {
      const bundle = sedangProsesData.find(b => b.id === input.bundleId);
      if (!bundle) continue;

      try {
        if (!isPacking) {
          await scanLanjutTahap({
            barcode: bundle.barcode,
            tahap_baru: tahap,
            karyawan_id: '',
            qty: input.qtyAktual,
          });
        }
        await scanSelesai({
          barcode: bundle.barcode,
          tahap: tahap,
          karyawan_id: null,
          qty: input.qtyAktual,
          catatan: undefined,
          alasan_qty_id: input.alasanId ?? null,
          tenant_id: 'STX-001',
        });
        
        berhasilBundles.push({ ...bundle, qty_per_bundle: input.qtyAktual });
      } catch (err: any) {
        gagal++;
        toast.error(`Gagal: ${bundle.barcode} — ${err.message}`);
      }
    }

    setIsBulkLoading(false);
    
    if (berhasilBundles.length > 0) {
      toast.success(`${berhasilBundles.length} bundle berhasil diselesaikan`);
      setShowKonfirmasiModal(false);
      setSelectedProsesIds(new Set());
      onBulkSelesaiDone?.(berhasilBundles);
    }
    
    if (gagal === 0 && berhasilBundles.length > 0) {
      router.refresh();
    } else if (berhasilBundles.length > 0) {
      router.refresh();
    }
  };

  const handleSelectAllAntrian = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.checked) {
      setSelectedAntrianIds(new Set(waitingData.map(b => b.id)));
    } else {
      setSelectedAntrianIds(new Set());
    }
  };

  const toggleSelectAntrian = (id: string) => {
    const newSet = new Set(selectedAntrianIds);
    if (newSet.has(id)) newSet.delete(id);
    else newSet.add(id);
    setSelectedAntrianIds(newSet);
  };

  const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.checked) {
      setSelectedProsesIds(new Set(sedangProsesData.map(b => b.id)));
    } else {
      setSelectedProsesIds(new Set());
    }
  };

  const toggleSelect = (id: string) => {
    const newSet = new Set(selectedProsesIds);
    if (newSet.has(id)) newSet.delete(id);
    else newSet.add(id);
    setSelectedProsesIds(newSet);
  };

  const formatDateTime = (dateStr: string) => {
    if (dateStr === '-' || !dateStr) return '-';
    return new Date(dateStr).toLocaleString('id-ID', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  // Format: "Jumat, 17-07-26" — nama hari (Indonesia) + tanggal DD-MM-YY
  const formatTanggalSelesaiJahit = (dateStr: string | null) => {
    if (!dateStr) return '-';
    const d = new Date(dateStr);
    const hari = d.toLocaleDateString('id-ID', { weekday: 'long' });
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yy = String(d.getFullYear()).slice(-2);
    return `${hari}, ${dd}-${mm}-${yy}`;
  };

  const TableHeader = ({ children }: { children: React.ReactNode }) => (
    <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-[#9aa0a6] bg-[#16181A] border-b border-[#2A2D31]">
      {children}
    </th>
  );

  const rejectCount = qtyInputs.filter(item => item.qtyAktual < item.qtyOrder).length;

  return (
    <div className="space-y-4">
      {/* Header & Tabs */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        {/* Tab Switcher */}
        <div className="flex p-1 bg-[#1A1D1F] rounded-xl border border-[#2A2D31] w-fit">
          {isPacking && (
            <button
              onClick={() => setActiveTab('antrian')}
              className={`px-6 py-2 rounded-lg text-xs font-bold transition-all ${
                activeTab === 'antrian' ? 'bg-[#e5c17b] text-[#0D0E10]' : 'text-[#9aa0a6] hover:text-[#e8eaed]'
              }`}
            >
              ANTRIAN <span className="ml-1 opacity-50">({waitingData.length})</span>
            </button>
          )}
          <button
            onClick={() => setActiveTab('sedang_proses')}
            className={`px-6 py-2 rounded-lg text-xs font-bold transition-all ${
              activeTab === 'sedang_proses' ? 'bg-[#e5c17b] text-[#0D0E10]' : 'text-[#9aa0a6] hover:text-[#e8eaed]'
            }`}
          >
            SEDANG PROSES <span className="ml-1 opacity-50">({sedangProsesData.length})</span>
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

        {/* Search — khusus Packing */}
        {isPacking && (
          <div className="relative w-full sm:w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#9aa0a6] pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Cari model, warna, size, no PO..."
              className="w-full bg-[#16181A] border border-[#2A2D31] rounded-lg pl-8 pr-8 py-2 text-xs text-[#e8eaed] placeholder-[#9aa0a6]/50 focus:outline-none focus:border-[#e5c17b] transition-colors"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-[#9aa0a6] hover:text-[#e8eaed] transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        )}
        </div>

        {/* Bulk Action Button */}
        {isPacking && activeTab === 'antrian' && selectedAntrianIds.size > 0 && (
          <button
            onClick={handleBulkTerima}
            disabled={isBulkTerimaLoading}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-xs font-bold transition-colors shadow-lg"
          >
            {isBulkTerimaLoading ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> Menerima...</>
            ) : (
              <><CheckCircle className="w-4 h-4" /> Terima ({selectedAntrianIds.size} Bundle)</>
            )}
          </button>
        )}

        {activeTab === 'sedang_proses' && selectedProsesIds.size > 0 && (
          <button
            onClick={handleOpenModal}
            disabled={isLoading}
            className="flex items-center gap-2 bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-xs font-bold transition-colors shadow-lg"
          >
            {isLoading ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> Memproses...</>
            ) : (
              <><CheckCircle className="w-4 h-4" /> Selesaikan ({selectedProsesIds.size} Bundle)</>
            )}
          </button>
        )}
      </div>

      {/* Content */}
      <div className="bg-[#1A1D1F] border border-[#2A2D31] rounded-2xl overflow-hidden shadow-sm relative">
        {isLoading && !showKonfirmasiModal && (
          <div className="absolute inset-0 bg-[#0D0E10]/40 backdrop-blur-[1px] z-10 flex items-center justify-center">
            <Loader2 className="w-8 h-8 text-[#e5c17b] animate-spin" />
          </div>
        )}

        {isPacking && activeTab === 'antrian' ? (
          <div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr>
                    <TableHeader>
                      <input
                        type="checkbox"
                        checked={selectedAntrianIds.size > 0 && selectedAntrianIds.size === waitingData.length}
                        onChange={handleSelectAllAntrian}
                        className="accent-[#e5c17b] w-4 h-4 rounded cursor-pointer"
                      />
                    </TableHeader>
                    <TableHeader>No.</TableHeader>
                    <TableHeader>No. PO</TableHeader>
                    <TableHeader>Artikel</TableHeader>
                    <TableHeader>Warna / Size</TableHeader>
                    <TableHeader>Barcode</TableHeader>
                    <TableHeader>QTY</TableHeader>
                    <TableHeader>Status</TableHeader>
                    <TableHeader>Nama Penjahit</TableHeader>
                    <TableHeader>Tgl Selesai Jahit</TableHeader>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#2A2D31]">
                  {waitingData.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="px-4 py-12 text-center text-[#9aa0a6]">
                        <Package className="w-8 h-8 mx-auto mb-2 opacity-20" />
                        Tidak ada antrian di tahap {tahap}
                      </td>
                    </tr>
                  ) : (
                    waitingData.map((item, idx) => (
                      <tr key={item.id} className="hover:bg-[#2A2D31]/40 transition-colors">
                        <td className="px-4 py-3">
                          <input
                            type="checkbox"
                            checked={selectedAntrianIds.has(item.id)}
                            onChange={() => toggleSelectAntrian(item.id)}
                            className="accent-[#e5c17b] w-4 h-4 rounded cursor-pointer"
                          />
                        </td>
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
                        <td className="px-4 py-3 text-[#9aa0a6]">{item.jahit_karyawan_nama}</td>
                        <td className="px-4 py-3 text-xs text-[#9aa0a6]">{formatTanggalSelesaiJahit(item.jahit_waktu_selesai)}</td>
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
        ) : activeTab === 'sedang_proses' ? (
          <div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr>
                    <TableHeader>
                      <input 
                        type="checkbox" 
                        checked={selectedProsesIds.size > 0 && selectedProsesIds.size === sedangProsesData.length}
                        onChange={handleSelectAll}
                        className="accent-[#e5c17b] w-4 h-4 rounded cursor-pointer"
                      />
                    </TableHeader>
                    <TableHeader>No.</TableHeader>
                    <TableHeader>No. PO</TableHeader>
                    <TableHeader>Artikel</TableHeader>
                    <TableHeader>Warna / Size</TableHeader>
                    <TableHeader>Barcode</TableHeader>
                    <TableHeader>QTY</TableHeader>
                    <TableHeader>Nama Penjahit</TableHeader>
                    <TableHeader>Tgl Selesai Jahit</TableHeader>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#2A2D31]">
                  {sedangProsesData.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="px-4 py-12 text-center text-[#9aa0a6]">
                        <Package className="w-8 h-8 mx-auto mb-2 opacity-20" />
                        Tidak ada bundle yang sedang diproses di tahap {tahap}
                      </td>
                    </tr>
                  ) : (
                    sedangProsesData.map((item, idx) => (
                      <tr key={item.id} className="hover:bg-[#2A2D31]/40 transition-colors">
                        <td className="px-4 py-3">
                          <input
                            type="checkbox"
                            checked={selectedProsesIds.has(item.id)}
                            onChange={() => toggleSelect(item.id)}
                            className="accent-[#e5c17b] w-4 h-4 rounded cursor-pointer"
                          />
                        </td>
                        <td className="px-4 py-3 text-xs font-bold text-[#9aa0a6]">{idx + 1}</td>
                        <td className="px-4 py-3">
                          <span className="font-mono font-bold text-[#e5c17b]">{item.no_po}</span>
                          <div className="text-[10px] text-[#9aa0a6]">{item.klien_nama}</div>
                        </td>
                        <td className="px-4 py-3 font-medium text-[#e8eaed]">{item.model_nama}</td>
                        <td className="px-4 py-3 text-[#9aa0a6]">{item.warna} <span className="mx-1">/</span> {item.size}</td>
                        <td className="px-4 py-3 font-mono text-xs text-[#9aa0a6]">{item.barcode}</td>
                        <td className="px-4 py-3 font-mono text-[#e8eaed]">
                          {item.qty_per_bundle} <span className="text-[10px] text-[#9aa0a6]">pcs</span>
                        </td>
                        <td className="px-4 py-3 text-[#9aa0a6]">{item.jahit_karyawan_nama}</td>
                        <td className="px-4 py-3 text-xs text-[#9aa0a6]">{formatTanggalSelesaiJahit(item.jahit_waktu_selesai)}</td>
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
                    <TableHeader>Waktu Selesai</TableHeader>
                    <TableHeader>Nama Penjahit</TableHeader>
                    <TableHeader>Tgl Selesai Jahit</TableHeader>
                    {isPacking && <TableHeader>Aksi</TableHeader>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#2A2D31]">
                  {selesaiData.length === 0 ? (
                    <tr>
                      <td colSpan={isPacking ? 10 : 9} className="px-4 py-12 text-center text-[#9aa0a6]">
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
                            <div className="flex items-center gap-2 text-[#9aa0a6]">
                                <Clock size={12} />
                                <span className="text-xs">{formatDateTime(item.waktu_selesai)}</span>
                            </div>
                        </td>
                        <td className="px-4 py-3 text-[#9aa0a6]">{item.jahit_karyawan_nama}</td>
                        <td className="px-4 py-3 text-xs text-[#9aa0a6]">{formatTanggalSelesaiJahit(item.jahit_waktu_selesai)}</td>
                        {isPacking && (
                          <td className="px-4 py-3">
                            <button
                              onClick={() => onReprintHangTag?.(item)}
                              className="flex items-center gap-1 text-[10px] font-bold text-[#9aa0a6] hover:text-[#e5c17b] border border-[#2A2D31] px-2 py-1 rounded-lg transition-colors"
                            >
                              <Printer className="w-3 h-3" /> Print Ulang
                            </button>
                          </td>
                        )}
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

      {/* Modal Konfirmasi QTY */}
      {showKonfirmasiModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-[#1A1D1F] border border-[#2A2D31] rounded-2xl w-full max-w-3xl max-h-[80vh] flex flex-col shadow-2xl">
            {/* Header */}
            <div className="flex items-center justify-between p-6 border-b border-[#2A2D31]">
              <div>
                <h3 className="text-lg font-bold text-[#e8eaed]">Konfirmasi QTY Sebelum Selesaikan</h3>
                <p className="text-sm text-[#9aa0a6] mt-1">Periksa dan sesuaikan QTY aktual. Jika ada reject, wajib isi alasan.</p>
              </div>
              <button 
                onClick={() => !isBulkLoading && setShowKonfirmasiModal(false)}
                disabled={isBulkLoading}
                className="text-[#9aa0a6] hover:text-[#e8eaed] transition-colors disabled:opacity-50"
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto p-6">
              <table className="w-full text-sm border-collapse text-[#e8eaed]">
                <thead className="sticky top-0 bg-[#1A1D1F] z-10">
                  <tr>
                    <th className="text-left px-2 py-3 text-[11px] font-bold uppercase tracking-wider text-[#9aa0a6] border-b border-[#2A2D31]">No</th>
                    <th className="text-left px-2 py-3 text-[11px] font-bold uppercase tracking-wider text-[#9aa0a6] border-b border-[#2A2D31]">Barcode</th>
                    <th className="text-left px-2 py-3 text-[11px] font-bold uppercase tracking-wider text-[#9aa0a6] border-b border-[#2A2D31]">Artikel</th>
                    <th className="text-left px-2 py-3 text-[11px] font-bold uppercase tracking-wider text-[#9aa0a6] border-b border-[#2A2D31]">Warna/Size</th>
                    <th className="text-center px-2 py-3 text-[11px] font-bold uppercase tracking-wider text-[#9aa0a6] border-b border-[#2A2D31]">QTY Order</th>
                    <th className="text-center px-2 py-3 text-[11px] font-bold uppercase tracking-wider text-[#9aa0a6] border-b border-[#2A2D31]">QTY Aktual</th>
                    <th className="text-left px-2 py-3 text-[11px] font-bold uppercase tracking-wider text-[#9aa0a6] border-b border-[#2A2D31]">Alasan Reject</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#2A2D31]">
                  {qtyInputs.map((item, idx) => {
                    const isReject = item.qtyAktual < item.qtyOrder;
                    return (
                      <tr 
                        key={item.bundleId} 
                        className={`transition-colors ${isReject ? 'bg-red-500/5 border-l-2 border-red-500' : 'hover:bg-[#2A2D31]/40'}`}
                      >
                        <td className="px-2 py-3 text-xs font-bold text-[#9aa0a6]">{idx + 1}</td>
                        <td className="px-2 py-3 font-mono text-xs">{item.barcode}</td>
                        <td className="px-2 py-3">{item.artikelNama}</td>
                        <td className="px-2 py-3 text-[#9aa0a6]">{item.warna} / {item.size}</td>
                        <td className="px-2 py-3 font-mono text-center">{item.qtyOrder}</td>
                        <td className="px-2 py-3 text-center">
                          <input 
                            type="number"
                            min={0}
                            value={item.qtyAktual}
                            onChange={(e) => handleQtyChange(item.bundleId, parseInt(e.target.value) || 0)}
                            className={`w-16 text-center bg-[#0D0E10] border ${isReject ? 'border-red-500' : 'border-[#2A2D31]'} rounded-lg px-2 py-1 text-sm font-bold text-[#e8eaed] focus:border-[#e5c17b] outline-none transition-colors`}
                          />
                        </td>
                        <td className="px-2 py-3">
                          {isReject && (
                            <select
                              value={item.alasanId || ''}
                              onChange={(e) => handleAlasanChange(item.bundleId, e.target.value)}
                              className="w-full bg-[#0D0E10] border border-red-500 rounded-lg px-2 py-1 text-sm text-[#e8eaed] outline-none"
                              required
                            >
                              <option value="" disabled>-- Pilih alasan --</option>
                              {alasanList.map(a => (
                                <option key={a.id} value={a.id}>{a.label}</option>
                              ))}
                            </select>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between p-6 border-t border-[#2A2D31] bg-[#16181A] rounded-b-2xl">
              <div className="text-sm font-medium">
                <span className="text-[#9aa0a6]">Total bundle: {qtyInputs.length} | </span>
                {rejectCount > 0 ? (
                  <span className="text-red-400 font-bold">Ada reject: {rejectCount} bundle</span>
                ) : (
                  <span className="text-green-400 font-bold">Semua QTY penuh ✓</span>
                )}
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setShowKonfirmasiModal(false)}
                  disabled={isBulkLoading}
                  className="px-6 py-2 rounded-lg bg-[#2A2D31] hover:bg-[#3A3D41] text-[#e8eaed] font-bold text-sm transition-colors disabled:opacity-50"
                >
                  Batal
                </button>
                <button
                  onClick={handleBulkSelesai}
                  disabled={
                    isBulkLoading || 
                    qtyInputs.some(item => item.qtyAktual < item.qtyOrder && !item.alasanId)
                  }
                  className="flex items-center gap-2 px-6 py-2 rounded-lg bg-green-600 hover:bg-green-500 text-white font-bold text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isBulkLoading ? (
                    <><Loader2 className="w-4 h-4 animate-spin" /> Memproses...</>
                  ) : (
                    'Konfirmasi & Selesaikan'
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
