'use server';

import { createClient } from '@/lib/supabase/server';
import { getLaporanPOList } from './laporan-po.actions';

const TENANT_ID = 'STX-001';

export interface RingkasanKeuanganData {
  bulan_berjalan: {
    total_pemasukan: number;
    total_pengeluaran: number;
    saldo: number;
    breakdown_pengeluaran: {
      direct_bahan: number;
      direct_upah: number;
      overhead: number;
    };
  };
  upah_outstanding: number;
  tren_6_bulan: {
    bulan: string;        // format: "2026-01"
    bulan_label: string;  // format: "Jan"
    direct_bahan: number;
    direct_upah: number;
    overhead: number;
    pemasukan: number;
  }[];
  po_boncos: {
    po_id: string;
    no_po: string;
    klien_nama: string;
    gap: number;
  }[];
}

const BULAN_SHORT = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];

export async function getRingkasanKeuangan(
  bulan?: number,
  tahun?: number
): Promise<RingkasanKeuanganData> {
  const now = new Date();
  const currentBulan = bulan ?? (now.getMonth() + 1);
  const currentTahun = tahun ?? now.getFullYear();
  const mm = String(currentBulan).padStart(2, '0');

  const supabase = await createClient();

  // ─── 1. Jurnal bulan berjalan ───
  const { data: jurnalBulanIni, error: jurnalErr } = await supabase
    .from('jurnal_entry')
    .select('jenis, nominal')
    .eq('tenant_id', TENANT_ID)
    .gte('tanggal', `${currentTahun}-${mm}-01`)
    .lte('tanggal', `${currentTahun}-${mm}-31`);

  if (jurnalErr) throw new Error(jurnalErr.message);

  let total_pemasukan = 0;
  let direct_bahan = 0;
  let direct_upah = 0;
  let overhead = 0;

  (jurnalBulanIni ?? []).forEach((j: any) => {
    const nominal = Number(j.nominal);
    if (j.jenis === 'masuk') total_pemasukan += nominal;
    else if (j.jenis === 'direct_bahan') direct_bahan += nominal;
    else if (j.jenis === 'direct_upah') direct_upah += nominal;
    else if (j.jenis === 'overhead') overhead += nominal;
  });

  const total_pengeluaran = direct_bahan + direct_upah + overhead;

  // ─── 2. Jurnal 6 bulan terakhir ───
  const months: { bulan: string; bulan_label: string; mm: string; yyyy: string }[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(currentTahun, currentBulan - 1 - i, 1);
    const m = d.getMonth() + 1;
    const y = d.getFullYear();
    months.push({
      bulan: `${y}-${String(m).padStart(2, '0')}`,
      bulan_label: BULAN_SHORT[m - 1],
      mm: String(m).padStart(2, '0'),
      yyyy: String(y),
    });
  }

  const firstMonth = months[0];
  const lastMonth = months[months.length - 1];

  const { data: jurnal6Bulan, error: tren6Err } = await supabase
    .from('jurnal_entry')
    .select('jenis, nominal, tanggal')
    .eq('tenant_id', TENANT_ID)
    .gte('tanggal', `${firstMonth.yyyy}-${firstMonth.mm}-01`)
    .lte('tanggal', `${lastMonth.yyyy}-${lastMonth.mm}-31`);

  if (tren6Err) throw new Error(tren6Err.message);

  const tren_6_bulan = months.map(month => {
    const monthEntries = (jurnal6Bulan ?? []).filter((j: any) => {
      const d = j.tanggal as string;
      return d.startsWith(`${month.yyyy}-${month.mm}`);
    });

    let db = 0, du = 0, ov = 0, pm = 0;
    monthEntries.forEach((j: any) => {
      const n = Number(j.nominal);
      if (j.jenis === 'direct_bahan') db += n;
      else if (j.jenis === 'direct_upah') du += n;
      else if (j.jenis === 'overhead') ov += n;
      else if (j.jenis === 'masuk') pm += n;
    });

    return {
      bulan: month.bulan,
      bulan_label: month.bulan_label,
      direct_bahan: db,
      direct_upah: du,
      overhead: ov,
      pemasukan: pm,
    };
  });

  // ─── 3. Upah outstanding ───
  const { data: ledgerData, error: ledgerErr } = await supabase
    .from('gaji_ledger')
    .select('total')
    .eq('tenant_id', TENANT_ID)
    .eq('status', 'belum_lunas');

  if (ledgerErr) throw new Error(ledgerErr.message);

  const upah_outstanding = (ledgerData ?? []).reduce(
    (s: number, r: any) => s + Math.abs(Number(r.total)), 0
  );

  // ─── 4. PO Boncos (reuse from Phase B) ───
  let po_boncos: RingkasanKeuanganData['po_boncos'] = [];
  try {
    const allPO = await getLaporanPOList();
    po_boncos = allPO
      .filter(p => p.status === 'boncos')
      .sort((a, b) => b.gap - a.gap)
      .slice(0, 5)
      .map(p => ({
        po_id: p.po_id,
        no_po: p.no_po,
        klien_nama: p.klien_nama,
        gap: p.gap,
      }));
  } catch {
    // If PO data fails, just return empty — non-critical
  }

  return {
    bulan_berjalan: {
      total_pemasukan,
      total_pengeluaran,
      saldo: total_pemasukan - total_pengeluaran,
      breakdown_pengeluaran: { direct_bahan, direct_upah, overhead },
    },
    upah_outstanding,
    tren_6_bulan,
    po_boncos,
  };
}
