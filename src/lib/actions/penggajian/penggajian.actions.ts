'use server';

import { createClient } from '@/lib/supabase/server';

const TENANT_ID = 'STX-001';

export interface GajiLedgerEntry {
  id: string;
  karyawan_id: string;
  tipe: 'selesai' | 'reject_potong' | 'rework';
  total: number;
  qty: number;
  upah_per_pcs: number;
  tanggal: string;
  sumber_id: string;
  keterangan: string;
  status: 'belum_lunas' | 'lunas' | 'escrow' | 'cancelled';
  tanggal_bayar: string | null;
  is_printed: boolean;
  created_at: string;
}

export interface KasbonItem {
  id: string;
  karyawan_id: string;
  karyawan_nama: string;
  jumlah: number;
  keterangan: string;
  tanggal: string;
  status: 'belum_lunas' | 'lunas';
  created_at: string;
}

export interface RekapGajiItem {
  karyawan_id: string;
  karyawan_nama: string;
  jabatan: string;
  gaji_pokok: number;
  total_upah_kotor: number;    // SUM selesai + rework
  total_potongan: number;      // SUM reject_potong
  upah_bersih: number;         // kotor - potongan
  kasbon_sisa: number;         // SUM kasbon belum_lunas
  entry_ids: string[];         // id entries yang belum_lunas
}

/** 1. Rekap Gaji: Hitung upah borongan dan sisa kasbon per karyawan */
export async function getRekapGaji(
  tanggal_dari: string,
  tanggal_sampai: string
): Promise<RekapGajiItem[]> {
  const supabase = await createClient();

  // 1. Ambil semua entry gaji_ledger yang belum lunas
  const { data: ledgerData, error: ledgerError } = await supabase
    .from('gaji_ledger')
    .select(`
      id, karyawan_id, tipe, total, tanggal,
      karyawan:karyawan_id(nama, gaji_pokok, jabatan)
    `)
    .eq('status', 'belum_lunas')
    .gte('tanggal', tanggal_dari)
    .lte('tanggal', tanggal_sampai)
    .eq('tenant_id', TENANT_ID);

  if (ledgerError) throw new Error(ledgerError.message);

  // 2. Ambil semua kasbon yang belum lunas
  const { data: kasbonData, error: kasbonError } = await supabase
    .from('kasbon')
    .select('karyawan_id, jumlah')
    .eq('status', 'belum_lunas')
    .eq('tenant_id', TENANT_ID);

  if (kasbonError) throw new Error(kasbonError.message);

  // Grouping dan Aggregasi
  const map: Record<string, RekapGajiItem> = {};

  (ledgerData ?? []).forEach((row: any) => {
    const kid = row.karyawan_id;
    if (!map[kid]) {
      map[kid] = {
        karyawan_id: kid,
        karyawan_nama: row.karyawan?.nama || 'N/A',
        jabatan: row.karyawan?.jabatan || 'N/A',
        gaji_pokok: row.karyawan?.gaji_pokok || 0,
        total_upah_kotor: 0,
        total_potongan: 0,
        upah_bersih: 0,
        kasbon_sisa: 0,
        entry_ids: []
      };
    }

    map[kid].entry_ids.push(row.id);

    if (row.tipe === 'selesai' || row.tipe === 'rework') {
      map[kid].total_upah_kotor += Number(row.total);
    } else if (row.tipe === 'reject_potong') {
      map[kid].total_potongan += Number(row.total);
    }
  });

  // Hitung upah_bersih
  Object.values(map).forEach(item => {
    item.upah_bersih = item.total_upah_kotor - item.total_potongan;
  });

  // Tambahkan data kasbon
  (kasbonData ?? []).forEach((k: any) => {
    if (map[k.karyawan_id]) {
      map[k.karyawan_id].kasbon_sisa += Number(k.jumlah);
    }
  });

  return Object.values(map).sort((a, b) => a.karyawan_nama.localeCompare(b.karyawan_nama));
}

/** 2. Detail Gaji: List per rincian pekerjaan dalam ledger */
export async function getGajiDetail(
  karyawan_id: string,
  tanggal_dari: string,
  tanggal_sampai: string
): Promise<GajiLedgerEntry[]> {
  const supabase = await createClient();

  // Step 1: Fetch gaji_ledger entries
  const { data, error } = await supabase
    .from('gaji_ledger')
    .select('*')
    .eq('karyawan_id', karyawan_id)
    .gte('tanggal', tanggal_dari)
    .lte('tanggal', tanggal_sampai)
    .eq('tenant_id', TENANT_ID)
    .order('created_at', { ascending: false });

  if (error) throw new Error(error.message);
  if (!data || data.length === 0) return [];

  // Step 2: Fetch bundle → po_item (warna, size, produk_id, qty)
  const bundleIds = [...new Set(data.map((r: any) => r.sumber_id).filter(Boolean))];

  let bundleMap: Record<string, { warna: string; size: string; modelNama: string; qty: number }> = {};

  if (bundleIds.length > 0) {
    // 2a. Fetch bundles (just po_item_id)
    const { data: bundleData, error: bundleErr } = await supabase
      .from('bundle')
      .select('id, po_item_id')
      .in('id', bundleIds);

    if (bundleErr) throw new Error('Bundle fetch error: ' + bundleErr.message);

    const poItemIds = [...new Set((bundleData ?? []).map((b: any) => b.po_item_id).filter(Boolean))];

    // 2b. Fetch po_items (warna, size, qty_per_bundle, produk_id)
    let poItemMap: Record<string, { warna: string; size: string; qty_per_bundle: number; produk_id: string }> = {};
    if (poItemIds.length > 0) {
      const { data: poItems, error: poErr } = await supabase
        .from('po_item')
        .select('id, warna, size, qty_per_bundle, produk_id')
        .in('id', poItemIds);

      if (poErr) throw new Error('PO Item fetch error: ' + poErr.message);
      (poItems ?? []).forEach((pi: any) => {
        poItemMap[pi.id] = { warna: pi.warna, size: pi.size, qty_per_bundle: Number(pi.qty_per_bundle) || 0, produk_id: pi.produk_id };
      });
    }

    const produkIds = [...new Set(Object.values(poItemMap).map(pi => pi.produk_id).filter(Boolean))];

    // 2c. Fetch produk → model_produk name
    let modelMap: Record<string, string> = {};
    if (produkIds.length > 0) {
      const { data: produkData, error: produkErr } = await supabase
        .from('produk')
        .select('id, model_id')
        .in('id', produkIds);

      if (produkErr) throw new Error('Produk fetch error: ' + produkErr.message);

      const modelIds = [...new Set((produkData ?? []).map((p: any) => p.model_id).filter(Boolean))];

      if (modelIds.length > 0) {
        const { data: modelData, error: modelErr } = await supabase
          .from('model_produk')
          .select('id, nama')
          .in('id', modelIds);

        if (modelErr) throw new Error('Model fetch error: ' + modelErr.message);

        // produk_id → model nama
        const modelNameById: Record<string, string> = {};
        (modelData ?? []).forEach((m: any) => { modelNameById[m.id] = m.nama; });
        (produkData ?? []).forEach((p: any) => {
          modelMap[p.id] = modelNameById[p.model_id] ?? '';
        });
      }
    }

    // 2d. Build bundleMap: bundle_id → enriched info
    (bundleData ?? []).forEach((b: any) => {
      const poItem = poItemMap[b.po_item_id];
      const modelNama = poItem ? (modelMap[poItem.produk_id] ?? '') : '';
      bundleMap[b.id] = {
        warna: poItem?.warna ?? '',
        size: poItem?.size ?? '',
        modelNama,
        qty: poItem?.qty_per_bundle ?? 0,
      };
    });
  }

  // Step 3: Map + enrich keterangan
  return data.map((row: any) => {
    const bundle = bundleMap[row.sumber_id];
    const { modelNama, warna, size, qty: bundleQty } = bundle ?? {};

    const total = Number(row.total);
    const qty = bundleQty || 0;
    const upah_per_pcs = qty > 0 ? Math.round(total / qty) : 0;

    const tahapPrefix = row.keterangan?.split(' - ')?.[0] ?? row.keterangan;
    const keteranganBaru = modelNama
      ? `${tahapPrefix} - ${modelNama} / ${warna} / ${size}`
      : row.keterangan;

    return {
      id: row.id,
      karyawan_id: row.karyawan_id,
      tipe: row.tipe,
      total,
      qty,
      upah_per_pcs,
      tanggal: row.tanggal,
      sumber_id: row.sumber_id,
      keterangan: keteranganBaru,
      status: row.status,
      tanggal_bayar: row.tanggal_bayar,
      is_printed: row.is_printed,
      created_at: row.created_at,
    };
  });
}

/**
 * Helper (D1): Dari array entry_ids gaji_ledger, trace ke UUID PO yang terlibat.
 * Path: gaji_ledger.sumber_id → bundle.id → bundle.po_item_id → po_item.po_id
 * Entry dengan sumber_id = 'SYSTEM' (gaji pokok prorata) difilter dan diabaikan.
 */
async function getPoIdsFromLedgerEntries(
  supabase: any,
  entry_ids: string[]
): Promise<string[]> {
  if (entry_ids.length === 0) return [];

  // 1. Ambil sumber_id (bundle UUID) dari ledger entries
  const { data: ledgerRows, error: ledgerErr } = await supabase
    .from('gaji_ledger')
    .select('sumber_id')
    .in('id', entry_ids);

  if (ledgerErr || !ledgerRows?.length) return [];

  const bundleIds = [...new Set(
    (ledgerRows as any[])
      .map((r) => r.sumber_id)
      .filter((id: string) => id && id !== 'SYSTEM')
  )] as string[];

  if (bundleIds.length === 0) return [];

  // 2. Dari bundle_ids, ambil po_item_id
  const { data: bundleRows } = await supabase
    .from('bundle')
    .select('po_item_id')
    .in('id', bundleIds);

  const poItemIds = [...new Set(
    (bundleRows ?? []).map((b: any) => b.po_item_id).filter(Boolean)
  )] as string[];

  if (poItemIds.length === 0) return [];

  // 3. Dari po_item_ids, ambil po_id
  const { data: poItemRows } = await supabase
    .from('po_item')
    .select('po_id')
    .in('id', poItemIds);

  const poIds = [...new Set(
    (poItemRows ?? []).map((pi: any) => pi.po_id).filter(Boolean)
  )] as string[];

  return poIds;
}

/** 3. Proses Pembayaran Gaji: Menggunakan RPC Atomic */
export async function prosesBayar(input: {
  karyawan_id: string;
  entry_ids: string[];
  hari_kerja: number;
  potong_kasbon: number;
}): Promise<void> {
  const supabase = await createClient();

  // 1. Ambil data karyawan untuk gaji_pokok dan nama
  const { data: karyawan, error: kError } = await supabase
    .from('karyawan')
    .select('gaji_pokok, nama')
    .eq('id', input.karyawan_id)
    .single();

  if (kError) throw new Error('Data karyawan tidak ditemukan');

  // 2. Hitung gaji pokok prorata (gapok / 6 hari * hari_kerja)
  const gapok = Number(karyawan.gaji_pokok) || 0;
  const gapok_prorata = (gapok / 6) * input.hari_kerja;

  // 3. (D1) Trace PO IDs dari entry ledger
  const tag_po_ids = await getPoIdsFromLedgerEntries(supabase, input.entry_ids);

  // 4. (D2) Hitung upah bersih dari entries untuk nominal jurnal
  const { data: ledgerEntries } = await supabase
    .from('gaji_ledger')
    .select('tipe, total')
    .in('id', input.entry_ids);

  const upah_bersih = (ledgerEntries ?? []).reduce((acc: number, e: any) => {
    if (e.tipe === 'selesai' || e.tipe === 'rework') return acc + Number(e.total);
    if (e.tipe === 'reject_potong') return acc - Number(e.total);
    return acc;
  }, 0);

  const total_bayar = upah_bersih + gapok_prorata - input.potong_kasbon;

  // 5. Panggil RPC Atomic pay_salary_atomic dengan tag_po_ids dan detail_upah
  const { error } = await supabase.rpc('pay_salary_atomic', {
    p_karyawan_id  : input.karyawan_id,
    p_ledger_ids   : input.entry_ids,
    p_tanggal_bayar: new Date().toISOString(),
    p_gapok_row    : (gapok_prorata > 0)
      ? { jumlah: gapok_prorata, keterangan: `Gaji Pokok (${input.hari_kerja} hari)` }
      : null,
    p_kasbon_row   : (input.potong_kasbon > 0)
      ? { jumlah: input.potong_kasbon, keterangan: 'Potongan Kasbon' }
      : null,
    p_jurnal_row   : (total_bayar > 0)
      ? {
          keterangan : `Pembayaran Gaji — ${karyawan.nama}`,
          nominal    : total_bayar,
          tag_po_ids : tag_po_ids,
          detail_upah: [{
            karyawan: karyawan.nama,
            jumlah  : total_bayar,
            po      : tag_po_ids.join(', '),
          }],
        }
      : null,
  });

  if (error) throw new Error(error.message);
}

/** 4. Ambil Histori Kasbon */
export async function getKasbon(karyawan_id?: string): Promise<KasbonItem[]> {
  const supabase = await createClient();

  let query = supabase
    .from('kasbon')
    .select(`
      id, karyawan_id, jumlah, keterangan, tanggal, status, created_at,
      karyawan:karyawan_id(nama)
    `)
    .eq('tenant_id', TENANT_ID)
    .order('tanggal', { ascending: false });

  if (karyawan_id) {
    query = query.eq('karyawan_id', karyawan_id);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  return (data ?? []).map((k: any) => ({
    id: k.id,
    karyawan_id: k.karyawan_id,
    karyawan_nama: k.karyawan?.nama || 'Unknown',
    jumlah: Number(k.jumlah),
    keterangan: k.keterangan || '-',
    tanggal: k.tanggal,
    status: k.status,
    created_at: k.created_at
  }));
}

/** Update status kasbon: belum_lunas <-> lunas */
export async function updateKasbonStatus(
  id: string,
  status: 'belum_lunas' | 'lunas'
): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from('kasbon')
    .update({ status })
    .eq('id', id)
    .eq('tenant_id', TENANT_ID);
  if (error) throw new Error(error.message);
}

/** 5. Tambah Kasbon Baru: Menggunakan RPC record_kasbon_atomic */
export async function addKasbon(input: {
  karyawan_id: string;
  jumlah: number;
  tanggal: string;
  keterangan: string;
}): Promise<void> {
  const supabase = await createClient();

  const { error } = await supabase.rpc('record_kasbon_atomic', {
    p_karyawan_id: input.karyawan_id,
    p_jumlah: input.jumlah,
    p_tanggal: input.tanggal,
    p_keterangan: input.keterangan,
    p_tenant_id: TENANT_ID
  });

  if (error) throw new Error(error.message);
}

/** 6. Helper: Daftar Karyawan Aktif */
export async function getKaryawanAktif(): Promise<{ id: string; nama: string; gaji_pokok: number }[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('karyawan')
    .select('id, nama, gaji_pokok')
    .eq('aktif', true)
    .eq('tenant_id', TENANT_ID)
    .order('nama');

  if (error) throw new Error(error.message);
  return data ?? [];
}

/** 7. Update status cetak slip */
export async function setSlipPrinted(entry_ids: string[]): Promise<void> {
  const supabase = await createClient();

  const { error } = await supabase
    .from('gaji_ledger')
    .update({ is_printed: true })
    .in('id', entry_ids)
    .eq('tenant_id', TENANT_ID);

  if (error) throw new Error(error.message);
}
