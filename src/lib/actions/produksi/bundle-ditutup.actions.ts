'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { getCurrentUserProfile } from '@/lib/auth/permissions';

const TENANT_ID = 'STX-001';

/**
 * Bundle "data lama" yang ditutup manual — sudah beres di lapangan tapi
 * menggantung di sistem (tidak pernah diserahterimakan ke jahit, atau
 * selesai packing tapi tidak pernah dibuatkan surat jalan). Bundle yang
 * ditutup hilang dari Antrian Jahit & Buat Surat Jalan, tidak membuat upah
 * apa pun, dan dikunci sampai dibuka lagi.
 */
export interface BundleDitutup {
  id: string;
  barcode: string;
  no_po: string;
  model_nama: string | null;
  warna: string;
  size: string;
  /** Posisi terakhir bundle saat ditutup, mis. "Cutting selesai" / "Packing selesai". */
  posisi: string;
  ditutup_at: string;
  ditutup_alasan: string;
}

const TAHAP_URUTAN = ['cutting', 'jahit', 'lubang_kancing', 'buang_benang', 'qc', 'steam', 'packing'];
const TAHAP_LABEL: Record<string, string> = {
  cutting: 'Cutting', jahit: 'Jahit', lubang_kancing: 'Lubang Kancing',
  buang_benang: 'Buang Benang', qc: 'QC', steam: 'Steam', packing: 'Packing',
};

function posisiTerakhir(statusTahap: Record<string, { status?: string }> | null): string {
  const st = statusTahap ?? {};
  for (let i = TAHAP_URUTAN.length - 1; i >= 0; i--) {
    const t = TAHAP_URUTAN[i];
    const s = st[t]?.status;
    if (s) return `${TAHAP_LABEL[t]} ${s === 'terima' ? 'dikerjakan' : s}`;
  }
  return '-';
}

function revalidateSemua() {
  revalidatePath('/app/produksi/scan/jahit');
  revalidatePath('/app/pengiriman/buat-surat-jalan');
  revalidatePath('/app/produksi/antrian-cutting');
}

export async function tutupBundleDataLama(
  bundleIds: string[],
  alasan: string,
): Promise<{ jumlah: number }> {
  const profile = await getCurrentUserProfile();
  if (!profile) throw new Error('Unauthorized');
  if (bundleIds.length === 0) throw new Error('Pilih minimal satu bundle');
  if (!alasan.trim()) throw new Error('Alasan wajib diisi');

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('tutup_bundle_data_lama', {
    p_bundle_ids: bundleIds,
    p_alasan: alasan.trim(),
    p_user_id: profile.id,
    p_tenant_id: TENANT_ID,
  });
  if (error) throw new Error(error.message || 'Gagal menutup bundle');

  revalidateSemua();
  return { jumlah: Number((data as { jumlah?: number } | null)?.jumlah) || 0 };
}

export async function bukaBundleDitutup(bundleId: string): Promise<{ barcode: string }> {
  const profile = await getCurrentUserProfile();
  if (!profile) throw new Error('Unauthorized');

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('buka_bundle_ditutup', {
    p_bundle_id: bundleId,
    p_user_id: profile.id,
    p_tenant_id: TENANT_ID,
  });
  if (error) throw new Error(error.message || 'Gagal membuka bundle');

  revalidateSemua();
  return { barcode: (data as { barcode?: string } | null)?.barcode ?? '' };
}

export async function getBundleDitutup(): Promise<BundleDitutup[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('bundle')
    .select(`
      id, barcode, status_tahap, ditutup_at, ditutup_alasan,
      po:po_id(no_po),
      po_item:po_item_id(warna, size, produk:produk_id(model_produk:model_id(nama)))
    `)
    .eq('tenant_id', TENANT_ID)
    .not('ditutup_at', 'is', null)
    .order('ditutup_at', { ascending: false });

  if (error) throw new Error(`Gagal memuat bundle yang ditutup: ${error.message}`);

  type Baris = {
    id: string; barcode: string; status_tahap: Record<string, { status?: string }> | null;
    ditutup_at: string; ditutup_alasan: string | null;
    po: { no_po: string } | { no_po: string }[] | null;
    po_item: {
      warna: string; size: string;
      produk: { model_produk: { nama: string } | { nama: string }[] | null } | { model_produk: { nama: string } | { nama: string }[] | null }[] | null;
    } | null;
  };
  const satu = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);

  return ((data ?? []) as unknown as Baris[]).map(b => {
    const produk = satu(b.po_item?.produk);
    const model = satu(produk?.model_produk);
    return {
      id: b.id,
      barcode: b.barcode,
      no_po: satu(b.po)?.no_po ?? '-',
      model_nama: model?.nama ?? null,
      warna: b.po_item?.warna ?? '-',
      size: b.po_item?.size ?? '-',
      posisi: posisiTerakhir(b.status_tahap),
      ditutup_at: b.ditutup_at,
      ditutup_alasan: b.ditutup_alasan ?? '-',
    };
  });
}
