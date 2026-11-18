'use server';

/**
 * Potong Puring (Nov 2026)
 * Puring dibeli per kg ("Bahan Puring", via Stok Masuk) lalu dipotong jadi
 * lembaran ("Puring", pcs). Lembaran terpakai otomatis 1 per pcs saat bundle
 * jaket masuk jahit (model_aksesori). Biaya per lembar = harga beli kg yang
 * dipakai ÷ jumlah lembar.
 */

import { createClient } from '@/lib/supabase/server';
import { getUserFromClaims } from '@/lib/auth/session';
import { revalidatePath } from 'next/cache';
import { assertCanEditProduksi } from '@/lib/auth/permissions';

const TENANT_ID = 'STX-001';
const PATH = '/app/produksi/antrian-cutting';

/* eslint-disable @typescript-eslint/no-explicit-any */

async function resolveUserId() {
  const supabase = await createClient();
  const { data: { user }, error } = await getUserFromClaims(supabase);
  if (error || !user) throw new Error('Unauthorized');
  return user.id;
}

export interface BahanPuringOption {
  id: string;
  nama: string;
  satuan: string;
  stok_aktual: number;
  /** LOT bersisa, urut FIFO (paling lama dulu) — untuk perkiraan biaya */
  lot: { qty_sisa: number; harga_satuan: number }[];
  harga_referensi: number;
}

export interface RiwayatPotongPuring {
  id: string;
  tanggal: string;
  bahan_nama: string;
  kg_pakai: number;
  pcs_hasil: number;
  biaya_total: number;
  harga_per_pcs: number;
  habis_roll: boolean;
  catatan: string | null;
  /** Lembar per ukuran (data lama: null) */
  per_size: Record<string, number> | null;
  dibatalkan_at: string | null;
}

export interface PuringData {
  bahan: BahanPuringOption[];
  stok_puring: number;
  harga_puring: number;
  riwayat: RiwayatPotongPuring[];
}

export async function getPuringData(): Promise<PuringData> {
  const supabase = await createClient();
  const [bahanRes, puringRes, riwayatRes] = await Promise.all([
    supabase.from('inventory_item').select('id, nama, satuan, stok_aktual, harga_referensi')
      .eq('tenant_id', TENANT_ID).ilike('nama', '%puring%').neq('nama', 'Puring').order('nama'),
    supabase.from('inventory_item').select('stok_aktual, harga_referensi')
      .eq('tenant_id', TENANT_ID).eq('nama', 'Puring').maybeSingle(),
    supabase.from('potong_puring')
      .select('id, tanggal, kg_pakai, pcs_hasil, biaya_total, harga_per_pcs, habis_roll, catatan, per_size, dibatalkan_at, bahan:bahan_item_id ( nama )')
      .eq('tenant_id', TENANT_ID).order('created_at', { ascending: false }).limit(50),
  ]);
  if (bahanRes.error) throw new Error(bahanRes.error.message);
  if (riwayatRes.error) throw new Error(riwayatRes.error.message);

  const bahanIds = (bahanRes.data ?? []).map((b: any) => b.id as string);
  const lotRes = bahanIds.length
    ? await supabase.from('inventory_batch').select('inventory_item_id, qty_sisa, harga_satuan')
        .eq('tenant_id', TENANT_ID).in('inventory_item_id', bahanIds).gt('qty_sisa', 0)
        .order('tanggal_masuk', { ascending: true }).order('created_at', { ascending: true })
    : { data: [], error: null };
  if (lotRes.error) throw new Error(lotRes.error.message);

  return {
    bahan: (bahanRes.data ?? []).map((b: any) => ({
      id: b.id, nama: b.nama, satuan: b.satuan, stok_aktual: Number(b.stok_aktual),
      harga_referensi: Number(b.harga_referensi ?? 0),
      lot: (lotRes.data ?? []).filter((l: any) => l.inventory_item_id === b.id)
        .map((l: any) => ({ qty_sisa: Number(l.qty_sisa), harga_satuan: Number(l.harga_satuan) })),
    })),
    stok_puring: Number(puringRes.data?.stok_aktual ?? 0),
    harga_puring: Number(puringRes.data?.harga_referensi ?? 0),
    riwayat: (riwayatRes.data ?? []).map((r: any) => ({
      id: r.id,
      tanggal: r.tanggal,
      bahan_nama: (Array.isArray(r.bahan) ? r.bahan[0]?.nama : r.bahan?.nama) ?? '-',
      kg_pakai: Number(r.kg_pakai),
      pcs_hasil: Number(r.pcs_hasil),
      biaya_total: Number(r.biaya_total),
      harga_per_pcs: Number(r.harga_per_pcs),
      habis_roll: !!r.habis_roll,
      catatan: r.catatan ?? null,
      per_size: r.per_size ?? null,
      dibatalkan_at: r.dibatalkan_at ?? null,
    })),
  };
}

export async function potongPuring(input: {
  bahan_item_id: string; kg: number; pcs: number; habis_roll: boolean; catatan?: string;
  per_size?: Record<string, number>;
}): Promise<{ success: boolean; biaya_total?: number; harga_per_pcs?: number; qty_lunasi_tunggu?: number; error?: string }> {
  await assertCanEditProduksi();
  try {
    const user_id = await resolveUserId();
    const supabase = await createClient();
    const { data, error } = await supabase.rpc('potong_puring', {
      p_bahan_item_id: input.bahan_item_id,
      p_kg: input.kg,
      p_pcs: Math.round(input.pcs),
      p_habis_roll: input.habis_roll,
      p_catatan: input.catatan ?? null,
      p_user_id: user_id,
      p_tenant_id: TENANT_ID,
    });
    if (error) return { success: false, error: error.message };
    if (input.per_size && data?.id) {
      const { error: e2 } = await supabase.rpc('set_per_size_potong_puring', {
        p_id: data.id, p_per_size: input.per_size, p_tenant_id: TENANT_ID,
      });
      if (e2) console.error('set_per_size_potong_puring', e2.message);
    }
    revalidatePath(PATH);
    return { success: true, biaya_total: Number(data?.biaya_total ?? 0), harga_per_pcs: Number(data?.harga_per_pcs ?? 0), qty_lunasi_tunggu: Number(data?.qty_lunasi_tunggu ?? 0) };
  } catch (e: any) {
    return { success: false, error: e?.message ?? 'Terjadi kesalahan' };
  }
}

export async function batalPotongPuring(id: string, alasan: string): Promise<{ success: boolean; error?: string }> {
  await assertCanEditProduksi();
  try {
    if (!alasan.trim()) return { success: false, error: 'Alasan wajib diisi' };
    const user_id = await resolveUserId();
    const supabase = await createClient();
    const { error } = await supabase.rpc('batal_potong_puring', {
      p_id: id, p_alasan: alasan.trim(), p_user_id: user_id, p_tenant_id: TENANT_ID,
    });
    if (error) return { success: false, error: error.message };
    revalidatePath(PATH);
    return { success: true };
  } catch (e: any) {
    return { success: false, error: e?.message ?? 'Terjadi kesalahan' };
  }
}
