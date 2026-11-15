'use server';

import { createClient } from '@/lib/supabase/server';
import { getCurrentUserProfile } from '@/lib/auth/permissions';
import { revalidatePath } from 'next/cache';
import type { BukuKasEntry, AddBukuKasInput, HppKomponenOption, PembantuJenisOption } from './buku-kas.types';
import { KATEGORI_BAHAN_PEMBANTU } from './buku-kas.types';

export type { BukuKasEntry, AddBukuKasInput, HppKomponenOption, PembantuJenisOption } from './buku-kas.types';

const TENANT_ID = 'STX-001';

export async function getBukuKasEntries(filters?: {
  bulan?: string;
  tahun?: string;
  tipe?: string;
}): Promise<BukuKasEntry[]> {
  const supabase = await createClient();

  let query = supabase
    .from('buku_kas')
    .select('id, tanggal, tipe, kategori, nominal, keterangan, no_referensi, po_id, komponen_id, created_at, po:po_id(no_po)')
    .eq('tenant_id', TENANT_ID)
    .order('tanggal', { ascending: false })
    .order('created_at', { ascending: false });

  if (filters?.tipe) query = query.eq('tipe', filters.tipe);

  if (filters?.tahun) {
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
    created_at: item.created_at,
  }));
}

export async function addBukuKas(
  input: AddBukuKasInput
): Promise<{ success: boolean; error?: string }> {
  const profile = await getCurrentUserProfile();
  if (!profile) return { success: false, error: 'Unauthorized.' };

  if (!input.nominal || input.nominal <= 0)
    return { success: false, error: 'Nominal harus lebih dari 0.' };
  if (!input.tanggal)
    return { success: false, error: 'Tanggal tidak boleh kosong.' };
  if (!input.kategori)
    return { success: false, error: 'Kategori tidak boleh kosong.' };

  const supabase = await createClient();
  const pembantu = input.tipe === 'keluar' && input.kategori === KATEGORI_BAHAN_PEMBANTU;
  let keterangan = input.keterangan?.trim() ?? '';

  if (pembantu) {
    if (!input.pembantu_jenis_id)
      return { success: false, error: 'Pilih jenis bahan pembantu.' };
    if (!input.qty || input.qty <= 0)
      return { success: false, error: 'Jumlah barang harus lebih dari 0.' };
    if (!input.satuan?.trim())
      return { success: false, error: 'Pilih satuan barang.' };
    if (!keterangan) {
      const { data: jenis } = await supabase
        .from('pembantu_jenis').select('nama').eq('id', input.pembantu_jenis_id).maybeSingle();
      keterangan = `Belanja ${jenis?.nama ?? 'bahan pembantu'} ${input.qty} ${input.satuan.trim()}`;
    }
  } else if (!keterangan) {
    return { success: false, error: 'Keterangan tidak boleh kosong.' };
  }

  const { error } = await supabase.from('buku_kas').insert({
    tanggal:      input.tanggal,
    tipe:         input.tipe,
    kategori:     input.kategori,
    nominal:      input.nominal,
    keterangan,
    no_referensi: input.no_referensi ?? null,
    po_id:        input.po_id ?? null,
    komponen_id:  pembantu ? null : (input.komponen_id ?? null),
    pembantu_jenis_id: pembantu ? input.pembantu_jenis_id : null,
    qty:          pembantu ? input.qty : null,
    satuan:       pembantu ? input.satuan!.trim() : null,
    tenant_id:    TENANT_ID,
    created_by:   profile.id,
  });

  if (error) return { success: false, error: error.message };

  revalidatePath('/app/keuangan/buku-kas');
  revalidatePath('/app/keuangan/saldo-pembantu');
  return { success: true };
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
