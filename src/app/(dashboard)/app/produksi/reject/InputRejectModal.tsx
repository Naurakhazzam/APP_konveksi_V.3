'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Loader2, PlusCircle, AlertTriangle } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  buatReject,
  type AlasanRejectOption,
} from '@/lib/actions/produksi/reject.actions';

// ---------------------------------------------------------------------------
// Types & constants
// ---------------------------------------------------------------------------

interface InputRejectModalProps {
  alasanList: AlasanRejectOption[];
  onClose: () => void;
  onSuccess: () => void;
}

const TAHAP_OPTIONS: { value: string; label: string }[] = [
  { value: 'cutting',       label: 'Cutting' },
  { value: 'jahit',         label: 'Jahit' },
  { value: 'lubang_kancing',label: 'Lubang Kancing' },
  { value: 'buang_benang',  label: 'Buang Benang' },
  { value: 'qc',            label: 'QC' },
  { value: 'steam',         label: 'Steam' },
  { value: 'packing',       label: 'Packing' },
];

// ---------------------------------------------------------------------------
// Shared input styles
// ---------------------------------------------------------------------------

const inputStyle: React.CSSProperties = {
  background: '#0D0E10',
  border: '1px solid #2A2D31',
  color: '#e8eaed',
  borderRadius: '8px',
  padding: '8px 12px',
  fontSize: '13px',
  width: '100%',
  outline: 'none',
  transition: 'border-color 0.15s ease',
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '11px',
  fontWeight: 600,
  color: '#9aa0a6',
  marginBottom: '6px',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function InputRejectModal({
  alasanList,
  onClose,
  onSuccess,
}: InputRejectModalProps) {
  const [alasanId,     setAlasanId]     = useState('');
  const [qty,          setQty]          = useState<number>(1);
  const [tahap,        setTahap]        = useState('');
  const [barcode,      setBarcode]      = useState('');
  const [keterangan,   setKeterangan]   = useState('');
  const [loading,      setLoading]      = useState(false);

  // ── Derived ──────────────────────────────────────────────────────────────
  const canSubmit = alasanId !== '' && qty >= 1 && tahap !== '' && !loading;

  // ── Submit ───────────────────────────────────────────────────────────────
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;

    setLoading(true);
    try {
      await buatReject({
        alasan_reject_id: alasanId,
        qty_reject:       qty,
        tahap_ditemukan:  tahap,
        keterangan:       keterangan.trim() || undefined,
        source:           'produksi',
        bundle_id:        undefined,
      });
      toast.success('Reject berhasil dicatat');
      onSuccess();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Terjadi kesalahan';
      toast.error(`Gagal: ${msg}`);
    } finally {
      setLoading(false);
    }
  };

  // ── Group alasan by jenis ─────────────────────────────────────────────────
  const grouped: Record<string, AlasanRejectOption[]> = {};
  for (const a of alasanList) {
    if (!grouped[a.jenis_nama]) grouped[a.jenis_nama] = [];
    grouped[a.jenis_nama].push(a);
  }

  return (
    <Dialog open onOpenChange={(v) => { if (!v && !loading) onClose(); }}>
      <DialogContent
        style={{
          backgroundColor: '#1A1D1F',
          border: '1px solid #2A2D31',
          color: '#e8eaed',
          maxWidth: '520px',
        }}
      >
        {/* ── Header ── */}
        <DialogHeader>
          <DialogTitle
            className="flex items-center gap-2 text-base"
            style={{ color: '#e5c17b' }}
          >
            <PlusCircle className="h-5 w-5" />
            Input Reject Manual
          </DialogTitle>
        </DialogHeader>

        {/* ── Form ── */}
        <form onSubmit={handleSubmit} className="mt-2 space-y-4">

          {/* Barcode Bundle (opsional / referensi) */}
          <div>
            <label style={labelStyle}>Barcode Bundle (opsional)</label>
            <input
              type="text"
              value={barcode}
              onChange={(e) => setBarcode(e.target.value)}
              placeholder="Scan atau ketik barcode…"
              style={inputStyle}
              onFocus={(e) => (e.currentTarget.style.borderColor = '#e5c17b')}
              onBlur={(e)  => (e.currentTarget.style.borderColor = '#2A2D31')}
            />
            <p style={{ fontSize: '11px', color: '#777e85', marginTop: '4px' }}>
              Hanya untuk referensi. Bundle tidak akan diperbarui otomatis.
            </p>
          </div>

          {/* Alasan Reject */}
          <div>
            <label style={labelStyle}>
              Alasan Reject <span style={{ color: '#e5c17b' }}>*</span>
            </label>
            <select
              required
              value={alasanId}
              onChange={(e) => setAlasanId(e.target.value)}
              style={{ ...inputStyle, cursor: 'pointer', appearance: 'auto' }}
              onFocus={(e) => (e.currentTarget.style.borderColor = '#e5c17b')}
              onBlur={(e)  => (e.currentTarget.style.borderColor = '#2A2D31')}
            >
              <option value="" disabled style={{ background: '#0D0E10' }}>
                — Pilih alasan reject —
              </option>
              {Object.entries(grouped).map(([jenis, items]) => (
                <optgroup
                  key={jenis}
                  label={jenis}
                  style={{ background: '#1A1D1F', color: '#9aa0a6' }}
                >
                  {items.map((a) => (
                    <option key={a.id} value={a.id} style={{ background: '#0D0E10', color: '#e8eaed' }}>
                      {a.nama}{a.bisa_diperbaiki ? ' ✓ rework' : ''}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>

            {/* Info badge alasan terpilih */}
            {alasanId && (() => {
              const selected = alasanList.find((a) => a.id === alasanId);
              if (!selected) return null;
              return (
                <div className="mt-2 flex items-center gap-2 flex-wrap">
                  <span
                    className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold"
                    style={{
                      background: selected.bisa_diperbaiki
                        ? 'rgba(251,191,36,0.12)'
                        : 'rgba(239,68,68,0.12)',
                      color: selected.bisa_diperbaiki ? '#fbbf24' : '#f87171',
                      border: `1px solid ${selected.bisa_diperbaiki ? 'rgba(251,191,36,0.25)' : 'rgba(239,68,68,0.25)'}`,
                    }}
                  >
                    {selected.bisa_diperbaiki ? 'Bisa Rework' : 'Permanen'}
                  </span>
                  <span
                    className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold"
                    style={{
                      background: 'rgba(239,68,68,0.1)',
                      color: '#f87171',
                      border: '1px solid rgba(239,68,68,0.2)',
                    }}
                  >
                    Potongan {selected.persen_potongan}%
                  </span>
                </div>
              );
            })()}
          </div>

          {/* Row: Qty + Tahap */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label style={labelStyle}>
                Qty Reject <span style={{ color: '#e5c17b' }}>*</span>
              </label>
              <input
                type="number"
                required
                min={1}
                value={qty}
                onChange={(e) => setQty(Number(e.target.value))}
                style={inputStyle}
                onFocus={(e) => (e.currentTarget.style.borderColor = '#e5c17b')}
                onBlur={(e)  => (e.currentTarget.style.borderColor = '#2A2D31')}
              />
            </div>
            <div>
              <label style={labelStyle}>
                Tahap Ditemukan <span style={{ color: '#e5c17b' }}>*</span>
              </label>
              <select
                required
                value={tahap}
                onChange={(e) => setTahap(e.target.value)}
                style={{ ...inputStyle, cursor: 'pointer', appearance: 'auto' }}
                onFocus={(e) => (e.currentTarget.style.borderColor = '#e5c17b')}
                onBlur={(e)  => (e.currentTarget.style.borderColor = '#2A2D31')}
              >
                <option value="" disabled style={{ background: '#0D0E10' }}>
                  — Pilih tahap —
                </option>
                {TAHAP_OPTIONS.map((t) => (
                  <option key={t.value} value={t.value} style={{ background: '#0D0E10', color: '#e8eaed' }}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Keterangan */}
          <div>
            <label style={labelStyle}>Keterangan (opsional)</label>
            <textarea
              rows={3}
              value={keterangan}
              onChange={(e) => setKeterangan(e.target.value)}
              placeholder="Catatan tambahan…"
              style={{
                ...inputStyle,
                resize: 'vertical',
                lineHeight: '1.5',
              }}
              onFocus={(e) => (e.currentTarget.style.borderColor = '#e5c17b')}
              onBlur={(e)  => (e.currentTarget.style.borderColor = '#2A2D31')}
            />
          </div>

          {/* Warning jika alasan permanen */}
          {alasanId && (() => {
            const selected = alasanList.find((a) => a.id === alasanId);
            if (!selected || selected.bisa_diperbaiki) return null;
            return (
              <div
                className="flex items-start gap-2 rounded-lg px-3 py-2.5"
                style={{
                  background: 'rgba(239,68,68,0.06)',
                  border: '1px solid rgba(239,68,68,0.15)',
                }}
              >
                <AlertTriangle className="h-3.5 w-3.5 text-red-400 shrink-0 mt-0.5" />
                <p style={{ fontSize: '11px', color: '#9aa0a6' }}>
                  Alasan ini bersifat{' '}
                  <span style={{ color: '#f87171', fontWeight: 600 }}>permanen</span>{' '}
                  — tidak bisa dirework. Gaji karyawan yang bertanggung jawab akan dipotong.
                </p>
              </div>
            );
          })()}

          {/* ── Footer actions ── */}
          <div
            className="flex justify-end gap-2 pt-2"
            style={{ borderTop: '1px solid #2A2D31' }}
          >
            <Button
              type="button"
              variant="outline"
              disabled={loading}
              onClick={onClose}
              style={{
                background: 'transparent',
                border: '1px solid #2A2D31',
                color: '#9ca3af',
              }}
              className="hover:!bg-[#2A2D31] hover:!text-white"
            >
              Batal
            </Button>
            <Button
              type="submit"
              disabled={!canSubmit}
              style={{
                background: canSubmit ? '#e5c17b' : 'rgba(229,193,123,0.3)',
                color: canSubmit ? '#0D0E10' : '#9aa0a6',
                border: 'none',
                fontWeight: 700,
                minWidth: '120px',
              }}
            >
              {loading ? (
                <>
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                  Menyimpan…
                </>
              ) : (
                <>
                  <PlusCircle className="mr-1.5 h-4 w-4" />
                  Simpan Reject
                </>
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
