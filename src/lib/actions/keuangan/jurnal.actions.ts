'use server';

import { createClient } from '@/lib/supabase/server';
import { getCurrentUserProfile } from '@/lib/auth/permissions';
import { revalidatePath } from 'next/cache';

const TENANT_ID = 'STX-001';

// ─── TYPES ─────────────────────────────────────────────────────────────────

export interface JurnalEntry {
  id: string;
  kategori_trx_id: string;
  kategori_nama: string;
  jenis: string;
  nominal: number;
  tanggal: string;
  no_faktur: string | null;
  keterangan: string;
  qty: number | null;
  inventory_item_id: string | null;
  tag_po_ids: string[];
  created_at: string;
}

export interface KategoriTrxItem {
  id: string;
  nama: string;
  jenis: string; // untuk filter kategori per jenis di UI
}

export interface AddJurnalEntryInput {
  kategori_trx_id: string;
  jenis: string;
  nominal: number;
  tanggal: string;
  no_faktur?: string;
  keterangan: string;
  qty?: number;
  inventory_item_id?: string;
  tag_po_ids?: string[];
}

// ─── FUNCTIONS ─────────────────────────────────────────────────────────────

/**
 * Ambil jurnal entries dengan filter opsional bulan, tahun, dan jenis.
 */
export async function getJurnalEntries(filters?: {
  bulan?: string;
  tahun?: string;
  jenis?: string;
}): Promise<JurnalEntry[]> {
  const supabase = await createClient();

  let query = supabase
    .from('jurnal_entry')
    .select(`
      id,
      kategori_trx_id,
      jenis,
      nominal,
      tanggal,
      no_faktur,
      keterangan,
      qty,
      inventory_item_id,
      tag_po_ids,
      created_at,
      kategori_trx:kategori_trx_id (nama)
    `)
    .eq('tenant_id', TENANT_ID)
    .order('tanggal', { ascending: false })
    .order('created_at', { ascending: false });

  if (filters?.jenis) {
    query = query.eq('jenis', filters.jenis);
  }

  if (filters?.tahun) {
    const year = filters.tahun;
    if (filters?.bulan) {
      const month = filters.bulan.padStart(2, '0');
      const lastDay = new Date(Number(year), Number(month), 0).getDate();
      query = query
        .gte('tanggal', `${year}-${month}-01`)
        .lte('tanggal', `${year}-${month}-${String(lastDay).padStart(2, '0')}`);
    } else {
      query = query
        .gte('tanggal', `${year}-01-01`)
        .lte('tanggal', `${year}-12-31`);
    }
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  return (data ?? []).map((item: any) => ({
    id: item.id,
    kategori_trx_id: item.kategori_trx_id,
    kategori_nama: (Array.isArray(item.kategori_trx)
      ? item.kategori_trx[0]?.nama
      : (item.kategori_trx as any)?.nama) ?? '-',
    jenis: item.jenis,
    nominal: Number(item.nominal),
    tanggal: item.tanggal,
    no_faktur: item.no_faktur ?? null,
    keterangan: item.keterangan,
    qty: item.qty != null ? Number(item.qty) : null,
    inventory_item_id: item.inventory_item_id ?? null,
    tag_po_ids: Array.isArray(item.tag_po_ids) ? item.tag_po_ids : [],
    created_at: item.created_at,
  }));
}

/**
 * Ambil list kategori transaksi.
 */
export async function getKategoriTrxList(): Promise<KategoriTrxItem[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('kategori_trx')
    .select('id, nama, jenis')
    .eq('tenant_id', TENANT_ID)
    .order('nama');

  if (error) throw new Error(error.message);

  return (data ?? []).map((item: any) => ({
    id: item.id,
    nama: item.nama,
    jenis: item.jenis ?? '',
  }));
}

/**
 * Tambah jurnal entry baru.
 * Return { success, error? } — tidak throw.
 */
export async function addJurnalEntry(
  input: AddJurnalEntryInput
): Promise<{ success: boolean; error?: string }> {
  // A1 — Block direct_upah dari input manual
  if (input.jenis === 'direct_upah') {
    return {
      success: false,
      error: 'Jenis direct_upah tidak dapat diinput manual. Gunakan fitur Rekap Gaji.',
    };
  }

  // Validasi dasar
  if (!input.nominal || input.nominal <= 0) {
    return { success: false, error: 'Nominal harus lebih dari 0.' };
  }
  if (!input.tanggal) {
    return { success: false, error: 'Tanggal tidak boleh kosong.' };
  }
  if (!input.keterangan?.trim()) {
    return { success: false, error: 'Keterangan tidak boleh kosong.' };
  }

  // Validasi khusus direct_bahan
  if (input.jenis === 'direct_bahan') {
    if (!input.no_faktur?.trim()) {
      return { success: false, error: 'No. Faktur wajib diisi untuk jenis direct_bahan.' };
    }
    if (input.qty == null || input.qty <= 0) {
      return { success: false, error: 'Qty wajib diisi untuk jenis direct_bahan.' };
    }

    if (!input.tag_po_ids || input.tag_po_ids.length === 0) {
      return { success: false, error: 'Wajib pilih minimal 1 PO untuk pembelian bahan.' };
    }
  }

  const profile = await getCurrentUserProfile();
  if (!profile) {
    return { success: false, error: 'Unauthorized.' };
  }

  const supabase = await createClient();

  const { error } = await supabase
    .from('jurnal_entry')
    .insert({
      kategori_trx_id: input.kategori_trx_id,
      jenis: input.jenis,
      nominal: input.nominal,
      tanggal: input.tanggal,
      no_faktur: input.no_faktur ?? null,
      keterangan: input.keterangan.trim(),
      qty: input.qty ?? null,
      inventory_item_id: input.inventory_item_id ?? null,
      tag_po_ids: input.tag_po_ids ?? [],
      tenant_id: TENANT_ID,
      created_by: profile.id,
    });

  if (error) return { success: false, error: error.message };

  revalidatePath('/app/keuangan/jurnal-umum');
  return { success: true };
}

/**
 * Hapus jurnal entry (hanya owner).
 * Return { success, error? } — tidak throw.
 */
export async function deleteJurnalEntry(
  id: string
): Promise<{ success: boolean; error?: string }> {
  const profile = await getCurrentUserProfile();
  if (!profile) {
    return { success: false, error: 'Unauthorized.' };
  }
  if (profile.role !== 'owner') {
    return { success: false, error: 'Hanya owner yang dapat menghapus jurnal entry.' };
  }

  // A1 — Guard: direct_upah tidak boleh dihapus manual
  const supabaseCheck = await createClient();
  const { data: existing } = await supabaseCheck
    .from('jurnal_entry')
    .select('jenis')
    .eq('id', id)
    .single();
  if (existing?.jenis === 'direct_upah') {
    return { success: false, error: 'Entry upah otomatis tidak dapat dihapus manual.' };
  }

  const supabase = await createClient();

  const { error } = await supabase
    .from('jurnal_entry')
    .delete()
    .eq('id', id)
    .eq('tenant_id', TENANT_ID);

  if (error) return { success: false, error: error.message };

  revalidatePath('/app/keuangan/jurnal-umum');
  return { success: true };
}

/**
 * Ambil list PO aktif.
 */
export async function getPOList(): Promise<{ id: string; no_po: string }[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('po')
    .select('id, no_po')
    .eq('tenant_id', TENANT_ID)
    .order('created_at', { ascending: false });

  if (error) throw new Error(error.message);

  return data ?? [];
}

