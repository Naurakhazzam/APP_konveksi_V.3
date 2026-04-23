'use server';

import { createClient } from '@/lib/supabase/server';

const TENANT_ID = 'STX-001';

export interface RecordRejectInput {
  gaji_ledger_id: string;
  qty_reject: number;
  tipe_reject: 'rework' | 'cacat_bahan' | 'permanen';
  alasan: string;
}

export async function recordReject(input: RecordRejectInput): Promise<void> {
  if (!input.gaji_ledger_id) throw new Error('gaji_ledger_id wajib diisi');
  if (input.qty_reject < 1) throw new Error('qty_reject harus minimal 1');
  if (!input.alasan.trim()) throw new Error('Alasan reject wajib diisi');

  const supabase = await createClient();

  const { error } = await supabase.rpc('record_reject', {
    p_gaji_ledger_id: input.gaji_ledger_id,
    p_qty_reject: input.qty_reject,
    p_tipe_reject: input.tipe_reject,
    p_alasan: input.alasan.trim(),
    p_tenant_id: TENANT_ID,
  });

  if (error) throw new Error(error.message);
}
