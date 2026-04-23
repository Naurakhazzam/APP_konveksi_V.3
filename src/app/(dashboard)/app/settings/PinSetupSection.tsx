'use client';

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ShieldCheck, Loader2 } from 'lucide-react';
import { setApprovalPin } from '@/lib/actions/settings/pin.actions';
import { toast } from 'sonner';

interface PinSetupSectionProps {
  hasPinAlready: boolean;
}

export default function PinSetupSection({ hasPinAlready }: PinSetupSectionProps) {
  const [isEditing, setIsEditing] = useState(!hasPinAlready);
  const [loading, setLoading] = useState(false);
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (pin.length !== 4) {
      toast.error('PIN harus 4 digit angka');
      return;
    }
    
    if (pin !== confirmPin) {
      toast.error('Konfirmasi PIN tidak cocok');
      return;
    }

    setLoading(true);
    try {
      await setApprovalPin(pin);
      toast.success('PIN approval berhasil disimpan');
      setIsEditing(false);
      setPin('');
      setConfirmPin('');
    } catch (err: any) {
      toast.error(err.message || 'Gagal menyimpan PIN');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="border-[#2A2D31] bg-[#16181A]">
      <CardHeader>
        <div className="flex items-center gap-2 mb-2">
          <div className="p-2 rounded-lg bg-[#e5c17b]/10 text-[#e5c17b]">
            <ShieldCheck size={20} />
          </div>
          <CardTitle>PIN Approval</CardTitle>
        </div>
        <CardDescription className="text-[#9aa0a6]">
          PIN 4 digit digunakan untuk mengkonfirmasi approve/tolak qty di halaman Approval oleh Owner.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {!isEditing ? (
          <div className="flex items-center justify-between p-4 rounded-lg bg-[#0D0E10] border border-[#2A2D31]">
            <div className="space-y-1">
              <p className="text-sm font-medium text-[#e8eaed]">PIN sudah diset</p>
              <p className="text-xs text-[#777e85]">Gunakan PIN ini untuk otorisasi transaksi kritikal.</p>
            </div>
            <Button 
              variant="outline" 
              onClick={() => setIsEditing(true)}
              className="border-[#2A2D31] text-[#9aa0a6] hover:bg-[#2A2D31] hover:text-[#e8eaed]"
            >
              Ganti PIN
            </Button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium text-[#e8eaed]">PIN Baru (4 Digit)</label>
                <Input
                  type="password"
                  inputMode="numeric"
                  maxLength={4}
                  value={pin}
                  onChange={(e) => setPin(e.target.value.replace(/[^0-9]/g, ''))}
                  placeholder="****"
                  className="bg-[#0D0E10] border-[#2A2D31] focus:ring-[#e5c17b]"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-[#e8eaed]">Konfirmasi PIN</label>
                <Input
                  type="password"
                  inputMode="numeric"
                  maxLength={4}
                  value={confirmPin}
                  onChange={(e) => setConfirmPin(e.target.value.replace(/[^0-9]/g, ''))}
                  placeholder="****"
                  className="bg-[#0D0E10] border-[#2A2D31] focus:ring-[#e5c17b]"
                />
              </div>
            </div>
            <div className="flex justify-end gap-3">
              {hasPinAlready && (
                <Button 
                  type="button" 
                  variant="ghost" 
                  onClick={() => setIsEditing(false)}
                  className="text-[#9aa0a6] hover:bg-[#2A2D31]"
                >
                  Batal
                </Button>
              )}
              <Button 
                type="submit" 
                disabled={loading || pin.length !== 4}
                className="bg-[#e5c17b] text-[#2b2318] hover:bg-[#e5c17b]/90 min-w-[100px]"
              >
                {loading ? <Loader2 className="animate-spin h-4 w-4" /> : 'Simpan PIN'}
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
