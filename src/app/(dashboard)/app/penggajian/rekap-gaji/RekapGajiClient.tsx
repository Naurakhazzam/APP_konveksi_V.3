'use client';

import { useState, useEffect } from 'react';
import { 
  getRekapGaji, 
  getGajiDetail,
  type GajiLedgerEntry,
  type RekapGajiItem 
} from '@/lib/actions/penggajian/penggajian.actions';
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Search,
  Loader2,
  CreditCard,
  Users,
  Wallet,
  TrendingUp,
  CheckCircle2,
  Eye,
  ChevronLeft,
  ChevronRight
} from 'lucide-react';
import { toast } from 'sonner';
import ModalBayarGaji from './ModalBayarGaji';

interface Props {
  initialRekap: RekapGajiItem[];
  tanggal_dari: string;
  tanggal_sampai: string;
}

export default function RekapGajiClient({ initialRekap, tanggal_dari, tanggal_sampai }: Props) {
  const [rekap, setRekap] = useState<RekapGajiItem[]>(initialRekap);
  const [weekOffset, setWeekOffset] = useState(0);
  const [loading, setLoading] = useState(false);

  const getWeekRange = (offset: number) => {
    const today = new Date();
    const dayOfWeek = today.getDay();
    const daysToLastSaturday = dayOfWeek === 6 ? 0 : dayOfWeek + 1;
    const lastSaturday = new Date(today);
    lastSaturday.setDate(today.getDate() - daysToLastSaturday + (offset * 7));
    const nextFriday = new Date(lastSaturday);
    nextFriday.setDate(lastSaturday.getDate() + 6);
    return {
      from: lastSaturday.toISOString().split('T')[0],
      to: nextFriday.toISOString().split('T')[0],
      fromDateObj: lastSaturday,
      toDateObj: nextFriday,
    };
  };

  const { from: dateFrom, to: dateTo, fromDateObj, toDateObj } = getWeekRange(weekOffset);

  const formatDateLabel = (date: Date) =>
    date.toLocaleDateString('id-ID', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
  const periodLabel = `${formatDateLabel(fromDateObj)} – ${formatDateLabel(toDateObj)}`;
  
  // Modal State
  const [selectedKaryawan, setSelectedKaryawan] = useState<RekapGajiItem | null>(null);
  const [showModal, setShowModal] = useState(false);

  const [detailData, setDetailData] = useState<GajiLedgerEntry[]>([]);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [detailKaryawan, setDetailKaryawan] = useState<RekapGajiItem | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const handleShowDetail = async (item: RekapGajiItem) => {
    setDetailKaryawan(item);
    setShowDetailModal(true);
    setDetailLoading(true);
    try {
      const data = await getGajiDetail(item.karyawan_id, dateFrom, dateTo);
      setDetailData(data);
    } catch (err: any) {
      toast.error(err.message || 'Gagal ambil detail');
    } finally {
      setDetailLoading(false);
    }
  };

  const fetchRekap = async () => {
    setLoading(true);
    try {
      const data = await getRekapGaji(dateFrom, dateTo);
      setRekap(data);
    } catch (err: any) {
      toast.error(err.message || 'Gagal mengambil rekap gaji');
    } finally {
      setLoading(false);
    }
  };

  const handlePaymentSuccess = (karyawan_id: string) => {
    setRekap(prev => prev.filter(item => item.karyawan_id !== karyawan_id));
  };

  const formatIDR = (val: number) => val.toLocaleString('id-ID');

  // KPI Calculations
  const totalUpahPeriode = rekap.reduce((acc, curr) => acc + curr.upah_bersih, 0);
  const belumDibayarCount = rekap.filter(r => r.entry_ids.length > 0).length;
  const totalKasbonOutstanding = rekap.reduce((acc, curr) => acc + curr.kasbon_sisa, 0);

  return (
    <div className="space-y-8 pb-20">
      {/* Week Navigator */}
      <div className="flex flex-wrap items-end gap-4 p-5 rounded-xl bg-[#1A1D1F] border border-[#2A2D31]">
        <div className="flex-1 flex flex-col space-y-1.5 min-w-[300px]">
          <label className="text-[10px] font-bold text-[#9aa0a6] uppercase tracking-wider">Periode</label>
          <div className="flex items-center justify-between bg-[#16181A] border border-[#2A2D31] rounded-lg h-10 px-1">
            <Button variant="ghost" onClick={() => setWeekOffset(prev => prev - 1)}
              className="h-8 px-3 text-[#9aa0a6] hover:text-[#e8eaed] hover:bg-[#2A2D31]">
              <ChevronLeft className="w-4 h-4 mr-1" /> Pekan Lalu
            </Button>
            <div className="text-xs font-bold text-[#e5c17b] tracking-wide px-2 text-center whitespace-nowrap">
              {periodLabel}
            </div>
            <Button variant="ghost" onClick={() => setWeekOffset(prev => prev + 1)}
              disabled={weekOffset === 0}
              className="h-8 px-3 text-[#9aa0a6] hover:text-[#e8eaed] hover:bg-[#2A2D31] disabled:opacity-30">
              Pekan Ini <ChevronRight className="w-4 h-4 ml-1" />
            </Button>
          </div>
        </div>
        <Button onClick={fetchRekap} disabled={loading} className="h-10 px-6 bg-[#e5c17b] hover:bg-[#d4b06a] text-[#0D0E10] font-bold rounded-lg transition-all">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4 mr-2" />}
          Tampilkan
        </Button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {[
          { label: 'Total Upah Periode', value: `Rp ${formatIDR(totalUpahPeriode)}`, icon: Wallet, color: 'text-[#e5c17b]' },
          { label: 'Belum Dibayar', value: `${belumDibayarCount} Karyawan`, icon: Users, color: 'text-orange-400' },
          { label: 'Kasbon Outstanding', value: `Rp ${formatIDR(totalKasbonOutstanding)}`, icon: TrendingUp, color: 'text-blue-400' },
          { label: 'Status Lunas', value: 'Live Updates', icon: CheckCircle2, color: 'text-green-400' },
        ].map((kpi, i) => (
          <div key={i} className="p-5 rounded-xl bg-[#1A1D1F] border border-[#2A2D31] space-y-1">
            <kpi.icon className={`w-5 h-5 ${kpi.color} mb-2`} />
            <p className="text-[10px] font-bold text-[#9aa0a6] uppercase tracking-widest">{kpi.label}</p>
            <p className="text-xl font-black text-[#e8eaed]">{kpi.value}</p>
          </div>
        ))}
      </div>

      {/* Table */}
      <div className="rounded-xl border border-[#2A2D31] bg-[#1A1D1F] overflow-hidden">
        <Table>
          <TableHeader className="bg-[#16181A]">
            <TableRow className="hover:bg-transparent border-[#2A2D31]">
              <TableHead className="text-[#9aa0a6] font-bold uppercase text-[10px]">Karyawan</TableHead>
              <TableHead className="text-[#9aa0a6] font-bold uppercase text-[10px] text-right">Upah Kotor</TableHead>
              <TableHead className="text-[#9aa0a6] font-bold uppercase text-[10px] text-right">Potongan Reject</TableHead>
              <TableHead className="text-[#9aa0a6] font-bold uppercase text-[10px] text-right">Upah Bersih</TableHead>
              <TableHead className="text-[#9aa0a6] font-bold uppercase text-[10px] text-right">Sisa Kasbon</TableHead>
              <TableHead className="text-[#9aa0a6] font-bold uppercase text-[10px] text-center">Aksi</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rekap.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="h-40 text-center text-[#9aa0a6] italic">Tidak ada data gaji untuk periode ini.</TableCell></TableRow>
            ) : (
              rekap.map((item) => (
                <TableRow key={item.karyawan_id} className={`border-[#2A2D31] transition-colors ${item.upah_bersih > 0 ? 'hover:bg-[#1E2124]' : 'bg-green-500/5'}`}>
                  <TableCell>
                    <div className="flex flex-col"><span className="font-bold text-[#e8eaed]">{item.karyawan_nama}</span><span className="text-[10px] text-[#9aa0a6]">{item.jabatan}</span></div>
                  </TableCell>
                  <TableCell className="text-right font-medium">Rp {formatIDR(item.total_upah_kotor)}</TableCell>
                  <TableCell className="text-right text-red-400/80">Rp {formatIDR(item.total_potongan)}</TableCell>
                  <TableCell className="text-right font-bold text-[#e8eaed]">Rp {formatIDR(item.upah_bersih)}</TableCell>
                  <TableCell className="text-right text-orange-400 font-medium">Rp {formatIDR(item.kasbon_sisa)}</TableCell>
                  <TableCell className="text-center">
                    <div className="flex items-center justify-center gap-2">
                      <Button variant="outline" onClick={() => handleShowDetail(item)}
                        className="h-8 px-3 border-[#2A2D31] text-[#9aa0a6] hover:text-[#e5c17b] hover:border-[#e5c17b]">
                        <Eye className="w-3.5 h-3.5 mr-1" /> Detail
                      </Button>
                      {item.entry_ids.length > 0 ? (
                        <Button onClick={() => { setSelectedKaryawan(item); setShowModal(true); }} size="sm" className="h-8 bg-[#e5c17b] hover:bg-[#d4b06a] text-[#0D0E10] font-bold rounded-lg px-4 shadow-lg shadow-yellow-500/10">
                          <CreditCard className="w-3 h-3 mr-1.5" /> Bayar
                        </Button>
                      ) : <span className="text-[#3A3D41]">—</span>}
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <ModalBayarGaji 
        isOpen={showModal} 
        onClose={() => setShowModal(false)} 
        selectedKaryawan={selectedKaryawan} 
        onSuccess={handlePaymentSuccess} 
      />

      {showDetailModal && detailKaryawan && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-[#1A1D1F] border border-[#2A2D31] rounded-2xl w-full max-w-2xl max-h-[80vh] flex flex-col">
            <div className="p-5 border-b border-[#2A2D31] flex justify-between items-center">
              <div>
                <h3 className="font-bold text-[#e8eaed]">Detail Gaji — {detailKaryawan.karyawan_nama}</h3>
                <p className="text-xs text-[#9aa0a6]">{dateFrom} s/d {dateTo}</p>
              </div>
              <button onClick={() => setShowDetailModal(false)}
                className="text-[#9aa0a6] hover:text-[#e8eaed] text-xl font-bold">✕</button>
            </div>
            <div className="overflow-y-auto flex-1">
              {detailLoading ? (
                <div className="flex items-center justify-center h-32">
                  <Loader2 className="w-6 h-6 animate-spin text-[#e5c17b]" />
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[#2A2D31]">
                      <th className="px-4 py-3 text-left text-[11px] text-[#9aa0a6] uppercase">Tanggal</th>
                      <th className="px-4 py-3 text-left text-[11px] text-[#9aa0a6] uppercase">Keterangan</th>
                      <th className="px-4 py-3 text-left text-[11px] text-[#9aa0a6] uppercase">Tipe</th>
                      <th className="px-4 py-3 text-right text-[11px] text-[#9aa0a6] uppercase">Rincian</th>
                      <th className="px-4 py-3 text-right text-[11px] text-[#9aa0a6] uppercase">Jumlah</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#2A2D31]">
                    {detailData.map(entry => (
                      <tr key={entry.id} className="hover:bg-[#2A2D31]/30">
                        <td className="px-4 py-3 text-xs text-[#9aa0a6] whitespace-nowrap">
                          {new Date(entry.tanggal).toLocaleDateString('id-ID', { day:'2-digit', month:'short', year:'numeric' })}
                        </td>
                        <td className="px-4 py-3 text-xs text-[#e8eaed]">{entry.keterangan}</td>
                        <td className="px-4 py-3">
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase
                            ${entry.tipe === 'selesai' ? 'bg-green-500/15 text-green-400' :
                              entry.tipe === 'reject_potong' ? 'bg-red-500/15 text-red-400' :
                              'bg-blue-500/15 text-blue-400'}`}>
                            {entry.tipe}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right text-xs text-[#9aa0a6] whitespace-nowrap">
                          {entry.qty > 0 && entry.upah_per_pcs > 0
                            ? `${entry.qty} pcs × @${entry.upah_per_pcs.toLocaleString('id-ID')}`
                            : '—'}
                        </td>
                        <td className={`px-4 py-3 text-right text-xs font-bold whitespace-nowrap
                          ${entry.tipe === 'reject_potong' ? 'text-red-400' : 'text-[#e5c17b]'}`}>
                          {entry.tipe === 'reject_potong' ? '-' : '+'}Rp {entry.total.toLocaleString('id-ID')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
