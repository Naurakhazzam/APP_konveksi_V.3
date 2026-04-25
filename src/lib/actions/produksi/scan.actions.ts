'use server';

import { createClient } from '@/lib/supabase/server';
import type { TahapKey } from '@/modules/produksi/constants/tahap';

const TENANT_ID = 'STX-001';

// Shape return type dari RPC get_bundle_for_scan
export interface BundleForScan {
  id: string;
  barcode: string;
  po_id: string;
  po_item_id: string;
  status_tahap: Record<string, {
    status: 'terima' | 'selesai';
    qty_terima: number;
    qty_selesai: number | null;
    waktu_terima: string;
    waktu_selesai: string | null;
    karyawan_id: string | null;
  }>;
  no_urut: number;
  no_po: string;
  klien_nama: string;
  warna: string;
  size: string;
  qty_order: number;
  qty_per_bundle: number;
  model_nama: string | null;
  has_pemakaian_config: boolean;
}

// 1. getBundleForScan
export async function getBundleForScan(barcode: string): Promise<BundleForScan | null> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc('get_bundle_for_scan', {
    p_barcode:   barcode,
    p_tenant_id: TENANT_ID,
  });

  if (error) throw new Error(error.message);
  return (data as BundleForScan | null) ?? null;
}

// 1b. searchBundlesByBarcode — partial match untuk input cepat
export interface BundleSearchResult {
  id: string;
  barcode: string;
  no_po: string;
  klien_nama: string;
  model_nama: string | null;
  warna: string;
  size: string;
}

export async function searchBundlesByBarcode(query: string, tahap: TahapKey): Promise<BundleSearchResult[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('bundle')
    .select(`
      id,
      barcode,
      status_tahap,
      po:po_id(no_po, klien:klien_id(nama)),
      po_item:po_item_id(warna, size, produk:produk_id(model_produk:model_id(nama)))
    `)
    .eq('tenant_id', TENANT_ID)
    .ilike('barcode', `%${query}%`)
    .limit(15);

  if (error) throw new Error(error.message);

  return (data ?? [])
    .filter((b: unknown) => {
      const row = b as { status_tahap?: Record<string, { status: string } | undefined> };
      return row.status_tahap?.[tahap]?.status !== 'selesai';
    })
    .slice(0, 10)
    .map((b: unknown) => {
      const row = b as {
        id: string;
        barcode: string;
        status_tahap?: Record<string, { status: string } | undefined>;
        po: { no_po: string; klien: { nama: string } | null } | null;
        po_item: { warna: string; size: string; produk: { model_produk: { nama: string } | null } | null } | null;
      };
      return {
        id: row.id,
        barcode: row.barcode,
        no_po: row.po?.no_po ?? '',
        klien_nama: row.po?.klien?.nama ?? '',
        model_nama: row.po_item?.produk?.model_produk?.nama ?? null,
        warna: row.po_item?.warna ?? '',
        size: row.po_item?.size ?? '',
      };
    });
}

// 2. getKaryawanForTahap
export async function getKaryawanForTahap(
  tahap: TahapKey
): Promise<{ id: string; nama: string }[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('karyawan')
    .select('id, nama')
    .eq('aktif', true)
    .contains('tahap_produksi', [tahap])
    .order('nama');

  if (error) throw new Error(error.message);
  return (data ?? []) as { id: string; nama: string }[];
}

// 3. getInventoryItemsAktif
export interface InventoryItemAktif {
  id: string;
  nama: string;
  satuan: string;
  stok_aktual: number;
  warna_nama: string | null;
}

export async function getInventoryItemsAktif(): Promise<InventoryItemAktif[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('inventory_item')
    .select('id, nama, satuan, stok_aktual, warna:warna_id(nama)')
    .order('nama');

  if (error) throw new Error(error.message);

  return (data ?? []).map((item: any) => ({
    id: item.id,
    nama: item.nama,
    satuan: item.satuan,
    stok_aktual: item.stok_aktual,
    warna_nama: item.warna?.nama ?? null,
  }));
}

// 4. getDefaultBoronganKaryawan
export async function getDefaultBoronganKaryawan(): Promise<{ id: string; nama: string } | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('settings')
    .select('karyawan:default_karyawan_borongan_id(id, nama)')
    .eq('tenant_id', TENANT_ID)
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data?.karyawan) return null;

  // Supabase returns nested relation as unknown shape — cast through unknown
  const k = (data.karyawan as unknown) as { id: string; nama: string };
  return { id: k.id, nama: k.nama };
}

// 5. getAntrianJahit
export interface AntrianJahitBundle {
  id: string;
  barcode: string;
  no_po: string;
  klien_nama: string;
  model_nama: string | null;
  warna: string;
  size: string;
  qty_per_bundle: number;
  po_item_id: string;
  status_tahap: Record<string, { status?: string; karyawan_id?: string; qty_terima?: number }>;
}

export async function getAntrianJahit(): Promise<AntrianJahitBundle[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('bundle')
    .select(`
      id,
      barcode,
      status_tahap,
      po_item_id,
      po:po_id(no_po, klien:klien_id(nama)),
      po_item:po_item_id(warna, size, qty_per_bundle, produk:produk_id(model_produk:model_id(nama)))
    `)
    .eq('tenant_id', TENANT_ID);

  if (error) throw new Error(error.message);

  const filtered = (data ?? []).filter((b: any) => {
    return b.status_tahap?.cutting?.status === 'selesai' && b.status_tahap?.jahit?.status !== 'selesai';
  });

  const result: AntrianJahitBundle[] = filtered.map((b: any) => {
    const po = Array.isArray(b.po) ? b.po[0] : b.po;
    const klien = Array.isArray(po?.klien) ? po.klien[0] : po?.klien;
    const poItem = Array.isArray(b.po_item) ? b.po_item[0] : b.po_item;
    const produk = Array.isArray(poItem?.produk) ? poItem.produk[0] : poItem?.produk;
    const model = Array.isArray(produk?.model_produk) ? produk.model_produk[0] : produk?.model_produk;

    return {
      id: b.id,
      barcode: b.barcode,
      no_po: po?.no_po ?? '',
      klien_nama: klien?.nama ?? '',
      model_nama: model?.nama ?? null,
      warna: poItem?.warna ?? '',
      size: poItem?.size ?? '',
      qty_per_bundle: poItem?.qty_per_bundle ?? 0,
      po_item_id: b.po_item_id,
      status_tahap: b.status_tahap ?? {},
    };
  });

  result.sort((a, b) => {
    if (a.no_po !== b.no_po) {
      return a.no_po.localeCompare(b.no_po);
    }
    return a.barcode.localeCompare(b.barcode);
  });

  return result;
}
