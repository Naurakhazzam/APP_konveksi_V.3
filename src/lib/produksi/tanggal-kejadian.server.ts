import type { createClient } from '@/lib/supabase/server';

type Supa = Awaited<ReturnType<typeof createClient>>;

/**
 * Pasang tanggal kejadian ke bundle yang baru saja diselesaikan.
 * Tahap sudah tercatat oleh RPC utama; bila langkah ini gagal, kembalikan
 * pesan peringatan (bukan error) supaya UI bisa memberi tahu admin.
 */
export async function pasangTanggalKejadian(
  supabase: Supa,
  bundleIds: string[],
  tahap: 'cutting' | 'packing',
  tanggal: string | null,
  userId: string,
  tenantId: string,
): Promise<string | null> {
  if (!tanggal || bundleIds.length === 0) return null;
  const { error } = await supabase.rpc('set_tanggal_kejadian_tahap', {
    p_bundle_ids: bundleIds,
    p_tahap: tahap,
    p_tanggal: tanggal,
    p_user_id: userId,
    p_tenant_id: tenantId,
  });
  return error ? `Tahap tercatat, tapi tanggal kejadian gagal disimpan: ${error.message}` : null;
}
