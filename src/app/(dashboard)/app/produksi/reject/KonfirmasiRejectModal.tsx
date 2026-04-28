'use client';

import React, { useState, useEffect } from 'react';
import {
  X,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  User,
  Barcode,
  Hash,
  Layers,
  Package,
  ShieldAlert,
  Scissors,
} from 'lucide-react';
import { toast } from 'sonner';

import {
  getRejectDetail,
  konfirmasiReject,
  type RejectDetail,
  type KaryawanItem,
} from '@/lib/actions/produksi/reject.actions';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Props {
  rejectId: string;
  onClose: () => void;
  onSuccess: () => void;
}

/** State check per karyawan — key: karyawan_id */
type CheckedMap = Record<string, boolean>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatTahap(tahap: string): string {
  const map: Record<string, string> = {
    cutting: 'Cutting',
    jahit: 'Jahit',
    buang_benang: 'Buang Benang',
    lubang_kancing: 'Lubang Kancing',
    qc: 'QC',
    steam: 'Steam',
    packing: 'Packing',
    pengiriman: 'Pengiriman',
  };
  return map[tahap] ?? tahap;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function InfoRow({ label, value, accent = false }: { label: string; value: React.ReactNode; accent?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3 py-2" style={{ borderBottom: '1px solid #1E2124' }}>
      <span className="text-[12px] text-[#9aa0a6] shrink-0">{label}</span>
      <span className={`text-[13px] font-medium text-right ${accent ? 'text-[#e5c17b]' : 'text-[#e8eaed]'}`}>
        {value}
      </span>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="flex flex-col items-center justify-center py-20 gap-3">
      <Loader2 className="w-8 h-8 animate-spin text-[#e5c17b]" />
      <span className="text-sm text-[#9aa0a6]">Memuat detail reject...</span>
    </div>
  );
}

function ErrorState({ message, onClose }: { message: string; onClose: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-4 px-6 text-center">
      <div
        className="flex h-14 w-14 items-center justify-center rounded-full"
        style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)' }}
      >
        <AlertTriangle className="w-6 h-6 text-red-400" />
      </div>
      <div>
        <p className="text-sm font-semibold text-[#e8eaed] mb-1">Gagal memuat data</p>
        <p className="text-xs text-[#9aa0a6]">{message}</p>
      </div>
      <button
        onClick={onClose}
        className="px-4 h-8 rounded-lg border border-[#2A2D31] text-[#e8eaed] text-sm hover:bg-[#2A2D31] transition-colors"
      >
        Tutup
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export default function KonfirmasiRejectModal({ rejectId, onClose, onSuccess }: Props) {
  const [detail, setDetail] = useState<RejectDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [checkedMap, setCheckedMap] = useState<CheckedMap>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  // ── Fetch detail on mount ────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setLoadError(null);

    getRejectDetail(rejectId)
      .then((data) => {
        if (cancelled) return;
        setDetail(data);
        // Init semua karyawan tercentang (default: semua bertanggung jawab)
        const initMap: CheckedMap = {};
        data.karyawan_list.forEach((k) => {
          initMap[k.reject_karyawan_id] = true;
        });
        setCheckedMap(initMap);
      })
      .catch((err: Error) => {
        if (!cancelled) setLoadError(err.message);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => { cancelled = true; };
  }, [rejectId]);

  // ── Derived ──────────────────────────────────────────────────────────────
  const checkedIds = Object.entries(checkedMap)
    .filter(([, checked]) => checked)
    .map(([id]) => id);

  const allUnchecked = checkedIds.length === 0;

  // ── Toggle ───────────────────────────────────────────────────────────────
  const toggleKaryawan = (rejectKaryawanId: string) => {
    setCheckedMap((prev) => ({ ...prev, [rejectKaryawanId]: !prev[rejectKaryawanId] }));
  };

  // ── Submit ───────────────────────────────────────────────────────────────
  const handleKonfirmasi = async () => {
    if (allUnchecked) {
      toast.error('Pilih minimal satu karyawan yang bertanggung jawab');
      return;
    }

    setIsSubmitting(true);
    try {
      await konfirmasiReject(rejectId, checkedIds);
      toast.success(`Reject dikonfirmasi. ${checkedIds.length} karyawan dikenai potongan gaji.`);
      onSuccess();
    } catch (err: unknown) {
      toast.error((err as Error).message ?? 'Gagal mengkonfirmasi reject');
    } finally {
      setIsSubmitting(false);
    }
  };

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    /* Backdrop */
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)' }}
      onClick={(e) => { if (e.target === e.currentTarget && !isSubmitting) onClose(); }}
    >
      {/* Panel */}
      <div
        className="relative w-full max-w-lg max-h-[90vh] flex flex-col rounded-2xl shadow-2xl overflow-hidden"
        style={{ background: '#1A1D1F', border: '1px solid #2A2D31' }}
      >
        {/* ── Header ── */}
        <div
          className="flex items-center justify-between px-5 py-4 flex-shrink-0"
          style={{ borderBottom: '1px solid #2A2D31', background: '#16181A' }}
        >
          <div className="flex items-center gap-3">
            <div
              className="flex h-8 w-8 items-center justify-center rounded-lg"
              style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.2)' }}
            >
              <ShieldAlert className="w-4 h-4 text-red-400" />
            </div>
            <div>
              <h2 className="text-[15px] font-bold text-[#e8eaed] leading-none">
                Konfirmasi Reject
              </h2>
              <p className="text-[11px] text-[#9aa0a6] mt-0.5">
                Tetapkan tanggung jawab & potong gaji
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={isSubmitting}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-[#9aa0a6] hover:text-[#e8eaed] hover:bg-[#2A2D31] transition-colors disabled:opacity-40"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* ── Body ── */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {isLoading ? (
            <LoadingState />
          ) : loadError ? (
            <ErrorState message={loadError} onClose={onClose} />
          ) : detail ? (
            <div className="space-y-5">

              {/* ─── Seksi 1: Info Reject ────────────────────────────────── */}
              <section>
                <h3 className="text-[10px] uppercase tracking-widest text-[#9aa0a6] font-bold mb-3 flex items-center gap-1.5">
                  <Hash className="w-3 h-3" />
                  Informasi Reject
                </h3>
                <div
                  className="rounded-xl px-4 py-1"
                  style={{ background: '#0D0E10', border: '1px solid #2A2D31' }}
                >
                  <InfoRow
                    label="Jenis Reject"
                    value={
                      <span
                        className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold"
                        style={{
                          background: 'rgba(229,193,123,0.12)',
                          color: '#e5c17b',
                          border: '1px solid rgba(229,193,123,0.25)',
                        }}
                      >
                        {detail.jenis_nama}
                      </span>
                    }
                  />
                  <InfoRow label="Alasan" value={detail.alasan_nama} />
                  <InfoRow
                    label="Qty Reject"
                    value={`${detail.qty_reject} pcs`}
                    accent
                  />
                  <InfoRow
                    label="Tahap Ditemukan"
                    value={
                      <span className="flex items-center gap-1">
                        <Layers className="w-3 h-3 text-[#9aa0a6]" />
                        {formatTahap(detail.tahap_ditemukan)}
                      </span>
                    }
                  />
                  {detail.barcode && (
                    <InfoRow
                      label="Barcode Bundle"
                      value={
                        <span className="flex items-center gap-1 font-mono text-[12px]">
                          <Barcode className="w-3 h-3 text-[#9aa0a6]" />
                          {detail.barcode}
                        </span>
                      }
                    />
                  )}
                  <InfoRow
                    label="Status"
                    value={
                      <span
                        className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold"
                        style={{
                          background: 'rgba(251,191,36,0.12)',
                          color: '#fbbf24',
                          border: '1px solid rgba(251,191,36,0.25)',
                        }}
                      >
                        {detail.status}
                      </span>
                    }
                  />
                  <InfoRow
                    label="Dilaporkan"
                    value={formatDate(detail.created_at)}
                  />
                  {detail.keterangan && (
                    <InfoRow label="Keterangan" value={detail.keterangan} />
                  )}
                  <InfoRow
                    label="Bisa Rework?"
                    value={
                      detail.bisa_diperbaiki ? (
                        <span className="text-emerald-400 font-semibold">Ya</span>
                      ) : (
                        <span className="text-red-400 font-semibold">Tidak (Permanen)</span>
                      )
                    }
                  />
                </div>
              </section>

              {/* ─── Seksi 2: Daftar Karyawan Bertanggung Jawab ─────────── */}
              <section>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-[10px] uppercase tracking-widest text-[#9aa0a6] font-bold flex items-center gap-1.5">
                    <User className="w-3 h-3" />
                    Karyawan Bertanggung Jawab
                  </h3>
                  <span className="text-[11px] text-[#9aa0a6]">
                    {checkedIds.length} dari {detail.karyawan_list.length} dipilih
                  </span>
                </div>

                {detail.karyawan_list.length === 0 ? (
                  <div
                    className="flex flex-col items-center justify-center rounded-xl py-8 gap-2 text-center"
                    style={{ border: '1px dashed #2A2D31' }}
                  >
                    <Package className="w-8 h-8 text-[#2A2D31]" />
                    <p className="text-sm text-[#9aa0a6]">
                      Belum ada karyawan terdaftar untuk reject ini
                    </p>
                    <p className="text-[11px] text-[#9aa0a6]/60">
                      Data karyawan akan tersedia setelah disinkronkan dari sistem scanning
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {detail.karyawan_list.map((k: KaryawanItem) => {
                      const isChecked = checkedMap[k.reject_karyawan_id] ?? false;
                      return (
                        <label
                          key={k.reject_karyawan_id}
                          className="flex items-center gap-3 rounded-xl px-4 py-3 cursor-pointer transition-all select-none"
                          style={{
                            background: isChecked
                              ? 'rgba(239,68,68,0.07)'
                              : '#0D0E10',
                            border: isChecked
                              ? '1px solid rgba(239,68,68,0.25)'
                              : '1px solid #2A2D31',
                          }}
                        >
                          {/* Custom Checkbox */}
                          <div
                            className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md transition-all"
                            style={{
                              background: isChecked
                                ? 'rgba(239,68,68,0.9)'
                                : 'transparent',
                              border: isChecked
                                ? '1.5px solid rgba(239,68,68,0.9)'
                                : '1.5px solid #2A2D31',
                            }}
                            onClick={() => toggleKaryawan(k.reject_karyawan_id)}
                          >
                            {isChecked && (
                              <svg
                                viewBox="0 0 12 12"
                                className="w-3 h-3 text-white"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth={2}
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              >
                                <polyline points="2,6 5,9 10,3" />
                              </svg>
                            )}
                          </div>

                          {/* Avatar inisial */}
                          <div
                            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-bold"
                            style={{
                              background: isChecked
                                ? 'rgba(239,68,68,0.15)'
                                : 'rgba(42,45,49,0.8)',
                              color: isChecked ? '#f87171' : '#9aa0a6',
                            }}
                          >
                            {k.nama.charAt(0).toUpperCase()}
                          </div>

                          {/* Info karyawan */}
                          <div className="flex-1 min-w-0" onClick={() => toggleKaryawan(k.reject_karyawan_id)}>
                            <p
                              className={`text-[13px] font-semibold truncate leading-none mb-0.5 ${
                                isChecked ? 'text-[#e8eaed]' : 'text-[#9aa0a6]'
                              }`}
                            >
                              {k.nama}
                            </p>
                            <p className="text-[11px] text-[#9aa0a6] truncate">
                              {formatTahap(k.tahap)}
                            </p>
                          </div>

                          {/* Persen potongan */}
                          {k.persen_potongan !== undefined && (
                            <div
                              className="shrink-0 text-right"
                              onClick={() => toggleKaryawan(k.reject_karyawan_id)}
                            >
                              <p
                                className={`text-[13px] font-bold ${
                                  isChecked ? 'text-red-400' : 'text-[#9aa0a6]'
                                }`}
                              >
                                -{k.persen_potongan}%
                              </p>
                              <p className="text-[10px] text-[#9aa0a6]">potongan</p>
                            </div>
                          )}

                          {/* Status badge */}
                          {isChecked && (
                            <span
                              className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold"
                              style={{
                                background: 'rgba(239,68,68,0.15)',
                                color: '#f87171',
                              }}
                            >
                              Dipotong
                            </span>
                          )}
                        </label>
                      );
                    })}
                  </div>
                )}

                {/* Peringatan jika semua di-uncheck */}
                {!allUnchecked && detail.karyawan_list.length > 0 && (
                  <div
                    className="mt-3 flex items-start gap-2 rounded-lg px-3 py-2.5"
                    style={{
                      background: 'rgba(239,68,68,0.06)',
                      border: '1px solid rgba(239,68,68,0.15)',
                    }}
                  >
                    <AlertTriangle className="w-3.5 h-3.5 text-red-400 shrink-0 mt-0.5" />
                    <p className="text-[11px] text-[#9aa0a6]">
                      Karyawan yang dicentang akan menerima{' '}
                      <span className="text-red-400 font-semibold">potongan gaji</span>{' '}
                      sesuai kebijakan reject. Uncheck untuk membebaskan dari tanggung jawab.
                    </p>
                  </div>
                )}

                {allUnchecked && detail.karyawan_list.length > 0 && (
                  <div
                    className="mt-3 flex items-start gap-2 rounded-lg px-3 py-2.5"
                    style={{
                      background: 'rgba(251,191,36,0.06)',
                      border: '1px solid rgba(251,191,36,0.2)',
                    }}
                  >
                    <AlertTriangle className="w-3.5 h-3.5 text-yellow-400 shrink-0 mt-0.5" />
                    <p className="text-[11px] text-[#9aa0a6]">
                      Tidak ada karyawan yang dipilih.{' '}
                      <span className="text-yellow-400 font-semibold">
                        Pilih minimal satu karyawan
                      </span>{' '}
                      untuk melanjutkan konfirmasi.
                    </p>
                  </div>
                )}
              </section>

            </div>
          ) : null}
        </div>

        {/* ── Footer ── */}
        {!isLoading && !loadError && detail && (
          <div
            className="flex items-center justify-end gap-3 px-5 py-4 flex-shrink-0"
            style={{ borderTop: '1px solid #2A2D31', background: '#16181A' }}
          >
            {/* Summary: berapa yang dipotong */}
            {checkedIds.length > 0 && (
              <div className="mr-auto flex items-center gap-1.5">
                <Scissors className="w-3.5 h-3.5 text-red-400" />
                <span className="text-[12px] text-[#9aa0a6]">
                  <span className="text-red-400 font-semibold">{checkedIds.length}</span>{' '}
                  karyawan akan dipotong
                </span>
              </div>
            )}

            <button
              onClick={onClose}
              disabled={isSubmitting}
              className="px-5 h-9 rounded-lg border border-[#2A2D31] text-[#e8eaed] text-sm hover:bg-[#2A2D31] transition-colors disabled:opacity-40"
            >
              Batal
            </button>

            <button
              onClick={handleKonfirmasi}
              disabled={isSubmitting || allUnchecked}
              className="flex items-center gap-2 px-5 h-9 rounded-lg text-sm font-bold transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              style={{
                background: isSubmitting || allUnchecked
                  ? 'rgba(239,68,68,0.3)'
                  : 'rgba(239,68,68,0.9)',
                color: '#fff',
              }}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Mengkonfirmasi...
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  Konfirmasi &amp; Potong Gaji
                </>
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
