'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';

const TENANT_ID = 'STX-001';

// ─── TYPES ───────────────────────────────────────────────────────────────────

export interface POCuttingItem {
  po_id: string;
  no_po: string;
  klien_nama: string;
  model_nama: string | null;
  total_bundle: number;
  total_qty: number;
  status: 'menunggu' | 'progress' | 'selesai';
  start_time: string | null;
}

export interface PemakaianBahanItem {
  po_id: string;
  inventory_item_id: string;
  qty_pakai: number;
}

export interface StokWarning {
  item_nama: string;
  qty_kurang: number;
  sisa_stok: number;
}

export interface SelesaiCuttingResult {
  success: boolean;
  total_qty: number;
  stok_warnings: StokWarning[];
  error?: string;
}

export interface BahanCuttingItem {
  inventory_item_id: string;
  nama: string;
  satuan: string;
  stok_aktual: number;
}

export interface POBahanInfo {
  po_id: string;
  no_po: string;
  model_nama: string | null;
  total_qty: number;
  bahan: BahanCuttingItem[];
}

// ─── HELPER ──────────────────────────────────────────────────────────────────

async function resolveUserId(): Promise<string> {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) throw new Error('Unauthorized');
  return user.id;
}

// ─── FUNGSI 1: getPOCuttingList ───────────────────────────────────────────────

export async function getPOCuttingList(): Promise<POCuttingItem[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('bundle')
    .select(`
      id,
      status_tahap,
      po_item_id,
      po:po_id (
        id,
        no_po,
        klien:klien_id ( nama )
      ),
      po_item:po_item_id (
        qty_per_bundle,
        produk:produk_id (
          model_produk:model_id ( nama )
        )
      )
    `)
    .eq('tenant_id', TENANT_ID)
    .order('created_at', { ascending: true });

  if (error) throw new Error(`Gagal fetch bundle: ${error.message}`);

  // Group by po_id
  const poMap = new Map<string, {
    po_id: string;
    no_po: string;
    klien_nama: string;
    model_nama: string | null;
    bundles: { status_tahap: any; qty_per_bundle: number }[];
  }>();

  for (const raw of (data ?? []) as any[]) {
    const po = Array.isArray(raw.po) ? raw.po[0] : raw.po;
    const po_item = Array.isArray(raw.po_item) ? raw.po_item[0] : raw.po_item;
    const klien = Array.isArray(po?.klien) ? po.klien[0] : po?.klien;
    const produk = Array.isArray(po_item?.produk) ? po_item.produk[0] : po_item?.produk;
    const model_produk = Array.isArray(produk?.model_produk) ? produk.model_produk[0] : produk?.model_produk;

    const po_id: string = po?.id ?? '';
    if (!po_id) continue;

    if (!poMap.has(po_id)) {
      poMap.set(po_id, {
        po_id,
        no_po: po?.no_po ?? '-',
        klien_nama: klien?.nama ?? '-',
        model_nama: model_produk?.nama ?? null,
        bundles: [],
      });
    }

    poMap.get(po_id)!.bundles.push({
      status_tahap: raw.status_tahap,
      qty_per_bundle: po_item?.qty_per_bundle ?? 0,
    });
  }

  const result: POCuttingItem[] = [];

  for (const group of poMap.values()) {
    const { bundles } = group;

    // Tentukan status cutting PO
    const cuttingStatuses = bundles.map(b => {
      const cutting = b.status_tahap?.cutting as { status?: string; waktu_terima?: string } | undefined;
      return cutting?.status ?? null;
    });

    const allNull     = cuttingStatuses.every(s => s === null);
    const allSelesai  = cuttingStatuses.every(s => s === 'selesai');
    const anyProgress = cuttingStatuses.some(s => s === 'progress' || s === 'terima');

    const status: 'menunggu' | 'progress' | 'selesai' =
      allSelesai  ? 'selesai' :
      anyProgress ? 'progress' :
      allNull     ? 'menunggu' :
      'progress'; // ada yang selesai sebagian → masih progress

    // Lewati PO yang sudah selesai
    if (status === 'selesai') continue;

    // Ambil start_time dari bundle (key 'start_time' sesuai RPC mulai_cutting_batch)
    const startBundle = bundles.find(b => b.status_tahap?.cutting?.start_time);
    const start_time = startBundle?.status_tahap?.cutting?.start_time ?? null;

    const total_bundle = bundles.length;
    const total_qty = bundles.reduce((s, b) => s + (b.qty_per_bundle ?? 0), 0);

    result.push({
      po_id:      group.po_id,
      no_po:      group.no_po,
      klien_nama: group.klien_nama,
      model_nama: group.model_nama,
      total_bundle,
      total_qty,
      status,
      start_time,
    });
  }

  // Urutkan: menunggu → progress → by no_po
  result.sort((a, b) => {
    const order = { menunggu: 0, progress: 1, selesai: 2 };
    const diff = order[a.status] - order[b.status];
    if (diff !== 0) return diff;
    return a.no_po.localeCompare(b.no_po);
  });

  return result;
}

// ─── FUNGSI 2: mulaiCuttingBatch ─────────────────────────────────────────────

export async function mulaiCuttingBatch(
  po_ids: string[]
): Promise<{ success: boolean; jumlah_bundle: number; error?: string }> {
  try {
    const user_id = await resolveUserId();
    const supabase = await createClient();

    const { data, error } = await supabase.rpc('mulai_cutting_batch', {
      p_po_ids:    po_ids,
      p_user_id:   user_id,
      p_tenant_id: TENANT_ID,
    });

    if (error) return { success: false, jumlah_bundle: 0, error: error.message };

    const result = data as { jumlah_bundle?: number } | null;
    const jumlah_bundle = result?.jumlah_bundle ?? 0;

    revalidatePath('/app/produksi/antrian-cutting');
    return { success: true, jumlah_bundle };
  } catch (e: any) {
    return { success: false, jumlah_bundle: 0, error: e.message ?? 'Terjadi kesalahan' };
  }
}

// ─── FUNGSI 3: selesaiCuttingBatch ───────────────────────────────────────────

export async function selesaiCuttingBatch(
  po_ids: string[],
  pemakaian: PemakaianBahanItem[]
): Promise<SelesaiCuttingResult> {
  try {
    const user_id = await resolveUserId();
    const supabase = await createClient();

    const { data, error } = await supabase.rpc('selesai_cutting_batch', {
      p_po_ids:    po_ids,
      p_pemakaian: JSON.stringify(pemakaian),
      p_user_id:   user_id,
      p_tenant_id: TENANT_ID,
    });

    if (error) return { success: false, total_qty: 0, stok_warnings: [], error: error.message };

    const result = data as {
      success?: boolean;
      total_qty?: number;
      stok_warnings?: StokWarning[];
    } | null;

    revalidatePath('/app/produksi/antrian-cutting');
    return {
      success:       result?.success ?? true,
      total_qty:     result?.total_qty ?? 0,
      stok_warnings: result?.stok_warnings ?? [],
    };
  } catch (e: any) {
    return { success: false, total_qty: 0, stok_warnings: [], error: e.message ?? 'Terjadi kesalahan' };
  }
}

// ─── FUNGSI 4: getBahanUntukCutting ──────────────────────────────────────────

export async function getBahanUntukCutting(
  po_ids: string[]
): Promise<POBahanInfo[]> {
  const supabase = await createClient();

  if (!po_ids.length) return [];

  // Fetch PO → po_item → produk → model_id + total_qty
  const { data: poData, error: poError } = await supabase
    .from('po')
    .select(`
      id,
      no_po,
      po_item (
        qty_per_bundle,
        produk:produk_id (
          model_id,
          model_produk:model_id ( nama )
        )
      )
    `)
    .in('id', po_ids)
    .eq('tenant_id', TENANT_ID);

  if (poError) throw new Error(`Gagal fetch PO: ${poError.message}`);

  const result: POBahanInfo[] = [];

  for (const po of (poData ?? []) as any[]) {
    const poItems: any[] = Array.isArray(po.po_item) ? po.po_item : [po.po_item].filter(Boolean);
    if (!poItems.length) {
      result.push({ po_id: po.id, no_po: po.no_po, model_nama: null, total_qty: 0, bahan: [] });
      continue;
    }

    // Ambil model_id dari po_item pertama (1 PO = 1 model)
    const firstItem = poItems[0];
    const produk = Array.isArray(firstItem?.produk) ? firstItem.produk[0] : firstItem?.produk;
    const modelProduk = Array.isArray(produk?.model_produk) ? produk.model_produk[0] : produk?.model_produk;
    const model_id: string | null = produk?.model_id ?? null;
    const model_nama: string | null = modelProduk?.nama ?? null;

    const total_qty = poItems.reduce((s: number, it: any) => s + (it.qty_per_bundle ?? 0), 0);

    let bahan: BahanCuttingItem[] = [];

    if (model_id) {
      // Fetch model_aksesori untuk tahap cutting, join inventory_item
      const { data: aksData, error: aksError } = await supabase
        .from('model_aksesori')
        .select(`
          inventory_item_id,
          inventory_item:inventory_item_id ( nama, satuan, stok_aktual )
        `)
        .eq('model_id', model_id)
        .eq('tahap_pakai', 'cutting')
        .eq('tenant_id', TENANT_ID);

      if (aksError) throw new Error(`Gagal fetch model_aksesori: ${aksError.message}`);

      bahan = (aksData ?? []).map((row: any) => {
        const inv = Array.isArray(row.inventory_item) ? row.inventory_item[0] : row.inventory_item;
        return {
          inventory_item_id: row.inventory_item_id,
          nama:              inv?.nama ?? '-',
          satuan:            inv?.satuan ?? '',
          stok_aktual:       inv?.stok_aktual ?? 0,
        };
      });
    }

    result.push({ po_id: po.id, no_po: po.no_po, model_nama, total_qty, bahan });
  }

  return result;
}
