'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Loader2, ShoppingBag, AlertTriangle } from 'lucide-react';
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
// Types
// ---------------------------------------------------------------------------

interface SuratJalanOption {
  id: string;
  nomor_sj: string;
  klien_nama: string;
}

interface InputRejectKonsumenModalProps {
  alasanList: AlasanRejectOption[];
  suratJalanList: SuratJalanOption[];
  onClose: () => void;
  onSuccess: () => void;
}

// ---------------------------------------------------------------------------
// Shared styles
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

export default function InputRejectKonsumenModal({
  alasanList,
  suratJalanList,
  onClose,
  onSuccess,
}: InputRejectKonsumenModalProps) {
  const [sjId,       setSjId]       = useState('');
  const [alasanId,   setAlasanId]   = useState('');
  const [qty,        setQty]        = useState<number>(1);
  const [keterangan, setKeterangan] = useState('');
  const [loading,    setLoading]    = useState(false);

  const canSubmit = sjId !== '' && alasanId !== '' && qty >= 1 && !loading;

  // ── Group alasan by jenis ─────────────────────────────────────────────────
  const grouped: Record<string, AlasanRejectOption[]> = {};
  for (const a of alasanList) {
    if (!grouped[a.jenis_nama]) grouped[a.jenis_nama] = [];
    grouped[a.jenis_nama].push(a);
  }

  const selectedAlasan = alasanList.find((a) => a.id === alasanId);
  const selectedSj     = suratJalanList.find((s) => s.id === sjId);

  // ── Submit ───────────────────────────────────────────────────────────────
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;

    setLoading(true);
    try {
      await buatReject({
        alasan_reject_id: alasanId,
        qty_reject:       qty,
        tahap_ditemukan:  'packing',
        keterangan:       keterangan.trim() || undefined,
        source:           'konsumen',
        surat_jalan_id:   sjId,
        bundle_id:        undefined,
      });
      toast.success('Reject konsumen berhasil dicatat');
      onSuccess();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Terjadi kesalahan';
      toast.error(`Gagal: ${msg}`);
    } finally {
      setLoading(false);
    }
  };

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
            <ShoppingBag className="h-5 w-5" />
            Input Reject Konsumen
          </DialogTitle>
        </DialogHeader>

        {/* ── Sub-label ── */}
        <p style={{ fontSize: '12px', color: '#9aa0a6', marginTop: '-4px', marginBottom: '4px' }}>
          Catat barang retur dari konsumen berdasarkan Surat Jalan yang telah dikirim.
        </p>

        {/* ── Form ── */}
        <form onSubmit={handleSubmit} className="space-y-4">

          {/* Nomor SJ */}
          <div>
            <label style={labelStyle}>
              Nomor Surat Jalan <span style={{ color: '#e5c17b' }}>*</span>
            </label>
            <select
              required
              value={sjId}
              onChange={(e) => setSjId(e.target.value)}
              style={{ ...inputStyle, cursor: 'pointer', appearance: 'auto' }}
              onFocus={(e) => (e.currentTarget.style.borderColor = '#e5c17b')}
              onBlur={(e)  => (e.currentTarget.style.borderColor = '#2A2D31')}
            >
              <option value="" disabled style={{ background: '#0D0E10' }}>
                — Pilih nomor SJ —
              </option>
              {suratJalanList.map((sj) => (
                <option key={sj.id} value={sj.id} style={{ background: '#0D0E10', color: '#e8eaed' }}>
                  {sj.nomor_sj} — {sj.klien_nama}
                </option>
              ))}
            </select>

            {/* Info SJ terpilih */}
            {selectedSj && (
              <div className="mt-2 flex items-center gap-1.5">
                <span
                  className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold"
                  style={{
                    background: 'rgba(229,193,123,0.1)',
                    color: '#e5c17b',
                    border: '1px solid rgba(229,193,123,0.2)',
                  }}
                >
                  {selectedSj.nomor_sj}
                </span>
                <span style={{ fontSize: '11px', color: '#9aa0a6' }}>{selectedSj.klien_nama}</span>
              </div>
            )}
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
                <optgroup key={jenis} label={jenis} style={{ background: '#1A1D1F', color: '#9aa0a6' }}>
                  {items.map((a) => (
                    <option key={a.id} value={a.id} style={{ background: '#0D0E10', color: '#e8eaed' }}>
                      {a.nama}{a.bisa_diperbaiki ? ' ✓ rework' : ''}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>

            {/* Badge info alasan */}
            {selectedAlasan && (
              <div className="mt-2 flex items-center gap-2 flex-wrap">
                <span
                  className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold"
                  style={{
                    background: selectedAlasan.bisa_diperbaiki
                      ? 'rgba(251,191,36,0.12)' : 'rgba(239,68,68,0.12)',
                    color: selectedAlasan.bisa_diperbaiki ? '#fbbf24' : '#f87171',
                    border: `1px solid ${selectedAlasan.bisa_diperbaiki ? 'rgba(251,191,36,0.25)' : 'rgba(239,68,68,0.25)'}`,
                  }}
                >
                  {selectedAlasan.bisa_diperbaiki ? 'Bisa Rework' : 'Permanen'}
                </span>
                <span
                  className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold"
                  style={{
                    background: 'rgba(239,68,68,0.1)',
                    color: '#f87171',
                    border: '1px solid rgba(239,68,68,0.2)',
                  }}
                >
                  Potongan {selectedAlasan.persen_potongan}%
                </span>
              </div>
            )}
          </div>

          {/* Qty */}
          <div>
            <label style={labelStyle}>
              Qty Reject (pcs) <span style={{ color: '#e5c17b' }}>*</span>
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

          {/* Keterangan */}
          <div>
            <label style={labelStyle}>Keterangan (opsional)</label>
            <textarea
              rows={3}
              value={keterangan}
              onChange={(e) => setKeterangan(e.target.value)}
              placeholder="Catatan retur dari konsumen…"
              style={{ ...inputStyle, resize: 'vertical', lineHeight: '1.5' }}
              onFocus={(e) => (e.currentTarget.style.borderColor = '#e5c17b')}
              onBlur={(e)  => (e.currentTarget.style.borderColor = '#2A2D31')}
            />
          </div>

          {/* Warning permanen */}
          {selectedAlasan && !selectedAlasan.bisa_diperbaiki && (
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
                <span style={{ color: '#f87171', fontWeight: 600 }}>permanen</span>
                {' '}— tidak bisa dirework.
              </p>
            </div>
          )}

          {/* Footer */}
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
                minWidth: '140px',
              }}
            >
              {loading ? (
                <>
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                  Menyimpan…
                </>
              ) : (
                <>
                  <ShoppingBag className="mr-1.5 h-4 w-4" />
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
