'use server';

import { createClient } from '@/lib/supabase/server';
import { getCurrentUserProfile } from '@/lib/auth/permissions';
import type { AntrianBundle } from '@/lib/actions/produksi/antrian.actions';

const TENANT_ID = 'STX-001';

export type DaftarPoScope = 'aktif' | 'semua';

/**
 * Satu baris = satu po_item (satu artikel dalam satu PO). Tidak digabung
 * antar size/warna — tampilan sengaja rata seperti daftar "selesai packing".
 */
export interface PoArtikelRow {
  po_item_id: string;
  no_po: string;
  klien_nama: string;
  model_nama: string;
  warna: string;
  size: string;
  qty_order: number;
  total_bundle: number;
  po_status: string;
}

/**
 * Daftar artikel per PO untuk tab "Daftar Artikel PO".
 *   scope 'aktif' → hanya PO berstatus aktif (default).
 *   scope 'semua' → semua PO (aktif & selesai), kecuali yang dibatalkan.
 */
export async function getPoArtikelList(scope: DaftarPoScope): Promise<PoArtikelRow[]> {
  const profile = await getCurrentUserProfile();
  if (!profile) throw new Error('Unauthorized');

  const supabase = await createClient();

  let query = supabase
    .from('po_item')
    .select(`
      id, warna, size, qty_order,
      po:po_id!inner(id, no_po, status, klien:klien_id(nama)),
      produk:produk_id(nama, model:model_id(nama)),
      bundle(id)
    `)
    .eq('tenant_id', TENANT_ID)
    .neq('po.status', 'dibatalkan')
    .limit(2000);

  if (scope === 'aktif') {
    query = query.eq('po.status', 'aktif');
  }

  const { data, error } = await query;
  if (error) throw new Error(`Gagal ambil daftar artikel PO: ${error.message}`);

  const rows: PoArtikelRow[] = (data as any[])
    .filter((item) => item.po !== null)
    .map((item) => ({
      po_item_id: item.id,
      no_po: item.po.no_po,
      klien_nama: item.po.klien?.nama ?? '-',
      model_nama: item.produk?.model?.nama ?? item.produk?.nama ?? '-',
      warna: item.warna ?? '-',
      size: item.size ?? '-',
      qty_order: Number(item.qty_order ?? 0),
      total_bundle: item.bundle?.length ?? 0,
      po_status: item.po.status,
    }));

  rows.sort(
    (a, b) =>
      a.no_po.localeCompare(b.no_po) ||
      a.model_nama.localeCompare(b.model_nama) ||
      a.warna.localeCompare(b.warna) ||
      a.size.localeCompare(b.size)
  );

  return rows;
}

/**
 * Ambil seluruh bundle milik satu po_item dalam bentuk {@link AntrianBundle},
 * agar bisa langsung dipakai ulang oleh PrintLabelLayout (barcode) maupun
 * PrintCuttingTicketLayout (tiket nomor cutting). Qty per bundle memakai
 * qty_aktual cutting bila sudah ada, jika belum pakai rencana qty_per_bundle.
 */
export async function getBundlesForPrint(poItemId: string): Promise<AntrianBundle[]> {
  const profile = await getCurrentUserProfile();
  if (!profile) throw new Error('Unauthorized');

  const supabase = await createClient();

  const { data, error } = await supabase
    .from('bundle')
    .select(`
      id, barcode, no_urut, po_id, po_item_id, status_tahap,
      po:po_id(no_po, tanggal_order, tanggal_target, catatan, klien:klien_id(nama)),
      po_item:po_item_id(warna, size, qty_per_bundle, produk:produk_id(nama, model:model_id(nama)))
    `)
    .eq('po_item_id', poItemId)
    .eq('tenant_id', TENANT_ID)
    .order('no_urut', { ascending: true });

  if (error) throw new Error(`Gagal ambil bundle untuk cetak: ${error.message}`);

  return (data as any[]).map((b) => {
    const cuttingQty = b.status_tahap?.cutting?.qty_aktual;
    return {
      id: b.id,
      barcode: b.barcode,
      no_urut: b.no_urut,
      po_id: b.po_id,
      po_item_id: b.po_item_id,
      no_po: b.po?.no_po ?? '-',
      tanggal_order: b.po?.tanggal_order ?? '',
      tanggal_target: b.po?.tanggal_target ?? '',
      po_catatan: b.po?.catatan ?? null,
      klien_nama: b.po?.klien?.nama ?? '-',
      warna: b.po_item?.warna ?? '-',
      size: b.po_item?.size ?? '-',
      qty_per_bundle: cuttingQty ?? b.po_item?.qty_per_bundle ?? 0,
      model_nama: b.po_item?.produk?.model?.nama ?? b.po_item?.produk?.nama ?? null,
    } as AntrianBundle;
  });
}
