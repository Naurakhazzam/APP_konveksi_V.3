'use server';

import { createClient } from '@/lib/supabase/server';
import { getCurrentUserProfile } from '@/lib/auth/permissions';

const TENANT_ID = 'STX-001';

export interface SkuValidationResult {
  sku_klien: string;
  produk_id: string | null;
  warna: string | null;
  size: string | null;
  found: boolean;
}

export interface ImportPoPayload {
  no_po: string;
  klien_id: string;
  tanggal_order: string;
  tanggal_target: string | null;
  catatan: string | null;
  items: Array<{
    produk_id: string;
    warna: string;
    size: string;
    qty_order: number;
    qty_per_bundle: number;
  }>;
}

export interface ImportPoResult {
  no_po: string;
  success: boolean;
  error?: string;
}

// Tipe raw response dari Supabase untuk validasi SKU
interface ProdukValidationRow {
  id: string;
  sku_klien: string;
  warna: { nama: string } | null;
  size: { nama: string } | null;
}

/**
 * Memvalidasi list SKU klien ke database.
 * Join ke tabel warna dan size untuk mendapatkan nama teks.
 * Digunakan saat preview sebelum import.
 */
export async function validateImportSkus(skuList: string[]): Promise<SkuValidationResult[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('produk')
    .select('id, sku_klien, warna:warna_id(nama), size:size_id(nama)')
    .in('sku_klien', skuList)
    .eq('tenant_id', TENANT_ID)
    .eq('aktif', true);

  if (error) {
    console.error('Error validating SKUs:', error);
    throw new Error('Gagal memvalidasi SKU');
  }

  const rows = (data ?? []) as unknown as ProdukValidationRow[];
  const foundMap = new Map(rows.map(p => [p.sku_klien, p]));

  return skuList.map(sku => {
    const match = foundMap.get(sku);
    return {
      sku_klien: sku,
      produk_id: match?.id ?? null,
      warna: match?.warna?.nama ?? null,
      size: match?.size?.nama ?? null,
      found: !!match,
    };
  });
}

/**
 * Import banyak PO sekaligus.
 * Memanggil RPC create_po_with_bundles langsung.
 */
export async function importPoBulk(pos: ImportPoPayload[]): Promise<ImportPoResult[]> {
  const profile = await getCurrentUserProfile();
  if (!profile) throw new Error('Unauthorized');

  const supabase = await createClient();
  const results: ImportPoResult[] = [];

  for (const po of pos) {
    try {
      const { error: rpcErr } = await supabase.rpc('create_po_with_bundles', {
        p_no_po: po.no_po,
        p_klien_id: po.klien_id,
        p_tanggal_order: po.tanggal_order,
        p_tanggal_target: po.tanggal_target || null,
        p_catatan: po.catatan || null,
        p_tenant_id: TENANT_ID,
        p_user_id: profile.id,
        p_items: po.items
      });

      if (rpcErr) {
        results.push({ no_po: po.no_po, success: false, error: rpcErr.message });
      } else {
        results.push({ no_po: po.no_po, success: true });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Terjadi kesalahan sistem';
      results.push({ no_po: po.no_po, success: false, error: msg });
    }
  }

  return results;
}
