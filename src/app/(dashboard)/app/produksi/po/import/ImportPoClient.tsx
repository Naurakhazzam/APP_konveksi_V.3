'use client';

import React, { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Upload, FileDown, CheckCircle2, XCircle, Loader2, PlayCircle, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { 
  validateImportSkus, 
  importPoBulk, 
  type SkuValidationResult, 
  type ImportPoPayload,
  type ImportPoResult 
} from '@/lib/actions/produksi/import-po.actions';

interface ExcelRow {
  Nomor_PO: string;
  SKU_Klien: string;
  Nama_Produk?: string;
  Total_QTY: number;
  QTY_Per_Bundle: number;
  Catatan_PO?: string;
}

type ImportStep = 'config' | 'upload' | 'preview' | 'importing' | 'done';

interface Props {
  klienList: { id: string; nama: string }[];
}

export default function ImportPoClient({ klienList }: Props) {
  const router = useRouter();
  const [step, setStep] = useState<ImportStep>('config');
  const [config, setConfig] = useState({
    klienId: '',
    tanggalOrder: new Date().toISOString().split('T')[0],
    tanggalTarget: '',
  });

  const [parsedRows, setParsedRows] = useState<ExcelRow[]>([]);
  const [validationMap, setValidationMap] = useState<Record<string, SkuValidationResult>>({});
  const [importResults, setImportResults] = useState<ImportPoResult[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);

  // Grouping rows by PO for preview
  const groupedPOs = useMemo(() => {
    const groups: Record<string, ExcelRow[]> = {};
    parsedRows.forEach(row => {
      if (!groups[row.Nomor_PO]) groups[row.Nomor_PO] = [];
      groups[row.Nomor_PO].push(row);
    });
    return groups;
  }, [parsedRows]);

  const hasValidationError = useMemo(() => {
    return parsedRows.some(row => !validationMap[row.SKU_Klien]?.found);
  }, [parsedRows, validationMap]);

  // Handlers
  const handleDownloadTemplate = async () => {
    const XLSX = await import('xlsx');
    const ws = XLSX.utils.aoa_to_sheet([
      ['Nomor_PO', 'SKU_Klien', 'Nama_Produk', 'Total_QTY', 'QTY_Per_Bundle', 'Catatan_PO'],
      ['PO-0020', 'ELY289', 'Contoh Produk - S', 20, 10, ''],
      ['PO-0020', 'ELY290', 'Contoh Produk - M', 30, 10, ''],
      ['PO-0021', 'ELY340', 'Contoh Produk Lain', 40, 10, 'Rush order'],
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Data PO');
    XLSX.writeFile(wb, 'template_import_po.xlsx');
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsProcessing(true);
    try {
      const XLSX = await import('xlsx');
      const arrayBuffer = await file.arrayBuffer();
      const data = new Uint8Array(arrayBuffer);
      const wb = XLSX.read(data, { type: 'array' });
      const ws = wb.Sheets['Data PO'];
      
      if (!ws) {
        toast.error('Sheet "Data PO" tidak ditemukan dalam file');
        return;
      }

      // Parse raw rows dan normalisasi nama kolom
      // (handle variasi: spasi vs underscore, case berbeda)
      // Gunakan defval: '' agar baris kosong tetap muncul
      const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' });
      if (rawRows.length === 0) {
        toast.error('File Excel kosong');
        return;
      }

      function findCol(row: Record<string, unknown>, ...candidates: string[]): unknown {
        for (const key of Object.keys(row)) {
          const normalized = key.replace(/\s+/g, '_').toLowerCase();
          if (candidates.some(c => c.toLowerCase() === normalized)) {
            return row[key];
          }
        }
        return undefined;
      }

      // ── Fill-down: sub-baris (tanpa Nomor_PO/SKU) mewarisi baris di atasnya ──
      // Setiap baris = 1 bundle: Total_QTY di-set sama dengan QTY_Per_Bundle-nya.
      let lastPO    = '';
      let lastSKU   = '';
      let lastNama  = '';
      let lastCatat = '';

      const rows: ExcelRow[] = rawRows
        .map(row => {
          const nomor   = String(findCol(row, 'Nomor_PO', 'nomor_po', 'No_PO')     ?? '').trim();
          const sku     = String(findCol(row, 'SKU_Klien', 'sku_klien', 'SKU')      ?? '').trim();
          const nama    = String(findCol(row, 'Nama_Produk', 'nama_produk', 'Nama') ?? '').trim();
          const catatan = String(findCol(row, 'Catatan_PO', 'catatan_po', 'Catatan') ?? '').trim();
          const totalQty = Number(findCol(row, 'Total_QTY', 'total_qty', 'Total_Qty', 'QTY') ?? 0);
          const qpb      = Number(findCol(row, 'QTY_Per_Bundle', 'qty_per_bundle', 'Per_Bundle') ?? 0);

          // Fill-down: pakai nilai dari baris sebelumnya jika kosong
          if (nomor)   lastPO    = nomor;
          if (sku)     lastSKU   = sku;
          if (nama)    lastNama  = nama;
          if (catatan) lastCatat = catatan;

          return {
            Nomor_PO:       lastPO,
            SKU_Klien:      lastSKU,
            Nama_Produk:    lastNama,
            Total_QTY:      totalQty,
            QTY_Per_Bundle: qpb,
            Catatan_PO:     lastCatat,
          };
        })
        // Buang baris yang tidak punya QTY (baris kosong/header sisa)
        .filter(row => row.Total_QTY > 0 && row.QTY_Per_Bundle > 0);

      // Basic client-side validation
      const errors: string[] = [];
      rows.forEach((row, i) => {
        const line = i + 2;
        if (!row.Nomor_PO?.match(/^PO-\d{4}$/)) errors.push(`Baris ${line}: Format PO invalid (PO-XXXX)`);
        if (!row.SKU_Klien) errors.push(`Baris ${line}: SKU Klien kosong`);
        if (!row.Total_QTY || row.Total_QTY <= 0) errors.push(`Baris ${line}: QTY invalid`);
      });

      if (errors.length > 0) {
        toast.error('Terdapat kesalahan format data', { description: errors[0] });
        return;
      }

      // Server-side validation for SKUs
      const skuList = Array.from(new Set(rows.map(r => r.SKU_Klien)));
      const validation = await validateImportSkus(skuList);
      const vMap: Record<string, SkuValidationResult> = {};
      validation.forEach(v => vMap[v.sku_klien] = v);

      setValidationMap(vMap);
      setParsedRows(rows);
      setStep('preview');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Terjadi kesalahan tidak dikenal';
      toast.error('Gagal memproses file Excel', { description: msg });
      console.error('[ImportPO] handleFileUpload error:', err);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleStartImport = async () => {
    setStep('importing');
    const posToImport: ImportPoPayload[] = Object.entries(groupedPOs).map(([no_po, rows]) => ({
      no_po,
      klien_id: config.klienId,
      tanggal_order: config.tanggalOrder,
      tanggal_target: config.tanggalTarget || null,
      catatan: rows[0]?.Catatan_PO || null,
      items: rows.map(r => {
        const v = validationMap[r.SKU_Klien];
        return {
          produk_id: v.produk_id!,
          warna: v.warna!,
          size: v.size!,
          qty_order: r.Total_QTY,
          qty_per_bundle: r.QTY_Per_Bundle
        };
      })
    }));

    const results = await importPoBulk(posToImport);
    setImportResults(results);
    setStep('done');
  };

  // Rendering Helpers
  if (step === 'config') return (
    <div className="max-w-xl mx-auto bg-[#1A1D1F] border border-[#2A2D31] rounded-2xl p-8 space-y-6">
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-[#9aa0a6] mb-2">Pilih Klien</label>
          <select 
            value={config.klienId} 
            onChange={e => setConfig({...config, klienId: e.target.value})}
            className="w-full h-11 bg-[#16181A] border border-[#2A2D31] rounded-xl px-4 text-[#e8eaed]"
          >
            <option value="">-- Pilih Klien --</option>
            {klienList.map(k => <option key={k.id} value={k.id}>{k.nama}</option>)}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-[#9aa0a6] mb-2">Tgl. Order</label>
            <input 
              type="date" value={config.tanggalOrder} 
              onChange={e => setConfig({...config, tanggalOrder: e.target.value})}
              className="w-full h-11 bg-[#16181A] border border-[#2A2D31] rounded-xl px-4 text-[#e8eaed]" 
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-[#9aa0a6] mb-2">Tgl. Target (Opsional)</label>
            <input 
              type="date" value={config.tanggalTarget} 
              onChange={e => setConfig({...config, tanggalTarget: e.target.value})}
              className="w-full h-11 bg-[#16181A] border border-[#2A2D31] rounded-xl px-4 text-[#e8eaed]" 
            />
          </div>
        </div>
      </div>
      <Button 
        disabled={!config.klienId || !config.tanggalOrder} 
        onClick={() => setStep('upload')}
        className="w-full h-12 bg-[#e5c17b] text-[#0D0E10] hover:bg-[#e5c17b]/90 font-bold text-lg rounded-xl"
      >
        Lanjut ke Upload File
      </Button>
    </div>
  );

  if (step === 'upload') return (
    <div className="max-w-xl mx-auto space-y-6 text-center">
      <div 
        className="border-2 border-dashed border-[#2A2D31] rounded-2xl p-12 bg-[#1A1D1F] hover:border-[#e5c17b]/50 transition-colors relative"
      >
        <input 
          type="file" accept=".xlsx, .xls" onChange={handleFileUpload}
          className="absolute inset-0 opacity-0 cursor-pointer"
          disabled={isProcessing}
        />
        <div className="space-y-4">
          <div className="w-16 h-16 bg-[#e5c17b]/10 rounded-full flex items-center justify-center mx-auto">
            {isProcessing ? <Loader2 className="w-8 h-8 text-[#e5c17b] animate-spin" /> : <Upload className="w-8 h-8 text-[#e5c17b]" />}
          </div>
          <div>
            <p className="text-lg font-bold text-[#e8eaed]">
              {isProcessing ? 'Sedang Memproses...' : 'Klik atau Seret Berkas ke Sini'}
            </p>
            <p className="text-[#9aa0a6] text-sm mt-1">Hanya mendukung format Excel (.xlsx)</p>
          </div>
        </div>
      </div>
      <button onClick={handleDownloadTemplate} className="text-[#e5c17b] text-sm flex items-center gap-2 mx-auto hover:underline">
        <FileDown className="w-4 h-4" /> Download Template Excel
      </button>
    </div>
  );

  if (step === 'preview') return (
    <div className="space-y-6">
      <div className="flex items-center justify-between bg-[#1A1D1F] border border-[#2A2D31] p-4 rounded-xl">
        <div className="flex gap-8">
          <div><p className="text-xs text-[#9aa0a6]">TOTAL PO</p><p className="text-xl font-bold">{Object.keys(groupedPOs).length}</p></div>
          <div><p className="text-xs text-[#9aa0a6]">TOTAL ARTIKEL</p><p className="text-xl font-bold">{parsedRows.length}</p></div>
        </div>
        <div className="flex gap-3">
          <Button variant="outline" onClick={() => setStep('upload')} disabled={isProcessing}>Ganti File</Button>
          <Button 
            disabled={hasValidationError || isProcessing} 
            onClick={handleStartImport}
            className="bg-[#e5c17b] text-[#0D0E10] font-bold"
          >
            {hasValidationError ? 'Selesaikan Semua Error' : 'Import Sekarang'}
          </Button>
        </div>
      </div>

      <div className="bg-[#1A1D1F] border border-[#2A2D31] rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-[#16181A] text-[#9aa0a6]">
            <tr>
              <th className="p-4 text-left">NO. PO</th>
              <th className="p-4 text-left">SKU KLIEN</th>
              <th className="p-4 text-left">PRODUK</th>
              <th className="p-4 text-center">QTY</th>
              <th className="p-4 text-center">STATUS</th>
            </tr>
          </thead>
          <tbody>
            {parsedRows.map((row, i) => {
              const v = validationMap[row.SKU_Klien];
              return (
                <tr key={i} className="border-t border-[#2A2D31]">
                  <td className="p-4 font-mono text-[#e5c17b]">{row.Nomor_PO}</td>
                  <td className="p-4 font-mono text-[#e8eaed]">{row.SKU_Klien}</td>
                  <td className="p-4">
                    {v?.found ? (
                      <div><p className="font-medium text-[#e8eaed]">{row.Nama_Produk || '-'}</p><p className="text-xs text-[#9aa0a6]">{v.warna} / {v.size}</p></div>
                    ) : <span className="text-red-400">SKU tidak ditemukan</span>}
                  </td>
                  <td className="p-4 text-center text-[#e8eaed]">{row.Total_QTY}</td>
                  <td className="p-4 text-center">
                    {v?.found ? <CheckCircle2 className="w-5 h-5 text-green-500 mx-auto" /> : <XCircle className="w-5 h-5 text-red-500 mx-auto" />}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );

  if (step === 'importing') return (
    <div className="max-w-2xl mx-auto space-y-8 py-12 text-center">
      <div className="space-y-4">
        <Loader2 className="w-16 h-16 text-[#e5c17b] animate-spin mx-auto" />
        <h2 className="text-2xl font-bold text-[#e8eaed]">Sedang Mengimport Data...</h2>
        <p className="text-[#9aa0a6]">Jangan tutup halaman ini sampai proses selesai.</p>
      </div>
    </div>
  );

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="bg-[#1A1D1F] border border-[#2A2D31] rounded-2xl p-8 text-center space-y-6">
        <div className="w-20 h-20 bg-green-500/10 rounded-full flex items-center justify-center mx-auto">
          <CheckCircle2 className="w-10 h-10 text-green-500" />
        </div>
        <h2 className="text-2xl font-bold text-[#e8eaed]">Import Selesai</h2>
        <div className="grid grid-cols-2 gap-4">
          <div className="p-4 bg-[#16181A] rounded-xl border border-[#2A2D31]">
            <p className="text-2xl font-bold text-green-500">{importResults.filter(r => r.success).length}</p>
            <p className="text-xs text-[#9aa0a6] uppercase font-bold mt-1">Berhasil</p>
          </div>
          <div className="p-4 bg-[#16181A] rounded-xl border border-[#2A2D31]">
            <p className="text-2xl font-bold text-red-400">{importResults.filter(r => !r.success).length}</p>
            <p className="text-xs text-[#9aa0a6] uppercase font-bold mt-1">Gagal</p>
          </div>
        </div>
        <div className="space-y-2 text-left max-h-60 overflow-y-auto">
          {importResults.map(res => (
            <div key={res.no_po} className="flex items-center justify-between p-3 bg-[#16181A] rounded-lg border border-[#2A2D31]">
              <span className="font-mono text-sm text-[#e8eaed]">{res.no_po}</span>
              {res.success ? (
                <span className="text-xs font-bold text-green-500 uppercase flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> Sukses</span>
              ) : (
                <span className="text-xs font-bold text-red-400 uppercase flex items-center gap-1"><XCircle className="w-3 h-3" /> {res.error}</span>
              )}
            </div>
          ))}
        </div>
        <Button onClick={() => router.push('/app/produksi/monitoring')} className="w-full h-12 bg-[#e5c17b] text-[#0D0E10] font-bold rounded-xl mt-4">
          Kembali ke Monitoring
        </Button>
      </div>
    </div>
  );
}
