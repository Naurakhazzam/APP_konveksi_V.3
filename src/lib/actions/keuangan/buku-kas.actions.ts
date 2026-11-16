'use server';

import { createClient } from '@/lib/supabase/server';
import { getCurrentUserProfile } from '@/lib/auth/permissions';
import { revalidatePath } from 'next/cache';
import type { BukuKasEntry, AddBukuKasInput, HppKomponenOption, PembantuJenisOption, OverheadSubOption } from './buku-kas.types';
import { KATEGORI_BAHAN_PEMBANTU, KATEGORI_OVERHEAD } from './buku-kas.types';

export type { BukuKasEntry, AddBukuKasInput, HppKomponenOption, PembantuJenisOption, OverheadSubOption } from './buku-kas.types';

const TENANT_ID = 'STX-001';

export async function getBukuKasEntries(filters?: {
  bulan?: string;
  tahun?: string;
  tipe?: string;
  /** Rentang tanggal 'YYYY-MM-DD' (dipakai unduh Excel); mengalahkan filter bulan/tahun */
  dari?: string;
  sampai?: string;
}): Promise<BukuKasEntry[]> {
  const supabase = await createClient();

  let query = supabase
    .from('buku_kas')
    .select('id, tanggal, tipe, kategori, nominal, keterangan, no_referensi, po_id, komponen_id, overhead_sub_id, pembantu_jenis_id, qty, satuan, inventory_batch_id, sumber_gaji, created_at, po:po_id(no_po), overhead_sub:overhead_sub_id(nama)')
    .eq('tenant_id', TENANT_ID)
    .order('tanggal', { ascending: false })
    .order('created_at', { ascending: false });

  if (filters?.tipe) query = query.eq('tipe', filters.tipe);

  if (filters?.dari || filters?.sampai) {
    if (filters.dari) query = query.gte('tanggal', filters.dari);
    if (filters.sampai) query = query.lte('tanggal', filters.sampai);
  } else if (filters?.tahun) {
    const year = filters.tahun;
    if (filters?.bulan) {
      const month = filters.bulan.padStart(2, '0');
      const lastDay = new Date(Number(year), Number(month), 0).getDate();
      query = query
        .gte('tanggal', `${year}-${month}-01`)
        .lte('tanggal', `${year}-${month}-${String(lastDay).padStart(2, '0')}`);
    } else {
      query = query
        .gte('tanggal', `${year}-01-01`)
        .lte('tanggal', `${year}-12-31`);
    }
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  return (data ?? []).map((item: any) => ({
    id: item.id,
    tanggal: item.tanggal,
    tipe: item.tipe,
    kategori: item.kategori,
    nominal: Number(item.nominal),
    keterangan: item.keterangan,
    no_referensi: item.no_referensi ?? null,
    po_id: item.po_id ?? null,
    po_no: (Array.isArray(item.po) ? item.po[0]?.no_po : item.po?.no_po) ?? null,
    komponen_id: item.komponen_id ?? null,
    overhead_sub_id: item.overhead_sub_id ?? null,
    overhead_sub_nama: (Array.isArray(item.overhead_sub) ? item.overhead_sub[0]?.nama : item.overhead_sub?.nama) ?? null,
    pembantu_jenis_id: item.pembantu_jenis_id ?? null,
    qty: item.qty == null ? null : Number(item.qty),
    satuan: item.satuan ?? null,
    dikunci: alasanKunci(item),
    bisa_ubah_tanggal: !!item.inventory_batch_id && !item.sumber_gaji,
    // sumber_gaji = 'gaji:<karyawan_id>:<tanggal bayar>'
    karyawan_id_gaji: (typeof item.sumber_gaji === 'string' && item.sumber_gaji.startsWith('gaji:'))
      ? item.sumber_gaji.split(':')[1] || null
      : null,
    created_at: item.created_at,
  }));
}

/** Baris otomatis tidak boleh diedit dari Buku Kas agar tetap cocok dengan sumbernya */
function alasanKunci(row: { inventory_batch_id?: string | null; sumber_gaji?: string | null }): string | null {
  if (row.inventory_batch_id) return 'Dibuat otomatis dari Stok Masuk — perbaiki lewat menu Inventory.';
  if (row.sumber_gaji) return 'Dibuat otomatis dari pembayaran gaji — perbaiki lewat menu Gaji.';
  return null;
}

export async function addBukuKas(
  input: AddBukuKasInput
): Promise<{ success: boolean; error?: string }> {
  const profile = await getCurrentUserProfile();
  if (!profile) return { success: false, error: 'Unauthorized.' };

  const supabase = await createClient();
  const siap = await siapkanBaris(supabase, input);
  if ('error' in siap) return { success: false, error: siap.error };

  const { error } = await supabase.from('buku_kas').insert({
    ...siap.row,
    tenant_id:  TENANT_ID,
    created_by: profile.id,
  });

  if (error) return { success: false, error: error.message };

  revalidatePath('/app/keuangan/buku-kas');
  revalidatePath('/app/keuangan/saldo-pembantu');
  return { success: true };
}

/** Edit entri Buku Kas (owner saja; baris otomatis dari Stok Masuk / gaji dikunci) */
export async function updateBukuKas(
  id: string,
  input: AddBukuKasInput
): Promise<{ success: boolean; error?: string }> {
  const profile = await getCurrentUserProfile();
  if (!profile) return { success: false, error: 'Unauthorized.' };
  if (profile.role !== 'owner')
    return { success: false, error: 'Hanya owner yang dapat mengedit.' };

  const supabase = await createClient();
  const { data: lama, error: e1 } = await supabase
    .from('buku_kas')
    .select('id, tipe, inventory_batch_id, sumber_gaji')
    .eq('id', id)
    .eq('tenant_id', TENANT_ID)
    .maybeSingle();
  if (e1) return { success: false, error: e1.message };
  if (!lama) return { success: false, error: 'Entri tidak ditemukan.' };
  const kunci = alasanKunci(lama);
  if (kunci) return { success: false, error: kunci };

  const siap = await siapkanBaris(supabase, { ...input, tipe: lama.tipe });
  if ('error' in siap) return { success: false, error: siap.error };

  const { error } = await supabase
    .from('buku_kas')
    .update(siap.row)
    .eq('id', id)
    .eq('tenant_id', TENANT_ID);
  if (error) return { success: false, error: error.message };

  revalidatePath('/app/keuangan/buku-kas');
  revalidatePath('/app/keuangan/saldo-pembantu');
  return { success: true };
}

/** Ubah tanggal baris dari Stok Masuk (owner saja); tanggal LOT & jurnal pembelian ikut diubah */
export async function ubahTanggalStokMasuk(
  id: string,
  tanggal: string
): Promise<{ success: boolean; error?: string }> {
  const profile = await getCurrentUserProfile();
  if (!profile) return { success: false, error: 'Unauthorized.' };
  if (profile.role !== 'owner')
    return { success: false, error: 'Hanya owner yang dapat mengubah tanggal.' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tanggal)) return { success: false, error: 'Tanggal tidak valid.' };

  const supabase = await createClient();
  const { error } = await supabase.rpc('ubah_tanggal_stok_masuk', {
    p_buku_kas_id: id, p_tanggal: tanggal, p_tenant_id: TENANT_ID,
  });
  if (error) return { success: false, error: error.message };

  revalidatePath('/app/keuangan/buku-kas');
  revalidatePath('/app/inventory');
  return { success: true };
}

/** Validasi + susun kolom buku_kas dari input form (dipakai tambah & edit) */
async function siapkanBaris(
  supabase: Awaited<ReturnType<typeof createClient>>,
  input: AddBukuKasInput
): Promise<{ row: Record<string, unknown> } | { error: string }> {
  if (!input.nominal || input.nominal <= 0) return { error: 'Nominal harus lebih dari 0.' };
  if (!input.tanggal) return { error: 'Tanggal tidak boleh kosong.' };
  if (!input.kategori) return { error: 'Kategori tidak boleh kosong.' };

  const pembantu = input.tipe === 'keluar' && input.kategori === KATEGORI_BAHAN_PEMBANTU;
  const overhead = input.tipe === 'keluar' && input.kategori === KATEGORI_OVERHEAD;
  let keterangan = input.keterangan?.trim() ?? '';

  // Overhead wajib punya sub-kelompok; komponen HPP diturunkan dari sub-kelompok itu
  let komponenOverhead: string | null = null;
  if (overhead) {
    if (!input.overhead_sub_id) return { error: 'Pilih sub-kelompok overhead.' };
    const { data: sub } = await supabase
      .from('overhead_sub').select('id, hpp_komponen_id')
      .eq('id', input.overhead_sub_id).eq('tenant_id', TENANT_ID).maybeSingle();
    if (!sub) return { error: 'Sub-kelompok overhead tidak ditemukan.' };
    komponenOverhead = sub.hpp_komponen_id ?? null;
  }

  if (pembantu) {
    if (!input.pembantu_jenis_id) return { error: 'Pilih jenis bahan pembantu.' };
    if (!input.qty || input.qty <= 0) return { error: 'Jumlah barang harus lebih dari 0.' };
    if (!input.satuan?.trim()) return { error: 'Pilih satuan barang.' };
    if (!keterangan) {
      const { data: jenis } = await supabase
        .from('pembantu_jenis').select('nama').eq('id', input.pembantu_jenis_id).maybeSingle();
      keterangan = `Belanja ${jenis?.nama ?? 'bahan pembantu'} ${input.qty} ${input.satuan.trim()}`;
    }
  } else if (!keterangan) {
    return { error: 'Keterangan tidak boleh kosong.' };
  }

  return {
    row: {
      tanggal:      input.tanggal,
      tipe:         input.tipe,
      kategori:     input.kategori,
      nominal:      input.nominal,
      keterangan,
      no_referensi: input.no_referensi || null,
      po_id:        input.po_id || null,
      komponen_id:  overhead ? komponenOverhead : null,
      overhead_sub_id: overhead ? input.overhead_sub_id : null,
      pembantu_jenis_id: pembantu ? input.pembantu_jenis_id : null,
      // Qty & satuan: wajib untuk bahan pembantu, opsional untuk kas keluar lain (nominal = qty × harga satuan)
      qty:          input.tipe === 'keluar' && input.qty && input.qty > 0 ? input.qty : null,
      satuan:       input.tipe === 'keluar' && input.qty && input.qty > 0 ? (input.satuan?.trim() || null) : null,
    },
  };
}

/** Jenis saldo bahan pembantu + satuan yang terakhir dipakai saat belanja */
export async function getPembantuJenis(): Promise<PembantuJenisOption[]> {
  const supabase = await createClient();
  const [{ data: jenis, error }, { data: riwayat }] = await Promise.all([
    supabase
      .from('pembantu_jenis')
      .select('id, nama, satuan_default')
      .eq('tenant_id', TENANT_ID)
      .eq('aktif', true)
      .eq('tanpa_barang', false)
      .order('urutan'),
    supabase
      .from('buku_kas')
      .select('pembantu_jenis_id, satuan')
      .eq('tenant_id', TENANT_ID)
      .not('pembantu_jenis_id', 'is', null)
      .not('satuan', 'is', null)
      .order('tanggal', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(500),
  ]);
  if (error) throw new Error(error.message);

  const terakhir = new Map<string, string>();
  for (const r of riwayat ?? []) {
    if (!terakhir.has(r.pembantu_jenis_id)) terakhir.set(r.pembantu_jenis_id, r.satuan);
  }
  return (jenis ?? []).map(j => ({
    id: j.id,
    nama: j.nama,
    satuan_default: terakhir.get(j.id) ?? j.satuan_default ?? null,
  }));
}

export async function deleteBukuKas(
  id: string
): Promise<{ success: boolean; error?: string }> {
  const profile = await getCurrentUserProfile();
  if (!profile) return { success: false, error: 'Unauthorized.' };
  if (profile.role !== 'owner')
    return { success: false, error: 'Hanya owner yang dapat menghapus.' };

  const supabase = await createClient();
  const { error } = await supabase
    .from('buku_kas')
    .delete()
    .eq('id', id)
    .eq('tenant_id', TENANT_ID);

  if (error) return { success: false, error: error.message };

  revalidatePath('/app/keuangan/buku-kas');
  return { success: true };
}

export async function getPOListForKas(): Promise<{ id: string; no_po: string }[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('po')
    .select('id, no_po')
    .eq('tenant_id', TENANT_ID)
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return data ?? [];
}

/** Daftar sub-kelompok Biaya Overhead: komponen HPP dulu, lalu buatan sendiri (abjad) */
export async function getOverheadSub(): Promise<OverheadSubOption[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('overhead_sub')
    .select('id, nama, hpp_komponen_id, urutan')
    .eq('tenant_id', TENANT_ID)
    .eq('aktif', true)
    .order('urutan')
    .order('nama');
  if (error) throw new Error(error.message);
  return (data ?? []).map(s => ({ id: s.id, nama: s.nama, dari_hpp: !!s.hpp_komponen_id }));
}

/** Tambah sub-kelompok overhead baru (mis. "Gaji Staff"); nama kembar dipakai ulang */
export async function tambahOverheadSub(
  nama: string
): Promise<{ success: boolean; error?: string; data?: OverheadSubOption }> {
  const profile = await getCurrentUserProfile();
  if (!profile) return { success: false, error: 'Unauthorized.' };
  const bersih = nama.trim().replace(/\s+/g, ' ');
  if (bersih.length < 2) return { success: false, error: 'Nama sub-kelompok terlalu pendek.' };

  const supabase = await createClient();
  const { data: ada } = await supabase
    .from('overhead_sub').select('id, nama, hpp_komponen_id, aktif')
    .eq('tenant_id', TENANT_ID).ilike('nama', bersih).maybeSingle();
  if (ada) {
    if (!ada.aktif) await supabase.from('overhead_sub').update({ aktif: true }).eq('id', ada.id);
    return { success: true, data: { id: ada.id, nama: ada.nama, dari_hpp: !!ada.hpp_komponen_id } };
  }

  const { data, error } = await supabase
    .from('overhead_sub')
    .insert({ tenant_id: TENANT_ID, nama: bersih, urutan: 100 })
    .select('id, nama')
    .single();
  if (error) return { success: false, error: error.message };
  revalidatePath('/app/keuangan/buku-kas');
  return { success: true, data: { id: data.id, nama: data.nama, dari_hpp: false } };
}

export async function getHppKomponenOverhead(): Promise<HppKomponenOption[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('hpp_komponen')
    .select('id, nama')
    .eq('kategori', 'overhead')
    .eq('tenant_id', TENANT_ID)
    .order('nama');
  if (error) throw new Error(error.message);
  return data ?? [];
}
