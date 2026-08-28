'use server';

import { createClient } from '@/lib/supabase/server';
import { getCurrentUserProfile } from '@/lib/auth/permissions';
import { TAHAP_ORDER as STAGE_ORDER, type TahapKey } from '@/modules/produksi/constants/tahap';
import { matchesBundleQuery } from '@/lib/search/bundle-search';

const TENANT_ID = 'STX-001';

// Cocokkan per-kata (bebas urutan) ke no_po, klien, model, warna, size,
// barcode. Logikanya dipakai bersama halaman lain — lihat lib/search.
const matchesSearch = matchesBundleQuery;

export interface AntrianBundleItem {
  id: string;
  barcode: string;
  status_tahap: any;
  no_po: string;
  po_item_id: string;
  klien_nama: string;
  warna: string;
  size: string;
  qty_per_bundle: number;
  model_nama: string;
  status: 'menunggu' | 'sedang_proses';
  jahit_karyawan_nama: string;
  jahit_waktu_selesai: string | null;
}

export interface SelesaiBundleItem extends Omit<AntrianBundleItem, 'status'> {
  karyawan_id: string;
  karyawan_nama: string;
  waktu_selesai: string;
}

/**
 * Mengambil antrian bundle per tahap produksi.
 */
export async function getAntrianPerTahap(tahap: TahapKey, page: number, pageSize: number, search?: string): Promise<{ data: AntrianBundleItem[], total: number }> {
  const profile = await getCurrentUserProfile();
  if (!profile) throw new Error('Unauthorized');

  const supabase = await createClient();
  const offset = (page - 1) * pageSize;
  const hasSearch = !!search?.trim();

  const selectClause = `
    id, barcode, status_tahap, po_item_id,
    po:po_id(no_po, klien:klien_id(nama)),
    po_item:po_item_id(
      warna, size, qty_per_bundle,
      produk:produk_id(model:model_id(nama))
    )
  `;

  let query = supabase
    .from('bundle')
    .select(selectClause, { count: 'exact' })
    .eq('tenant_id', TENANT_ID);

  const stageIndex = STAGE_ORDER.indexOf(tahap);
  if (stageIndex === -1) throw new Error(`Tahap ${tahap} tidak valid`);
  const prevStage = stageIndex > 0 ? STAGE_ORDER[stageIndex - 1] : null;

  if (tahap === 'cutting') {
    query = query.not('status_tahap', 'cs', JSON.stringify({ cutting: { status: 'selesai' } }));
  } else {
    // Tahap sebelumnya (dinamis sesuai STAGE_ORDER) harus benar-benar 'selesai' —
    // bukan 'terima' (masih dikerjakan) — sebelum bundle boleh masuk antrian tahap ini.
    // Dicek di query (bukan filter JS setelah .range()) supaya total & isi per
    // halaman selalu konsisten.
    query = query
      .contains('status_tahap', { [prevStage!]: { status: 'selesai' } })
      .not('status_tahap', 'cs', JSON.stringify({ [tahap]: { status: 'selesai' } }));
  }

  // Saat mencari (search), ambil semua baris yang cocok filter tahap dulu
  // (tanpa .range()) supaya pencarian menjangkau seluruh data, bukan cuma
  // halaman yang sedang tampil — baru dipotong per halaman manual di JS
  // setelah difilter oleh kata kunci.
  if (!hasSearch) {
    query = query.range(offset, offset + pageSize - 1);
  }

  const { data, count, error } = await query
    .order('created_at', { ascending: true });

  if (error) throw new Error(`Gagal ambil antrian ${tahap}: ${error.message}`);

  // Ambil nama penjahit (tahap jahit selalu sudah selesai untuk bundle yang
  // muncul di sini, karena tahap ini bukan 'jahit' sendiri — lihat guard di atas)
  const jahitKaryawanIds = Array.from(
    new Set((data as any[]).map(item => item.status_tahap?.jahit?.karyawan_id).filter(Boolean))
  );

  const jahitKaryawanMap: Record<string, string> = {};
  if (jahitKaryawanIds.length > 0) {
    const { data: kData } = await supabase.from('karyawan').select('id, nama').in('id', jahitKaryawanIds);
    kData?.forEach(k => jahitKaryawanMap[k.id] = k.nama);
  }

  const mappedData: AntrianBundleItem[] = (data as any[]).map(item => {
    const stageInfo = item.status_tahap?.[tahap];
    const status: 'menunggu' | 'sedang_proses' = (stageInfo?.status === 'terima') ? 'sedang_proses' : 'menunggu';
    const jahitInfo = item.status_tahap?.jahit;

    // Prioritas qty efektif bundle ini: qty_terima tahap ini sendiri (kalau
    // sudah diserahterimakan — termasuk bundle hasil Split, yang qty-nya
    // memang beda dari qty tahap sebelumnya) → qty_selesai tahap sebelumnya
    // (rencana yang akan diterima di tahap ini) → qty_aktual cutting →
    // qty_per_bundle rencana sebagai fallback terakhir.
    const qtyTerimaCurrent = stageInfo?.qty_terima;
    const qtyPrevSelesai = prevStage ? item.status_tahap?.[prevStage]?.qty_selesai : null;
    const qtyAktualCutting = item.status_tahap?.cutting?.qty_aktual;
    const qtyEfektif = qtyTerimaCurrent ?? qtyPrevSelesai ?? qtyAktualCutting ?? (item.po_item?.qty_per_bundle ?? 0);

    return {
      id: item.id,
      barcode: item.barcode,
      status_tahap: item.status_tahap,
      no_po: item.po?.no_po ?? '-',
      po_item_id: item.po_item_id,
      klien_nama: item.po?.klien?.nama ?? '-',
      warna: item.po_item?.warna ?? '-',
      size: item.po_item?.size ?? '-',
      qty_per_bundle: qtyEfektif,
      model_nama: item.po_item?.produk?.model?.nama ?? '-',
      status,
      jahit_karyawan_nama: jahitKaryawanMap[jahitInfo?.karyawan_id] ?? '-',
      jahit_waktu_selesai: jahitInfo?.waktu_selesai ?? null,
    };
  });

  if (!hasSearch) {
    return { data: mappedData, total: count || 0 };
  }

  const filtered = mappedData.filter(item => matchesSearch(item, search!));
  const start = (page - 1) * pageSize;
  return { data: filtered.slice(start, start + pageSize), total: filtered.length };
}

/**
 * Mengambil daftar bundle yang sudah selesai di tahap tertentu namun belum lanjut ke tahap berikutnya.
 */
export async function getSelesaiPerTahap(tahap: TahapKey, page: number, pageSize: number, search?: string): Promise<{ data: SelesaiBundleItem[], total: number }> {
  const profile = await getCurrentUserProfile();
  if (!profile) throw new Error('Unauthorized');

  const supabase = await createClient();
  const offset = (page - 1) * pageSize;
  const hasSearch = !!search?.trim();

  const selectClause = `
    id, barcode, status_tahap, po_item_id,
    po:po_id(no_po, klien:klien_id(nama)),
    po_item:po_item_id(
      warna, size, qty_per_bundle,
      produk:produk_id(model:model_id(nama))
    )
  `;

  let query = supabase
    .from('bundle')
    .select(selectClause, { count: 'exact' })
    .eq('tenant_id', TENANT_ID);

  const stageIndex = STAGE_ORDER.indexOf(tahap);
  if (stageIndex === -1) throw new Error(`Tahap ${tahap} tidak valid`);

  const nextStage = STAGE_ORDER[stageIndex + 1];

  query = query.contains('status_tahap', { [tahap]: { status: 'selesai' } });

  if (nextStage) {
    query = query
      .not('status_tahap', 'cs', JSON.stringify({ [nextStage]: { status: 'terima' } }))
      .not('status_tahap', 'cs', JSON.stringify({ [nextStage]: { status: 'selesai' } }));
  }

  if (!hasSearch) {
    query = query.range(offset, offset + pageSize - 1);
  }

  const { data, count, error } = await query
    .order('created_at', { ascending: false });

  if (error) throw new Error(`Gagal ambil data selesai ${tahap}: ${error.message}`);

  // Ambil list karyawan_id untuk join manual (Supabase tidak support join via JSONB field secara langsung)
  // — gabungkan karyawan tahap ini dengan karyawan (penjahit) dari tahap jahit dalam 1 query.
  const karyawanIds = Array.from(new Set([
    ...(data as any[]).map(item => item.status_tahap?.[tahap]?.karyawan_id),
    ...(data as any[]).map(item => item.status_tahap?.jahit?.karyawan_id),
  ].filter(Boolean)));

  let karyawanMap: Record<string, string> = {};
  if (karyawanIds.length > 0) {
    const { data: kData } = await supabase.from('karyawan').select('id, nama').in('id', karyawanIds);
    kData?.forEach(k => karyawanMap[k.id] = k.nama);
  }

  const mappedData: SelesaiBundleItem[] = (data as any[]).map(item => {
    const stageInfo = item.status_tahap?.[tahap];
    const jahitInfo = item.status_tahap?.jahit;

    // qty_selesai tahap ini sudah final/otoritatif begitu tahap ini selesai
    // (termasuk untuk bundle hasil Split — qty_selesai-nya sudah benar
    // sesuai porsi bundle itu sendiri, bukan qty_aktual cutting induknya).
    const qtySelesaiCurrent = stageInfo?.qty_selesai;
    const qtyTerimaCurrent = stageInfo?.qty_terima;
    const qtyAktualCutting = item.status_tahap?.cutting?.qty_aktual;
    const qtyEfektif = qtySelesaiCurrent ?? qtyTerimaCurrent ?? qtyAktualCutting ?? (item.po_item?.qty_per_bundle ?? 0);

    return {
      id: item.id,
      barcode: item.barcode,
      status_tahap: item.status_tahap,
      no_po: item.po?.no_po ?? '-',
      po_item_id: item.po_item_id,
      klien_nama: item.po?.klien?.nama ?? '-',
      warna: item.po_item?.warna ?? '-',
      size: item.po_item?.size ?? '-',
      qty_per_bundle: qtyEfektif,
      model_nama: item.po_item?.produk?.model?.nama ?? '-',
      karyawan_id: stageInfo?.karyawan_id ?? '-',
      karyawan_nama: karyawanMap[stageInfo?.karyawan_id] ?? '-',
      waktu_selesai: stageInfo?.waktu_selesai ?? '-',
      jahit_karyawan_nama: karyawanMap[jahitInfo?.karyawan_id] ?? '-',
      jahit_waktu_selesai: jahitInfo?.waktu_selesai ?? null,
    };
  });

  if (!hasSearch) {
    return { data: mappedData, total: count || 0 };
  }

  const filtered = mappedData.filter(item => matchesSearch(item, search!));
  const start = (page - 1) * pageSize;
  return { data: filtered.slice(start, start + pageSize), total: filtered.length };
}
