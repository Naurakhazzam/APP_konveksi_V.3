'use server';

import { createClient } from '@/lib/supabase/server';
import {
  ScanCuttingTerimaInputSchema,
  ScanSelesaiInputSchema,
  ScanTerimaGenericInputSchema,
  type ScanCuttingTerimaInput,
  type ScanSelesaiInput,
  type ScanTerimaGenericInput,
} from '@/lib/validations/scan.schemas';

const TENANT_ID = 'STX-001';

export interface StokWarning {
  item_nama: string;
  qty_kurang: number;
  sisa_stok: number;
}

export interface ScanCuttingTerimaResult {
  scan_log_id: string;
  stok_warnings: StokWarning[];
}

export interface ScanSelesaiResult {
  scan_log_id: string;
  gaji_entry_id: string | null;
  upah_nominal: number;
  is_qty_lebih: boolean;
  approval_request_id: string | null;
}

// Ambil user_id dari session aktif
async function resolveUserId(): Promise<string> {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) throw new Error('Unauthorized');
  return user.id;
}

// 1. scanCuttingTerima
export async function scanCuttingTerima(
  input: ScanCuttingTerimaInput
): Promise<ScanCuttingTerimaResult> {
  const validated = ScanCuttingTerimaInputSchema.parse(input);
  const user_id   = await resolveUserId();
  const supabase  = await createClient();

  const p_pemakaian = validated.pemakaian.map(item => ({
    inventory_item_id: item.inventory_item_id,
    rate_per_pcs:      item.rate_per_pcs,
  }));

  const { data, error } = await supabase.rpc('scan_cutting_terima', {
    p_barcode:     validated.barcode,
    p_karyawan_id: validated.karyawan_id,
    p_qty:         validated.qty,
    p_pemakaian:   p_pemakaian,
    p_user_id:     user_id,
    p_tenant_id:   TENANT_ID,
  });

  if (error) throw new Error(error.message);

  const result = data as { scan_log_id: string; stok_warnings: StokWarning[] };
  return {
    scan_log_id:   result.scan_log_id,
    stok_warnings: result.stok_warnings ?? [],
  };
}

// 2. scanSelesai
export async function scanSelesai(
  input: ScanSelesaiInput
): Promise<ScanSelesaiResult> {
  const validated = ScanSelesaiInputSchema.parse(input);
  const user_id   = await resolveUserId();
  const supabase  = await createClient();

  const { data, error } = await supabase.rpc('scan_selesai', {
    p_barcode:       validated.barcode,
    p_tahap:         validated.tahap,
    p_karyawan_id:   validated.karyawan_id ?? null,
    p_qty:           validated.qty,
    p_catatan:       validated.catatan ?? null,
    p_alasan_qty_id: validated.alasan_qty_id ?? null,
    p_user_id:       user_id,
    p_tenant_id:     TENANT_ID,
  });

  if (error) throw new Error(error.message);

  const result = data as {
    scan_log_id:         string;
    gaji_entry_id:       string | null;
    upah_nominal:        number;
    is_qty_lebih:        boolean;
    approval_request_id: string | null;
  };

  return {
    scan_log_id:         result.scan_log_id,
    gaji_entry_id:       result.gaji_entry_id ?? null,
    upah_nominal:        result.upah_nominal ?? 0,
    is_qty_lebih:        result.is_qty_lebih ?? false,
    approval_request_id: result.approval_request_id ?? null,
  };
}
export interface ScanTerimaGenericResult {
  scan_log_id: string;
}

export async function scanTerimaGeneric(
  input: ScanTerimaGenericInput
): Promise<ScanTerimaGenericResult> {
  const validated = ScanTerimaGenericInputSchema.parse(input);
  const user_id   = await resolveUserId();
  const supabase  = await createClient();

  const { data, error } = await supabase.rpc('scan_terima_generic', {
    p_barcode:     validated.barcode,
    p_tahap:       validated.tahap,
    p_karyawan_id: validated.karyawan_id,
    p_qty:         validated.qty,
    p_user_id:     user_id,
    p_tenant_id:   TENANT_ID,
  });

  if (error) throw new Error(error.message);
  const result = data as { scan_log_id: string };
  return { scan_log_id: result.scan_log_id };
}
