'use server';

import { createClient } from '@/lib/supabase/server';

const TENANT_ID = 'STX-001';

export interface AppSettings {
  default_karyawan_borongan_id: string | null;
  stok_warning_jam: number;
  hpp_gap_threshold: number;
}

export async function getSettings(): Promise<AppSettings> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('settings')
    .select('default_karyawan_borongan_id, stok_warning_jam, hpp_gap_threshold')
    .eq('tenant_id', TENANT_ID)
    .single();

  if (error) {
    throw new Error('Gagal memuat pengaturan: ' + error.message);
  }

  return data as AppSettings;
}

export async function updateDefaultBorongan(karyawan_id: string | null): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from('settings')
    .update({ 
      default_karyawan_borongan_id: karyawan_id, 
      updated_at: new Date().toISOString() 
    })
    .eq('tenant_id', TENANT_ID);

  if (error) {
    throw new Error('Gagal menyimpan pengaturan: ' + error.message);
  }
}

export async function getKaryawanAktif(): Promise<{ id: string; nama: string; jabatan: string }[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('karyawan')
    .select('id, nama, jabatan')
    .eq('tenant_id', TENANT_ID)
    .eq('aktif', true)
    .order('nama');

  if (error) {
    throw new Error('Gagal memuat daftar karyawan: ' + error.message);
  }

  return data || [];
}
