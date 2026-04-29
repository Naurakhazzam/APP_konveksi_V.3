'use server';

import { createClient } from '@/lib/supabase/server';

const TENANT_ID = 'STX-001';

export interface InventoryItem {
  id: string;
  nama: string;
  satuan: string;
  stokAktual: number;
}

export async function getInventoryItems(): Promise<InventoryItem[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('inventory_item')
    .select('id, nama, satuan, stok_aktual')
    .eq('tenant_id', TENANT_ID)
    .order('nama');

  if (error) throw new Error(error.message);

  return (data || []).map(item => ({
    id: item.id,
    nama: item.nama,
    satuan: item.satuan,
    stokAktual: Number(item.stok_aktual || 0),
  }));
}

// ─── Harga Referensi ────────────────────────────────────────────

export interface HargaReferensiItem {
  id             : string;
  nama           : string;
  satuan         : string;
  stok_aktual    : number;
  harga_referensi: number;
}

export async function getHargaReferensiItems(): Promise<HargaReferensiItem[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('inventory_item')
    .select('id, nama, satuan, stok_aktual, harga_referensi')
    .eq('tenant_id', TENANT_ID)
    .order('nama');

  if (error) throw new Error(error.message);

  return (data || []).map(item => ({
    id             : item.id,
    nama           : item.nama,
    satuan         : item.satuan,
    stok_aktual    : Number(item.stok_aktual    || 0),
    harga_referensi: Number(item.harga_referensi || 0),
  }));
}

export async function updateHargaReferensi(
  id    : string,
  harga : number
): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from('inventory_item')
    .update({ harga_referensi: harga })
    .eq('id', id)
    .eq('tenant_id', TENANT_ID);

  if (error) throw new Error(error.message);
}
