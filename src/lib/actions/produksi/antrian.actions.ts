'use server';

import { createClient } from '@/lib/supabase/server';

const TENANT_ID = 'STX-001';

// Tipe data bundle untuk antrian dan proses
export interface AntrianBundle {
  id: string;
  barcode: string;
  no_urut: number;
  po_id: string;
  po_item_id: string;
  // Dari relasi po
  no_po: string;
  tanggal_order: string;
  tanggal_target: string;
  po_catatan: string | null;
  klien_nama: string;
  // Dari relasi po_item
  warna: string;
  size: string;
  qty_per_bundle: number;
  // Dari relasi produk → model_produk
  model_nama: string | null;
}

// Buat interface untuk raw Supabase response
interface RawSupabaseBundle {
  id: string;
  barcode: string;
  no_urut: number;
  po_id: string;
  po_item_id: string;
  status_tahap: Record<string, unknown> | null;
  po: unknown;
  po_item: unknown;
}

// flattenBundle pakai tipe eksplisit
function flattenBundle(raw: RawSupabaseBundle): AntrianBundle {
  // Helper untuk handle both array and single object (Supabase quirk)
  function pick<T>(val: unknown): T | null {
    if (Array.isArray(val)) return (val[0] as T) ?? null;
    return (val as T) ?? null;
  }

  const po = pick<{ no_po: string; tanggal_order: string; tanggal_target: string; catatan: string | null; klien: unknown }>(raw.po);
  const klien = pick<{ nama: string }>(po?.klien ?? null);
  const poItem = pick<{ warna: string; size: string; qty_order: number; qty_per_bundle: number; produk: unknown }>(raw.po_item);
  const produk = pick<{ nama: string; model: unknown }>(poItem?.produk ?? null);
  const model = pick<{ nama: string }>(produk?.model ?? null);

  return {
    id: raw.id,
    barcode: raw.barcode,
    no_urut: raw.no_urut,
    po_id: raw.po_id,
    po_item_id: raw.po_item_id,
    no_po: po?.no_po ?? '-',
    tanggal_order: po?.tanggal_order ?? '',
    tanggal_target: po?.tanggal_target ?? '',
    po_catatan: po?.catatan ?? null,
    klien_nama: klien?.nama ?? '-',
    warna: poItem?.warna ?? '-',
    size: poItem?.size ?? '-',
    qty_per_bundle: poItem?.qty_per_bundle ?? 0,
    model_nama: model?.nama ?? produk?.nama ?? null,
  };
}

/**
 * Fetch data bundle untuk Antrian Cutting (status null) 
 * dan Proses Cutting (status 'terima')
 */
export async function getAntrianData(): Promise<{
  antrian: AntrianBundle[];
  dipotong: AntrianBundle[];
}> {
  const supabase = await createClient();

  const selectClause = `
    id, barcode, no_urut, po_id, po_item_id, status_tahap,
    po:po_id (
      no_po, tanggal_order, tanggal_target, catatan,
      klien:klien_id ( nama )
    ),
    po_item:po_item_id (
      warna, size, qty_order, qty_per_bundle,
      produk:produk_id (
        nama,
        model:model_id ( nama )
      )
    )
  `;

  const { data, error } = await supabase
    .from('bundle')
    .select(selectClause)
    .eq('tenant_id', TENANT_ID)
    .order('created_at', { ascending: true });

  if (error) {
    throw new Error(`Gagal fetch antrian: ${error.message}`);
  }

  const rawBundles = (data ?? []) as RawSupabaseBundle[];

  // Filter 1: Antrian - status_tahap['cutting'] IS NULL
  const antrian = rawBundles
    .filter(b => !b.status_tahap || b.status_tahap['cutting'] == null)
    .map(flattenBundle);

  // Filter 2: Sedang Dipotong - status_tahap['cutting']['status'] === 'terima'
  const dipotong = rawBundles
    .filter(b => {
      const cutting = b.status_tahap?.['cutting'] as Record<string, unknown> | undefined;
      return cutting?.status === 'terima';
    })
    .map(flattenBundle);

  return { antrian, dipotong };
}
