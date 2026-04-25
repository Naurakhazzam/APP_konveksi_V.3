'use client';

import { useState } from 'react';
import { 
  getGajiDetail, 
  getKasbon, 
  type GajiLedgerEntry, 
  type KasbonItem 
} from '@/lib/actions/penggajian/penggajian.actions';
import { Button } from '@/components/ui/button';
import {
  Search,
  Printer,
  Loader2,
  ChevronLeft,
  ChevronRight,
  FileText
} from 'lucide-react';
import { toast } from 'sonner';
import SlipPreview from './SlipPreview';

interface Props {
  karyawanList: { id: string; nama: string; gaji_pokok: number }[];
}

export default function SlipGajiClient({ karyawanList }: Props) {
  const [selectedKaryawanId, setSelectedKaryawanId] = useState('');
  const [weekOffset, setWeekOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  
  // Data State
  const [ledgerData, setLedgerData] = useState<GajiLedgerEntry[]>([]);
  const [kasbonData, setKasbonData] = useState<KasbonItem[]>([]);
  const [hasGenerated, setHasGenerated] = useState(false);

  const getWeekRange = (offset: number) => {
    const today = new Date();
    const dayOfWeek = today.getDay(); // 0 = Sunday, 6 = Saturday
    const daysToLastSaturday = dayOfWeek === 6 ? 0 : dayOfWeek + 1;
    
    const lastSaturday = new Date(today);
    lastSaturday.setDate(today.getDate() - daysToLastSaturday + (offset * 7));
    
    const nextFriday = new Date(lastSaturday);
    nextFriday.setDate(lastSaturday.getDate() + 6);
    
    return {
      from: lastSaturday.toISOString().split('T')[0],
      to: nextFriday.toISOString().split('T')[0],
      fromDateObj: lastSaturday,
      toDateObj: nextFriday
    };
  };

  const { from: dateFrom, to: dateTo, fromDateObj, toDateObj } = getWeekRange(weekOffset);

  const formatDateLabel = (date: Date) => {
    return date.toLocaleDateString('id-ID', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
  };
  const periodLabel = `${formatDateLabel(fromDateObj)} – ${formatDateLabel(toDateObj)}`;

  const handleGenerate = async () => {
    if (!selectedKaryawanId || !dateFrom || !dateTo) {
      toast.error('Pilih karyawan dan periode tanggal');
      return;
    }

    setLoading(true);
    try {
      const [ledger, kasbon] = await Promise.all([
        getGajiDetail(selectedKaryawanId, dateFrom, dateTo),
        getKasbon(selectedKaryawanId)
      ]);

      // Filter kasbon in range
      const fromTime = new Date(dateFrom).getTime();
      const toTime = new Date(dateTo).getTime();
      const filteredKasbon = kasbon.filter(k => {
        const t = new Date(k.tanggal).getTime();
        return t >= fromTime && t <= toTime;
      });

      setLedgerData(ledger);
      setKasbonData(filteredKasbon);
      setHasGenerated(true);
      toast.success('Slip gaji berhasil digenerate');
    } catch (err: any) {
      toast.error(err.message || 'Gagal mengambil data slip');
    } finally {
      setLoading(false);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  const selectedKaryawan = karyawanList.find(k => k.id === selectedKaryawanId);

  return (
    <div className="space-y-8">
      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { background: white !important; }
          .print-container { margin: 0 !important; padding: 0 !important; }
        }
      `}</style>

      {/* Filter Bar */}
      <div className="no-print p-6 rounded-xl bg-[#1A1D1F] border border-[#2A2D31] flex flex-wrap items-end gap-4 shadow-xl">
        <div className="space-y-1.5 flex-1 min-w-[200px]">
          <label className="text-[10px] font-bold text-[#9aa0a6] uppercase tracking-widest">Pilih Karyawan</label>
          <select 
            value={selectedKaryawanId}
            onChange={(e) => setSelectedKaryawanId(e.target.value)}
            className="w-full h-11 px-3 rounded-lg bg-[#16181A] border border-[#2A2D31] text-sm text-[#e8eaed] focus:ring-1 focus:ring-[#e5c17b] outline-none"
          >
            <option value="">-- Pilih Karyawan --</option>
            {karyawanList.map(k => <option key={k.id} value={k.id}>{k.nama}</option>)}
          </select>
        </div>

        <div className="flex-1 flex flex-col min-w-[300px] space-y-1.5">
          <label className="text-[10px] font-bold text-[#9aa0a6] uppercase tracking-widest">Periode</label>
          <div className="flex items-center justify-between bg-[#16181A] border border-[#2A2D31] rounded-lg h-11 px-1">
            <Button 
              variant="ghost" 
              onClick={() => setWeekOffset(prev => prev - 1)}
              className="h-9 px-3 text-[#9aa0a6] hover:text-[#e8eaed] hover:bg-[#2A2D31]"
            >
              <ChevronLeft className="w-4 h-4 mr-1" />
              Pekan Lalu
            </Button>
            <div className="text-xs font-bold text-[#e5c17b] tracking-wide px-2 text-center whitespace-nowrap">
              {periodLabel}
            </div>
            <Button 
              variant="ghost" 
              onClick={() => setWeekOffset(prev => prev + 1)}
              disabled={weekOffset === 0}
              className="h-9 px-3 text-[#9aa0a6] hover:text-[#e8eaed] hover:bg-[#2A2D31] disabled:opacity-30"
            >
              Pekan Ini
              <ChevronRight className="w-4 h-4 ml-1" />
            </Button>
          </div>
        </div>

        <div className="flex gap-2">
          <Button 
            onClick={handleGenerate} 
            disabled={loading}
            className="h-11 px-6 bg-[#e5c17b] hover:bg-[#d4b06a] text-[#0D0E10] font-bold rounded-lg transition-all"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4 mr-2" />}
            Tampilkan Slip
          </Button>
        </div>
      </div>

      {/* Preview Area */}
      <div className="print-container">
        {hasGenerated ? (
          <div className="space-y-6">
            <div className="no-print flex justify-between items-center bg-[#1A1D1F] p-4 rounded-lg border border-[#2A2D31]">
              <div className="flex items-center gap-2 text-[#9aa0a6]">
                <FileText className="w-4 h-4 text-[#e5c17b]" />
                <span className="text-xs font-bold uppercase tracking-wider">Preview Slip Gaji</span>
              </div>
              <Button onClick={handlePrint} className="bg-white hover:bg-gray-100 text-black font-bold h-9 px-5">
                <Printer className="w-4 h-4 mr-2" />
                Cetak Slip
              </Button>
            </div>
            
            <SlipPreview 
              karyawan={selectedKaryawan}
              ledgerEntries={ledgerData}
              kasbonEntries={kasbonData}
              dateFrom={dateFrom}
              dateTo={dateTo}
            />
          </div>
        ) : (
          <div className="no-print h-64 border-2 border-dashed border-[#2A2D31] rounded-xl flex flex-col items-center justify-center text-[#3A3D41] space-y-4">
            <div className="p-4 rounded-full bg-[#1A1D1F] border border-[#2A2D31]">
              <FileText className="w-8 h-8 opacity-20" />
            </div>
            <p className="text-sm font-medium italic">Silakan pilih karyawan dan periode untuk melihat slip gaji.</p>
          </div>
        )}
      </div>
    </div>
  );
}
