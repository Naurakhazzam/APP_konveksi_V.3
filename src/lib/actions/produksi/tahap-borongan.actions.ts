'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { matchesBundleQuery } from '@/lib/search/bundle-search';
import { TAHAP_ORDER, TAHAP_CONFIG, getPrevTahap, type TahapKey } from '@/modules/produksi/constants/tahap';

/**
 * Tahap borongan: Lubang Kancing, Buang Benang, QC, Steam.
 * Tidak ada langkah "terima" terpisah — bundle di Antrian langsung
 * diselesaikan (terima + selesai dalam satu transaksi di DB).
 */
export type TahapBorongan = 'lubang_kancing' | 'buang_benang' | 'qc' | 'steam';

const TENANT_ID = 'STX-001';

async function getUserId(supabase: Awaited<ReturnType<typeof createClient>>): Promise<string> {
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) throw new Error('Unauthorized');
  return user.id;
}

export interface BundleTahapItem {
  id: string;
  barcode: string;
  po_item_id: string;
  no_po: string;
  klien_nama: string;
  model_nama: string | null;
  warna: string;
  size: string;
  /** Qty masuk tahap ini (hasil tahap sebelumnya). */
  qty_per_bundle: number;
  penjahit_nama: string;
  /** Waktu selesai tahap sebelumnya (Antrian) / tahap ini (Selesai). */
  waktu: string | null;
}

export interface SelesaiTahapItem extends BundleTahapItem {
  posisi: string;
  dilewati: string[];
  bisa_batal: boolean;
}

const SELECT = `
  id, barcode, status_tahap, po_item_id,
  po:po_id(no_po, klien:klien_id(nama)),
  po_item:po_item_id(warna, size, qty_per_bundle, produk:produk_id(model:model_id(nama)))
`;

const satu = (x: any) => (Array.isArray(x) ? x[0] : x);

async function petaKaryawan(supabase: Awaited<ReturnType<typeof createClient>>, rows: any[]) {
  const ids = Array.from(new Set(rows.map(r => r.status_tahap?.jahit?.karyawan_id).filter(Boolean)));
  const map: Record<string, string> = {};
  if (ids.length > 0) {
    const { data } = await supabase.from('karyawan').select('id, nama').in('id', ids);
    data?.forEach(k => { map[k.id] = k.nama; });
  }
  return map;
}

function petakan(r: any, karyawan: Record<string, string>, qty: number, waktu: string | null): BundleTahapItem {
  const po = satu(r.po);
  const pi = satu(r.po_item);
  const model = satu(satu(pi?.produk)?.model);
  return {
    id: r.id,
    barcode: r.barcode,
    po_item_id: r.po_item_id,
    no_po: po?.no_po ?? '-',
    klien_nama: satu(po?.klien)?.nama ?? '-',
    model_nama: model?.nama ?? null,
    warna: pi?.warna ?? '-',
    size: pi?.size ?? '-',
    qty_per_bundle: qty,
    penjahit_nama: karyawan[r.status_tahap?.jahit?.karyawan_id] ?? '-',
    waktu,
  };
}

/** Semua bundle di Antrian tahap ini (tanpa paginasi), PO terbaru dulu. */
export async function getAntrianTahap(tahap: TahapBorongan): Promise<BundleTahapItem[]> {
  const supabase = await createClient();
  const prev = getPrevTahap(tahap)!;

  const { data, error } = await supabase
    .from('bundle')
    .select(SELECT)
    .eq('tenant_id', TENANT_ID)
    .is('ditutup_at', null)
    .eq(`status_tahap->${prev}->>status`, 'selesai')
    .or(`status_tahap->${tahap}->>status.is.null,status_tahap->${tahap}->>status.neq.selesai`)
    .limit(5000);
  if (error) throw new Error(`Gagal ambil antrian: ${error.message}`);

  const rows = (data ?? []) as any[];
  const karyawan = await petaKaryawan(supabase, rows);

  const hasil = rows.map(r => {
    const st = r.status_tahap ?? {};
    const p = st[prev] ?? {};
    const qty = Number(
      st[tahap]?.qty_terima ?? p.qty_selesai ?? p.qty_terima ?? st.cutting?.qty_aktual
        ?? satu(r.po_item)?.qty_per_bundle ?? 0,
    );
    return petakan(r, karyawan, qty, p.waktu_selesai ?? null);
  });

  hasil.sort((a, b) => (a.no_po !== b.no_po ? b.no_po.localeCompare(a.no_po) : a.barcode.localeCompare(b.barcode)));
  return hasil;
}

function hitungPosisi(st: any, tahap: TahapBorongan) {
  const setelah = TAHAP_ORDER.slice(TAHAP_ORDER.indexOf(tahap) + 1) as TahapKey[];
  const dilewati: string[] = [];
  let bisa_batal = true;
  let posisi = 'Selesai semua tahap';
  let ketemu = false;
  for (const t of setelah) {
    const s = st?.[t];
    if (s?.dilewati) { dilewati.push(TAHAP_CONFIG[t].label); continue; }
    if (s) bisa_batal = false;
    if (ketemu) continue;
    if (!s) { posisi = `Menunggu ${TAHAP_CONFIG[t].label}`; ketemu = true; }
    else if (s.status !== 'selesai') { posisi = `Di ${TAHAP_CONFIG[t].label}`; ketemu = true; }
  }
  return { posisi, dilewati, bisa_batal };
}

/** Riwayat selesai tahap ini (bukan yang otomatis dilewati), terbaru dulu. */
export async function getRiwayatSelesaiTahap(
  tahap: TahapBorongan, page: number, pageSize: number, search?: string,
): Promise<{ data: SelesaiTahapItem[]; total: number }> {
  const supabase = await createClient();
  const hasSearch = !!search?.trim();

  let query = supabase
    .from('bundle')
    .select(SELECT, { count: 'exact' })
    .eq('tenant_id', TENANT_ID)
    .is('ditutup_at', null)
    .eq(`status_tahap->${tahap}->>status`, 'selesai')
    .or(`status_tahap->${tahap}->>dilewati.is.null,status_tahap->${tahap}->>dilewati.neq.true`)
    .order(`status_tahap->${tahap}->>waktu_selesai`, { ascending: false, nullsFirst: false });

  query = hasSearch ? query.limit(2000) : query.range((page - 1) * pageSize, page * pageSize - 1);

  const { data, count, error } = await query;
  if (error) throw new Error(`Gagal ambil riwayat: ${error.message}`);

  const rows = (data ?? []) as any[];
  const karyawan = await petaKaryawan(supabase, rows);
  const mapped: SelesaiTahapItem[] = rows.map(r => {
    const s = r.status_tahap?.[tahap] ?? {};
    return {
      ...petakan(r, karyawan, Number(s.qty_selesai ?? s.qty_terima ?? 0), s.waktu_selesai ?? null),
      ...hitungPosisi(r.status_tahap, tahap),
    };
  });

  if (!hasSearch) return { data: mapped, total: count ?? 0 };
  const q = search!.trim().toLowerCase();
  const filtered = mapped.filter(m => matchesBundleQuery(m, search!) || m.penjahit_nama.toLowerCase().includes(q));
  const start = (page - 1) * pageSize;
  return { data: filtered.slice(start, start + pageSize), total: filtered.length };
}

/** Selesaikan banyak bundle sekaligus — satu transaksi (semua atau tidak sama sekali). */
export async function selesaiTahapBatch(
  tahap: TahapBorongan,
  items: { bundle_id: string; qty?: number; alasan_qty_id?: string | null }[],
): Promise<{ jumlah: number; upah_total: number }> {
  const supabase = await createClient();
  const user_id = await getUserId(supabase);
  const { data, error } = await supabase.rpc('tahap_selesai_batch', {
    p_tahap: tahap,
    p_items: items,
    p_user_id: user_id,
    p_tenant_id: TENANT_ID,
  });
  if (error) throw new Error(error.message);
  revalidatePath('/app/produksi', 'layout');
  const r = (data ?? {}) as any;
  return { jumlah: Number(r.jumlah ?? 0), upah_total: Number(r.upah_total ?? 0) };
}

/** Salah klik Selesai: kembalikan ke Antrian (upah dibatalkan, stok aksesori kembali). */
export async function batalSelesaiTahapBatch(
  tahap: TahapBorongan, bundle_ids: string[], alasan: string,
): Promise<{ jumlah: number }> {
  const supabase = await createClient();
  const user_id = await getUserId(supabase);
  const { data, error } = await supabase.rpc('tahap_batal_selesai_batch', {
    p_tahap: tahap,
    p_bundle_ids: bundle_ids,
    p_alasan: alasan,
    p_user_id: user_id,
    p_tenant_id: TENANT_ID,
  });
  if (error) throw new Error(error.message);
  revalidatePath('/app/produksi', 'layout');
  return { jumlah: Number((data as any)?.jumlah ?? 0) };
}
