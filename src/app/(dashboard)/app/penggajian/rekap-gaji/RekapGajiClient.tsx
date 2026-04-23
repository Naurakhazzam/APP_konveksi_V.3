'use client';

import { useState, useEffect } from 'react';
import { 
  getRekapGaji, 
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
  RefreshCcw, 
  Search, 
  Loader2, 
  CreditCard, 
  Users, 
  Wallet, 
  TrendingUp, 
  CheckCircle2 
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
  const [dateFrom, setDateFrom] = useState(tanggal_dari);
  const [dateTo, setDateTo] = useState(tanggal_sampai);
  const [loading, setLoading] = useState(false);
  
  // Modal State
  const [selectedKaryawan, setSelectedKaryawan] = useState<RekapGajiItem | null>(null);
  const [showModal, setShowModal] = useState(false);

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

  const handleWeekPicker = () => {
    const today = new Date();
    const dayOfWeek = today.getDay(); // 0=Sunday, 6=Saturday
    const daysToLastSaturday = dayOfWeek === 6 ? 0 : dayOfWeek + 1;
    const lastSaturday = new Date(today);
    lastSaturday.setDate(today.getDate() - daysToLastSaturday);
    const nextFriday = new Date(lastSaturday);
    nextFriday.setDate(lastSaturday.getDate() + 6);

    const from = lastSaturday.toISOString().split('T')[0];
    const to = nextFriday.toISOString().split('T')[0];
    
    setDateFrom(from);
    setDateTo(to);
    // Trigger fetch manually because state update is async
    setLoading(true);
    getRekapGaji(from, to).then(data => {
      setRekap(data);
      setLoading(false);
    }).catch(err => {
      toast.error(err.message);
      setLoading(false);
    });
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
      {/* Week Picker & Filters */}
      <div className="flex flex-wrap items-end gap-4 p-5 rounded-xl bg-[#1A1D1F] border border-[#2A2D31]">
        <div className="space-y-1.5 flex-1 min-w-[150px]">
          <label className="text-[10px] font-bold text-[#9aa0a6] uppercase tracking-wider">Dari Tanggal</label>
          <input 
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="w-full h-10 px-3 rounded-lg bg-[#16181A] border border-[#2A2D31] text-sm text-[#e8eaed] focus:ring-1 focus:ring-[#e5c17b] outline-none"
          />
        </div>
        <div className="space-y-1.5 flex-1 min-w-[150px]">
          <label className="text-[10px] font-bold text-[#9aa0a6] uppercase tracking-wider">Sampai Tanggal</label>
          <input 
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="w-full h-10 px-3 rounded-lg bg-[#16181A] border border-[#2A2D31] text-sm text-[#e8eaed] focus:ring-1 focus:ring-[#e5c17b] outline-none"
          />
        </div>
        <Button onClick={handleWeekPicker} variant="outline" className="h-10 border-[#2A2D31] text-[#9aa0a6] hover:bg-[#2A2D31] hover:text-[#e5c17b]">
          <RefreshCcw className="w-4 h-4 mr-2" />
          ⟳ Pekan Ini
        </Button>
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
                    {item.entry_ids.length > 0 ? (
                      <Button onClick={() => { setSelectedKaryawan(item); setShowModal(true); }} size="sm" className="h-8 bg-[#e5c17b] hover:bg-[#d4b06a] text-[#0D0E10] font-bold rounded-lg px-4 shadow-lg shadow-yellow-500/10">
                        <CreditCard className="w-3 h-3 mr-1.5" /> Bayar
                      </Button>
                    ) : <span className="text-[#3A3D41]">—</span>}
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
    </div>
  );
}
