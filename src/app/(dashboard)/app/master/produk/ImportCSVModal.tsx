'use client';

import React, { useState, useRef } from 'react';
import { Upload, CheckCircle2, XCircle, AlertCircle } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  validateImportCSV,
  executeImportCSV,
  type ImportRow,
  type ValidateResult,
} from '@/lib/actions/master/produk-csv.actions';

const REQUIRED_HEADER = 'SKU_Klien;Nama_Produk;Kategori;Model;Size;Warna;Harga_Jual';

interface ImportCSVModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

type Step = 'upload' | 'preview' | 'result';

export function ImportCSVModal({ open, onClose, onSuccess }: ImportCSVModalProps) {
  const [step, setStep] = useState<Step>('upload');
  const [isLoading, setIsLoading] = useState(false);
  const [headerError, setHeaderError] = useState<string | null>(null);
  const [validateResult, setValidateResult] = useState<ValidateResult | null>(null);
  const [execResult, setExecResult] = useState<{ inserted: number; updated: number; errors: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState('');

  const reset = () => {
    setStep('upload');
    setIsLoading(false);
    setHeaderError(null);
    setValidateResult(null);
    setExecResult(null);
    setFileName('');
    if (fileRef.current) fileRef.current.value = '';
  };

  const handleClose = () => { reset(); onClose(); };

  const handleFileRead = async () => {
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    setIsLoading(true);
    setHeaderError(null);

    const text = await file.text();
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

    if (lines[0] !== REQUIRED_HEADER) {
      setHeaderError(`Header tidak sesuai. Harus:\n${REQUIRED_HEADER}`);
      setIsLoading(false);
      return;
    }

    const rows: ImportRow[] = lines.slice(1).map(line => {
      const [sku_klien, nama, kategori, model, size, warna, harga_raw] = line.split(';');
      return {
        sku_klien: sku_klien?.trim() === '-' ? '' : sku_klien?.trim() ?? '',
        nama: nama?.trim() ?? '',
        kategori: kategori?.trim() ?? '',
        model: model?.trim() ?? '',
        size: size?.trim() ?? '',
        warna: warna?.trim() ?? '',
        harga_jual: parseInt(harga_raw?.trim() ?? '0') || 0,
      };
    }).filter(r => r.nama);

    try {
      const result = await validateImportCSV(rows);
      setValidateResult(result);
      setStep('preview');
    } catch (err: any) {
      setHeaderError('Gagal validasi: ' + err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleExecute = async () => {
    if (!validateResult?.valid.length) return;
    setIsLoading(true);
    try {
      const result = await executeImportCSV(validateResult.valid);
      setExecResult(result);
      setStep('result');
    } catch (err: any) {
      setHeaderError('Gagal import: ' + err.message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="sm:max-w-[560px] bg-[#16181A] border-[#2A2D31] text-[#e8eaed]">
        <DialogHeader>
          <DialogTitle className="text-[#e8eaed]">Import CSV Produk</DialogTitle>
        </DialogHeader>

        {/* STEP 1 — UPLOAD */}
        {step === 'upload' && (
          <div className="space-y-4 mt-2">
            <div className="rounded-lg border border-dashed border-[#2A2D31] bg-[#0D0E10] p-4">
              <p className="text-xs text-[#9aa0a6] mb-2 font-semibold">Format header wajib:</p>
              <code className="text-xs text-[#e5c17b] font-mono block">
                SKU_Klien;Nama_Produk;Kategori;Model;Size;Warna;Harga_Jual
              </code>
              <code className="text-xs text-[#777e85] font-mono block mt-1">
                ely289;Airflow Black - S;Jacket;Airflow;S;Black;84012
              </code>
            </div>

            <div
              className="flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-[#2A2D31] bg-[#1A1D1F] p-8 cursor-pointer hover:border-[#e5c17b]/40 transition-colors"
              onClick={() => fileRef.current?.click()}
            >
              <Upload size={28} className="text-[#5f6368]" />
              <p className="text-sm text-[#9aa0a6]">
                {fileName ? fileName : 'Klik untuk pilih file CSV'}
              </p>
              <input
                ref={fileRef} type="file" accept=".csv" className="hidden"
                onChange={e => setFileName(e.target.files?.[0]?.name ?? '')}
              />
            </div>

            {headerError && (
              <div className="flex gap-2 rounded-lg bg-red-500/10 border border-red-500/20 p-3">
                <AlertCircle size={16} className="text-red-400 shrink-0 mt-0.5" />
                <p className="text-xs text-red-400 whitespace-pre-wrap">{headerError}</p>
              </div>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={handleClose}
                className="border-[#2A2D31] bg-transparent text-[#9aa0a6]">
                Batal
              </Button>
              <Button onClick={handleFileRead} disabled={!fileName || isLoading}
                className="bg-[#e5c17b] text-[#2b2318] hover:bg-[#e5c17b]/90">
                {isLoading ? 'Memvalidasi...' : 'Baca & Validasi'}
              </Button>
            </div>
          </div>
        )}

        {/* STEP 2 — PREVIEW */}
        {step === 'preview' && validateResult && (
          <div className="space-y-4 mt-2">
            <div className="flex gap-3">
              <span className="flex items-center gap-1.5 rounded-full bg-green-500/10 px-3 py-1 text-xs text-green-400">
                <CheckCircle2 size={13} /> {validateResult.valid.length} valid
              </span>
              <span className="flex items-center gap-1.5 rounded-full bg-red-500/10 px-3 py-1 text-xs text-red-400">
                <XCircle size={13} /> {validateResult.errors.length} error
              </span>
            </div>

            {validateResult.errors.length > 0 && (
              <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-3 max-h-32 overflow-y-auto">
                {validateResult.errors.slice(0, 10).map(e => (
                  <p key={e.row} className="text-xs text-red-400">Baris {e.row}: {e.pesan}</p>
                ))}
                {validateResult.errors.length > 10 && (
                  <p className="text-xs text-[#9aa0a6]">...dan {validateResult.errors.length - 10} lainnya</p>
                )}
              </div>
            )}

            {validateResult.valid.length > 0 && (
              <div className="rounded-lg border border-[#2A2D31] overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-[#2A2D31]/40">
                    <tr>{['SKU Klien','Nama','Model','Size','Warna'].map(h => (
                      <th key={h} className="px-3 py-2 text-left text-[#9aa0a6] font-medium">{h}</th>
                    ))}</tr>
                  </thead>
                  <tbody>
                    {validateResult.valid.slice(0, 5).map((r, i) => (
                      <tr key={i} className="border-t border-[#2A2D31]">
                        <td className="px-3 py-2 font-mono text-[#e5c17b]">{r.sku_klien || '—'}</td>
                        <td className="px-3 py-2 text-[#e8eaed]">{r.nama}</td>
                        <td className="px-3 py-2 text-[#9aa0a6]">{r.model}</td>
                        <td className="px-3 py-2 text-[#9aa0a6]">{r.size}</td>
                        <td className="px-3 py-2 text-[#9aa0a6]">{r.warna}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {validateResult.valid.length > 5 && (
                  <p className="px-3 py-2 text-xs text-[#5f6368] border-t border-[#2A2D31]">
                    ...dan {validateResult.valid.length - 5} baris lainnya
                  </p>
                )}
              </div>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setStep('upload')}
                className="border-[#2A2D31] bg-transparent text-[#9aa0a6]">
                Kembali
              </Button>
              <Button onClick={handleExecute}
                disabled={validateResult.valid.length === 0 || isLoading}
                className="bg-[#e5c17b] text-[#2b2318] hover:bg-[#e5c17b]/90">
                {isLoading ? 'Mengimport...' : `Konfirmasi Import (${validateResult.valid.length} baris)`}
              </Button>
            </div>
          </div>
        )}

        {/* STEP 3 — HASIL */}
        {step === 'result' && execResult && (
          <div className="space-y-4 mt-2">
            <div className="rounded-xl border border-[#2A2D31] bg-[#1A1D1F] p-5 space-y-3">
              <div className="flex items-center gap-2 text-green-400">
                <CheckCircle2 size={18} />
                <span className="text-sm font-semibold">{execResult.inserted} produk baru ditambahkan</span>
              </div>
              <div className="flex items-center gap-2 text-[#e5c17b]">
                <CheckCircle2 size={18} />
                <span className="text-sm font-semibold">{execResult.updated} produk diperbarui</span>
              </div>
              {execResult.errors > 0 && (
                <div className="flex items-center gap-2 text-red-400">
                  <XCircle size={18} />
                  <span className="text-sm font-semibold">{execResult.errors} baris gagal</span>
                </div>
              )}
            </div>
            <div className="flex justify-end">
              <Button onClick={() => { reset(); onSuccess(); }}
                className="bg-[#e5c17b] text-[#2b2318] hover:bg-[#e5c17b]/90">
                Tutup & Refresh
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
