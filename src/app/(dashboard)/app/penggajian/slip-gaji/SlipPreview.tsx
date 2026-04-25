'use client';

import { 
  type GajiLedgerEntry, 
  type KasbonItem 
} from '@/lib/actions/penggajian/penggajian.actions';
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from '@/components/ui/table';

interface Props {
  karyawan: { id: string; nama: string; gaji_pokok: number } | undefined;
  ledgerEntries: GajiLedgerEntry[];
  kasbonEntries: KasbonItem[];
  dateFrom: string;
  dateTo: string;
}

export default function SlipPreview({ karyawan, ledgerEntries, kasbonEntries, dateFrom, dateTo }: Props) {
  const formatIDR = (val: number) => val.toLocaleString('id-ID');
  
  // Calculations
  const upahProduksi = ledgerEntries
    .filter(e => e.tipe === 'selesai' || e.tipe === 'rework')
    .reduce((acc, curr) => acc + Number(curr.total), 0);
    
  const potonganReject = ledgerEntries
    .filter(e => e.tipe === 'reject_potong')
    .reduce((acc, curr) => acc + Number(curr.total), 0);
    
  const upahBersih = upahProduksi - potonganReject;
  
  // Kasbon Dipotong (Assume kasbon lunas in this period)
  const kasbonDipotong = kasbonEntries
    .filter(k => k.status === 'lunas')
    .reduce((acc, curr) => acc + Number(curr.jumlah), 0);

  // Gaji Pokok - since we don't have hari_kerja stored in ledger entry explicitly in the interface
  // we look for a row that might have it in keterangan, or just show 0 if not found.
  // In a real scenario, the ledger would have a 'gapok' type.
  const gapokEntry = ledgerEntries.find(e => e.keterangan.toLowerCase().includes('gaji pokok'));
  const gapokNominal = gapokEntry ? Number(gapokEntry.total) : 0;

  const totalDiterima = upahBersih + gapokNominal - kasbonDipotong;

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('id-ID', {
      day: '2-digit',
      month: 'short',
      year: 'numeric'
    });
  };

  return (
    <div id="slip-gaji-printable" className="w-full max-w-[800px] bg-white text-[#0D0E10] p-12 shadow-2xl rounded-sm print:shadow-none print:p-0 mx-auto">
      {/* Header */}
      <div className="border-b-4 border-[#0D0E10] pb-6 mb-8 flex justify-between items-end">
        <div>
          <h1 className="text-3xl font-black tracking-tighter">STITCHLYX.SYNCORE</h1>
          <p className="text-[10px] font-bold text-gray-500 uppercase tracking-[0.2em]">Garment Manufacturing & Distribution</p>
        </div>
        <div className="text-right">
          <h2 className="text-xl font-bold uppercase tracking-tight">Slip Gaji Karyawan</h2>
          <p className="text-xs font-medium text-gray-600">Periode: {formatDate(dateFrom)} - {formatDate(dateTo)}</p>
        </div>
      </div>

      {/* Employee Info */}
      <div className="grid grid-cols-2 gap-8 mb-10">
        <div className="space-y-1">
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Karyawan</p>
          <p className="text-lg font-black uppercase">{karyawan?.nama || 'N/A'}</p>
        </div>
        <div className="text-right space-y-1">
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Tanggal Cetak</p>
          <p className="text-sm font-bold">{new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
        </div>
      </div>

      {/* Earnings Table */}
      <div className="mb-10">
        <h3 className="text-xs font-black uppercase mb-4 px-3 py-1 bg-[#0D0E10] text-white inline-block">Rincian Penghasilan</h3>
        <div className="border border-gray-200 rounded-sm overflow-hidden">
          <Table>
            <TableHeader className="bg-gray-50">
              <TableRow className="hover:bg-transparent border-gray-200">
                <TableHead className="text-[10px] font-bold text-gray-800 uppercase py-3">Tanggal</TableHead>
                <TableHead className="text-[10px] font-bold text-gray-800 uppercase py-3">Keterangan</TableHead>
                <TableHead className="text-[10px] font-bold text-gray-800 uppercase py-3">Tipe</TableHead>
                <TableHead className="text-[10px] font-bold text-gray-800 uppercase py-3 text-right">Rincian</TableHead>
                <TableHead className="text-[10px] font-bold text-gray-800 uppercase py-3 text-right">Jumlah (Rp)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ledgerEntries.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="h-20 text-center text-gray-400 text-xs italic">Tidak ada rincian ledger untuk periode ini.</TableCell>
                </TableRow>
              ) : (
                ledgerEntries.map((entry) => (
                  <TableRow
                    key={entry.id}
                    className={`border-gray-100 hover:bg-transparent ${
                      entry.tipe === 'selesai' ? 'bg-green-50' :
                      entry.tipe === 'reject_potong' ? 'bg-red-50' :
                      entry.tipe === 'rework' ? 'bg-blue-50' : ''
                    }`}
                  >
                    <TableCell className="text-[11px] font-medium py-2.5">{formatDate(entry.tanggal)}</TableCell>
                    <TableCell className="text-[11px] py-2.5 max-w-[220px] truncate">{entry.keterangan}</TableCell>
                    <TableCell className="text-[10px] font-bold uppercase py-2.5 whitespace-nowrap">
                      <span className={
                        entry.tipe === 'selesai' ? 'text-green-700' :
                        entry.tipe === 'reject_potong' ? 'text-red-700' :
                        entry.tipe === 'rework' ? 'text-blue-700' : ''
                      }>
                        {entry.tipe.replace('_', ' ')}
                      </span>
                    </TableCell>
                    <TableCell className="text-[11px] py-2.5 text-right text-gray-500 whitespace-nowrap">
                      {entry.qty > 0 && entry.upah_per_pcs > 0
                        ? `${entry.qty} pcs × @${formatIDR(entry.upah_per_pcs)}`
                        : '—'}
                    </TableCell>
                    <TableCell className={`text-[11px] font-bold text-right py-2.5 whitespace-nowrap ${entry.tipe === 'reject_potong' ? 'text-red-600' : ''}`}>
                      {entry.tipe === 'reject_potong' ? '-' : ''}Rp {formatIDR(Number(entry.total))}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Summary Section */}
      <div className="grid grid-cols-2 gap-10 mb-12">
        <div className="space-y-4">
          {/* Signatures */}
          <div className="grid grid-cols-2 gap-4 h-full items-end pt-10">
            <div className="text-center">
              <div className="h-16"></div>
              <p className="text-[10px] font-bold border-t border-gray-300 pt-1 uppercase">Karyawan</p>
            </div>
            <div className="text-center">
              <div className="h-16"></div>
              <p className="text-[10px] font-bold border-t border-gray-300 pt-1 uppercase">Admin Keuangan</p>
            </div>
          </div>
        </div>

        <div className="space-y-2.5 bg-gray-50 p-6 rounded-sm border border-gray-100">
          <div className="flex justify-between text-xs">
            <span className="text-gray-500 font-medium">Upah Produksi</span>
            <span className="font-bold">Rp {formatIDR(upahProduksi)}</span>
          </div>
          <div className="flex justify-between text-xs text-red-600">
            <span className="text-gray-500 font-medium">Potongan Reject</span>
            <span className="font-bold">-(Rp {formatIDR(potonganReject)})</span>
          </div>
          <div className="pt-2 border-t border-gray-200 flex justify-between text-xs font-bold">
            <span>Upah Bersih</span>
            <span>Rp {formatIDR(upahBersih)}</span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-gray-500 font-medium">Gaji Pokok (Prorata)</span>
            <span className="font-bold">Rp {formatIDR(gapokNominal)}</span>
          </div>
          <div className="flex justify-between text-xs text-red-600">
            <span className="text-gray-500 font-medium">Kasbon Dipotong</span>
            <span className="font-bold">-(Rp {formatIDR(kasbonDipotong)})</span>
          </div>
          
          <div className="pt-4 border-t-2 border-[#0D0E10] flex justify-between items-center">
            <span className="text-[10px] font-black uppercase tracking-tighter">Total Diterima</span>
            <span className="text-xl font-black text-[#e5c17b] bg-[#0D0E10] px-3 py-1 rounded-sm shadow-lg shadow-yellow-500/10">
              Rp {formatIDR(totalDiterima)}
            </span>
          </div>
        </div>
      </div>

      {/* Footer Text */}
      <p className="text-[9px] text-gray-400 italic text-center">
        Slip ini dihasilkan secara otomatis oleh sistem STITCHLYX.SYNCORE pada {new Date().toLocaleString('id-ID')}.
      </p>
    </div>
  );
}
