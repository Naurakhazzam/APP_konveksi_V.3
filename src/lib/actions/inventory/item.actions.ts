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
