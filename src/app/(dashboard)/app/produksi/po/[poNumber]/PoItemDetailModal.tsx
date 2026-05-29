'use client';

import React, { useEffect, useState } from 'react';
import { X, Package, Truck, AlertTriangle, CheckCircle, Loader2, Clock, User, Scissors, ChevronRight } from 'lucide-react';
import { getPoItemBundleDetail, type BundleDetailItem, type BundleStageDetail } from '@/lib/actions/produksi/po-bundle.actions';

const TAHAP_ORDER = ['cutting', 'jahit', 'buang_benang', 'lubang_kancing', 'qc', 'steam', 'packing'] as const;
const TAHAP_LABEL: Record<string, string> = {
  cutting: 'Cutting',
  jahit: 'Jahit',
  buang_benang: 'Buang Benang',
  lubang_kancing: 'Lubang Kancing',
  qc: 'QC',
  steam: 'Steam',
  packing: 'Packing',
};

interface Props {
  poItemId: string;
  artikelInfo: { model_nama: string; warna: string; size: string; total_bundle: number; qty_order: number };
  onClose: () => void;
}

function StageBadge({ tahap, detail }: { tahap: string; detail: BundleStageDetail }) {
  const qty = detail.qty_selesai ?? detail.qty_aktual ?? detail.qty_terima;
  if (detail.status === 'selesai') {
    return (
      <div className="text-center min-w-[68px]">
        <p className="text-[9px] text-[#9aa0a6] mb-1 leading-tight">{TAHAP_LABEL[tahap]}</p>
        <span className="inline-flex items-center gap-0.5 text-[10px] bg-[#1D9E75]/15 text-[#1D9E75] px-2 py-0.5 rounded-full font-medium whitespace-nowrap">
          <CheckCircle className="w-2.5 h-2.5" /> {qty ?? '—'} pcs
        </span>
        {detail.karyawan_nama && (
          <p className="text-[9px] text-[#9aa0a6] mt-0.5 truncate max-w-[68px]">{detail.karyawan_nama}</p>
        )}
      </div>
    );
  }
  if (detail.status === 'progress') {
    return (
      <div className="text-center min-w-[68px]">
        <p className="text-[9px] text-[#9aa0a6] mb-1 leading-tight">{TAHAP_LABEL[tahap]}</p>
        <span className="inline-flex items-center gap-0.5 text-[10px] bg-[#e5c17b]/15 text-[#e5c17b] px-2 py-0.5 rounded-full font-medium whitespace-nowrap">
          <Loader2 className="w-2.5 h-2.5 animate-spin" /> Proses
        </span>
        {detail.karyawan_nama && (
          <p className="text-[9px] text-[#9aa0a6] mt-0.5 truncate max-w-[68px]">{detail.karyawan_nama}</p>
        )}
      </div>
    );
  }
  return (
    <div className="text-center min-w-[60px]">
      <p className="text-[9px] text-[#9aa0a6] mb-1 leading-tight">{TAHAP_LABEL[tahap]}</p>
      <span className="inline-block text-[10px] bg-[#2A2D31] text-[#9aa0a6] px-2 py-0.5 rounded-full border border-[#3A3D41]">— Belum</span>
    </div>
  );
}

function formatDate(d: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatRp(n: number) {
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(n);
}

function StatusOverallBadge({ status }: { status: BundleDetailItem['status_overall'] }) {
  if (status === 'selesai') return <span className="text-[10px] bg-[#1D9E75]/15 text-[#1D9E75] px-2 py-0.5 rounded-full font-medium">Selesai semua tahap</span>;
  if (status === 'proses') return <span className="text-[10px] bg-[#e5c17b]/15 text-[#e5c17b] px-2 py-0.5 rounded-full font-medium">Sedang proses</span>;
  return <span className="text-[10px] bg-[#2A2D31] text-[#9aa0a6] px-2 py-0.5 rounded-full border border-[#3A3D41]">Belum mulai</span>;
}

export default function PoItemDetailModal({ poItemId, artikelInfo, onClose }: Props) {
  const [bundles, setBundles] = useState<BundleDetailItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getPoItemBundleDetail(poItemId)
      .then(setBundles)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [poItemId]);

  return (
    <div className="fixed inset-0 bg-black/75 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-[#1A1D1F] border border-[#2A2D31] rounded-2xl w-full max-w-3xl max-h-[90vh] flex flex-col shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-[#2A2D31] flex items-start justify-between shrink-0">
          <div>
            <p className="text-[10px] uppercase tracking-widest text-[#9aa0a6] mb-0.5">Detail Artikel</p>
            <h2 className="text-lg font-bold text-[#e8eaed]">
              {artikelInfo.model_nama} &nbsp;·&nbsp; {artikelInfo.warna} &nbsp;·&nbsp; {artikelInfo.size}
            </h2>
            <p className="text-xs text-[#9aa0a6] mt-0.5">
              {artikelInfo.total_bundle} bundle &nbsp;·&nbsp; {artikelInfo.qty_order} pcs order
            </p>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg text-[#9aa0a6] hover:text-[#e8eaed] hover:bg-[#2A2D31] transition-colors mt-0.5">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 px-6 py-4 space-y-3">
          {loading && (
            <div className="flex items-center justify-center py-16 gap-3 text-[#9aa0a6]">
              <Loader2 className="w-5 h-5 animate-spin" />
              <span className="text-sm">Memuat data bundle...</span>
            </div>
          )}
          {error && (
            <div className="flex items-center gap-2 text-red-400 text-sm py-8 justify-center">
              <AlertTriangle className="w-4 h-4" /> {error}
            </div>
          )}
          {!loading && !error && bundles.length === 0 && (
            <p className="text-center text-[#9aa0a6] text-sm py-12">Tidak ada bundle untuk artikel ini.</p>
          )}

          {!loading && !error && bundles.map(b => (
            <div key={b.id} className={`border rounded-xl overflow-hidden ${b.rejects.length > 0 ? 'border-red-500/30' : 'border-[#2A2D31]'}`}>

              {/* Bundle header */}
              <div className="px-4 py-2.5 bg-[#16181A] flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <Package className="w-4 h-4 text-[#9aa0a6] shrink-0" />
                  <span className="font-mono text-xs font-bold text-[#e8eaed] truncate">{b.barcode}</span>
                  {b.parent_barcode && (
                    <span className="text-[10px] bg-blue-500/15 text-blue-400 px-1.5 py-0.5 rounded-full shrink-0 flex items-center gap-1">
                      <Scissors className="w-2.5 h-2.5" /> Split dari {b.parent_barcode.split('-').pop()}
                    </span>
                  )}
                  {b.child_barcodes.length > 0 && (
                    <span className="text-[10px] bg-[#e5c17b]/15 text-[#e5c17b] px-1.5 py-0.5 rounded-full shrink-0">
                      Di-split → {b.child_barcodes.length} bundle
                    </span>
                  )}
                </div>
                <StatusOverallBadge status={b.status_overall} />
              </div>

              {/* Tahap produksi */}
              {b.status_overall !== 'belum' && (
                <div className="px-4 py-3 border-t border-[#2A2D31]">
                  <p className="text-[10px] uppercase tracking-widest text-[#9aa0a6] mb-2">Alur produksi</p>
                  <div className="flex items-start gap-1.5 flex-wrap">
                    {TAHAP_ORDER.map((tahap, i) => (
                      <React.Fragment key={tahap}>
                        <StageBadge tahap={tahap} detail={b.stages[tahap]} />
                        {i < TAHAP_ORDER.length - 1 && (
                          <ChevronRight className="w-3 h-3 text-[#3A3D41] mt-3 shrink-0" />
                        )}
                      </React.Fragment>
                    ))}
                  </div>
                </div>
              )}

              {b.status_overall === 'belum' && (
                <div className="px-4 py-3 border-t border-[#2A2D31]">
                  <p className="text-xs text-[#9aa0a6]">Bundle ini belum memasuki tahap produksi manapun.</p>
                </div>
              )}

              {/* Qty mismatch warning */}
              {b.qty_mismatches.map((m, i) => (
                <div key={i} className={`px-4 py-2 border-t flex items-start gap-2 ${m.tipe === 'kurang' ? 'bg-orange-500/8 border-orange-500/20' : 'bg-yellow-500/8 border-yellow-500/20'}`}>
                  <AlertTriangle className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${m.tipe === 'kurang' ? 'text-orange-400' : 'text-yellow-400'}`} />
                  <span className={`text-[11px] font-medium ${m.tipe === 'kurang' ? 'text-orange-300' : 'text-yellow-300'}`}>
                    QTY {TAHAP_LABEL[m.tahap]} {m.tipe} —&nbsp;
                    terima {m.qty_terima} pcs, selesai {m.qty_selesai} pcs ({m.tipe === 'kurang' ? '-' : '+'}{m.selisih} pcs)
                    {m.alasan && <> · Alasan: {m.alasan}</>}
                    {m.catatan && <> · &quot;{m.catatan}&quot;</>}
                  </span>
                </div>
              ))}

              {/* Info bawah: 3 kolom */}
              <div className="grid grid-cols-3 divide-x divide-[#2A2D31] border-t border-[#2A2D31]">
                {/* Pengiriman */}
                <div className="px-4 py-2.5">
                  <p className="text-[10px] uppercase tracking-widest text-[#9aa0a6] mb-1">Pengiriman</p>
                  {b.nomor_sj ? (
                    <>
                      <div className="flex items-center gap-1.5 text-[#1D9E75]">
                        <Truck className="w-3.5 h-3.5 shrink-0" />
                        <span className="text-xs font-medium">{b.nomor_sj}</span>
                      </div>
                      <p className="text-[10px] text-[#9aa0a6] mt-0.5">{formatDate(b.tanggal_sj)}</p>
                    </>
                  ) : (
                    <div className="flex items-center gap-1.5 text-[#9aa0a6]">
                      <Clock className="w-3.5 h-3.5" />
                      <span className="text-xs">Belum dikirim</span>
                    </div>
                  )}
                </div>

                {/* Gaji */}
                <div className="px-4 py-2.5">
                  <p className="text-[10px] uppercase tracking-widest text-[#9aa0a6] mb-1">Gaji karyawan</p>
                  {b.gaji_status !== null ? (
                    <>
                      <div className="flex items-center gap-1.5">
                        <User className="w-3.5 h-3.5 text-[#9aa0a6] shrink-0" />
                        <span className="text-xs font-medium text-[#e8eaed]">{formatRp(b.total_gaji)}</span>
                      </div>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium mt-1 inline-block ${b.gaji_status === 'lunas' ? 'bg-[#1D9E75]/15 text-[#1D9E75]' : 'bg-red-500/15 text-red-400'}`}>
                        {b.gaji_status === 'lunas' ? 'Lunas' : 'Belum lunas'}
                      </span>
                    </>
                  ) : (
                    <p className="text-xs text-[#9aa0a6]">— Belum ada</p>
                  )}
                </div>

                {/* Reject */}
                <div className="px-4 py-2.5">
                  <p className="text-[10px] uppercase tracking-widest text-[#9aa0a6] mb-1">Reject</p>
                  {b.rejects.length === 0 ? (
                    <div className="flex items-center gap-1.5 text-[#1D9E75]">
                      <CheckCircle className="w-3.5 h-3.5" />
                      <span className="text-xs">Tidak ada reject</span>
                    </div>
                  ) : (
                    <div className="space-y-1">
                      {b.rejects.map((r, i) => (
                        <div key={i}>
                          <div className="flex items-center gap-1.5 text-red-400">
                            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                            <span className="text-xs font-medium">{r.qty_reject} pcs reject</span>
                          </div>
                          <p className="text-[10px] text-[#9aa0a6] mt-0.5">
                            {TAHAP_LABEL[r.tahap_ditemukan] ?? r.tahap_ditemukan} · {r.alasan}
                            {r.source === 'konsumen' && <span className="ml-1 text-orange-400">(dari klien)</span>}
                          </p>
                          {r.keterangan && <p className="text-[10px] text-[#9aa0a6] italic">&quot;{r.keterangan}&quot;</p>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-[#2A2D31] bg-[#16181A] rounded-b-2xl shrink-0 flex justify-end">
          <button onClick={onClose} className="px-5 py-2 rounded-xl border border-[#2A2D31] text-sm font-bold text-[#e8eaed] hover:bg-[#2A2D31] transition-colors">
            Tutup
          </button>
        </div>
      </div>
    </div>
  );
}
