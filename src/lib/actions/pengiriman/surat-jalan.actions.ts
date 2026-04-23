'use server';

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { revalidatePath } from 'next/cache';

const TENANT_ID = 'STX-001';

export interface BundleReadyToShip {
  id: string;
  barcode: string;
  no_po: string;
  klien_id: string;
  klien_nama: string;
  model_nama: string | null;
  warna: string;
  size: string;
  qty_per_bundle: number;
  qty_kirim: number;
}

export interface SuratJalanRow {
  id: string;
  nomor_sj: string;
  tanggal: string;
  status: string;
  catatan: string | null;
  klien_nama: string;
  total_bundle: number;
  total_qty: number;
  created_at: string;
}

export interface SuratJalanDetail {
  id: string;
  nomor_sj: string;
  tanggal: string;
  catatan: string | null;
  klien_id: string;
  klien_nama: string;
  klien_alamat: string | null;
  items: {
    bundle_id: string;
    barcode: string;
    no_po: string;
    model_nama: string | null;
    warna: string;
    size: string;
    qty_kirim: number;
  }[];
}

export async function getBundlesReadyToShip(): Promise<BundleReadyToShip[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('bundle')
    .select(`
      id,
      barcode,
      status_tahap,
      surat_jalan_id,
      po:po_id (
        no_po,
        klien:klien_id (id, nama)
      ),
      po_item:po_item_id (
        warna,
        size,
        qty_per_bundle,
        produk:produk_id (
          model_produk:model_id (nama)
        )
      )
    `)
    .eq('tenant_id', TENANT_ID)
    .is('surat_jalan_id', null);

  if (error) {
    console.error('Error fetching ready bundles:', error);
    throw new Error('Gagal memuat daftar bundle siap kirim');
  }

  // Filter client-side untuk status packing selesai (Supabase filter JSON agak kompleks jika tidak ada index/function spesifik)
  const readyBundles = (data || []).filter((b: any) => {
    return b.status_tahap?.packing?.status === 'selesai';
  });

  return readyBundles.map((b: any) => ({
    id: b.id,
    barcode: b.barcode,
    no_po: b.po?.no_po || '-',
    klien_id: b.po?.klien?.id || '',
    klien_nama: b.po?.klien?.nama || 'Unknown',
    model_nama: b.po_item?.produk?.model_produk?.nama || null,
    warna: b.po_item?.warna || '-',
    size: b.po_item?.size || '-',
    qty_per_bundle: b.po_item?.qty_per_bundle || 0,
    qty_kirim: b.po_item?.qty_per_bundle || 0, // Default qty_kirim
  }));
}

export async function createSuratJalan(input: {
  klien_id: string;
  tanggal: string;
  catatan: string;
  bundles: { bundle_id: string; qty_kirim: number }[];
}): Promise<string> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc('finalize_surat_jalan', {
    p_klien_id: input.klien_id,
    p_tanggal: input.tanggal,
    p_catatan: input.catatan,
    p_bundles: input.bundles,
    p_tenant_id: TENANT_ID
  });

  if (error) {
    console.error('Error finalize_surat_jalan:', error);
    throw new Error(error.message || 'Gagal membuat surat jalan');
  }

  revalidatePath('/app/pengiriman/buat-surat-jalan');
  revalidatePath('/app/pengiriman/riwayat');

  return data as string;
}

export async function getSuratJalanList(): Promise<SuratJalanRow[]> {
  const supabase = await createClient();

  // Dapatkan total_bundle dan total_qty bisa jadi dari subquery atau count()
  // Kita fetch data relasional
  const { data, error } = await supabase
    .from('surat_jalan')
    .select(`
      id,
      nomor_sj,
      tanggal,
      status,
      catatan,
      created_at,
      klien:klien_id (nama),
      surat_jalan_item (qty_kirim)
    `)
    .eq('tenant_id', TENANT_ID)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error fetching SJ list:', error);
    throw new Error('Gagal memuat riwayat surat jalan');
  }

  return (data || []).map((sj: any) => {
    const items = sj.surat_jalan_item || [];
    const totalBundle = items.length;
    const totalQty = items.reduce((sum: number, it: any) => sum + (it.qty_kirim || 0), 0);

    return {
      id: sj.id,
      nomor_sj: sj.nomor_sj,
      tanggal: sj.tanggal,
      status: sj.status,
      catatan: sj.catatan,
      klien_nama: sj.klien?.nama || 'Unknown',
      total_bundle: totalBundle,
      total_qty: totalQty,
      created_at: sj.created_at,
    };
  });
}

export async function getSuratJalanDetail(id: string): Promise<SuratJalanDetail | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('surat_jalan')
    .select(`
      id,
      nomor_sj,
      tanggal,
      catatan,
      klien_id,
      klien:klien_id (nama, alamat),
      surat_jalan_item (
        qty_kirim,
        bundle:bundle_id (
          id,
          barcode,
          po:po_id (no_po),
          po_item:po_item_id (
            warna,
            size,
            produk:produk_id (
              model_produk:model_id (nama)
            )
          )
        )
      )
    `)
    .eq('id', id)
    .eq('tenant_id', TENANT_ID)
    .single();

  if (error || !data) {
    console.error('Error fetching SJ detail:', error);
    return null;
  }

  const items = (data.surat_jalan_item || []).map((it: any) => {
    const b = it.bundle;
    return {
      bundle_id: b.id,
      barcode: b.barcode,
      no_po: b.po?.no_po || '-',
      model_nama: b.po_item?.produk?.model_produk?.nama || null,
      warna: b.po_item?.warna || '-',
      size: b.po_item?.size || '-',
      qty_kirim: it.qty_kirim,
    };
  });

  return {
    id: data.id,
    nomor_sj: data.nomor_sj,
    tanggal: data.tanggal,
    catatan: data.catatan,
    klien_id: data.klien_id,
    klien_nama: (Array.isArray(data.klien) ? data.klien[0]?.nama : (data.klien as any)?.nama) || 'Unknown',
    klien_alamat: (Array.isArray(data.klien) ? data.klien[0]?.alamat : (data.klien as any)?.alamat) || null,
    items,
  };
}
