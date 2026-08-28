'use server';

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { revalidatePath } from 'next/cache';
import bcrypt from 'bcryptjs';

const TENANT_ID = 'STX-001';

async function resolveUserId(): Promise<string> {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) throw new Error('Unauthorized: User session not found.');
  return user.id;
}

export interface BundleReadyToShip {
  id: string;
  barcode: string;
  no_po: string;
  klien_id: string;
  klien_nama: string;
  model_nama: string | null;
  warna: string;
  size: string;
  /** Sisa yang belum terkirim — ini batas atas qty kirim yang wajar. */
  qty_per_bundle: number;
  /** Total qty yang benar-benar jadi di bundle ini. */
  qty_jadi: number;
  /** Sudah terkirim di surat jalan sebelumnya (0 kalau belum pernah dikirim). */
  qty_sudah_kirim: number;
  qty_kirim: number;
}

export interface SuratJalanRow {
  id: string;
  nomor_sj: string;
  tanggal: string;
  status: string;
  catatan: string | null;
  klien_nama: string;
  total_bundle: number;
  total_qty: number;
  created_at: string;
}

export interface SuratJalanDetail {
  id: string;
  nomor_sj: string;
  tanggal: string;
  catatan: string | null;
  klien_id: string;
  klien_nama: string;
  klien_alamat: string | null;
  items: {
    bundle_id: string;
    barcode: string;
    no_po: string;
    model_nama: string | null;
    warna: string;
    size: string;
    qty_kirim: number;
  }[];
}

export async function getBundlesReadyToShip(): Promise<BundleReadyToShip[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('bundle')
    .select(`
      id,
      barcode,
      status_tahap,
      surat_jalan_id,
      surat_jalan_item (qty_kirim),
      po:po_id (
        no_po,
        klien:klien_id (id, nama)
      ),
      po_item:po_item_id (
        warna,
        size,
        qty_per_bundle,
        produk:produk_id (
          model_produk:model_id (nama)
        )
      )
    `)
    .eq('tenant_id', TENANT_ID);

  if (error) {
    console.error('Error fetching ready bundles:', error);
    throw new Error('Gagal memuat daftar bundle siap kirim');
  }

  // Bundle disaring dari sisa yang belum terkirim, bukan dari surat_jalan_id.
  // Satu bundle boleh dikirim bertahap lewat beberapa surat jalan — kalau
  // patokannya surat_jalan_id, bundle yang baru terkirim sebagian akan lenyap
  // dari daftar dan sisanya tidak pernah bisa dikirim.
  const readyBundles = (data || [])
    .map((b: any) => {
      // Prioritas qty efektif bundle ini: qty_selesai packing sendiri (paling
      // otoritatif — termasuk untuk bundle hasil Split) → qty_aktual cutting →
      // qty_per_bundle rencana sebagai fallback terakhir.
      const qtySelesaiPacking = b.status_tahap?.packing?.qty_selesai;
      const qtyAktualCutting = b.status_tahap?.cutting?.qty_aktual;
      const qtyJadi = qtySelesaiPacking ?? qtyAktualCutting ?? (b.po_item?.qty_per_bundle || 0);

      const qtySudahKirim = (b.surat_jalan_item || []).reduce(
        (sum: number, it: any) => sum + (it.qty_kirim || 0), 0
      );
      const sisa = qtyJadi - qtySudahKirim;

      return { raw: b, qtyJadi, qtySudahKirim, sisa };
    })
    .filter(({ raw, sisa }) =>
      raw.status_tahap?.packing?.status === 'selesai' && sisa > 0
    );

  return readyBundles.map(({ raw: b, qtyJadi, qtySudahKirim, sisa }) => ({
    id: b.id,
    barcode: b.barcode,
    no_po: b.po?.no_po || '-',
    klien_id: b.po?.klien?.id || '',
    klien_nama: b.po?.klien?.nama || 'Unknown',
    model_nama: b.po_item?.produk?.model_produk?.nama || null,
    warna: b.po_item?.warna || '-',
    size: b.po_item?.size || '-',
    qty_per_bundle: sisa,
    qty_jadi: qtyJadi,
    qty_sudah_kirim: qtySudahKirim,
    qty_kirim: sisa, // Default: kirim seluruh sisanya
  }));
}

export async function createSuratJalan(input: {
  klien_id: string;
  tanggal: string;
  catatan: string;
  bundles: { bundle_id: string; qty_kirim: number; alasan_lebih?: string }[];
}): Promise<string> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc('finalize_surat_jalan', {
    p_klien_id: input.klien_id,
    p_tanggal: input.tanggal,
    p_catatan: input.catatan,
    p_bundles: input.bundles,
    p_tenant_id: TENANT_ID
  });

  if (error) {
    console.error('Error finalize_surat_jalan:', error);
    throw new Error(error.message || 'Gagal membuat surat jalan');
  }

  revalidatePath('/app/pengiriman/buat-surat-jalan');
  revalidatePath('/app/pengiriman/riwayat');

  return data as string;
}

export async function getSuratJalanList(): Promise<SuratJalanRow[]> {
  const supabase = await createClient();

  // Dapatkan total_bundle dan total_qty bisa jadi dari subquery atau count()
  // Kita fetch data relasional
  const { data, error } = await supabase
    .from('surat_jalan')
    .select(`
      id,
      nomor_sj,
      tanggal,
      status,
      catatan,
      created_at,
      klien:klien_id (nama),
      surat_jalan_item (qty_kirim)
    `)
    .eq('tenant_id', TENANT_ID)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error fetching SJ list:', error);
    throw new Error('Gagal memuat riwayat surat jalan');
  }

  return (data || []).map((sj: any) => {
    const items = sj.surat_jalan_item || [];
    const totalBundle = items.length;
    const totalQty = items.reduce((sum: number, it: any) => sum + (it.qty_kirim || 0), 0);

    return {
      id: sj.id,
      nomor_sj: sj.nomor_sj,
      tanggal: sj.tanggal,
      status: sj.status,
      catatan: sj.catatan,
      klien_nama: sj.klien?.nama || 'Unknown',
      total_bundle: totalBundle,
      total_qty: totalQty,
      created_at: sj.created_at,
    };
  });
}

export async function getSuratJalanDetail(id: string): Promise<SuratJalanDetail | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('surat_jalan')
    .select(`
      id,
      nomor_sj,
      tanggal,
      catatan,
      klien_id,
      klien:klien_id (nama, alamat),
      surat_jalan_item (
        qty_kirim,
        urutan,
        bundle:bundle_id (
          id,
          barcode,
          po:po_id (no_po),
          po_item:po_item_id (
            warna,
            size,
            produk:produk_id (
              model_produk:model_id (nama)
            )
          )
        )
      )
    `)
    .eq('id', id)
    .eq('tenant_id', TENANT_ID)
    .single();

  if (error || !data) {
    console.error('Error fetching SJ detail:', error);
    return null;
  }

  // Tampilkan sesuai urutan pencentangan saat surat jalan dibuat. PostgREST
  // tidak menjamin urutan baris anak, jadi diurutkan di sini.
  const items = [...(data.surat_jalan_item || [])]
    .sort((a: any, b: any) => (a.urutan ?? 0) - (b.urutan ?? 0))
    .map((it: any) => {
    const b = it.bundle;
    return {
      bundle_id: b.id,
      barcode: b.barcode,
      no_po: b.po?.no_po || '-',
      model_nama: b.po_item?.produk?.model_produk?.nama || null,
      warna: b.po_item?.warna || '-',
      size: b.po_item?.size || '-',
      qty_kirim: it.qty_kirim,
    };
  });

  return {
    id: data.id,
    nomor_sj: data.nomor_sj,
    tanggal: data.tanggal,
    catatan: data.catatan,
    klien_id: data.klien_id,
    klien_nama: (Array.isArray(data.klien) ? data.klien[0]?.nama : (data.klien as any)?.nama) || 'Unknown',
    klien_alamat: (Array.isArray(data.klien) ? data.klien[0]?.alamat : (data.klien as any)?.alamat) || null,
    items,
  };
}

// ─── Qty lebih saat Buat Surat Jalan — menunggu approval PIN Owner ──────────

export interface QtyLebihKirimPending {
  approval_id: string;
  bundle_id: string;
  barcode: string;
  no_po: string;
  klien_nama: string;
  model_nama: string | null;
  warna: string;
  size: string;
  qty_rencana: number;
  qty_lebih: number;
  qty_kirim: number;
  alasan_pengajuan: string | null;
  diajukan_oleh: string;
  diajukan_pada: string;
}

export async function getQtyLebihKirimPending(): Promise<QtyLebihKirimPending[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('qty_approval_request')
    .select(`
      id,
      qty_diajukan,
      qty_default,
      catatan_pengajuan,
      created_at,
      created_by,
      bundle:bundle_id (
        id,
        barcode,
        po:po_id (no_po, klien:klien_id (nama)),
        po_item:po_item_id (
          warna, size,
          produk:produk_id (model_produk:model_id (nama))
        )
      )
    `)
    .eq('tenant_id', TENANT_ID)
    .eq('sumber', 'buat_surat_jalan')
    .eq('status', 'pending')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error fetching qty lebih kirim pending:', error);
    throw new Error('Gagal memuat daftar qty lebih menunggu approval');
  }

  const pengajuIds = Array.from(new Set((data ?? []).map((r: any) => r.created_by).filter(Boolean)));
  let pengajuMap: Record<string, string> = {};
  if (pengajuIds.length > 0) {
    const { data: profiles } = await supabase.from('user_profile').select('id, nama').in('id', pengajuIds);
    profiles?.forEach(p => { pengajuMap[p.id] = p.nama; });
  }

  return (data ?? []).map((r: any) => {
    const b = r.bundle;
    const po = Array.isArray(b?.po) ? b.po[0] : b?.po;
    const klien = Array.isArray(po?.klien) ? po.klien[0] : po?.klien;
    const poItem = Array.isArray(b?.po_item) ? b.po_item[0] : b?.po_item;
    const produk = Array.isArray(poItem?.produk) ? poItem.produk[0] : poItem?.produk;
    const model = Array.isArray(produk?.model_produk) ? produk.model_produk[0] : produk?.model_produk;

    return {
      approval_id: r.id,
      bundle_id: b?.id ?? '',
      barcode: b?.barcode ?? '-',
      no_po: po?.no_po ?? '-',
      klien_nama: klien?.nama ?? '-',
      model_nama: model?.nama ?? null,
      warna: poItem?.warna ?? '-',
      size: poItem?.size ?? '-',
      qty_rencana: r.qty_default ?? 0,
      qty_lebih: r.qty_diajukan ?? 0,
      qty_kirim: (r.qty_default ?? 0) + (r.qty_diajukan ?? 0),
      alasan_pengajuan: r.catatan_pengajuan ?? null,
      diajukan_oleh: pengajuMap[r.created_by] ?? '-',
      diajukan_pada: r.created_at,
    };
  });
}

export async function resolveQtyLebihKirim(
  approval_id: string,
  pin: string,
  action: 'approved' | 'rejected',
  catatan?: string,
): Promise<{ success: boolean; status: string }> {
  const userId = await resolveUserId();
  const supabase = await createClient();

  const { data: profile, error: profileErr } = await supabase
    .from('user_profile')
    .select('approval_pin')
    .eq('id', userId)
    .maybeSingle();

  if (profileErr) throw new Error(profileErr.message);
  if (!profile?.approval_pin) {
    throw new Error('PIN belum diset. Setup PIN terlebih dahulu di Settings.');
  }

  const isPinValid = await bcrypt.compare(pin, profile.approval_pin);
  if (!isPinValid) throw new Error('PIN tidak valid');

  const { data, error } = await supabase.rpc('resolve_qty_lebih_kirim', {
    p_approval_id: approval_id,
    p_status: action,
    p_catatan: catatan ?? null,
    p_user_id: userId,
    p_tenant_id: TENANT_ID,
  });

  if (error) throw new Error(error.message || 'Gagal memproses approval');

  revalidatePath('/app/pengiriman/validasi');

  return data as { success: boolean; status: string };
}

export interface BatalSuratJalanResult {
  success: boolean;
  nomor_sj: string;
  nomor_invoice: string | null;
  jumlah_bundle: number;
  total_qty: number;
}

/**
 * Batalkan surat jalan yang salah input. Barang-barangnya kembali ke daftar
 * siap kirim, dan invoice yang ikut terbit otomatis dibuang bersamanya.
 *
 * Butuh PIN Owner: aksi ini menghapus surat jalan beserta tagihannya.
 * RPC di database yang menolak kalau pembatalannya sudah tidak aman
 * (sudah divalidasi klien, atau invoice-nya sudah dibayar).
 */
export async function batalSuratJalan(
  sj_id: string,
  pin: string,
  alasan: string,
): Promise<BatalSuratJalanResult> {
  const userId = await resolveUserId();
  const supabase = await createClient();

  if (!alasan?.trim()) {
    throw new Error('Alasan pembatalan wajib diisi');
  }

  const { data: profile, error: profileErr } = await supabase
    .from('user_profile')
    .select('approval_pin')
    .eq('id', userId)
    .maybeSingle();

  if (profileErr) throw new Error(profileErr.message);
  if (!profile?.approval_pin) {
    throw new Error('PIN belum diset. Setup PIN terlebih dahulu di Settings.');
  }

  const isPinValid = await bcrypt.compare(pin, profile.approval_pin);
  if (!isPinValid) throw new Error('PIN tidak valid');

  const { data, error } = await supabase.rpc('batal_surat_jalan', {
    p_sj_id: sj_id,
    p_alasan: alasan.trim(),
    p_user_id: userId,
    p_tenant_id: TENANT_ID,
  });

  if (error) throw new Error(error.message || 'Gagal membatalkan surat jalan');

  revalidatePath('/app/pengiriman/riwayat');
  revalidatePath('/app/pengiriman/buat-surat-jalan');
  revalidatePath('/app/keuangan/invoice');

  return data as BatalSuratJalanResult;
}
