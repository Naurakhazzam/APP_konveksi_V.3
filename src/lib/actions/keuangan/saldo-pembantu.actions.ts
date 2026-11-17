'use server';

import { createClient } from '@/lib/supabase/server';
import { getCurrentUserProfile } from '@/lib/auth/permissions';
import { revalidatePath } from 'next/cache';
import { PO_AWAL_PERIODE } from '@/lib/keuangan/periode-po';

const TENANT_ID = 'STX-001';

export interface SaldoPembantuJenis {
  id: string;
  nama: string;
  tanpa_barang: boolean;
  total_beli: number;
  total_jatah: number;
  /** Uang belanja yang belum habis oleh jatah (tidak pernah minus) */
  saldo: number;
  /** Jatah yang tidak tertutup saldo */
  penghematan: number;
  pcs: number;
  /** Saldo awal barang lama (setoran modal berupa barang) */
  total_modal: number;
  /** Sisa barang lama yang belum terpakai jatah → aset */
  sisa_modal: number;
}

/** Barang lama milik pemilik yang dimasukkan sebagai saldo awal (harga perkiraan) */
export interface SaldoAwalPembantu {
  id: string;
  jenis_id: string;
  jenis: string;
  tanggal: string;
  nama_barang: string | null;
  qty: number;
  satuan: string | null;
  harga_satuan: number;
  nominal: number;
  keterangan: string | null;
}

export interface MutasiPembantu {
  jenis_id: string;
  jenis: string;
  tanggal: string;
  tipe: 'modal' | 'beli' | 'jatah';
  nominal: number;
  pcs: number | null;
  ke_saldo: number;
  ke_hemat: number;
  saldo: number;
  /** + saldo awal masuk / − barang lama terpakai jatah */
  ke_modal: number;
  saldo_modal: number;
  /** Penghematan final baris jatah setelah dihitung ulang dengan SEMUA barang masuk (termasuk yang belakangan) */
  hemat_final: number;
}

export interface PenghematanBulan {
  bulan: string; // YYYY-MM
  per_jenis: Record<string, number>;
  total: number;
}

export interface SaldoPembantuData {
  jenis: SaldoPembantuJenis[];
  mutasi: MutasiPembantu[];
  saldo_awal: SaldoAwalPembantu[];
  penghematan_bulanan: PenghematanBulan[];
  total_beli: number;
  total_jatah: number;
  total_saldo: number;
  total_penghematan: number;
  total_modal: number;
  total_sisa_modal: number;
}

export async function getSaldoPembantu(): Promise<SaldoPembantuData> {
  const supabase = await createClient();
  const [{ data: jenisRows, error: jErr }, { data: mutasiRows, error: mErr }, { data: awalRows, error: aErr }] = await Promise.all([
    supabase
      .from('pembantu_jenis')
      .select('id, nama, tanpa_barang, urutan')
      .eq('tenant_id', TENANT_ID)
      .eq('aktif', true)
      .order('urutan'),
    supabase.rpc('get_mutasi_saldo_pembantu', { p_tenant_id: TENANT_ID, p_mulai: PO_AWAL_PERIODE }),
    supabase
      .from('pembantu_saldo_awal')
      .select('id, jenis_id, tanggal, nama_barang, qty, satuan, harga_satuan, nominal, keterangan')
      .eq('tenant_id', TENANT_ID)
      .order('tanggal').order('created_at'),
  ]);
  if (jErr) throw new Error(jErr.message);
  if (mErr) throw new Error(mErr.message);
  if (aErr) throw new Error(aErr.message);

  const nama = new Map<string, string>((jenisRows ?? []).map(j => [j.id, j.nama]));
  const ringkas = new Map<string, SaldoPembantuJenis>(
    (jenisRows ?? []).map(j => [j.id, {
      id: j.id, nama: j.nama, tanpa_barang: j.tanpa_barang,
      total_beli: 0, total_jatah: 0, saldo: 0, penghematan: 0, pcs: 0, total_modal: 0, sisa_modal: 0,
    }]),
  );
  const bulanan = new Map<string, PenghematanBulan>();

  type Row = {
    jenis_id: string; tanggal: string; tipe: 'modal' | 'beli' | 'jatah'; nominal: number | string;
    pcs: number | string | null; ke_saldo: number | string; ke_hemat: number | string; saldo: number | string;
    ke_modal: number | string | null; saldo_modal: number | string | null; hemat_final: number | string | null;
  };
  const mutasi: MutasiPembantu[] = ((mutasiRows ?? []) as Row[]).map(r => {
    const m: MutasiPembantu = {
      jenis_id: r.jenis_id,
      jenis: nama.get(r.jenis_id) ?? '?',
      tanggal: r.tanggal,
      tipe: r.tipe,
      nominal: Number(r.nominal),
      pcs: r.pcs == null ? null : Number(r.pcs),
      ke_saldo: Number(r.ke_saldo),
      ke_hemat: Number(r.ke_hemat),
      saldo: Number(r.saldo),
      ke_modal: Number(r.ke_modal ?? 0),
      saldo_modal: Number(r.saldo_modal ?? 0),
      hemat_final: Number(r.hemat_final ?? 0),
    };
    const s = ringkas.get(m.jenis_id);
    if (s) {
      if (m.tipe === 'modal') s.total_modal += m.nominal;
      else if (m.tipe === 'beli') s.total_beli += m.nominal;
      else { s.total_jatah += m.nominal; s.pcs += m.pcs ?? 0; }
      s.saldo = m.saldo; // mutasi urut per jenis (saldo awal dulu, lalu tanggal) → baris terakhir = saldo akhir
      s.sisa_modal = m.saldo_modal;
      s.penghematan += m.ke_hemat;
    }
    // Per bulan pakai hemat_final: belanja/barang lama yang masuk belakangan sudah menutup jatah
    // paling awal, jadi bulan lalu ikut terkoreksi (tidak pernah minus).
    if (m.hemat_final > 0) {
      const key = m.tanggal.slice(0, 7);
      const b = bulanan.get(key) ?? { bulan: key, per_jenis: {}, total: 0 };
      b.per_jenis[m.jenis_id] = (b.per_jenis[m.jenis_id] ?? 0) + m.hemat_final;
      b.total += m.hemat_final;
      bulanan.set(key, b);
    }
    return m;
  });

  const jenis = [...ringkas.values()];
  return {
    jenis,
    mutasi: mutasi.sort((a, b) => b.tanggal.localeCompare(a.tanggal) || (a.tipe === 'jatah' ? -1 : 1)),
    saldo_awal: ((awalRows ?? []) as Record<string, unknown>[]).map(a => ({
      id: String(a.id), jenis_id: String(a.jenis_id), jenis: nama.get(String(a.jenis_id)) ?? '?',
      tanggal: String(a.tanggal), nama_barang: (a.nama_barang as string | null) ?? null,
      qty: Number(a.qty), satuan: (a.satuan as string | null) ?? null,
      harga_satuan: Number(a.harga_satuan), nominal: Number(a.nominal),
      keterangan: (a.keterangan as string | null) ?? null,
    })),
    penghematan_bulanan: [...bulanan.values()].sort((a, b) => b.bulan.localeCompare(a.bulan)),
    total_beli: jenis.reduce((s, j) => s + j.total_beli, 0),
    total_jatah: jenis.reduce((s, j) => s + j.total_jatah, 0),
    total_saldo: jenis.reduce((s, j) => s + j.saldo, 0),
    total_penghematan: jenis.reduce((s, j) => s + j.penghematan, 0),
    total_modal: jenis.reduce((s, j) => s + j.total_modal, 0),
    total_sisa_modal: jenis.reduce((s, j) => s + j.sisa_modal, 0),
  };
}

const PATH = '/app/keuangan/saldo-pembantu';

async function wajibKeuangan() {
  const profile = await getCurrentUserProfile();
  if (!profile) throw new Error('Unauthorized');
  if (!(['owner', 'admin_keuangan'] as string[]).includes(profile.role)) {
    throw new Error('Hanya owner / admin keuangan yang boleh mengubah saldo awal bahan pembantu.');
  }
  return profile;
}

function segarkan() {
  revalidatePath(PATH);
  revalidatePath('/app/keuangan/proyeksi-surplus');
  revalidatePath('/app/keuangan/ringkasan');
}

/**
 * Catat barang lama (bahan pembantu yang sudah ada sebelum periode baru) sebagai saldo awal.
 * = setoran modal berupa barang: TIDAK menyentuh Buku Kas. Nilai = qty × harga perkiraan.
 */
export async function tambahSaldoAwalPembantu(input: {
  jenis_id: string;
  tanggal: string; // YYYY-MM-DD
  nama_barang?: string;
  qty: number;
  satuan?: string;
  harga_satuan: number;
  keterangan?: string;
}): Promise<{ ok: true }> {
  const profile = await wajibKeuangan();
  const qty = Number(input.qty), harga = Number(input.harga_satuan);
  if (!input.jenis_id) throw new Error('Pilih jenis bahan');
  if (!(qty > 0)) throw new Error('Qty harus lebih dari 0');
  if (!(harga > 0)) throw new Error('Harga perkiraan harus lebih dari 0');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.tanggal)) throw new Error('Tanggal tidak valid');

  const supabase = await createClient();
  const { data: jenis, error: jErr } = await supabase
    .from('pembantu_jenis').select('id, tanpa_barang')
    .eq('tenant_id', TENANT_ID).eq('id', input.jenis_id).maybeSingle();
  if (jErr) throw new Error(jErr.message);
  if (!jenis) throw new Error('Jenis bahan tidak ditemukan');
  if (jenis.tanpa_barang) throw new Error('Jenis ini tanpa barang — tidak bisa diberi saldo awal');

  const { error } = await supabase.from('pembantu_saldo_awal').insert({
    tenant_id: TENANT_ID,
    jenis_id: input.jenis_id,
    tanggal: input.tanggal,
    nama_barang: input.nama_barang?.trim() || null,
    qty,
    satuan: input.satuan?.trim() || null,
    harga_satuan: harga,
    nominal: Math.round(qty * harga),
    keterangan: input.keterangan?.trim() || null,
    created_by: profile.id,
  });
  if (error) throw new Error(error.message);
  segarkan();
  return { ok: true };
}

export async function hapusSaldoAwalPembantu(id: string): Promise<{ ok: true }> {
  await wajibKeuangan();
  const supabase = await createClient();
  const { error } = await supabase.from('pembantu_saldo_awal').delete().eq('tenant_id', TENANT_ID).eq('id', id);
  if (error) throw new Error(error.message);
  segarkan();
  return { ok: true };
}
