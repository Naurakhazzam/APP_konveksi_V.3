'use client';

import React, { useEffect, useState } from 'react';
import { Loader2, Save, Info } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  getStandarBahan, saveStandarBahan, type StandarBahanRow,
} from '@/lib/actions/master/standar-bahan.actions';

/**
 * Standar pemakaian bahan utama per ukuran (yard/meter/kg per pcs).
 * Dipakai untuk mengisi otomatis angka pemakaian saat Selesai Cutting.
 */
export default function StandarBahanTab({ modelId }: { modelId: string }) {
  const [rows, setRows] = useState<StandarBahanRow[]>([]);
  const [nilai, setNilai] = useState<Record<string, string>>({});
  const [jenisBahan, setJenisBahan] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let batal = false;
    getStandarBahan(modelId)
      .then(res => {
        if (batal) return;
        setRows(res.rows);
        setJenisBahan(res.jenis_bahan);
        setNilai(Object.fromEntries(res.rows.map(r => [r.size, r.rate_per_pcs != null ? String(r.rate_per_pcs) : ''])));
      })
      .catch(e => toast.error('Gagal memuat standar: ' + e.message))
      .finally(() => { if (!batal) setLoading(false); });
    return () => { batal = true; };
  }, [modelId]);

  const simpan = async () => {
    setSaving(true);
    try {
      await saveStandarBahan(modelId, rows.map(r => {
        const v = nilai[r.size]?.trim();
        return { size: r.size, rate_per_pcs: v ? Number(v.replace(',', '.')) : null };
      }));
      toast.success('Standar pemakaian bahan disimpan');
      const res = await getStandarBahan(modelId);
      setRows(res.rows);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Gagal menyimpan');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="flex items-center gap-2 text-[#9aa0a6] text-sm py-10 justify-center"><Loader2 className="w-4 h-4 animate-spin" /> Memuat...</div>;
  }

  return (
    <div className="rounded-xl border border-[#2A2D31] bg-[#1A1D1F] p-5 space-y-4 max-w-xl">
      <div className="flex items-start gap-2 text-xs text-[#9aa0a6]">
        <Info className="w-4 h-4 text-[#e5c17b] shrink-0 mt-0.5" />
        <p>
          Pemakaian bahan utama per pcs, per ukuran. Saat <b className="text-[#e8eaed]">Selesai Cutting</b>, angka ini terisi otomatis
          (masih bisa diubah). Bahan utama kategori: <b className="text-[#e8eaed]">{jenisBahan ?? 'belum diatur'}</b>
          {!jenisBahan && <> — atur di Master Detail → Kategori.</>}
          {' '}Kosongkan angka untuk menghapus standar ukuran itu.
        </p>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-[#9aa0a6]">Model ini belum punya produk/ukuran.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[10px] uppercase tracking-widest text-[#9aa0a6] border-b border-[#2A2D31]">
              <th className="text-left py-2">Ukuran</th>
              <th className="text-left py-2">Pemakaian / pcs</th>
              <th className="text-left py-2">Asal</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.size} className="border-b border-[#2A2D31]/50">
                <td className="py-2 font-semibold text-[#e8eaed]">{r.size}</td>
                <td className="py-2">
                  <input
                    inputMode="decimal" placeholder="belum ada"
                    value={nilai[r.size] ?? ''}
                    onChange={e => setNilai(p => ({ ...p, [r.size]: e.target.value }))}
                    className="h-8 w-28 rounded-md border border-[#2A2D31] bg-[#0D0E10] px-2 text-sm text-[#e8eaed] focus:outline-none focus:ring-1 focus:ring-[#e5c17b]"
                  />
                </td>
                <td className="py-2 text-xs text-[#9aa0a6]">
                  {r.sumber === 'riwayat' ? 'dari riwayat cutting' : r.sumber === 'manual' ? 'diisi manual' : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="flex justify-end">
        <Button onClick={simpan} disabled={saving || rows.length === 0}
          className="bg-[#e5c17b] text-[#2b2318] hover:bg-[#e5c17b]/90 gap-2">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Simpan
        </Button>
      </div>
    </div>
  );
}
