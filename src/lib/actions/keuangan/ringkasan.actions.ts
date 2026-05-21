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
  const lastDayCurrent = new Date(currentTahun, currentBulan, 0).getDate();
  const { data: jurnalBulanIni, error: jurnalErr } = await supabase
    .from('jurnal_entry')
    .select('jenis, nominal')
    .eq('tenant_id', TENANT_ID)
    .gte('tanggal', `${currentTahun}-${mm}-01`)
    .lte('tanggal', `${currentTahun}-${mm}-${String(lastDayCurrent).padStart(2, '0')}`);

  if (jurnalErr) throw new Error(jurnalErr.message);

  // Buku kas tipe='masuk' untuk bulan berjalan (DP klien, pelunasan, dll)
  const { data: bukuKasBulanIni, error: bukuKasBulanErr } = await supabase
    .from('buku_kas')
    .select('nominal')
    .eq('tenant_id', TENANT_ID)
    .eq('tipe', 'masuk')
    .gte('tanggal', `${currentTahun}-${mm}-01`)
    .lte('tanggal', `${currentTahun}-${mm}-${String(lastDayCurrent).padStart(2, '0')}`);

  if (bukuKasBulanErr) throw new Error(bukuKasBulanErr.message);

  // Upah bulan berjalan: baca dari gaji_ledger (earned, belum/sudah lunas)
  const { data: gajiLedgerBulanIni, error: gajiLedgerBulanErr } = await supabase
    .from('gaji_ledger')
    .select('total, tipe')
    .eq('tenant_id', TENANT_ID)
    .in('status', ['belum_lunas', 'lunas'])
    .gte('tanggal', `${currentTahun}-${mm}-01`)
    .lte('tanggal', `${currentTahun}-${mm}-${String(lastDayCurrent).padStart(2, '0')}`);

  if (gajiLedgerBulanErr) throw new Error(gajiLedgerBulanErr.message);

  let total_pemasukan = 0;
  let direct_bahan = 0;
  let overhead = 0;

  // Fallback: direct_bahan & overhead dari jurnal_entry
  (jurnalBulanIni ?? []).forEach((j: any) => {
    const nominal = Number(j.nominal);
    if (j.jenis === 'masuk') total_pemasukan += nominal;
    else if (j.jenis === 'direct_bahan') direct_bahan += nominal;
    else if (j.jenis === 'overhead') overhead += nominal;
  });

  // Gabungkan pemasukan dari buku_kas
  (bukuKasBulanIni ?? []).forEach((k: any) => {
    total_pemasukan += Number(k.nominal);
  });

  // direct_upah dari gaji_ledger (upah earned bulan berjalan)
  // selesai + rework = biaya positif; reject_potong = potongan (dikurangi)
  const direct_upah = (gajiLedgerBulanIni ?? []).reduce(
    (s: number, r: any) => {
      const t = Number(r.total);
      return r.tipe === 'reject_potong' ? s - t : s + t;
    }, 0
  );

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

  const lastDayOfRange = new Date(Number(lastMonth.yyyy), Number(lastMonth.mm), 0).getDate();
  const { data: jurnal6Bulan, error: tren6Err } = await supabase
    .from('jurnal_entry')
    .select('jenis, nominal, tanggal')
    .eq('tenant_id', TENANT_ID)
    .gte('tanggal', `${firstMonth.yyyy}-${firstMonth.mm}-01`)
    .lte('tanggal', `${lastMonth.yyyy}-${lastMonth.mm}-${String(lastDayOfRange).padStart(2, '0')}`);

  if (tren6Err) throw new Error(tren6Err.message);

  // Buku kas tipe='masuk' untuk 6 bulan terakhir
  const { data: bukuKas6Bulan, error: bukuKas6Err } = await supabase
    .from('buku_kas')
    .select('nominal, tanggal')
    .eq('tenant_id', TENANT_ID)
    .eq('tipe', 'masuk')
    .gte('tanggal', `${firstMonth.yyyy}-${firstMonth.mm}-01`)
    .lte('tanggal', `${lastMonth.yyyy}-${lastMonth.mm}-${String(lastDayOfRange).padStart(2, '0')}`);

  if (bukuKas6Err) throw new Error(bukuKas6Err.message);

  // Gaji ledger 6 bulan terakhir (upah earned, belum/sudah lunas)
  const { data: gajiLedger6Bulan, error: gajiLedger6Err } = await supabase
    .from('gaji_ledger')
    .select('total, tipe, tanggal')
    .eq('tenant_id', TENANT_ID)
    .in('status', ['belum_lunas', 'lunas'])
    .gte('tanggal', `${firstMonth.yyyy}-${firstMonth.mm}-01`)
    .lte('tanggal', `${lastMonth.yyyy}-${lastMonth.mm}-${String(lastDayOfRange).padStart(2, '0')}`);

  if (gajiLedger6Err) throw new Error(gajiLedger6Err.message);

  const tren_6_bulan = months.map(month => {
    const monthJurnal = (jurnal6Bulan ?? []).filter((j: any) => {
      const d = j.tanggal as string;
      return d.startsWith(`${month.yyyy}-${month.mm}`);
    });

    const monthBukuKas = (bukuKas6Bulan ?? []).filter((k: any) => {
      const d = k.tanggal as string;
      return d.startsWith(`${month.yyyy}-${month.mm}`);
    });

    const monthGajiLedger = (gajiLedger6Bulan ?? []).filter((g: any) => {
      const d = g.tanggal as string;
      return d.startsWith(`${month.yyyy}-${month.mm}`);
    });

    let db = 0, ov = 0, pm = 0;

    // direct_bahan & overhead dari jurnal_entry; pemasukan manual sebagai fallback
    monthJurnal.forEach((j: any) => {
      const n = Number(j.nominal);
      if (j.jenis === 'direct_bahan') db += n;
      else if (j.jenis === 'overhead') ov += n;
      else if (j.jenis === 'masuk') pm += n;
    });

    // Gabungkan pemasukan dari buku_kas
    monthBukuKas.forEach((k: any) => {
      pm += Number(k.nominal);
    });

    // direct_upah dari gaji_ledger (upah earned per bulan, net reject_potong)
    const du = monthGajiLedger.reduce(
      (s: number, g: any) => {
        const t = Number(g.total);
        return g.tipe === 'reject_potong' ? s - t : s + t;
      }, 0
    );

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
    .select('total, tipe')
    .eq('tenant_id', TENANT_ID)
    .eq('status', 'belum_lunas');

  if (ledgerErr) throw new Error(ledgerErr.message);

  const upah_outstanding = (ledgerData ?? []).reduce(
    (s: number, r: any) => {
      const t = Number(r.total);
      return r.tipe === 'reject_potong' ? s - t : s + t;
    }, 0
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
