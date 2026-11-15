'use server';

import { createClient } from '@/lib/supabase/server';
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
}

export interface MutasiPembantu {
  jenis_id: string;
  jenis: string;
  tanggal: string;
  tipe: 'beli' | 'jatah';
  nominal: number;
  pcs: number | null;
  ke_saldo: number;
  ke_hemat: number;
  saldo: number;
}

export interface PenghematanBulan {
  bulan: string; // YYYY-MM
  per_jenis: Record<string, number>;
  total: number;
}

export interface SaldoPembantuData {
  jenis: SaldoPembantuJenis[];
  mutasi: MutasiPembantu[];
  penghematan_bulanan: PenghematanBulan[];
  total_beli: number;
  total_jatah: number;
  total_saldo: number;
  total_penghematan: number;
}

export async function getSaldoPembantu(): Promise<SaldoPembantuData> {
  const supabase = await createClient();
  const [{ data: jenisRows, error: jErr }, { data: mutasiRows, error: mErr }] = await Promise.all([
    supabase
      .from('pembantu_jenis')
      .select('id, nama, tanpa_barang, urutan')
      .eq('tenant_id', TENANT_ID)
      .eq('aktif', true)
      .order('urutan'),
    supabase.rpc('get_mutasi_saldo_pembantu', { p_tenant_id: TENANT_ID, p_mulai: PO_AWAL_PERIODE }),
  ]);
  if (jErr) throw new Error(jErr.message);
  if (mErr) throw new Error(mErr.message);

  const nama = new Map<string, string>((jenisRows ?? []).map(j => [j.id, j.nama]));
  const ringkas = new Map<string, SaldoPembantuJenis>(
    (jenisRows ?? []).map(j => [j.id, {
      id: j.id, nama: j.nama, tanpa_barang: j.tanpa_barang,
      total_beli: 0, total_jatah: 0, saldo: 0, penghematan: 0, pcs: 0,
    }]),
  );
  const bulanan = new Map<string, PenghematanBulan>();

  type Row = {
    jenis_id: string; tanggal: string; tipe: 'beli' | 'jatah'; nominal: number | string;
    pcs: number | string | null; ke_saldo: number | string; ke_hemat: number | string; saldo: number | string;
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
    };
    const s = ringkas.get(m.jenis_id);
    if (s) {
      if (m.tipe === 'beli') s.total_beli += m.nominal;
      else { s.total_jatah += m.nominal; s.pcs += m.pcs ?? 0; }
      s.saldo = m.saldo; // mutasi urut tanggal per jenis → baris terakhir = saldo akhir
      s.penghematan += m.ke_hemat;
    }
    if (m.ke_hemat > 0) {
      const key = m.tanggal.slice(0, 7);
      const b = bulanan.get(key) ?? { bulan: key, per_jenis: {}, total: 0 };
      b.per_jenis[m.jenis_id] = (b.per_jenis[m.jenis_id] ?? 0) + m.ke_hemat;
      b.total += m.ke_hemat;
      bulanan.set(key, b);
    }
    return m;
  });

  const jenis = [...ringkas.values()];
  return {
    jenis,
    mutasi: mutasi.sort((a, b) => b.tanggal.localeCompare(a.tanggal) || (a.tipe === 'beli' ? 1 : -1)),
    penghematan_bulanan: [...bulanan.values()].sort((a, b) => b.bulan.localeCompare(a.bulan)),
    total_beli: jenis.reduce((s, j) => s + j.total_beli, 0),
    total_jatah: jenis.reduce((s, j) => s + j.total_jatah, 0),
    total_saldo: jenis.reduce((s, j) => s + j.saldo, 0),
    total_penghematan: jenis.reduce((s, j) => s + j.penghematan, 0),
  };
}
