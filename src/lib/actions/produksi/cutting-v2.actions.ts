'use server';

/**
 * Alur Cutting versi 2 (Nov 2026)
 *
 *  - Status dihitung PER BUNDLE, bukan per artikel: satu artikel boleh muncul
 *    di Menunggu dan Sedang Dipotong sekaligus.
 *  - Isi bundle = bundle.qty_rencana (bundle sisa pembagian tidak lagi terbaca
 *    penuh). Hasil potong asli = status_tahap.cutting.qty_aktual.
 *  - Mulai Cutting menerima qty per bundle; sisa otomatis jadi bundle Menunggu.
 *  - Selesai Cutting: kurang → sisa ke Menunggu, lebih → ditandai, bahan dicatat
 *    per bundle (RPC selesai_cutting_v2).
 *  - Bahan & pemakaian/pcs diisi otomatis dari riwayat, jenis bahan kategori,
 *    dan standar per model + ukuran.
 */

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import type { AntrianBundle } from './antrian.actions';

const TENANT_ID = 'STX-001';
const PATH = '/app/produksi/antrian-cutting';

export type CuttingStatus = 'menunggu' | 'progress' | 'selesai';

export interface CuttingRow {
  /** po_id::model::status — unik per baris di tiap tab */
  row_id: string;
  po_id: string;
  no_po: string;
  klien_nama: string;
  model_nama: string | null;
  status: CuttingStatus;
  total_bundle: number;
  total_qty: number;
  /** Total kelebihan hasil potong (tab Selesai) */
  qty_lebih: number;
  /** Mulai paling awal (tab Sedang Dipotong) / selesai paling akhir (tab Selesai) */
  waktu: string | null;
}

export interface CuttingBundle {
  id: string;
  barcode: string;
  po_item_id: string;
  warna: string;
  size: string;
  qty_rencana: number;
  qty_aktual: number | null;
  qty_lebih: number;
  status: CuttingStatus;
}

// ─── helpers ────────────────────────────────────────────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */
const one = <T,>(v: any): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

function statusOf(statusTahap: any): CuttingStatus {
  const s = statusTahap?.cutting?.status as string | undefined;
  if (!s) return 'menunggu';
  if (s === 'progress' || s === 'terima') return 'progress';
  return 'selesai'; // selesai | partial (data lama)
}

function rowId(po_id: string, model: string | null, status: CuttingStatus) {
  return `${po_id}::${model ?? ''}::${status}`;
}

async function resolveUserId() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) throw new Error('Unauthorized');
  return user.id;
}

const BUNDLE_SELECT = `
  id, barcode, po_id, po_item_id, qty_rencana, status_tahap, ditutup_at,
  po:po_id ( no_po, klien:klien_id ( nama ) ),
  po_item:po_item_id ( warna, size, qty_per_bundle, produk:produk_id ( model:model_id ( nama ) ) )
`;

function flatten(raw: any) {
  const po = one<any>(raw.po);
  const pi = one<any>(raw.po_item);
  const produk = one<any>(pi?.produk);
  const model = one<any>(produk?.model);
  const cutting = raw.status_tahap?.cutting ?? null;
  const qtyAktual = cutting?.qty_aktual != null ? Number(cutting.qty_aktual) : null;
  return {
    id: raw.id as string,
    barcode: raw.barcode as string,
    po_id: raw.po_id as string,
    po_item_id: raw.po_item_id as string,
    no_po: (po?.no_po ?? '-') as string,
    klien_nama: (one<any>(po?.klien)?.nama ?? '-') as string,
    model_nama: (model?.nama ?? null) as string | null,
    warna: (pi?.warna ?? '-') as string,
    size: (pi?.size ?? '-') as string,
    qty_rencana: Number(raw.qty_rencana ?? pi?.qty_per_bundle ?? 0),
    qty_aktual: qtyAktual,
    qty_lebih: Number(cutting?.qty_lebih ?? 0),
    status: statusOf(raw.status_tahap),
    start_time: (cutting?.start_time ?? null) as string | null,
    waktu_selesai: (cutting?.waktu_selesai ?? cutting?.closed_at ?? null) as string | null,
    ditutup: !!raw.ditutup_at,
  };
}

// ─── Daftar baris per tab ───────────────────────────────────────────────────

export async function getCuttingRows(): Promise<CuttingRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('bundle')
    .select(BUNDLE_SELECT)
    .eq('tenant_id', TENANT_ID)
    .order('created_at', { ascending: true });
  if (error) throw new Error(`Gagal memuat antrian cutting: ${error.message}`);

  const map = new Map<string, CuttingRow>();
  for (const raw of data ?? []) {
    const b = flatten(raw);
    // Bundle data lama yang ditutup hanya tampil di Selesai
    if (b.ditutup && b.status !== 'selesai') continue;

    const id = rowId(b.po_id, b.model_nama, b.status);
    let row = map.get(id);
    if (!row) {
      row = {
        row_id: id, po_id: b.po_id, no_po: b.no_po, klien_nama: b.klien_nama,
        model_nama: b.model_nama, status: b.status,
        total_bundle: 0, total_qty: 0, qty_lebih: 0, waktu: null,
      };
      map.set(id, row);
    }
    row.total_bundle += 1;
    row.total_qty += b.status === 'selesai' ? (b.qty_aktual ?? b.qty_rencana) : b.qty_rencana;
    row.qty_lebih += b.qty_lebih;
    if (b.status === 'progress' && b.start_time && (!row.waktu || b.start_time < row.waktu)) row.waktu = b.start_time;
    if (b.status === 'selesai' && b.waktu_selesai && (!row.waktu || b.waktu_selesai > row.waktu)) row.waktu = b.waktu_selesai;
  }

  return [...map.values()].sort((a, b) => {
    // Selesai: terbaru dulu; lainnya: urut No PO lalu model
    if (a.status === 'selesai' && b.status === 'selesai') return String(b.waktu).localeCompare(String(a.waktu));
    return a.no_po.localeCompare(b.no_po) || (a.model_nama ?? '').localeCompare(b.model_nama ?? '');
  });
}

/** Bundle dalam satu baris (PO + model + status). */
export async function getCuttingBundles(
  po_id: string, model_nama: string | null, status: CuttingStatus,
): Promise<CuttingBundle[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('bundle')
    .select(BUNDLE_SELECT)
    .eq('po_id', po_id)
    .eq('tenant_id', TENANT_ID);
  if (error) throw new Error(`Gagal memuat bundle: ${error.message}`);

  return (data ?? [])
    .map(flatten)
    .filter(b => b.model_nama === model_nama && b.status === status && !(b.ditutup && status !== 'selesai'))
    .sort((a, b) =>
      a.warna.localeCompare(b.warna) || a.size.localeCompare(b.size) || a.barcode.localeCompare(b.barcode))
    .map(b => ({
      id: b.id, barcode: b.barcode, po_item_id: b.po_item_id, warna: b.warna, size: b.size,
      qty_rencana: b.qty_rencana, qty_aktual: b.qty_aktual, qty_lebih: b.qty_lebih, status: b.status,
    }));
}

// ─── Mulai Cutting ──────────────────────────────────────────────────────────

export interface MulaiResult {
  success: boolean;
  jumlah_bundle: number;
  sisa: { dari: string; barcode: string; qty: number }[];
  error?: string;
}

export async function mulaiCuttingV2(items: { bundle_id: string; qty: number }[]): Promise<MulaiResult> {
  try {
    const user_id = await resolveUserId();
    const supabase = await createClient();
    const { data, error } = await supabase.rpc('mulai_cutting_v2', {
      p_items: items, p_user_id: user_id, p_tenant_id: TENANT_ID,
    });
    if (error) return { success: false, jumlah_bundle: 0, sisa: [], error: error.message };
    revalidatePath(PATH);
    const r = data as { jumlah_bundle?: number; sisa?: MulaiResult['sisa'] } | null;
    return { success: true, jumlah_bundle: r?.jumlah_bundle ?? 0, sisa: r?.sisa ?? [] };
  } catch (e: any) {
    return { success: false, jumlah_bundle: 0, sisa: [], error: e?.message ?? 'Terjadi kesalahan' };
  }
}

// ─── Selesai Cutting ────────────────────────────────────────────────────────

export interface SelesaiResult {
  success: boolean;
  jumlah_bundle: number;
  total_qty: number;
  kembali_antri: number;
  sisa: { dari: string; barcode: string; qty: number }[];
  lebih: { barcode: string; lebih: number; sisa_dikurangi: number }[];
  total_upah: number;
  stok_warnings: { item_nama: string; qty_kurang: number; sisa_stok: number }[];
  error?: string;
}

const EMPTY_SELESAI: Omit<SelesaiResult, 'success'> = {
  jumlah_bundle: 0, total_qty: 0, kembali_antri: 0, sisa: [], lebih: [], total_upah: 0, stok_warnings: [],
};

export async function selesaiCuttingV2(
  bundles: { bundle_id: string; qty_aktual: number }[],
  pemakaian: { po_item_id: string; inventory_item_id: string; rate_per_pcs: number }[],
  kurangiSisa: boolean,
  karyawanId: string | null,
): Promise<SelesaiResult> {
  try {
    const user_id = await resolveUserId();
    const supabase = await createClient();
    const { data, error } = await supabase.rpc('selesai_cutting_v2', {
      p_bundles: bundles,
      p_pemakaian: pemakaian,
      p_kurangi_sisa: kurangiSisa,
      p_user_id: user_id,
      p_tenant_id: TENANT_ID,
      p_karyawan_id: karyawanId,
    });
    if (error) return { success: false, ...EMPTY_SELESAI, error: error.message };
    revalidatePath(PATH);
    const r = (data ?? {}) as Partial<SelesaiResult>;
    return {
      success: true,
      jumlah_bundle: r.jumlah_bundle ?? 0,
      total_qty: r.total_qty ?? 0,
      kembali_antri: r.kembali_antri ?? 0,
      sisa: r.sisa ?? [],
      lebih: r.lebih ?? [],
      total_upah: Number(r.total_upah ?? 0),
      stok_warnings: r.stok_warnings ?? [],
    };
  } catch (e: any) {
    return { success: false, ...EMPTY_SELESAI, error: e?.message ?? 'Terjadi kesalahan' };
  }
}

// ─── Data modal Selesai: bundle + artikel ───────────────────────────────────

export interface BundleSelesai {
  id: string;
  barcode: string;
  po_item_id: string;
  produk_nama: string;
  warna: string;
  size: string;
  qty_rencana: number;
}

export async function getBundlesForSelesai(ids: string[]): Promise<BundleSelesai[]> {
  if (!ids.length) return [];
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('bundle')
    .select('id, barcode, po_item_id, qty_rencana, po_item:po_item_id ( warna, size, qty_per_bundle, produk:produk_id ( nama ) )')
    .in('id', ids)
    .eq('tenant_id', TENANT_ID);
  if (error) throw new Error(`Gagal memuat bundle: ${error.message}`);

  return (data ?? []).map((b: any) => {
    const pi = one<any>(b.po_item);
    return {
      id: b.id, barcode: b.barcode, po_item_id: b.po_item_id,
      produk_nama: one<any>(pi?.produk)?.nama ?? '-',
      warna: pi?.warna ?? '-', size: pi?.size ?? '-',
      qty_rencana: Number(b.qty_rencana ?? pi?.qty_per_bundle ?? 0),
    };
  }).sort((a, b) => a.produk_nama.localeCompare(b.produk_nama) || a.barcode.localeCompare(b.barcode));
}

// ─── Bahan otomatis ─────────────────────────────────────────────────────────

export interface BahanDefault {
  inventory_item_id: string;
  rate_per_pcs: number | null;
  /** Asal pilihan bahan */
  sumber_bahan: 'riwayat' | 'kategori';
  /** Asal angka pemakaian — null berarti belum ada, wajib diisi */
  sumber_rate: 'standar' | null;
}

const normWarna = (s: string) => s.toLowerCase().replace(/\s+/g, '');

/**
 * Bahan + pemakaian/pcs default per artikel (po_item):
 *  Bahan  : 1) bahan terakhir untuk model + warna yang sama
 *           2) jenis bahan kategori × warna produk (kombinasi "A x B" → 2 bahan)
 *  Rate   : standar pemakaian model + ukuran; kosong kalau belum ada.
 */
export async function getBahanDefaults(poItemIds: string[]): Promise<Record<string, BahanDefault[]>> {
  if (!poItemIds.length) return {};
  const supabase = await createClient();

  const [itemsRes, invRes, histRes] = await Promise.all([
    supabase.from('po_item')
      .select('id, warna, size, produk:produk_id ( model_id, model:model_id ( kategori:kategori_id ( jenis_bahan ) ) )')
      .in('id', poItemIds),
    supabase.from('inventory_item')
      .select('id, nama, warna:warna_id ( nama )')
      .eq('tenant_id', TENANT_ID),
    supabase.from('pemakaian_bahan')
      .select('bundle_id, inventory_item_id, created_at, po_item:po_item_id ( warna, produk:produk_id ( model_id ) )')
      .eq('tenant_id', TENANT_ID)
      .order('created_at', { ascending: false }),
  ]);
  if (itemsRes.error) throw new Error(itemsRes.error.message);
  if (invRes.error) throw new Error(invRes.error.message);
  if (histRes.error) throw new Error(histRes.error.message);

  const items = (itemsRes.data ?? []).map((it: any) => {
    const produk = one<any>(it.produk);
    const kategori = one<any>(one<any>(produk?.model)?.kategori);
    return {
      id: it.id as string, warna: it.warna as string, size: it.size as string,
      model_id: (produk?.model_id ?? null) as string | null,
      jenis_bahan: (kategori?.jenis_bahan ?? null) as string | null,
    };
  });

  const modelIds = [...new Set(items.map(i => i.model_id).filter(Boolean))] as string[];
  const standarRes = modelIds.length
    ? await supabase.from('standar_pemakaian_bahan')
        .select('model_id, size, rate_per_pcs').eq('tenant_id', TENANT_ID).in('model_id', modelIds)
    : { data: [], error: null };
  if (standarRes.error) throw new Error(standarRes.error.message);
  const standar = new Map<string, number>(
    (standarRes.data ?? []).map((s: any) => [`${s.model_id}|${s.size}`, Number(s.rate_per_pcs)]));

  const inv = (invRes.data ?? []).map((i: any) => ({
    id: i.id as string, nama: String(i.nama), warna: one<any>(i.warna)?.nama as string | undefined,
  }));

  // Bahan berwarna hanya dianggap cocok bila warnanya bagian dari warna produk
  // ("Black x Grey" → Black / Dark Grey / Light Grey). Melindungi dari riwayat salah pilih.
  const warnaInv = new Map(inv.map(i => [i.id, i.warna ? normWarna(i.warna) : null]));
  const warnaCocok = (invId: string, warnaProduk: string) => {
    const w = warnaInv.get(invId);
    if (!w) return true; // bahan tanpa warna (mis. puring) selalu boleh
    return warnaProduk.split(/\s+x\s+/i).map(normWarna).some(p => w === p || w.endsWith(p));
  };

  // Riwayat: bahan dari bundle TERAKHIR per model + warna
  const riwayat = new Map<string, string[]>();
  const bundleTerakhir = new Map<string, string>();
  for (const h of histRes.data ?? [] as any[]) {
    const pi = one<any>((h as any).po_item);
    const modelId = one<any>(pi?.produk)?.model_id;
    if (!modelId || !pi?.warna) continue;
    if (!warnaCocok((h as any).inventory_item_id, pi.warna)) continue;
    const key = `${modelId}|${normWarna(pi.warna)}`;
    const bundleId = (h as any).bundle_id as string;
    if (!bundleTerakhir.has(key)) bundleTerakhir.set(key, bundleId);
    if (bundleTerakhir.get(key) !== bundleId) continue;
    const list = riwayat.get(key) ?? [];
    if (!list.includes((h as any).inventory_item_id)) list.push((h as any).inventory_item_id);
    riwayat.set(key, list);
  }

  const result: Record<string, BahanDefault[]> = {};
  for (const it of items) {
    const rate = it.model_id ? standar.get(`${it.model_id}|${it.size}`) ?? null : null;
    const sumber_rate = rate != null ? 'standar' as const : null;

    const dariRiwayat = it.model_id ? riwayat.get(`${it.model_id}|${normWarna(it.warna)}`) : undefined;
    if (dariRiwayat?.length) {
      result[it.id] = dariRiwayat.map(id => ({ inventory_item_id: id, rate_per_pcs: rate, sumber_bahan: 'riwayat', sumber_rate }));
      continue;
    }

    // Kategori × warna: "Black x Grey" → bahan warna Black + bahan warna Grey
    const list: BahanDefault[] = [];
    if (it.jenis_bahan) {
      const prefix = it.jenis_bahan.toLowerCase();
      const kandidat = inv.filter(i => i.nama.toLowerCase().startsWith(prefix) && i.warna);
      for (const part of it.warna.split(/\s+x\s+/i).map(normWarna)) {
        const persis = kandidat.filter(i => normWarna(i.warna!) === part);
        const cocok = persis.length ? persis : kandidat.filter(i => normWarna(i.warna!).endsWith(part));
        if (cocok.length === 1 && !list.some(l => l.inventory_item_id === cocok[0].id)) {
          list.push({ inventory_item_id: cocok[0].id, rate_per_pcs: rate, sumber_bahan: 'kategori', sumber_rate });
        }
      }
    }
    result[it.id] = list;
  }
  return result;
}

// ─── Data cetak (tiket / SPK / label / kartu) ──────────────────────────────

/**
 * Bundle terpilih dalam bentuk AntrianBundle untuk layout cetak.
 * QTY = hasil potong asli bila sudah selesai, selain itu isi bundle.
 */
export async function getPrintBundlesByIds(ids: string[]): Promise<AntrianBundle[]> {
  if (!ids.length) return [];
  const supabase = await createClient();
  const rows: any[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await supabase
      .from('bundle')
      .select(`
        id, barcode, no_urut, po_id, po_item_id, qty_rencana, status_tahap,
        po:po_id ( no_po, tanggal_order, tanggal_target, catatan, klien:klien_id ( nama ) ),
        po_item:po_item_id ( warna, size, qty_per_bundle, produk:produk_id ( nama, model:model_id ( nama ) ) )
      `)
      .in('id', ids.slice(i, i + 100))
      .eq('tenant_id', TENANT_ID);
    if (error) throw new Error(`Gagal memuat data cetak: ${error.message}`);
    rows.push(...(data ?? []));
  }

  return rows.map(raw => {
    const po = one<any>(raw.po);
    const pi = one<any>(raw.po_item);
    const produk = one<any>(pi?.produk);
    const qtyAktual = raw.status_tahap?.cutting?.qty_aktual;
    return {
      id: raw.id, barcode: raw.barcode, no_urut: raw.no_urut, po_id: raw.po_id, po_item_id: raw.po_item_id,
      no_po: po?.no_po ?? '-', tanggal_order: po?.tanggal_order ?? '', tanggal_target: po?.tanggal_target ?? '',
      po_catatan: po?.catatan ?? null, klien_nama: one<any>(po?.klien)?.nama ?? '-',
      warna: pi?.warna ?? '-', size: pi?.size ?? '-',
      qty_per_bundle: qtyAktual != null ? Number(qtyAktual) : Number(raw.qty_rencana ?? pi?.qty_per_bundle ?? 0),
      model_nama: one<any>(produk?.model)?.nama ?? produk?.nama ?? null,
    } satisfies AntrianBundle;
  }).sort((a, b) => a.barcode.localeCompare(b.barcode));
}

// ─── Batalkan (Sedang Dipotong → Menunggu) ─────────────────────────────────

/**
 * Kembalikan bundle yang sedang dipotong ke Menunggu. Bundle sisa yang dibuat
 * saat Mulai (masih Menunggu) digabung kembali ke bundle asalnya.
 */
export async function batalMulaiCutting(
  bundleIds: string[],
): Promise<{ success: boolean; jumlah_bundle: number; sisa_digabung: number; error?: string }> {
  try {
    const user_id = await resolveUserId();
    const supabase = await createClient();
    const { data, error } = await supabase.rpc('batal_mulai_cutting', {
      p_bundle_ids: bundleIds, p_user_id: user_id, p_tenant_id: TENANT_ID,
    });
    if (error) return { success: false, jumlah_bundle: 0, sisa_digabung: 0, error: error.message };
    revalidatePath(PATH);
    const r = data as { jumlah_bundle?: number; sisa_digabung?: number } | null;
    return { success: true, jumlah_bundle: r?.jumlah_bundle ?? 0, sisa_digabung: r?.sisa_digabung ?? 0 };
  } catch (e: any) {
    return { success: false, jumlah_bundle: 0, sisa_digabung: 0, error: e?.message ?? 'Terjadi kesalahan' };
  }
}
