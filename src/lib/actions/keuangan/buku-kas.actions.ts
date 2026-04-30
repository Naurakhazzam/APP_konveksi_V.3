'use server';

import { createClient } from '@/lib/supabase/server';
import { getCurrentUserProfile } from '@/lib/auth/permissions';
import { revalidatePath } from 'next/cache';
import type { BukuKasEntry, AddBukuKasInput, HppKomponenOption } from './buku-kas.types';

export type { BukuKasEntry, AddBukuKasInput, HppKomponenOption } from './buku-kas.types';

const TENANT_ID = 'STX-001';

export async function getBukuKasEntries(filters?: {
  bulan?: string;
  tahun?: string;
  tipe?: string;
}): Promise<BukuKasEntry[]> {
  const supabase = await createClient();

  let query = supabase
    .from('buku_kas')
    .select('id, tanggal, tipe, kategori, nominal, keterangan, no_referensi, po_id, komponen_id, created_at, po:po_id(no_po)')
    .eq('tenant_id', TENANT_ID)
    .order('tanggal', { ascending: false })
    .order('created_at', { ascending: false });

  if (filters?.tipe) query = query.eq('tipe', filters.tipe);

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
    tanggal: item.tanggal,
    tipe: item.tipe,
    kategori: item.kategori,
    nominal: Number(item.nominal),
    keterangan: item.keterangan,
    no_referensi: item.no_referensi ?? null,
    po_id: item.po_id ?? null,
    po_no: (Array.isArray(item.po) ? item.po[0]?.no_po : item.po?.no_po) ?? null,
    komponen_id: item.komponen_id ?? null,
    created_at: item.created_at,
  }));
}

export async function addBukuKas(
  input: AddBukuKasInput
): Promise<{ success: boolean; error?: string }> {
  const profile = await getCurrentUserProfile();
  if (!profile) return { success: false, error: 'Unauthorized.' };

  if (!input.nominal || input.nominal <= 0)
    return { success: false, error: 'Nominal harus lebih dari 0.' };
  if (!input.tanggal)
    return { success: false, error: 'Tanggal tidak boleh kosong.' };
  if (!input.keterangan?.trim())
    return { success: false, error: 'Keterangan tidak boleh kosong.' };
  if (!input.kategori)
    return { success: false, error: 'Kategori tidak boleh kosong.' };

  const supabase = await createClient();
  const { error } = await supabase.from('buku_kas').insert({
    tanggal:      input.tanggal,
    tipe:         input.tipe,
    kategori:     input.kategori,
    nominal:      input.nominal,
    keterangan:   input.keterangan.trim(),
    no_referensi: input.no_referensi ?? null,
    po_id:        input.po_id ?? null,
    komponen_id:  input.komponen_id ?? null,
    tenant_id:    TENANT_ID,
    created_by:   profile.id,
  });

  if (error) return { success: false, error: error.message };

  revalidatePath('/app/keuangan/buku-kas');
  return { success: true };
}

export async function deleteBukuKas(
  id: string
): Promise<{ success: boolean; error?: string }> {
  const profile = await getCurrentUserProfile();
  if (!profile) return { success: false, error: 'Unauthorized.' };
  if (profile.role !== 'owner')
    return { success: false, error: 'Hanya owner yang dapat menghapus.' };

  const supabase = await createClient();
  const { error } = await supabase
    .from('buku_kas')
    .delete()
    .eq('id', id)
    .eq('tenant_id', TENANT_ID);

  if (error) return { success: false, error: error.message };

  revalidatePath('/app/keuangan/buku-kas');
  return { success: true };
}

export async function getPOListForKas(): Promise<{ id: string; no_po: string }[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('po')
    .select('id, no_po')
    .eq('tenant_id', TENANT_ID)
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function getHppKomponenOverhead(): Promise<HppKomponenOption[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('hpp_komponen')
    .select('id, nama')
    .eq('kategori', 'overhead')
    .eq('tenant_id', TENANT_ID)
    .order('nama');
  if (error) throw new Error(error.message);
  return data ?? [];
}
