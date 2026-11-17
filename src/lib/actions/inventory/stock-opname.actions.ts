'use server';

/**
 * Stock Opname (Nov 2026)
 * Bahan pembantu (benang, mata itik, stoper, kancing, karet, dll.) tidak dipotong
 * otomatis per bundle. Pemakaiannya dihitung dari hitung fisik berkala:
 *   terpakai = stok sistem − stok fisik, dinilai FIFO dari LOT Stok Masuk.
 */

import { createClient } from '@/lib/supabase/server';
import { getUserFromClaims } from '@/lib/auth/session';
import { revalidatePath } from 'next/cache';

const TENANT_ID = 'STX-001';
const PATH = '/app/inventory/stock-opname';

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface OpnameItem {
  id: string;
  nama: string;
  satuan: string;
  jenis: 'utama' | 'pembantu';
  stok_aktual: number;
  harga_referensi: number;
  /** Opname terakhir */
  terakhir: string | null;
}

export interface OpnameRiwayat {
  id: string;
  tanggal: string;
  nama: string;
  satuan: string;
  stok_sistem: number;
  stok_fisik: number;
  selisih: number;
  nilai_selisih: number;
  catatan: string | null;
}

export async function getOpnameData(): Promise<{ items: OpnameItem[]; riwayat: OpnameRiwayat[] }> {
  const supabase = await createClient();
  const [itemRes, riwayatRes] = await Promise.all([
    supabase.from('inventory_item').select('id, nama, satuan, jenis, stok_aktual, harga_referensi')
      .eq('tenant_id', TENANT_ID).eq('aktif', true).order('nama'),
    supabase.from('stock_opname')
      .select('id, tanggal, inventory_item_id, stok_sistem, stok_fisik, selisih, nilai_selisih, catatan, item:inventory_item_id ( nama, satuan )')
      .eq('tenant_id', TENANT_ID).order('created_at', { ascending: false }).limit(300),
  ]);
  if (itemRes.error) throw new Error(itemRes.error.message);
  if (riwayatRes.error) throw new Error(riwayatRes.error.message);

  const terakhir = new Map<string, string>();
  (riwayatRes.data ?? []).forEach((r: any) => {
    if (!terakhir.has(r.inventory_item_id)) terakhir.set(r.inventory_item_id, r.tanggal);
  });

  return {
    items: (itemRes.data ?? []).map((i: any) => ({
      id: i.id, nama: i.nama, satuan: i.satuan, jenis: (i.jenis ?? 'utama'),
      stok_aktual: Number(i.stok_aktual), harga_referensi: Number(i.harga_referensi ?? 0),
      terakhir: terakhir.get(i.id) ?? null,
    })),
    riwayat: (riwayatRes.data ?? []).map((r: any) => {
      const item = Array.isArray(r.item) ? r.item[0] : r.item;
      return {
        id: r.id, tanggal: r.tanggal, nama: item?.nama ?? '-', satuan: item?.satuan ?? '',
        stok_sistem: Number(r.stok_sistem), stok_fisik: Number(r.stok_fisik),
        selisih: Number(r.selisih), nilai_selisih: Number(r.nilai_selisih), catatan: r.catatan ?? null,
      };
    }),
  };
}

export async function simpanStockOpname(
  /** harga: harga beli per satuan untuk stok LEBIH (barang lama → setoran modal); opsional bila barang sudah punya harga */
  items: { inventory_item_id: string; stok_fisik: number; harga?: number | null }[],
  tanggal: string,
  catatan: string,
): Promise<{ success: boolean; jumlah?: number; nilai_selisih?: number; error?: string }> {
  try {
    if (!items.length) return { success: false, error: 'Isi stok fisik minimal satu barang' };
    const supabase = await createClient();
    const { data: { user }, error: authErr } = await getUserFromClaims(supabase);
    if (authErr || !user) return { success: false, error: 'Unauthorized' };
    const { data, error } = await supabase.rpc('simpan_stock_opname', {
      p_items: items, p_tanggal: tanggal, p_catatan: catatan || null, p_user_id: user.id, p_tenant_id: TENANT_ID,
    });
    if (error) return { success: false, error: error.message };
    revalidatePath(PATH);
    revalidatePath('/app/inventory/overview');
    revalidatePath('/app/keuangan/buku-kas');
    revalidatePath('/app/keuangan/proyeksi-surplus');
    return { success: true, jumlah: Number(data?.jumlah ?? 0), nilai_selisih: Number(data?.nilai_selisih ?? 0) };
  } catch (e: any) {
    return { success: false, error: e?.message ?? 'Terjadi kesalahan' };
  }
}
