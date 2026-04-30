'use server';

import { createClient } from '@/lib/supabase/server';
import { getOverheadRateInfo, getQtyShippedPerPO } from './overhead.actions';

const TENANT_ID = 'STX-001';

export interface POLaporanItem {
  po_id           : string;
  no_po           : string;
  klien_nama      : string;
  tanggal         : string;
  total_qty       : number;
  hpp_estimasi    : number;   // dari BOM (hpp_item.qty × harga_satuan × qty_order)
  biaya_bahan     : number;   // dari pemakaian: bahan_kain + aksesori (dinamis)
  biaya_upah      : number;   // dari jurnal direct_upah
  hpp_aktual      : number;   // biaya_bahan + biaya_upah
  gap             : number;   // hpp_aktual - hpp_estimasi
  status          : 'hemat' | 'boncos' | 'on_budget';
  nilai_project   : number;   // SUM(qty_order × produk.harga_jual)
  profit          : number;   // nilai_project - hpp_aktual
  margin_pct      : number;   // (profit / nilai_project) × 100
  qty_shipped     : number;
  alokasi_overhead: number;
  hpp_aktual_final: number;
  profit_final    : number;
  margin_pct_final: number;
}

/**
 * B1 — Ambil semua PO beserta kalkulasi HPP-nya.
 *
 * biaya_bahan dihitung dari tabel pemakaian (bukan jurnal_entry):
 *   - pemakaian_bahan   × inventory_batch.harga_satuan  → biaya kain (FIFO)
 *   - pemakaian_aksesori × inventory_item.harga_referensi → biaya aksesori
 * Sehingga kalau harga_referensi diupdate belakangan,
 * semua data historis langsung ikut terhitung ulang.
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
      po_item(
        qty_order,
        produk:produk_id(
          harga_jual,
          hpp_item(qty, harga_satuan)
        )
      )
    `)
    .eq('tenant_id', TENANT_ID)
    .order('tanggal_order', { ascending: false });

  if (poError) throw new Error(poError.message);

  // Step 2 — Biaya bahan dari pemakaian (dinamis & retroaktif)
  const { data: biayaData, error: biayaError } = await supabase
    .rpc('get_biaya_pemakaian_per_po', { p_tenant_id: TENANT_ID });

  if (biayaError) throw new Error(biayaError.message);

  // Step 3 — Biaya upah dari jurnal direct_upah
  const { data: upahData, error: upahError } = await supabase
    .from('jurnal_entry')
    .select('id, nominal, tag_po_ids')
    .eq('tenant_id', TENANT_ID)
    .eq('jenis', 'direct_upah');

  if (upahError) throw new Error(upahError.message);

  // Build biaya map: po_id → { bahan_kain, aksesori }
  const biayaMap = new Map<string, { biaya_aksesori: number; biaya_bahan_kain: number }>();
  (biayaData ?? []).forEach((b: any) => {
    biayaMap.set(String(b.po_id), {
      biaya_aksesori  : Number(b.biaya_aksesori)   || 0,
      biaya_bahan_kain: Number(b.biaya_bahan_kain) || 0,
    });
  });

  // Filter bulan/tahun
  const filteredData = (poData ?? []).filter((po: any) => {
    if (!filters?.bulan && !filters?.tahun) return true;
    const d = new Date(po.tanggal_order);
    if (filters.bulan && String(d.getMonth() + 1).padStart(2, '0') !== filters.bulan) return false;
    if (filters.tahun && String(d.getFullYear()) !== filters.tahun) return false;
    return true;
  });

  const rateInfo = await getOverheadRateInfo();
  const qtyShippedMap = rateInfo.period
    ? await getQtyShippedPerPO(
        rateInfo.period.tanggal_mulai,
        rateInfo.period.tanggal_akhir
      )
    : {};

  const result: POLaporanItem[] = filteredData.map((po: any) => {
    // HPP Estimasi — dari BOM
    const hpp_estimasi = (po.po_item ?? []).reduce((sum: number, pi: any) => {
      const qtyOrder  = Number(pi.qty_order) || 0;
      const hppItems  = pi.produk?.hpp_item ?? [];
      const hppPerPcs = hppItems.reduce((s: number, hi: any) =>
        s + Number(hi.qty) * Number(hi.harga_satuan), 0);
      return sum + (hppPerPcs * qtyOrder);
    }, 0);

    const total_qty = (po.po_item ?? []).reduce((sum: number, pi: any) =>
      sum + Number(pi.qty_order), 0);

    // Biaya Bahan = bahan kain (FIFO) + aksesori (dinamis × harga_referensi)
    const bp          = biayaMap.get(po.id);
    const biaya_bahan = (bp?.biaya_bahan_kain ?? 0) + (bp?.biaya_aksesori ?? 0);

    // Biaya Upah dari jurnal
    const biaya_upah = (upahData ?? [])
      .filter((j: any) => {
        const tags: string[] = j.tag_po_ids ?? [];
        return tags.includes(po.id);
      })
      .reduce((sum: number, j: any) => sum + Number(j.nominal), 0);

    const hpp_aktual = biaya_bahan + biaya_upah;
    const gap        = hpp_aktual - hpp_estimasi;

    const nilai_project = (po.po_item ?? []).reduce((sum: number, pi: any) =>
      sum + (Number(pi.produk?.harga_jual ?? 0) * Number(pi.qty_order)), 0);

    const profit     = nilai_project - hpp_aktual;
    const margin_pct = nilai_project > 0
      ? Math.round((profit / nilai_project) * 100)
      : 0;

    const qty_shipped        = qtyShippedMap[po.id] ?? 0;
    const alokasi_overhead   = rateInfo.overhead_rate * qty_shipped;
    const hpp_aktual_final   = hpp_aktual + alokasi_overhead;
    const profit_final       = nilai_project - hpp_aktual_final;
    const margin_pct_final   = nilai_project > 0
      ? Math.round((profit_final / nilai_project) * 100)
      : 0;

    let status: 'hemat' | 'boncos' | 'on_budget' = 'on_budget';
    if (gap > 50000)  status = 'boncos';
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
      nilai_project,
      profit,
      margin_pct,
      qty_shipped,
      alokasi_overhead,
      hpp_aktual_final,
      profit_final,
      margin_pct_final,
    };
  });

  return result;
}

export interface POHPPDetail {
  estimasi_breakdown: {
    nama_komponen : string;
    kategori      : string;
    qty_order     : number;
    harga_per_unit: number;
    total         : number;
  }[];
  aktual_breakdown: {
    jenis         : string;
    keterangan    : string;
    tanggal       : string;
    nominal_penuh : number;
    nominal_po    : number;
  }[];
  totals: {
    hpp_estimasi    : number;
    biaya_bahan     : number;
    biaya_upah      : number;
    hpp_aktual      : number;
    gap             : number;
    alokasi_overhead: number;
    hpp_aktual_final: number;
  };
}

/**
 * B1 — Ambil breakdown detail untuk satu PO.
 *
 * aktual_breakdown menggabungkan:
 *   - pemakaian bahan kain & aksesori (dari RPC, dinamis)
 *   - biaya upah dari jurnal_entry direct_upah
 */
export async function getPOHPPDetail(po_id: string): Promise<POHPPDetail> {
  const supabase = await createClient();

  // 1. Estimasi Breakdown (via po_item → produk → hpp_item → hpp_komponen)
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

  const estMap: Record<string, {
    total: number; kategori: string; qty_order: number; harga_per_unit: number;
  }> = {};

  (poItems ?? []).forEach((pi: any) => {
    const qtyOrder = Number(pi.qty_order) || 0;
    (pi.produk?.hpp_item ?? []).forEach((hi: any) => {
      const nama          = hi.hpp_komponen?.nama     || 'Unknown';
      const kategori      = hi.hpp_komponen?.kategori || 'Lainnya';
      const harga_per_unit = Number(hi.harga_satuan) || 0;
      const lineTotal     = Number(hi.qty) * harga_per_unit * qtyOrder;
      if (!estMap[nama]) {
        estMap[nama] = { total: 0, kategori, qty_order: 0, harga_per_unit };
      }
      estMap[nama].total     += lineTotal;
      estMap[nama].qty_order += qtyOrder;
    });
  });

  const total_hpp_estimasi = Object.values(estMap).reduce((s, v) => s + v.total, 0);
  const estimasi_breakdown = Object.entries(estMap).map(([nama, val]) => ({
    nama_komponen : nama,
    kategori      : val.kategori,
    qty_order     : val.qty_order,
    harga_per_unit: val.harga_per_unit,
    total         : val.total,
  }));

  // 2. Aktual Breakdown bahan & aksesori (dinamis dari pemakaian)
  const { data: pemDetail, error: pemErr } = await supabase
    .rpc('get_biaya_pemakaian_detail_po', { p_po_id: po_id, p_tenant_id: TENANT_ID });

  if (pemErr) throw new Error(pemErr.message);

  // 3. Aktual Breakdown upah dari jurnal
  const { data: upahData, error: upahErr } = await supabase
    .from('jurnal_entry')
    .select('jenis, keterangan, tanggal, nominal, tag_po_ids')
    .eq('tenant_id', TENANT_ID)
    .eq('jenis', 'direct_upah')
    .filter('tag_po_ids', 'cs', `["${po_id}"]`);

  if (upahErr) throw new Error(upahErr.message);

  // 4. Overhead alokasi untuk PO ini
  const rateInfo = await getOverheadRateInfo();
  const qtyShippedMap = rateInfo.period
    ? await getQtyShippedPerPO(rateInfo.period.tanggal_mulai, rateInfo.period.tanggal_akhir)
    : {};
  const qty_shipped_po   = qtyShippedMap[po_id] ?? 0;
  const alokasi_overhead = Math.round(rateInfo.overhead_rate * qty_shipped_po);

  // Gabung aktual_breakdown: pemakaian + upah + overhead
  const aktual_breakdown = [
    // Bahan kain & aksesori dari pemakaian (dinamis)
    ...(pemDetail ?? []).map((p: any) => ({
      jenis        : 'direct_bahan',
      keterangan   : `${p.item_nama} — ${p.tahap} (${Number(p.qty_pakai)} × Rp ${Number(p.harga_satuan).toLocaleString('id-ID')})`,
      tanggal      : p.tgl_pertama ?? '',
      nominal_penuh: Number(p.subtotal),
      nominal_po   : Number(p.subtotal),
    })),
    // Upah dari jurnal
    ...(upahData ?? []).map((j: any) => ({
      jenis        : j.jenis,
      keterangan   : j.keterangan,
      tanggal      : j.tanggal,
      nominal_penuh: Number(j.nominal),
      nominal_po   : Number(j.nominal),
    })),
    // Overhead alokasi
    ...(alokasi_overhead > 0 ? [{
      jenis        : 'overhead',
      keterangan   : `Alokasi Overhead — ${qty_shipped_po} pcs × Rp ${Math.round(rateInfo.overhead_rate).toLocaleString('id-ID')}`,
      tanggal      : rateInfo.period?.tanggal_mulai ?? '',
      nominal_penuh: alokasi_overhead,
      nominal_po   : alokasi_overhead,
    }] : []),
  ];

  const biaya_bahan = aktual_breakdown
    .filter(j => j.jenis === 'direct_bahan')
    .reduce((s, j) => s + j.nominal_po, 0);

  const biaya_upah = aktual_breakdown
    .filter(j => j.jenis === 'direct_upah')
    .reduce((s, j) => s + j.nominal_po, 0);

  const hpp_aktual = biaya_bahan + biaya_upah;

  return {
    estimasi_breakdown,
    aktual_breakdown,
    totals: {
      hpp_estimasi    : total_hpp_estimasi,
      biaya_bahan,
      biaya_upah,
      hpp_aktual,
      gap             : hpp_aktual - total_hpp_estimasi,
      alokasi_overhead,
      hpp_aktual_final: hpp_aktual + alokasi_overhead,
    },
  };
}
