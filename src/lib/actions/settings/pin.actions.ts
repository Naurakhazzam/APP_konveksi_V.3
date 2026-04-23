'use server';

import { createClient } from '@/lib/supabase/server';
import bcrypt from 'bcryptjs';

/** 1. Set PIN approval owner (4 digit bcrypt hash) */
export async function setApprovalPin(pin: string): Promise<void> {
  // Validasi: pin harus 4 digit angka
  if (!/^\d{4}$/.test(pin)) {
    throw new Error('PIN harus 4 digit angka');
  }

  const supabase = await createClient();
  const { data: { user }, error: userErr } = await supabase.auth.getUser();

  if (userErr || !user) throw new Error('Unauthorized');

  const hash = await bcrypt.hash(pin, 10);

  const { error } = await supabase
    .from('user_profile')
    .update({ approval_pin: hash })
    .eq('id', user.id);

  if (error) throw new Error(error.message);
}

/** 2. Cek apakah user sudah memiliki PIN */
export async function hasApprovalPin(): Promise<boolean> {
  const supabase = await createClient();
  const { data: { user }, error: userErr } = await supabase.auth.getUser();

  if (userErr || !user) return false;

  const { data, error } = await supabase
    .from('user_profile')
    .select('approval_pin')
    .eq('id', user.id)
    .single();

  if (error || !data) return false;

  return data.approval_pin !== null && data.approval_pin !== undefined;
}
