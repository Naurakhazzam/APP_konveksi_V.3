'use server';

import { createClient } from '@/lib/supabase/server';
import { getCurrentUserProfile } from '@/lib/auth/permissions';

const TENANT_ID = 'STX-001';

export interface ModelAksesori {
  id: string;
  model_id: string;
  inventory_item_id: string;
  inventory_item_nama: string;
  satuan: string;
  qty_per_pcs: number;
  tahap_pakai: string;
}

export interface AddModelAksesoriInput {
  model_id: string;
  inventory_item_id: string;
  qty_per_pcs: number;
  tahap_pakai: string;
}

/** 1. Ambil kebutuhan aksesori per model */
export async function getModelAksesori(model_id: string): Promise<ModelAksesori[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('model_aksesori')
    .select(`
      id,
      model_id,
      inventory_item_id,
      qty_per_pcs,
      tahap_pakai,
      inventory_item:inventory_item_id (nama, satuan)
    `)
    .eq('model_id', model_id)
    .eq('tenant_id', TENANT_ID)
    .order('tahap_pakai');

  if (error) throw new Error(error.message);

  return (data ?? []).map((item: any) => ({
    id: item.id,
    model_id: item.model_id,
    inventory_item_id: item.inventory_item_id,
    inventory_item_nama: item.inventory_item?.nama ?? '',
    satuan: item.inventory_item?.satuan ?? '',
    qty_per_pcs: Number(item.qty_per_pcs),
    tahap_pakai: item.tahap_pakai,
  }));
}

/** 2. Tambah kebutuhan aksesori ke model */
export async function addModelAksesori(input: AddModelAksesoriInput): Promise<void> {
  const profile = await getCurrentUserProfile();
  if (!profile) throw new Error('Unauthorized');

  const supabase = await createClient();

  const { error } = await supabase
    .from('model_aksesori')
    .insert({
      ...input,
      tenant_id: TENANT_ID,
      created_by: profile.id
    });

  if (error) throw new Error(error.message);
}

/** 3. Hapus kebutuhan aksesori */
export async function deleteModelAksesori(id: string): Promise<void> {
  const supabase = await createClient();

  const { error } = await supabase
    .from('model_aksesori')
    .delete()
    .eq('id', id)
    .eq('tenant_id', TENANT_ID);

  if (error) throw new Error(error.message);
}
