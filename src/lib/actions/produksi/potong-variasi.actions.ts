'use server';

/**
 * Potong Variasi (Nov 2026)
 * Drill variasi Zubair/Arslan biasanya dari celah pola Celana Arslan (tidak dicatat).
 * Bila Drill harus dipotong MANDIRI, catat di sini: stok Drill (bahan utama) berkurang FIFO
 * dan nilainya masuk saldo bahan pembantu "Variasi" (tanpa Buku Kas, Drill sudah dibayar).
 */

import { createClient } from '@/lib/supabase/server';
import { getUserFromClaims } from '@/lib/auth/session';
import { revalidatePath } from 'next/cache';
import { assertCanEditProduksi } from '@/lib/auth/permissions';
import { MODEL_VARIASI } from '@/lib/produksi/variasi';

const TENANT_ID = 'STX-001';
const PATH = '/app/produksi/antrian-cutting';

/* eslint-disable @typescript-eslint/no-explicit-any */


async function resolveUserId() {
  const supabase = await createClient();
  const { data: { user }, error } = await getUserFromClaims(supabase);
  if (error || !user) throw new Error('Unauthorized');
  return user.id;
}

export interface BahanVariasiOption {
  id: string;
  nama: string;
  satuan: string;
  stok_aktual: number;
  harga_referensi: number;
  /** LOT bersisa, urut FIFO — untuk perkiraan biaya */
  lot: { qty_sisa: number; harga_satuan: number }[];
}

export interface RiwayatPotongVariasi {
  id: string;
  tanggal: string;
  bahan_nama: string;
  satuan: string;
  qty_pakai: number;
  biaya_total: number;
  habis_roll: boolean;
  untuk_model: string | null;
  per_size: Record<string, number> | null;
  catatan: string | null;
  dibatalkan_at: string | null;
}

export interface VariasiData {
  bahan: BahanVariasiOption[];
  riwayat: RiwayatPotongVariasi[];
}

export async function getVariasiData(): Promise<VariasiData> {
  const supabase = await createClient();
  const [bahanRes, riwayatRes] = await Promise.all([
    supabase.from('inventory_item').select('id, nama, satuan, stok_aktual, harga_referensi, jenis, aktif')
      .eq('tenant_id', TENANT_ID).ilike('nama', 'drill%').order('nama'),
    supabase.from('potong_variasi')
      .select('id, tanggal, qty_pakai, biaya_total, habis_roll, untuk_model, per_size, catatan, dibatalkan_at, bahan:bahan_item_id ( nama, satuan )')
      // Yang sudah dibatalkan disembunyikan (jejaknya tetap di audit_log)
      .eq('tenant_id', TENANT_ID).is('dibatalkan_at', null).order('created_at', { ascending: false }).limit(50),
  ]);
  if (bahanRes.error) throw new Error(bahanRes.error.message);
  if (riwayatRes.error) throw new Error(riwayatRes.error.message);

  const bahanRows = (bahanRes.data ?? []).filter((b: any) => b.jenis !== 'pembantu' && b.aktif !== false);
  const ids = bahanRows.map((b: any) => b.id as string);
  const lotRes = ids.length
    ? await supabase.from('inventory_batch').select('inventory_item_id, qty_sisa, harga_satuan')
        .eq('tenant_id', TENANT_ID).in('inventory_item_id', ids).gt('qty_sisa', 0)
        .order('tanggal_masuk', { ascending: true }).order('created_at', { ascending: true })
    : { data: [], error: null };
  if (lotRes.error) throw new Error(lotRes.error.message);

  return {
    bahan: bahanRows
      .map((b: any) => ({
        id: b.id, nama: b.nama, satuan: b.satuan, stok_aktual: Number(b.stok_aktual),
        harga_referensi: Number(b.harga_referensi ?? 0),
        lot: (lotRes.data ?? []).filter((l: any) => l.inventory_item_id === b.id)
          .map((l: any) => ({ qty_sisa: Number(l.qty_sisa), harga_satuan: Number(l.harga_satuan) })),
      }))
      // Drill Hitam paling atas (paling sering), lalu yang ada stoknya
      .sort((a, b) => Number(/hitam/i.test(b.nama)) - Number(/hitam/i.test(a.nama))
        || Number(b.stok_aktual > 0) - Number(a.stok_aktual > 0) || a.nama.localeCompare(b.nama)),
    riwayat: (riwayatRes.data ?? []).map((r: any) => {
      const bahan = Array.isArray(r.bahan) ? r.bahan[0] : r.bahan;
      return {
        id: r.id,
        tanggal: r.tanggal,
        bahan_nama: bahan?.nama ?? '-',
        satuan: bahan?.satuan ?? '',
        qty_pakai: Number(r.qty_pakai),
        biaya_total: Number(r.biaya_total),
        habis_roll: !!r.habis_roll,
        untuk_model: r.untuk_model ?? null,
        per_size: r.per_size ?? null,
        catatan: r.catatan ?? null,
        dibatalkan_at: r.dibatalkan_at ?? null,
      };
    }),
  };
}

export async function potongVariasi(input: {
  bahan_item_id: string; qty: number; habis_roll: boolean; untuk_model: string;
  per_size: Record<string, number>; catatan?: string;
}): Promise<{ success: boolean; biaya_total?: number; error?: string }> {
  await assertCanEditProduksi();
  try {
    if (!(MODEL_VARIASI as readonly string[]).includes(input.untuk_model)) {
      return { success: false, error: 'Pilih variasi untuk model apa' };
    }
    const user_id = await resolveUserId();
    const supabase = await createClient();
    const { data, error } = await supabase.rpc('potong_variasi', {
      p_bahan_item_id: input.bahan_item_id,
      p_qty: input.qty,
      p_habis_roll: input.habis_roll,
      p_untuk_model: input.untuk_model,
      p_per_size: input.per_size,
      p_catatan: input.catatan ?? null,
      p_user_id: user_id,
      p_tenant_id: TENANT_ID,
    });
    if (error) return { success: false, error: error.message };
    revalidatePath(PATH);
    revalidatePath('/app/keuangan/saldo-pembantu');
    return { success: true, biaya_total: Number(data?.biaya_total ?? 0) };
  } catch (e: any) {
    return { success: false, error: e?.message ?? 'Terjadi kesalahan' };
  }
}

export async function batalPotongVariasi(id: string, alasan: string): Promise<{ success: boolean; error?: string }> {
  await assertCanEditProduksi();
  try {
    if (!alasan.trim()) return { success: false, error: 'Alasan wajib diisi' };
    const user_id = await resolveUserId();
    const supabase = await createClient();
    const { error } = await supabase.rpc('batal_potong_variasi', {
      p_id: id, p_alasan: alasan.trim(), p_user_id: user_id, p_tenant_id: TENANT_ID,
    });
    if (error) return { success: false, error: error.message };
    revalidatePath(PATH);
    revalidatePath('/app/keuangan/saldo-pembantu');
    return { success: true };
  } catch (e: any) {
    return { success: false, error: e?.message ?? 'Terjadi kesalahan' };
  }
}
