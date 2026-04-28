'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { CheckCircle2, Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { selesaiRework } from '@/lib/actions/produksi/reject.actions';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface SelesaiReworkButtonProps {
  rejectLogId: string;
  nomorReject: string;
  onSuccess: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function SelesaiReworkButton({
  rejectLogId,
  nomorReject,
  onSuccess,
}: SelesaiReworkButtonProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  // ── Buka dialog ──────────────────────────────────────────────────────────
  const handleOpenDialog = () => setOpen(true);

  // ── Konfirmasi & eksekusi ─────────────────────────────────────────────────
  const handleConfirm = async () => {
    setLoading(true);
    try {
      await selesaiRework(rejectLogId);
      toast.success('Rework selesai, gaji dikembalikan');
      setOpen(false);
      onSuccess();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Terjadi kesalahan';
      toast.error(`Gagal: ${msg}`);
    } finally {
      setLoading(false);
    }
  };

  // ── Batal ─────────────────────────────────────────────────────────────────
  const handleCancel = () => {
    if (!loading) setOpen(false);
  };

  return (
    <>
      {/* ── Trigger Button ─────────────────────────────────────────────── */}
      <Button
        size="sm"
        onClick={handleOpenDialog}
        style={{
          backgroundColor: '#16a34a',
          color: '#ffffff',
          border: '1px solid #15803d',
          transition: 'background-color 0.15s ease, box-shadow 0.15s ease',
        }}
        className="hover:!bg-green-700 gap-1.5 font-medium"
      >
        <CheckCircle2 className="h-4 w-4" />
        Selesai Rework
      </Button>

      {/* ── Confirmation Dialog ─────────────────────────────────────────── */}
      <Dialog open={open} onOpenChange={(v) => { if (!loading) setOpen(v); }}>
        <DialogContent
          style={{
            backgroundColor: '#1A1D1F',
            border: '1px solid #2A2D31',
            color: '#e5e7eb',
          }}
          className="max-w-md"
        >
          <DialogHeader>
            <DialogTitle
              style={{ color: '#e5c17b' }}
              className="flex items-center gap-2 text-base"
            >
              <CheckCircle2 className="h-5 w-5 text-green-400" />
              Konfirmasi Selesai Rework
            </DialogTitle>
            <DialogDescription
              style={{ color: '#9ca3af' }}
              className="pt-1 text-sm leading-relaxed"
            >
              Konfirmasi rework{' '}
              <span
                style={{
                  color: '#e5c17b',
                  fontWeight: 600,
                  fontFamily: 'monospace',
                }}
              >
                {nomorReject}
              </span>{' '}
              selesai?
              <br />
              Gaji karyawan yang dipotong akan dikembalikan.
            </DialogDescription>
          </DialogHeader>

          <DialogFooter className="mt-2 flex gap-2 sm:flex-row-reverse">
            {/* ── Ya, Selesai ── */}
            <Button
              onClick={handleConfirm}
              disabled={loading}
              style={{
                backgroundColor: loading ? '#15803d99' : '#16a34a',
                color: '#ffffff',
                border: '1px solid #15803d',
                minWidth: '120px',
              }}
              className="hover:!bg-green-700 font-semibold"
            >
              {loading ? (
                <>
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                  Memproses…
                </>
              ) : (
                <>
                  <CheckCircle2 className="mr-1.5 h-4 w-4" />
                  Ya, Selesai
                </>
              )}
            </Button>

            {/* ── Batal ── */}
            <Button
              variant="outline"
              onClick={handleCancel}
              disabled={loading}
              style={{
                backgroundColor: 'transparent',
                border: '1px solid #2A2D31',
                color: '#9ca3af',
              }}
              className="hover:!bg-[#2A2D31] hover:!text-white font-medium"
            >
              Batal
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
