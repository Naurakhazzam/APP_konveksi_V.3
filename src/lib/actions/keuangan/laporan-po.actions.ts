'use server';

import { createClient } from '@/lib/supabase/server';

const TENANT_ID = 'STX-001';

export interface POLaporanItem {
  po_id        : string;
  no_po        : string;
  klien_nama   : string;
  tanggal      : string;
  total_qty    : number;
  hpp_estimasi : number;   // dari po_item.hpp_estimasi × qty_order
  biaya_bahan  : number;   // dari jurnal direct_bahan (dengan multi-PO split)
  biaya_upah   : number;   // dari jurnal direct_upah
  hpp_aktual   : number;   // biaya_bahan + biaya_upah
  gap          : number;   // hpp_aktual - hpp_estimasi
  status       : 'hemat' | 'boncos' | 'on_budget';
  warning_no_estimasi?: boolean;
}

/**
 * B1 — Ambil semua PO beserta kalkulasi HPP-nya.
 */
export async function getLaporanPOList(filters?: {
  bulan?: string;
  tahun?: string;
}): Promise<POLaporanItem[]> {
  const supabase = await createClient();

  // Step 1 — Fetch semua PO dengan hpp estimasi
  const { data: poData, error: poError } = await supabase
    .from('po')
    .select(`
      id, no_po, tanggal_order,
      klien:klien_id(nama),
      po_item(hpp_estimasi, qty_order)
    `)
    .eq('tenant_id', TENANT_ID)
    .order('tanggal_order', { ascending: false });

  if (poError) throw new Error(poError.message);

  // Step 2 — Fetch semua jurnal direct_bahan dan direct_upah
  const { data: jurnalData, error: jurnalError } = await supabase
    .from('jurnal_entry')
    .select('id, jenis, nominal, tag_po_ids')
    .eq('tenant_id', TENANT_ID)
    .in('jenis', ['direct_bahan', 'direct_upah']);

  if (jurnalError) throw new Error(jurnalError.message);

  // Step 3 — Hitung per PO di JavaScript
  const filteredData = (poData ?? []).filter((po: any) => {
    if (!filters?.bulan && !filters?.tahun) return true;
    const d = new Date(po.tanggal_order);
    if (filters.bulan && String(d.getMonth() + 1).padStart(2, '0') !== filters.bulan) return false;
    if (filters.tahun && String(d.getFullYear()) !== filters.tahun) return false;
    return true;
  });

  const result: POLaporanItem[] = filteredData.map((po: any) => {
    // HPP Estimasi
    const hpp_estimasi = (po.po_item ?? []).reduce((sum: number, item: any) => {
      return sum + (Number(item.hpp_estimasi) * Number(item.qty_order));
    }, 0);

    const total_qty = (po.po_item ?? []).reduce((sum: number, item: any) => {
      return sum + Number(item.qty_order);
    }, 0);

    // Biaya Bahan Real — dengan multi-PO split
    const biaya_bahan = (jurnalData ?? [])
      .filter((j: any) => {
        const tags: string[] = j.tag_po_ids ?? [];
        return j.jenis === 'direct_bahan' && tags.includes(po.id);
      })
      .reduce((sum: number, j: any) => {
        const tags: string[] = j.tag_po_ids ?? [];
        const pembagi = tags.length > 1 ? tags.length : 1;
        return sum + (Number(j.nominal) / pembagi);
      }, 0);

    // Biaya Upah Real — full nominal (as per business rule in Phase B)
    const biaya_upah = (jurnalData ?? [])
      .filter((j: any) => {
        const tags: string[] = j.tag_po_ids ?? [];
        return j.jenis === 'direct_upah' && tags.includes(po.id);
      })
      .reduce((sum: number, j: any) => sum + Number(j.nominal), 0);

    const hpp_aktual = biaya_bahan + biaya_upah;
    const gap = hpp_aktual - hpp_estimasi;

    let status: 'hemat' | 'boncos' | 'on_budget' = 'on_budget';
    if (gap > 50000) status = 'boncos';
    else if (gap < -50000) status = 'hemat';

    return {
      po_id: po.id,
      no_po: po.no_po,
      klien_nama: (po.klien as any)?.nama ?? '-',
      tanggal: po.tanggal_order,
      total_qty,
      hpp_estimasi,
      biaya_bahan,
      biaya_upah,
      hpp_aktual,
      gap,
      status,
      warning_no_estimasi: hpp_estimasi === 0 && total_qty > 0
    };
  });

  return result;
}

export interface POHPPDetail {
  estimasi_breakdown: {
    nama_komponen : string;
    kategori      : string;
    total         : number;
  }[];
  aktual_breakdown: {
    jenis         : string;
    keterangan    : string;
    tanggal       : string;
    nominal_penuh : number;
    nominal_po    : number;  // setelah dibagi multi-PO
  }[];
  totals: {
    hpp_estimasi : number;
    biaya_bahan  : number;
    biaya_upah   : number;
    hpp_aktual   : number;
    gap          : number;
  };
}

/**
 * B1 — Ambil breakdown detail untuk satu PO.
 */
export async function getPOHPPDetail(po_id: string): Promise<POHPPDetail> {
  const supabase = await createClient();

  // 1. Ambil data PO dan Estimasi Breakdown (via po_item -> produk -> hpp_item -> hpp_komponen)
  const { data: poItems, error: poErr } = await supabase
    .from('po_item')
    .select(`
      qty_order,
      hpp_estimasi,
      produk:produk_id (
        hpp_item (
          qty,
          harga_satuan,
          hpp_komponen (
            nama,
            kategori
          )
        )
      )
    `)
    .eq('po_id', po_id);

  if (poErr) throw new Error(poErr.message);

  const estMap: Record<string, { total: number; kategori: string }> = {};
  let total_hpp_estimasi = 0;

  (poItems ?? []).forEach((pi: any) => {
    const qtyOrder = Number(pi.qty_order) || 0;
    total_hpp_estimasi += (Number(pi.hpp_estimasi) * qtyOrder);

    const hppItems = pi.produk?.hpp_item ?? [];
    hppItems.forEach((hi: any) => {
      const nama = hi.hpp_komponen?.nama || 'Unknown';
      const kategori = hi.hpp_komponen?.kategori || 'Lainnya';
      const lineTotal = Number(hi.qty) * Number(hi.harga_satuan) * qtyOrder;

      if (!estMap[nama]) {
        estMap[nama] = { total: 0, kategori };
      }
      estMap[nama].total += lineTotal;
    });
  });

  const estimasi_breakdown = Object.entries(estMap).map(([nama, val]) => ({
    nama_komponen: nama,
    kategori: val.kategori,
    total: val.total
  }));

  // 2. Ambil Aktual Breakdown (jurnal_entry)
  // Gunakan operator containment @> untuk JSONB array
  const { data: jurnalData, error: jurnalErr } = await supabase
    .from('jurnal_entry')
    .select('jenis, keterangan, tanggal, nominal, tag_po_ids')
    .eq('tenant_id', TENANT_ID)
    .filter('tag_po_ids', 'cs', `["${po_id}"]`); // .cs is 'contains' for JSONB

  if (jurnalErr) throw new Error(jurnalErr.message);

  const aktual_breakdown = (jurnalData ?? []).map((j: any) => {
    const tags: string[] = j.tag_po_ids ?? [];
    const pembagi = (j.jenis === 'direct_bahan' && tags.length > 1) ? tags.length : 1;
    return {
      jenis: j.jenis,
      keterangan: j.keterangan,
      tanggal: j.tanggal,
      nominal_penuh: Number(j.nominal),
      nominal_po: Number(j.nominal) / pembagi
    };
  });

  const biaya_bahan = aktual_breakdown
    .filter(j => j.jenis === 'direct_bahan')
    .reduce((sum, j) => sum + j.nominal_po, 0);

  const biaya_upah = aktual_breakdown
    .filter(j => j.jenis === 'direct_upah')
    .reduce((sum, j) => sum + j.nominal_po, 0);

  const hpp_aktual = biaya_bahan + biaya_upah;

  return {
    estimasi_breakdown,
    aktual_breakdown,
    totals: {
      hpp_estimasi: total_hpp_estimasi,
      biaya_bahan,
      biaya_upah,
      hpp_aktual,
      gap: hpp_aktual - total_hpp_estimasi
    }
  };
}
