import { PO_AWAL_PERIODE } from './periode-po';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Supa = { rpc: (fn: string, args: Record<string, unknown>) => any };

const TENANT_ID = 'STX-001';

/** Id PO periode baru (PO-0100 ke atas) */
export async function getPoIdsPeriodeBaru(supabase: Supa): Promise<Set<string>> {
  const { data, error } = await supabase.rpc('po_ids_periode_baru', { p_tenant_id: TENANT_ID, p_mulai: PO_AWAL_PERIODE });
  if (error) throw new Error(error.message);
  return new Set(((data ?? []) as any[]).map(r => String(typeof r === 'string' ? r : r.po_ids_periode_baru ?? r)));
}

/** Id bundle milik PO periode baru — untuk menyaring upah (gaji_ledger.sumber_id) */
export async function getBundleIdsPeriodeBaru(supabase: Supa): Promise<Set<string>> {
  const { data, error } = await supabase.rpc('bundle_ids_periode_baru', { p_tenant_id: TENANT_ID, p_mulai: PO_AWAL_PERIODE });
  if (error) throw new Error(error.message);
  return new Set(((data ?? []) as any[]).map(r => String(typeof r === 'string' ? r : r.bundle_ids_periode_baru ?? r)));
}
