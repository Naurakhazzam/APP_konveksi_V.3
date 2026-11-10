import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Identitas user dari JWT sesi — pengganti cepat `supabase.auth.getUser()`.
 *
 * Project memakai kunci ES256 (asimetris), jadi `getClaims()` memverifikasi
 * tanda tangan token secara lokal (kunci publik di-cache) tanpa bolak-balik ke
 * server Auth. `getUser()` selalu memanggil server Auth (~150 ms tiap kali)
 * dan dulu dipanggil berkali-kali per request: middleware, layout, tiap aksi.
 *
 * Bentuk kembalian sengaja sama dengan getUser() → { data: { user }, error }.
 * Catatan: logout dari perangkat lain baru berlaku setelah token kedaluwarsa
 * (maks. 1 jam). Untuk aksi sangat sensitif (mis. PIN) tetap pakai getUser().
 */
export async function getUserFromClaims(supabase: Pick<SupabaseClient, 'auth'>) {
  const { data, error } = await supabase.auth.getClaims();
  const sub = data?.claims?.sub;
  if (error || !sub) {
    return { data: { user: null }, error: error ?? new Error('Unauthorized') };
  }
  return { data: { user: { id: String(sub) } }, error: null };
}
