'use server';

import { createClient } from '@/lib/supabase/server';
import { getCurrentUserProfile } from '@/lib/auth/permissions';

const TENANT_ID = 'STX-001';

export async function resetAllData(): Promise<void> {
  const supabase = await createClient();

  // Hanya owner yang boleh melakukan reset
  const profile = await getCurrentUserProfile();
  if (!profile || profile.role !== 'owner') {
    throw new Error('Unauthorized: hanya owner yang dapat melakukan reset data.');
  }

  const { error } = await supabase.rpc('reset_all_data', {
    p_tenant_id: TENANT_ID,
  });

  if (error) {
    throw new Error(`Reset gagal: ${error.message}`);
  }
}
