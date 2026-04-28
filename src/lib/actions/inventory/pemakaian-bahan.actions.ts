'use server';

import { createClient } from '@/lib/supabase/server';

const TENANT_ID = 'STX-001';

// ─── Interfaces ──────────────────────────────────────────────────────────────

export interface PemakaianBahanRow {
  id           : string;
  tanggal      : string;       // created_at formatted
  nama_bahan   : string;       // dari inventory_item.nama
  satuan       : string;       // dari inventory_item.satuan
  qty_pakai    : number;
  rate_per_pcs : number | null;
  total_biaya  : number;       // qty_pakai * (rate_per_pcs ?? 0)
  no_po        : string;       // dari po.no_po
  warna        : string;       // dari po_item.warna
  size         : string;       // dari po_item.size
}

export interface PemakaianBahanSummary {
  rows          : PemakaianBahanRow[];
  total_qty     : number;   // SUM semua qty_pakai
  total_biaya   : number;   // SUM semua total_biaya
  jumlah_bahan  : number;   // COUNT DISTINCT inventory_item_id
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getStartDate(bulan: string, tahun: string): string {
  return `${tahun}-${bulan.padStart(2, '0')}-01`;
}

function getEndDate(bulan: string, tahun: string): string {
  const mm = bulan.padStart(2, '0');
  const lastDay = new Date(Number(tahun), Number(mm), 0).getDate();
  return `${tahun}-${mm}-${String(lastDay).padStart(2, '0')}`;
}

// ─── Main Function ───────────────────────────────────────────────────────────

export async function getPemakaianBahan(
  bulan_dari  : string,
  tahun_dari  : string,
  bulan_sampai: string,
  tahun_sampai: string,
): Promise<PemakaianBahanSummary> {
  const supabase = await createClient();

  const start = getStartDate(bulan_dari, tahun_dari);
  const end = getEndDate(bulan_sampai, tahun_sampai);

  // Fetch dari pemakaian_bahan
  const { data, error } = await supabase
    .from('pemakaian_bahan')
    .select(`
      id, qty_pakai, rate_per_pcs, created_at, inventory_item_id,
      inventory_item:inventory_item_id(nama, satuan),
      po_item:po_item_id(warna, size, po:po_id(no_po))
    `)
    .eq('tenant_id', TENANT_ID)
    .gte('created_at', `${start}T00:00:00`)
    .lte('created_at', `${end}T23:59:59`)
    .order('created_at', { ascending: false });

  if (error) {
    throw new Error('Gagal memuat data pemakaian bahan: ' + error.message);
  }

  // Hitung di JS
  let total_qty = 0;
  let total_biaya = 0;
  const itemIds = new Set<string>();

  const rows: PemakaianBahanRow[] = (data || []).map((row: any) => {
    const qty = Number(row.qty_pakai) || 0;
    const rate = Number(row.rate_per_pcs) || 0;
    const total = qty * rate;

    total_qty += qty;
    total_biaya += total;
    if (row.inventory_item_id) {
      itemIds.add(row.inventory_item_id);
    }

    // Ekstraksi join data dengan aman
    const inventoryItem = row.inventory_item || {};
    const poItem = row.po_item || {};
    const po = poItem.po || {};

    return {
      id: row.id,
      tanggal: row.created_at,
      nama_bahan: inventoryItem.nama || 'Tidak diketahui',
      satuan: inventoryItem.satuan || '-',
      qty_pakai: qty,
      rate_per_pcs: row.rate_per_pcs !== null ? rate : null,
      total_biaya: total,
      no_po: po.no_po || '-',
      warna: poItem.warna || '-',
      size: poItem.size || '-',
    };
  });

  return {
    rows,
    total_qty,
    total_biaya,
    jumlah_bahan: itemIds.size,
  };
}
