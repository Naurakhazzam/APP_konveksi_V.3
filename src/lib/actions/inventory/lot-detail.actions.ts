'use server';

import { createClient } from '@/lib/supabase/server';

const TENANT_ID = 'STX-001';

export interface BahanBakuOption {
  id: string;
  nama: string;
  satuan: string;
}

// Daftar bahan baku untuk dropdown pilihan di mode "Cari per LOT".
export async function getBahanBakuList(): Promise<BahanBakuOption[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('inventory_item')
    .select('id, nama, satuan')
    .eq('tenant_id', TENANT_ID)
    .order('nama');

  if (error) throw new Error(error.message);
  return data ?? [];
}

export interface LotUsagePerArtikel {
  po_item_id: string;
  model_nama: string | null;
  warna: string;
  size: string;
  bahan_nama: string | null;
  satuan: string | null;
  qty_pakai: number | null;
  lot_number: number | null;
  lot_tanggal_masuk: string | null;
  no_faktur: string | null;
}

export interface PoLotUsageResult {
  no_po: string;
  klien_nama: string;
  artikel: LotUsagePerArtikel[];
}

// Cari LOT bahan yang dipakai untuk tiap artikel di sebuah PO.
// Catatan: pemakaian_bahan dicatat per-artikel (FIFO), jadi kalau 1 artikel
// kebetulan memakai bahan lintas 2 LOT sekaligus, yang tercatat cuma LOT
// pertama yang mulai dipakai — bukan daftar lengkap semua LOT yang tersentuh.
export async function getLotUsageByPO(noPo: string): Promise<PoLotUsageResult | null> {
  const supabase = await createClient();

  const { data: po, error: poError } = await supabase
    .from('po')
    .select('id, no_po, klien:klien_id(nama)')
    .ilike('no_po', noPo.trim())
    .eq('tenant_id', TENANT_ID)
    .maybeSingle();

  if (poError) throw new Error(poError.message);
  if (!po) return null;

  const poRow = po as any;
  const klien = Array.isArray(poRow.klien) ? poRow.klien[0] : poRow.klien;

  const { data: items, error: itemError } = await supabase
    .from('po_item')
    .select('id, warna, size, produk:produk_id(model_produk:model_id(nama))')
    .eq('po_id', poRow.id)
    .eq('tenant_id', TENANT_ID);

  if (itemError) throw new Error(itemError.message);

  const poItemIds = (items ?? []).map((i: any) => i.id);
  const pemakaianMap: Record<string, any> = {};

  if (poItemIds.length > 0) {
    const { data: pemakaian, error: pemakaianError } = await supabase
      .from('pemakaian_bahan')
      .select('po_item_id, qty_pakai, inventory_batch_id, inventory_item:inventory_item_id(nama, satuan)')
      .in('po_item_id', poItemIds)
      .eq('tenant_id', TENANT_ID);

    if (pemakaianError) throw new Error(pemakaianError.message);
    (pemakaian ?? []).forEach((p: any) => { pemakaianMap[p.po_item_id] = p; });
  }

  // Hitung nomor LOT (ascending — LOT-1 = paling lama masuk) per inventory_item
  // yang relevan, dari batch yang benar-benar dipakai di PO ini.
  const batchIds = Object.values(pemakaianMap).map((p: any) => p.inventory_batch_id).filter(Boolean);
  const batchLotMap: Record<string, { lot_number: number; tanggal_masuk: string; no_faktur: string | null }> = {};

  if (batchIds.length > 0) {
    const { data: batchRows } = await supabase
      .from('inventory_batch')
      .select('id, inventory_item_id')
      .in('id', batchIds);

    const itemIds = [...new Set((batchRows ?? []).map((b: any) => b.inventory_item_id))];

    for (const itemId of itemIds) {
      const { data: allBatches } = await supabase
        .from('inventory_batch')
        .select('id, tanggal_masuk, jurnal_entry:jurnal_entry_id(no_faktur)')
        .eq('inventory_item_id', itemId)
        .eq('tenant_id', TENANT_ID)
        .order('tanggal_masuk', { ascending: true });

      (allBatches ?? []).forEach((b: any, idx: number) => {
        const jurnal = Array.isArray(b.jurnal_entry) ? b.jurnal_entry[0] : b.jurnal_entry;
        batchLotMap[b.id] = {
          lot_number: idx + 1,
          tanggal_masuk: b.tanggal_masuk,
          no_faktur: jurnal?.no_faktur ?? null,
        };
      });
    }
  }

  const artikel: LotUsagePerArtikel[] = (items ?? []).map((it: any) => {
    const produk = Array.isArray(it.produk) ? it.produk[0] : it.produk;
    const model = Array.isArray(produk?.model_produk) ? produk.model_produk[0] : produk?.model_produk;
    const pemakaian = pemakaianMap[it.id];
    const invItem = pemakaian
      ? (Array.isArray(pemakaian.inventory_item) ? pemakaian.inventory_item[0] : pemakaian.inventory_item)
      : null;
    const lotInfo = pemakaian?.inventory_batch_id ? batchLotMap[pemakaian.inventory_batch_id] : null;

    return {
      po_item_id: it.id,
      model_nama: model?.nama ?? null,
      warna: it.warna,
      size: it.size,
      bahan_nama: invItem?.nama ?? null,
      satuan: invItem?.satuan ?? null,
      qty_pakai: pemakaian?.qty_pakai ?? null,
      lot_number: lotInfo?.lot_number ?? null,
      lot_tanggal_masuk: lotInfo?.tanggal_masuk ?? null,
      no_faktur: lotInfo?.no_faktur ?? null,
    };
  });

  return {
    no_po: poRow.no_po,
    klien_nama: klien?.nama ?? '',
    artikel,
  };
}

export interface PoUsingLot {
  no_po: string;
  klien_nama: string;
  model_nama: string | null;
  warna: string;
  size: string;
  qty_pakai: number;
}

// Cari PO/artikel apa saja yang tercatat memakai 1 LOT (batch) tertentu.
// Batasan yang sama seperti di atas: kalau LOT ini adalah LOT "kedua" yang
// dipakai untuk artikel tertentu (bukan LOT pertama yang disentuh FIFO),
// artikel itu tidak akan muncul di sini.
export async function getPOsUsingLot(batchId: string): Promise<PoUsingLot[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('pemakaian_bahan')
    .select(`
      qty_pakai,
      po_item:po_item_id(
        warna, size,
        produk:produk_id(model_produk:model_id(nama)),
        po:po_id(no_po, klien:klien_id(nama))
      )
    `)
    .eq('inventory_batch_id', batchId)
    .eq('tenant_id', TENANT_ID);

  if (error) throw new Error(error.message);

  return (data ?? []).map((row: any) => {
    const poItem = Array.isArray(row.po_item) ? row.po_item[0] : row.po_item;
    const produk = Array.isArray(poItem?.produk) ? poItem.produk[0] : poItem?.produk;
    const model = Array.isArray(produk?.model_produk) ? produk.model_produk[0] : produk?.model_produk;
    const po = Array.isArray(poItem?.po) ? poItem.po[0] : poItem?.po;
    const klien = Array.isArray(po?.klien) ? po.klien[0] : po?.klien;

    return {
      no_po: po?.no_po ?? '',
      klien_nama: klien?.nama ?? '',
      model_nama: model?.nama ?? null,
      warna: poItem?.warna ?? '',
      size: poItem?.size ?? '',
      qty_pakai: row.qty_pakai,
    };
  });
}
