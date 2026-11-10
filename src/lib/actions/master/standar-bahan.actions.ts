'use server';

import { createClient } from '@/lib/supabase/server';
import { getCurrentUserProfile, permissions } from '@/lib/auth/permissions';
import { revalidatePath } from 'next/cache';

const TENANT_ID = 'STX-001';

export interface StandarBahanRow {
  size: string;
  rate_per_pcs: number | null;
  sumber: 'riwayat' | 'manual' | 'hpp' | null;
}

const URUTAN_SIZE = ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL', '4XL', '5XL', '6XL'];
const urut = (s: string) => {
  const i = URUTAN_SIZE.indexOf(s.toUpperCase());
  return i === -1 ? 100 : i;
};

/** Semua ukuran yang dipakai produk model ini + standar pemakaian bahannya. */
export async function getStandarBahan(modelId: string): Promise<{ rows: StandarBahanRow[]; jenis_bahan: string | null }> {
  const supabase = await createClient();
  const [produkRes, standarRes, modelRes] = await Promise.all([
    supabase.from('produk').select('size:size_id ( nama )').eq('model_id', modelId).eq('tenant_id', TENANT_ID),
    supabase.from('standar_pemakaian_bahan').select('size, rate_per_pcs, sumber').eq('model_id', modelId).eq('tenant_id', TENANT_ID),
    supabase.from('model_produk').select('kategori:kategori_id ( jenis_bahan )').eq('id', modelId).single(),
  ]);
  if (produkRes.error) throw new Error(produkRes.error.message);
  if (standarRes.error) throw new Error(standarRes.error.message);

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const sizes = new Set<string>();
  for (const p of produkRes.data ?? []) {
    const s = Array.isArray((p as any).size) ? (p as any).size[0] : (p as any).size;
    if (s?.nama) sizes.add(s.nama);
  }
  const std = new Map((standarRes.data ?? []).map((s: any) => [s.size as string, s]));
  for (const s of std.keys()) sizes.add(s);

  const kategori = (modelRes.data as any)?.kategori;
  const jenis_bahan = (Array.isArray(kategori) ? kategori[0] : kategori)?.jenis_bahan ?? null;

  const rows = [...sizes].sort((a, b) => urut(a) - urut(b) || a.localeCompare(b)).map(size => {
    const s = std.get(size) as any;
    return { size, rate_per_pcs: s ? Number(s.rate_per_pcs) : null, sumber: s?.sumber ?? null };
  });
  return { rows, jenis_bahan };
}

/** Simpan standar; angka kosong = hapus standar ukuran itu. Hanya owner. */
export async function saveStandarBahan(modelId: string, rows: { size: string; rate_per_pcs: number | null }[]) {
  const profile = await getCurrentUserProfile();
  if (!profile || !permissions.canEditMasterData(profile.role)) {
    throw new Error('Hanya owner yang dapat mengubah standar pemakaian bahan');
  }
  for (const r of rows) {
    if (r.rate_per_pcs != null && !(r.rate_per_pcs > 0 && r.rate_per_pcs <= 5)) {
      throw new Error(`Pemakaian ukuran ${r.size} harus antara 0 dan 5`);
    }
  }

  const supabase = await createClient();
  const isi = rows.filter(r => r.rate_per_pcs != null);
  const kosong = rows.filter(r => r.rate_per_pcs == null).map(r => r.size);

  if (isi.length) {
    const { data: lama } = await supabase.from('standar_pemakaian_bahan')
      .select('size, rate_per_pcs').eq('model_id', modelId).eq('tenant_id', TENANT_ID);
    const lamaMap = new Map((lama ?? []).map(l => [l.size, Number(l.rate_per_pcs)]));
    const berubah = isi.filter(r => lamaMap.get(r.size) !== r.rate_per_pcs);
    if (berubah.length) {
      const { error } = await supabase.from('standar_pemakaian_bahan').upsert(
        berubah.map(r => ({
          tenant_id: TENANT_ID, model_id: modelId, size: r.size, rate_per_pcs: r.rate_per_pcs,
          sumber: 'manual', updated_at: new Date().toISOString(), updated_by: profile.id,
        })),
        { onConflict: 'tenant_id,model_id,size' });
      if (error) throw new Error(error.message);
    }
  }
  if (kosong.length) {
    const { error } = await supabase.from('standar_pemakaian_bahan')
      .delete().eq('model_id', modelId).eq('tenant_id', TENANT_ID).in('size', kosong);
    if (error) throw new Error(error.message);
  }
  revalidatePath(`/app/master/model/${modelId}`);
  return { success: true };
}
