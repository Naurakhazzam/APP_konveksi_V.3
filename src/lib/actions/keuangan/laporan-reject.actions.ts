'use server';

import { createClient } from '@/lib/supabase/server';

const TENANT_ID = 'STX-001';

export interface LaporanRejectItem {
  id: string;
  tanggal: string;
  karyawan_nama: string;
  keterangan: string;
  total_potongan: number;
}

export interface LaporanRejectSummary {
  total_potongan_periode: number;
  jumlah_kejadian: number;
  per_karyawan: {
    karyawan_nama: string;
    total_potongan: number;
    jumlah_kejadian: number;
  }[];
  items: LaporanRejectItem[];
}

export async function getLaporanReject(filters?: {
  bulan?: string;
  tahun?: string;
  karyawan_id?: string;
}): Promise<LaporanRejectSummary> {
  const supabase = await createClient();

  let query = supabase
    .from('gaji_ledger')
    .select(`
      id, tanggal, keterangan, total, sumber_id,
      karyawan:karyawan_id(nama)
    `)
    .eq('tenant_id', TENANT_ID)
    .eq('tipe', 'reject_potong')
    .order('tanggal', { ascending: false });

  if (filters?.bulan && filters?.tahun) {
    const mm = filters.bulan.padStart(2, '0');
    const lastDay = new Date(Number(filters.tahun), Number(mm), 0).getDate();
    query = query
      .gte('tanggal', `${filters.tahun}-${mm}-01`)
      .lte('tanggal', `${filters.tahun}-${mm}-${String(lastDay).padStart(2, '0')}`);
  } else if (filters?.tahun) {
    query = query
      .gte('tanggal', `${filters.tahun}-01-01`)
      .lte('tanggal', `${filters.tahun}-12-31`);
  }

  if (filters?.karyawan_id) {
    query = query.eq('karyawan_id', filters.karyawan_id);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const items: LaporanRejectItem[] = (data ?? []).map((row: any) => ({
    id: row.id,
    tanggal: row.tanggal,
    karyawan_nama: (row.karyawan as any)?.nama ?? '-',
    keterangan: row.keterangan ?? '-',
    total_potongan: Math.abs(Number(row.total)),
  }));

  // Per-karyawan aggregation
  const karyawanAgg: Record<string, { total: number; count: number }> = {};
  items.forEach(item => {
    if (!karyawanAgg[item.karyawan_nama]) {
      karyawanAgg[item.karyawan_nama] = { total: 0, count: 0 };
    }
    karyawanAgg[item.karyawan_nama].total += item.total_potongan;
    karyawanAgg[item.karyawan_nama].count += 1;
  });

  const per_karyawan = Object.entries(karyawanAgg)
    .map(([karyawan_nama, v]) => ({
      karyawan_nama,
      total_potongan: v.total,
      jumlah_kejadian: v.count,
    }))
    .sort((a, b) => b.total_potongan - a.total_potongan);

  return {
    total_potongan_periode: items.reduce((s, i) => s + i.total_potongan, 0),
    jumlah_kejadian: items.length,
    per_karyawan,
    items,
  };
}

// Helper: get list of karyawan for filter dropdown
export async function getKaryawanList(): Promise<{ id: string; nama: string }[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('karyawan')
    .select('id, nama')
    .eq('tenant_id', TENANT_ID)
    .eq('aktif', true)
    .order('nama');
  if (error) throw new Error(error.message);
  return data ?? [];
}
