'use client';

import { useState, useEffect } from 'react';
import { 
  History, 
  Filter, 
  Calendar, 
  ArrowDownRight,
  Package,
  Layers,
  Search,
  Tag
} from 'lucide-react';
import { 
  TransaksiKeluar, 
  InventoryOverviewItem,
  getTransaksiKeluar 
} from '@/lib/actions/inventory/inventory.actions';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

const selectCls = 'h-10 rounded-md border border-[#2A2D31] bg-[#16181A] px-3 text-sm text-[#e8eaed] focus:ring-1 focus:ring-[#e5c17b] outline-none min-w-[220px]';

interface Props {
  initialData: TransaksiKeluar[];
  totalCount: number;
  inventoryItems: InventoryOverviewItem[];
}

export default function TransaksiKeluarClient({ initialData, totalCount, inventoryItems }: Props) {
  const [data, setData] = useState<TransaksiKeluar[]>(initialData);
  const [filterItemId, setFilterItemId] = useState<string>('all');
  const [loading, setLoading] = useState(false);

  // Re-fetch when filter changes
  useEffect(() => {
    if (filterItemId === 'all' && data === initialData) return;

    const fetchData = async () => {
      setLoading(true);
      try {
        const result = await getTransaksiKeluar(1, 30, filterItemId === 'all' ? undefined : filterItemId);
        setData(result.data);
      } catch (err) {
        console.error('Failed to fetch transactions:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [filterItemId]);

  const formatTahap = (tahap: string) => {
    return tahap.split('_').map(word => 
      word.charAt(0).toUpperCase() + word.slice(1)
    ).join(' ');
  };

  const formatWaktu = (dateStr: string) => {
    return new Date(dateStr).toLocaleString('id-ID', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-[#e8eaed] flex items-center gap-3">
          <History className="text-[#e5c17b]" />
          Transaksi Keluar (Pemakaian)
        </h1>
        <p className="text-sm text-[#9aa0a6] mt-1">
          Riwayat pemakaian bahan baku dan aksesori dari semua scan produksi
        </p>
      </div>

      {/* Filter Bar */}
      <div className="flex items-center gap-4 bg-[#1A1D1F] border border-[#2A2D31] p-4 rounded-2xl shadow-sm">
        <div className="flex items-center gap-2 text-[#9aa0a6]">
          <Filter size={16} />
          <span className="text-sm font-medium">Filter Item:</span>
        </div>
        <select
          value={filterItemId}
          onChange={(e) => setFilterItemId(e.target.value)}
          className={selectCls}
        >
          <option value="all">Semua Item</option>
          {inventoryItems.map(item => (
            <option key={item.id} value={item.id}>
              {item.nama} ({item.satuan})
            </option>
          ))}
        </select>
        {loading && <span className="text-xs text-[#e5c17b] animate-pulse">Memuat data...</span>}
      </div>

      {/* Table */}
      <div className="bg-[#1A1D1F] border border-[#2A2D31] rounded-2xl overflow-hidden shadow-sm">
        <Table>
          <TableHeader className="bg-[#1E2124]">
            <TableRow className="hover:bg-transparent border-[#2A2D31]">
              <TableHead className="text-[#9aa0a6] font-semibold">Waktu</TableHead>
              <TableHead className="text-[#9aa0a6] font-semibold">Item</TableHead>
              <TableHead className="text-[#9aa0a6] font-semibold text-center">Qty Keluar</TableHead>
              <TableHead className="text-[#9aa0a6] font-semibold">Satuan</TableHead>
              <TableHead className="text-[#9aa0a6] font-semibold">Bundle</TableHead>
              <TableHead className="text-[#9aa0a6] font-semibold">No. PO</TableHead>
              <TableHead className="text-[#9aa0a6] font-semibold">Tahap</TableHead>
              <TableHead className="text-[#9aa0a6] font-semibold text-right">Tipe</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="h-48 text-center">
                  <div className="flex flex-col items-center justify-center gap-3 text-[#9aa0a6]">
                    <div className="h-12 w-12 rounded-full bg-[#2A2D31] flex items-center justify-center">
                      <Package size={24} />
                    </div>
                    <p>Belum ada transaksi keluar yang tercatat.</p>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              data.map((trx) => (
                <TableRow key={trx.id} className="border-[#2A2D31] hover:bg-[#1E2124]/50 transition-colors">
                  <TableCell className="text-[#e8eaed] text-xs font-medium whitespace-nowrap">
                    <div className="flex items-center gap-2">
                      <Calendar size={12} className="text-[#9aa0a6]" />
                      {formatWaktu(trx.created_at)}
                    </div>
                  </TableCell>
                  <TableCell className="font-semibold text-[#e8eaed]">{trx.inventory_item_nama}</TableCell>
                  <TableCell className="text-center font-bold text-red-400">
                    <div className="flex items-center justify-center gap-1">
                      <ArrowDownRight size={14} />
                      -{trx.qty_pakai.toLocaleString('id-ID', { maximumFractionDigits: 3 })}
                    </div>
                  </TableCell>
                  <TableCell className="text-[#9aa0a6] text-xs uppercase tracking-wider">{trx.satuan}</TableCell>
                  <TableCell className="font-mono text-xs text-[#e5c17b]">{trx.bundle_barcode}</TableCell>
                  <TableCell className="text-[#e8eaed] font-medium">{trx.no_po}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className="border-[#2A2D31] text-[#9aa0a6] font-normal">
                      <Layers size={10} className="mr-1.5" />
                      {formatTahap(trx.tahap)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Badge className={
                      trx.tipe === 'bahan' 
                        ? 'bg-blue-500/10 text-blue-400 border-blue-500/20' 
                        : 'bg-[#e5c17b]/10 text-[#e5c17b] border-[#e5c17b]/20'
                    }>
                      <Tag size={10} className="mr-1.5" />
                      {trx.tipe === 'bahan' ? 'Bahan Baku' : 'Aksesori'}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
      
      {data.length > 0 && (
        <p className="text-[10px] text-[#9aa0a6] text-center uppercase tracking-[0.2em]">
          Menampilkan 30 transaksi terakhir
        </p>
      )}
    </div>
  );
}
