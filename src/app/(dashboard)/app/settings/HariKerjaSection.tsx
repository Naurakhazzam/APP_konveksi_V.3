'use client';

import { useState } from 'react';
import { CalendarDays } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { updateHariKerjaSeminggu } from '@/lib/actions/settings/settings.actions';

interface Props {
  currentValue: number;
}

export default function HariKerjaSection({ currentValue }: Props) {
  const [value, setValue]   = useState(currentValue);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (value < 1 || value > 7) {
      toast.error('Hari kerja harus antara 1 dan 7');
      return;
    }
    setSaving(true);
    try {
      await updateHariKerjaSeminggu(value);
      toast.success('Pengaturan hari kerja disimpan');
    } catch (err: any) {
      toast.error(err.message || 'Gagal menyimpan');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-[#1A1D1F] border border-[#2A2D31] rounded-2xl p-6 space-y-4">
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-xl bg-[#e5c17b]/10 flex items-center justify-center">
          <CalendarDays size={20} className="text-[#e5c17b]" />
        </div>
        <div>
          <h3 className="font-semibold text-[#e8eaed]">Hari Kerja per Minggu</h3>
          <p className="text-xs text-[#9aa0a6] mt-0.5">
            Dipakai sebagai pembagi perhitungan gaji pokok prorata saat proses bayar gaji.
          </p>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          {[5, 6, 7].map(n => (
            <button
              key={n}
              onClick={() => setValue(n)}
              className={`h-10 w-10 rounded-xl text-sm font-bold border transition-colors ${
                value === n
                  ? 'bg-[#e5c17b] text-[#0D0E10] border-[#e5c17b]'
                  : 'bg-[#16181A] text-[#9aa0a6] border-[#2A2D31] hover:border-[#e5c17b]/50 hover:text-[#e8eaed]'
              }`}
            >
              {n}
            </button>
          ))}
          <input
            type="number"
            min={1}
            max={7}
            value={value}
            onChange={e => setValue(Number(e.target.value))}
            className="h-10 w-16 rounded-xl bg-[#16181A] border border-[#2A2D31] text-center text-sm text-[#e8eaed] focus:border-[#e5c17b] focus:outline-none"
          />
          <span className="text-sm text-[#9aa0a6]">hari / minggu</span>
        </div>

        <Button
          onClick={handleSave}
          disabled={saving || value === currentValue}
          className="ml-auto bg-[#e5c17b] hover:bg-[#d4b06a] text-[#0D0E10] font-semibold h-10 px-5"
        >
          {saving ? 'Menyimpan...' : 'Simpan'}
        </Button>
      </div>

      <p className="text-xs text-[#9aa0a6] bg-[#16181A] rounded-xl px-4 py-3 border border-[#2A2D31]">
        Contoh: karyawan gaji pokok Rp 1.800.000 / minggu, bekerja <strong className="text-[#e8eaed]">{value} hari</strong> sehari penuh →
        gapok prorata per hari = Rp {Math.round(1800000 / value).toLocaleString('id-ID')}
      </p>
    </div>
  );
}
