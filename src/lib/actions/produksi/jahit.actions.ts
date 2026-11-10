'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { getUserFromClaims } from '@/lib/auth/session';
import { matchesBundleQuery } from '@/lib/search/bundle-search';
import { TAHAP_ORDER, TAHAP_CONFIG, type TahapKey } from '@/modules/produksi/constants/tahap';

const TENANT_ID = 'STX-001';

export interface StokWarningJahit {
  item_nama: string;
  qty_kurang: number;
  sisa_stok: number;
}

async function getUserId(supabase: Awaited<ReturnType<typeof createClient>>): Promise<string> {
  const { data: { user }, error } = await getUserFromClaims(supabase);
  if (error || !user) throw new Error('Unauthorized');
  return user.id;
}

function revalidateProduksi() {
  revalidatePath('/app/produksi', 'layout');
}

/**
 * Serah terima banyak bundle ke satu penjahit — satu transaksi (semua
 * berhasil atau semua batal), termasuk benang. Bila `langsung_selesai`,
 * bundle sekaligus dicatat selesai jahit (input susulan).
 */
export async function serahTerimaJahitBatch(input: {
  bundle_ids: string[];
  karyawan_id: string;
  langsung_selesai: boolean;
  items?: { bundle_id: string; qty_selesai: number; alasan_qty_id: string | null }[];
  benang?: { inventory_item_id: string; qty: number }[];
}): Promise<{ jumlah: number; stok_warnings: StokWarningJahit[]; upah_total: number }> {
  const supabase = await createClient();
  const user_id = await getUserId(supabase);
  const { data, error } = await supabase.rpc('jahit_serah_terima_batch', {
    p_bundle_ids:       input.bundle_ids,
    p_karyawan_id:      input.karyawan_id,
    p_langsung_selesai: input.langsung_selesai,
    p_items:            input.items ?? [],
    p_benang:           input.benang ?? [],
    p_user_id:          user_id,
    p_tenant_id:        TENANT_ID,
  });
  if (error) throw new Error(error.message);
  revalidateProduksi();
  const r = (data ?? {}) as any;
  return {
    jumlah: Number(r.jumlah ?? 0),
    stok_warnings: r.stok_warnings ?? [],
    upah_total: Number(r.upah_total ?? 0),
  };
}

/** Selesaikan jahit banyak bundle — satu transaksi. */
export async function selesaiJahitBatch(
  items: { bundle_id: string; qty: number; alasan_qty_id: string | null; catatan?: string }[],
): Promise<{ jumlah: number; qty_lebih: number }> {
  const supabase = await createClient();
  const user_id = await getUserId(supabase);
  const { data, error } = await supabase.rpc('jahit_selesai_batch', {
    p_items:     items,
    p_user_id:   user_id,
    p_tenant_id: TENANT_ID,
  });
  if (error) throw new Error(error.message);
  revalidateProduksi();
  const r = (data ?? {}) as any;
  return { jumlah: Number(r.jumlah ?? 0), qty_lebih: Number(r.qty_lebih ?? 0) };
}

/**
 * Mundur satu langkah:
 *  - 'serah_terima' : Sedang Dijahit → Antrian (aksesori jahit dikembalikan)
 *  - 'selesai'      : Selesai → Sedang Dijahit (upah jahit dibatalkan)
 */
export async function batalJahitBatch(
  bundle_ids: string[],
  mode: 'serah_terima' | 'selesai',
  alasan: string,
): Promise<{ jumlah: number }> {
  const supabase = await createClient();
  const user_id = await getUserId(supabase);
  const { data, error } = await supabase.rpc('jahit_batal_batch', {
    p_bundle_ids: bundle_ids,
    p_mode:       mode,
    p_alasan:     alasan,
    p_user_id:    user_id,
    p_tenant_id:  TENANT_ID,
  });
  if (error) throw new Error(error.message);
  revalidateProduksi();
  return { jumlah: Number((data as any)?.jumlah ?? 0) };
}

/**
 * Salah klik Selesai Cutting: bundle di Antrian Jahit dikembalikan ke
 * "Sedang Dipotong" — upah potong dibatalkan, stok kain & bundle sisa
 * otomatis dikembalikan.
 */
export async function kembalikanKeCutting(bundle_ids: string[], alasan: string): Promise<{ jumlah: number }> {
  const supabase = await createClient();
  const user_id = await getUserId(supabase);
  const { data, error } = await supabase.rpc('batal_selesai_cutting', {
    p_bundle_ids: bundle_ids,
    p_alasan:     alasan,
    p_user_id:    user_id,
    p_tenant_id:  TENANT_ID,
  });
  if (error) throw new Error(error.message);
  revalidateProduksi();
  return { jumlah: Number((data as any)?.jumlah ?? 0) };
}

// ── Riwayat Selesai Jahit ────────────────────────────────────────────────

export interface SelesaiJahitItem {
  id: string;
  barcode: string;
  po_item_id: string;
  no_po: string;
  klien_nama: string;
  model_nama: string | null;
  warna: string;
  size: string;
  qty_per_bundle: number;
  karyawan_nama: string;
  waktu_selesai: string | null;
  /** Posisi bundle sekarang, mis. "Menunggu Buang Benang". */
  posisi: string;
  /** Tahap yang otomatis dilewati, mis. ["Lubang Kancing"]. */
  dilewati: string[];
  /** Batal selesai hanya boleh bila belum masuk tahap berikutnya. */
  bisa_batal: boolean;
}

function hitungPosisi(st: any): { posisi: string; dilewati: string[]; bisa_batal: boolean } {
  const setelahJahit = TAHAP_ORDER.slice(TAHAP_ORDER.indexOf('jahit') + 1) as TahapKey[];
  const dilewati: string[] = [];
  let bisa_batal = true;
  let posisi = 'Selesai semua tahap';
  let ketemu = false;
  for (const t of setelahJahit) {
    const s = st?.[t];
    if (s?.dilewati) { dilewati.push(TAHAP_CONFIG[t].label); continue; }
    if (s) bisa_batal = false;
    if (ketemu) continue;
    if (!s) { posisi = `Menunggu ${TAHAP_CONFIG[t].label}`; ketemu = true; }
    else if (s.status !== 'selesai') { posisi = `Di ${TAHAP_CONFIG[t].label}`; ketemu = true; }
  }
  return { posisi, dilewati, bisa_batal };
}

export async function getRiwayatSelesaiJahit(
  page: number,
  pageSize: number,
  search?: string,
): Promise<{ data: SelesaiJahitItem[]; total: number }> {
  const supabase = await createClient();
  const hasSearch = !!search?.trim();

  let query = supabase
    .from('bundle')
    .select(`
      id, barcode, status_tahap, po_item_id,
      po:po_id(no_po, klien:klien_id(nama)),
      po_item:po_item_id(warna, size, produk:produk_id(model:model_id(nama)))
    `, { count: 'exact' })
    .eq('tenant_id', TENANT_ID)
    .is('ditutup_at', null)
    .eq('status_tahap->jahit->>status', 'selesai')
    .order('status_tahap->jahit->>waktu_selesai', { ascending: false, nullsFirst: false });

  query = hasSearch
    ? query.limit(2000)
    : query.range((page - 1) * pageSize, page * pageSize - 1);

  const { data, count, error } = await query;
  if (error) throw new Error(`Gagal ambil riwayat jahit: ${error.message}`);

  const rows = (data ?? []) as any[];
  const karyawanIds = Array.from(new Set(rows.map(r => r.status_tahap?.jahit?.karyawan_id).filter(Boolean)));
  const karyawanMap: Record<string, string> = {};
  if (karyawanIds.length > 0) {
    const { data: k } = await supabase.from('karyawan').select('id, nama').in('id', karyawanIds);
    k?.forEach(x => { karyawanMap[x.id] = x.nama; });
  }

  const mapped: SelesaiJahitItem[] = rows.map(r => {
    const po = Array.isArray(r.po) ? r.po[0] : r.po;
    const klien = Array.isArray(po?.klien) ? po.klien[0] : po?.klien;
    const pi = Array.isArray(r.po_item) ? r.po_item[0] : r.po_item;
    const produk = Array.isArray(pi?.produk) ? pi.produk[0] : pi?.produk;
    const model = Array.isArray(produk?.model) ? produk.model[0] : produk?.model;
    const j = r.status_tahap?.jahit ?? {};
    return {
      id: r.id,
      barcode: r.barcode,
      po_item_id: r.po_item_id,
      no_po: po?.no_po ?? '-',
      klien_nama: klien?.nama ?? '-',
      model_nama: model?.nama ?? null,
      warna: pi?.warna ?? '-',
      size: pi?.size ?? '-',
      qty_per_bundle: Number(j.qty_selesai ?? j.qty_terima ?? 0),
      karyawan_nama: karyawanMap[j.karyawan_id] ?? '-',
      waktu_selesai: j.waktu_selesai ?? null,
      ...hitungPosisi(r.status_tahap),
    };
  });

  if (!hasSearch) return { data: mapped, total: count ?? 0 };

  const filtered = mapped.filter(m =>
    matchesBundleQuery(m, search!) || m.karyawan_nama.toLowerCase().includes(search!.trim().toLowerCase()));
  const start = (page - 1) * pageSize;
  return { data: filtered.slice(start, start + pageSize), total: filtered.length };
}
