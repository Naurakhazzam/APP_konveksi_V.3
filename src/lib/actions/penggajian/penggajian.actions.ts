'use server';

import { createClient } from '@/lib/supabase/server';

const TENANT_ID = 'STX-001';

export interface GajiLedgerEntry {
  id: string;
  karyawan_id: string;
  tipe: 'selesai' | 'reject_potong' | 'rework';
  total: number;
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

  const { data, error } = await supabase
    .from('gaji_ledger')
    .select(`
      *,
      bundle:sumber_id(
        barcode,
        po_item:po_item_id(
          warna, size,
          produk:produk_id(model_produk:model_id(nama))
        )
      )
    `)
    .eq('karyawan_id', karyawan_id)
    .gte('tanggal', tanggal_dari)
    .lte('tanggal', tanggal_sampai)
    .eq('tenant_id', TENANT_ID)
    .order('created_at', { ascending: false });

  if (error) throw new Error(error.message);

  return (data ?? []).map((row: any) => {
    const bundle = row.bundle;
    const poItem = bundle?.po_item;
    const modelNama = poItem?.produk?.model_produk?.nama;
    const warna = poItem?.warna;
    const size = poItem?.size;

    // Ambil prefix tahap dari keterangan lama (misal "Upah jahit")
    const tahapPrefix = row.keterangan?.split(' - ')?.[0] ?? row.keterangan;

    const keteranganBaru = modelNama
      ? `${tahapPrefix} - ${modelNama} / ${warna} / ${size}`
      : row.keterangan;

    return {
      id: row.id,
      karyawan_id: row.karyawan_id,
      tipe: row.tipe,
      total: Number(row.total),
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

/** 3. Proses Pembayaran Gaji: Menggunakan RPC Atomic */
export async function prosesBayar(input: {
  karyawan_id: string;
  entry_ids: string[];
  hari_kerja: number;
  potong_kasbon: number;
}): Promise<void> {
  const supabase = await createClient();

  // 1. Ambil data karyawan untuk gaji_pokok
  const { data: karyawan, error: kError } = await supabase
    .from('karyawan')
    .select('gaji_pokok')
    .eq('id', input.karyawan_id)
    .single();

  if (kError) throw new Error('Data karyawan tidak ditemukan');

  // 2. Hitung gaji pokok prorata (gapok / 6 hari * hari_kerja)
  const gapok = Number(karyawan.gaji_pokok) || 0;
  const gapok_prorata = (gapok / 6) * input.hari_kerja;

  // 3. Panggil RPC Atomic pay_salary_atomic
  // Parameter disesuaikan dengan schema DB
  const { error } = await supabase.rpc('pay_salary_atomic', {
    p_karyawan_id: input.karyawan_id,
    p_ledger_ids: input.entry_ids,
    p_tanggal_bayar: new Date().toISOString(),
    p_gapok_row: (gapok_prorata > 0) ? { jumlah: gapok_prorata, keterangan: `Gaji Pokok (${input.hari_kerja} hari)` } : null,
    p_kasbon_row: (input.potong_kasbon > 0) ? { jumlah: input.potong_kasbon, keterangan: 'Potongan Gaji' } : null,
    p_jurnal_row: { keterangan: `Pembayaran Gaji Karyawan ID: ${input.karyawan_id}` }
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
