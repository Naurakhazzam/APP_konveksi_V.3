'use server';

import { createClient } from '@/lib/supabase/server';
import { getCurrentUserProfile } from '@/lib/auth/permissions';
import { CreatePoSchema, type CreatePoInput } from '@/lib/validations/po.schemas';

const TENANT_ID = 'STX-001';

// 8. createPoWithBundles()
export async function createPoWithBundles(data: CreatePoInput) {
  const profile = await getCurrentUserProfile();
  if (!profile) throw new Error('Unauthorized');

  if (profile.role !== 'owner' && profile.role !== 'admin_produksi') {
    throw new Error('Hanya owner atau admin produksi yang bisa membuat PO');
  }

  const validated = CreatePoSchema.parse(data);

  if (!validated.tanggal_target) {
    const orderDate = new Date(validated.tanggal_order);
    orderDate.setDate(orderDate.getDate() + 30);
    validated.tanggal_target = orderDate.toISOString().split('T')[0];
  }

  const supabase = await createClient();

  const produkIds = validated.items.map(i => i.produk_id);
  const { data: exProduk, error: errProduk } = await supabase
    .from('produk')
    .select('id')
    .in('id', produkIds)
    .eq('tenant_id', TENANT_ID)
    .eq('aktif', true);

  if (errProduk) throw new Error(errProduk.message);

  const existingIds = new Set((exProduk || []).map(p => p.id));
  for (let i = 0; i < validated.items.length; i++) {
    const item = validated.items[i];
    if (!existingIds.has(item.produk_id)) {
      throw new Error(`Produk untuk item baris ${i + 1} tidak valid atau tidak aktif.`);
    }
  }

  const p_items = validated.items.map(item => ({
    produk_id: item.produk_id,
    warna: item.warna,
    size: item.size,
    qty_order: item.qty_order,
    qty_per_bundle: item.qty_per_bundle
  }));

  const { error: rpcErr } = await supabase.rpc('create_po_with_bundles', {
    p_no_po: validated.no_po,
    p_klien_id: validated.klien_id,
    p_tanggal_order: validated.tanggal_order,
    p_tanggal_target: validated.tanggal_target,
    p_catatan: validated.catatan,
    p_tenant_id: TENANT_ID,
    p_user_id: profile.id,
    p_items
  });

  if (rpcErr) throw new Error(rpcErr.message);

  return { success: true, no_po: validated.no_po };
}

// 9. cancelPo()
export async function cancelPo(id: string) {
  const profile = await getCurrentUserProfile();
  if (!profile) throw new Error('Unauthorized');

  if (profile.role !== 'owner' && profile.role !== 'admin_produksi') {
    throw new Error('Hanya owner atau admin produksi yang bisa membatalkan PO');
  }

  const supabase = await createClient();

  const { data: poCek, error: cekErr } = await supabase
    .from('po')
    .select('status')
    .eq('id', id)
    .eq('tenant_id', TENANT_ID)
    .single();

  if (cekErr || !poCek) throw new Error('PO tidak ditemukan');
  if (poCek.status === 'dibatalkan' || poCek.status === 'selesai') {
    throw new Error(`Tidak bisa membatalkan PO dengan status ${poCek.status}`);
  }

  const { error: updErr } = await supabase
    .from('po')
    .update({ status: 'dibatalkan' })
    .eq('id', id)
    .eq('tenant_id', TENANT_ID);

  if (updErr) throw new Error(updErr.message);

  return { success: true };
}
