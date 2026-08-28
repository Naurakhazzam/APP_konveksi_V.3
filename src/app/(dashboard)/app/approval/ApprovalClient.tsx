'use client';

import React, { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { 
  CheckCircle2, 
  XCircle, 
  Clock, 
  BarChart3, 
  ArrowUpRight, 
  User, 
  Hash,
  Lock,
  Loader2,
  AlertCircle
} from 'lucide-react';
import { 
  QtyApprovalRequest, 
  resolveQtyApproval 
} from '@/lib/actions/produksi/qty-approval.actions';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 60) return `${minutes} menit lalu`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} jam lalu`;
  const days = Math.floor(hours / 24);
  return `${days} hari lalu`;
}

interface ApprovalClientProps {
  initialData: QtyApprovalRequest[];
}

export default function ApprovalClient({ initialData }: ApprovalClientProps) {
  const [items, setItems] = useState(initialData);
  const [loading, setLoading] = useState<string | null>(null);
  const [modalState, setModalState] = useState<{
    open: boolean;
    requestId: string | null;
    action: 'approve' | 'reject' | null;
  }>({ open: false, requestId: null, action: null });
  const [pin, setPin] = useState('');

  const handleActionClick = (requestId: string, action: 'approve' | 'reject') => {
    setModalState({ open: true, requestId, action });
  };

  const handleConfirmPIN = async () => {
    if (!modalState.requestId || !modalState.action) return;
    
    setLoading(modalState.requestId);
    try {
      await resolveQtyApproval(
        modalState.requestId,
        modalState.action === 'approve' ? 'approved' : 'rejected',
        '',
        pin
      );
      
      toast.success(`Request berhasil di-${modalState.action === 'approve' ? 'setujui' : 'tolak'}`);
      setItems(prev => prev.filter(item => item.id !== modalState.requestId));
      setModalState({ open: false, requestId: null, action: null });
      setPin('');
    } catch (err: any) {
      toast.error(err.message || 'Gagal memproses approval. Cek PIN Anda.');
    } finally {
      setLoading(null);
    }
  };

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-12 text-center rounded-2xl border border-dashed border-[#2A2D31] bg-[#16181A]/40">
        <div className="mb-4 p-4 rounded-full bg-[#1A1D1F] border border-[#2A2D31] text-[#777e85]">
          <CheckCircle2 size={40} />
        </div>
        <h3 className="text-lg font-semibold text-[#e8eaed]">Semua Request Selesai</h3>
        <p className="text-[#9aa0a6] max-w-xs mt-1">Tidak ada permintaan approval QTY lebih yang menunggu saat ini.</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {items.map((item) => (
        <Card key={item.id} className="border-[#2A2D31] bg-[#16181A] hover:border-[#e5c17b]/30 transition-colors">
          <CardContent className="p-5">
            <div className="flex items-start justify-between mb-4">
              <div className="space-y-1">
                <div className="flex items-center gap-1.5 text-xs text-[#9aa0a6]">
                  <Hash size={12} />
                  <span className="font-mono">{item.barcode}</span>
                </div>
                <h4 className="font-semibold text-[#e8eaed] line-clamp-1">{item.no_po}</h4>
                <p className="text-xs text-[#777e85] flex items-center gap-1">
                  <User size={10} /> {item.klien_nama}
                </p>
              </div>
              <div className="px-2 py-1 rounded bg-[#e5c17b]/10 text-[#e5c17b] text-[10px] font-bold uppercase tracking-wider border border-[#e5c17b]/20">
                {item.tahap.replace('_', ' ')}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 mb-4">
              <div className="p-3 rounded-xl bg-[#0D0E10] border border-[#2A2D31]">
                <p className="text-[10px] text-[#777e85] uppercase tracking-wide mb-1 font-semibold">QTY Default</p>
                <div className="text-lg font-bold text-[#e8eaed]">{item.qty_default}</div>
              </div>
              <div className="p-3 rounded-xl bg-[#e5c17b]/5 border border-[#e5c17b]/20">
                <p className="text-[10px] text-[#e5c17b] uppercase tracking-wide mb-1 font-semibold">Diajukan</p>
                <div className="flex items-baseline gap-1">
                  <div className="text-lg font-bold text-[#e5c17b]">{item.qty_diajukan}</div>
                  <ArrowUpRight size={14} className="text-[#e5c17b]" />
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 mb-5 text-[11px] text-[#777e85]">
              <Clock size={12} />
              <span>Diminta {timeAgo(item.created_at)}</span>
            </div>

            <div className="flex gap-2">
              <Button 
                variant="outline" 
                className="flex-1 border-destructive/30 text-destructive hover:bg-destructive hover:text-white transition-all"
                onClick={() => handleActionClick(item.id, 'reject')}
                disabled={loading === item.id}
              >
                <XCircle className="mr-2 h-4 w-4" /> Tolak
              </Button>
              <Button 
                className="flex-1 bg-[#e5c17b] text-[#2b2318] hover:bg-[#e5c17b]/90"
                onClick={() => handleActionClick(item.id, 'approve')}
                disabled={loading === item.id}
              >
                {loading === item.id ? <Loader2 className="animate-spin h-4 w-4 mr-2" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
                Setujui
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}

      {/* PIN Confirmation Modal */}
      <Dialog 
        open={modalState.open} 
        onOpenChange={(open) => !open && setModalState(prev => ({ ...prev, open: false }))}
      >
        <DialogContent className="bg-[#16181A] border-[#2A2D31] text-[#e8eaed] max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Lock className="text-[#e5c17b]" size={18} />
              Konfirmasi Otoritas
            </DialogTitle>
            <DialogDescription className="text-[#9aa0a6]">
              Masukkan PIN Anda untuk {modalState.action === 'approve' ? 'menyetujui' : 'menolak'} permintaan ini.
            </DialogDescription>
          </DialogHeader>
          
          <div className="py-4">
            <div className="space-y-2">
              <Input
                type="password"
                inputMode="numeric"
                maxLength={6}
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/[^0-9]/g, ''))}
                placeholder="****"
                className="bg-[#0D0E10] border-[#2A2D31] text-center text-2xl tracking-[1em] focus:ring-[#e5c17b] py-6"
                autoFocus
                onKeyDown={(e) => e.key === 'Enter' && pin.length >= 4 && handleConfirmPIN()}
              />
              <p className="text-[10px] text-center text-[#777e85]">Security Verification Required</p>
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button 
              variant="ghost" 
              onClick={() => setModalState(prev => ({ ...prev, open: false }))}
              className="text-[#9aa0a6] hover:bg-[#2A2D31]"
            >
              Batal
            </Button>
            <Button 
              onClick={handleConfirmPIN}
              disabled={loading !== null || pin.length < 4}
              className="bg-[#e5c17b] text-[#2b2318] hover:bg-[#e5c17b]/90 min-w-[80px]"
            >
              {loading !== null ? <Loader2 className="animate-spin h-4 w-4" /> : 'Konfirmasi'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
