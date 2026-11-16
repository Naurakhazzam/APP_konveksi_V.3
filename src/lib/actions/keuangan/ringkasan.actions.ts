'use server';

import { createClient } from '@/lib/supabase/server';
import { getLaporanPOList } from './laporan-po.actions';
import { PO_AWAL_PERIODE, poPeriodeBaru } from '@/lib/keuangan/periode-po';
import { getBundleIdsPeriodeBaru, getPoIdsPeriodeBaru } from '@/lib/keuangan/periode-po.server';
import { overheadPerBulan, pembantuPerBulan } from '@/lib/keuangan/biaya-bulanan.server';

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
  tahun?: number,
  /** true = hanya angka PO periode baru (PO-0100 ke atas); entri tanpa PO tetap dihitung */
  hanyaPeriodeBaru = false,
): Promise<RingkasanKeuanganData> {
  const now = new Date();
  const currentBulan = bulan ?? (now.getMonth() + 1);
  const currentTahun = tahun ?? now.getFullYear();
  const mm = String(currentBulan).padStart(2, '0');

  const supabase = await createClient();
  const poBaru = hanyaPeriodeBaru ? await getPoIdsPeriodeBaru(supabase) : null;
  const bundleBaru = hanyaPeriodeBaru ? await getBundleIdsPeriodeBaru(supabase) : null;
  const saringKas = (rows: any[] | null) => !poBaru ? (rows ?? [])
    : (rows ?? []).filter((k: any) => !k.po_id || poBaru.has(String(k.po_id)));
  const saringUpah = (rows: any[] | null) => !bundleBaru ? (rows ?? [])
    : (rows ?? []).filter((g: any) => bundleBaru.has(String(g.sumber_id)));

  // ─── 1. Bulan berjalan ───
  const lastDayCurrent = new Date(currentTahun, currentBulan, 0).getDate();
  const awalBulan = `${currentTahun}-${mm}-01`;
  const akhirBulan = `${currentTahun}-${mm}-${String(lastDayCurrent).padStart(2, '0')}`;

  // Buku kas tipe='masuk' untuk bulan berjalan (DP klien, pelunasan, dll)
  const { data: bukuKasBulanIni, error: bukuKasBulanErr } = await supabase
    .from('buku_kas')
    .select('nominal, po_id')
    .eq('tenant_id', TENANT_ID)
    .eq('tipe', 'masuk')
    .gte('tanggal', `${currentTahun}-${mm}-01`)
    .lte('tanggal', `${currentTahun}-${mm}-${String(lastDayCurrent).padStart(2, '0')}`);

  if (bukuKasBulanErr) throw new Error(bukuKasBulanErr.message);

  // Upah bulan berjalan: baca dari gaji_ledger (earned, belum/sudah lunas)
  const { data: gajiLedgerBulanIni, error: gajiLedgerBulanErr } = await supabase
    .from('gaji_ledger')
    .select('total, tipe, sumber_id')
    .eq('tenant_id', TENANT_ID)
    .in('status', ['belum_lunas', 'lunas'])
    .gte('tanggal', `${currentTahun}-${mm}-01`)
    .lte('tanggal', `${currentTahun}-${mm}-${String(lastDayCurrent).padStart(2, '0')}`);

  if (gajiLedgerBulanErr) throw new Error(gajiLedgerBulanErr.message);

  let total_pemasukan = 0;
  let direct_bahan = 0;

  // Overhead dari Buku Kas (+ alokasi biaya tetap, Operasional, Lainnya) — bukan jurnal_entry
  // yang sudah tidak diisi. Bahan = pemakaian kain/aksesori + belanja bahan pembantu.
  const bulanIni = `${currentTahun}-${mm}`;
  const [ovBulanIni, pembantuBulanIni] = await Promise.all([
    overheadPerBulan(supabase, awalBulan, akhirBulan, hanyaPeriodeBaru),
    pembantuPerBulan(supabase, awalBulan, akhirBulan, hanyaPeriodeBaru),
  ]);
  const overhead = Math.round(ovBulanIni.get(bulanIni) ?? 0);

  const { data: bahanBulanIni, error: bahanBulanErr } = await supabase.rpc('get_biaya_bahan_bulanan', {
    p_dari: `${currentTahun}-${mm}-01`,
    p_sampai: `${currentTahun}-${mm}-${String(lastDayCurrent).padStart(2, '0')}`,
    p_tenant_id: TENANT_ID,
    p_po_mulai: hanyaPeriodeBaru ? PO_AWAL_PERIODE : null,
  });
  if (bahanBulanErr) throw new Error(bahanBulanErr.message);
  direct_bahan = Math.round((bahanBulanIni ?? []).reduce(
    (s: number, r: any) => s + Number(r.biaya_kain ?? 0) + Number(r.biaya_aksesori ?? 0), 0)
    + (pembantuBulanIni.get(bulanIni) ?? 0));

  // Gabungkan pemasukan dari buku_kas
  saringKas(bukuKasBulanIni).forEach((k: any) => {
    total_pemasukan += Number(k.nominal);
  });

  // direct_upah dari gaji_ledger (upah earned bulan berjalan)
  // selesai + rework = biaya positif; reject_potong = potongan (dikurangi)
  const direct_upah = saringUpah(gajiLedgerBulanIni).reduce(
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
  const awalRange = `${firstMonth.yyyy}-${firstMonth.mm}-01`;
  const akhirRange = `${lastMonth.yyyy}-${lastMonth.mm}-${String(lastDayOfRange).padStart(2, '0')}`;
  const [ov6Bulan, pembantu6Bulan] = await Promise.all([
    overheadPerBulan(supabase, awalRange, akhirRange, hanyaPeriodeBaru),
    pembantuPerBulan(supabase, awalRange, akhirRange, hanyaPeriodeBaru),
  ]);

  // Buku kas tipe='masuk' untuk 6 bulan terakhir
  const { data: bukuKas6Bulan, error: bukuKas6Err } = await supabase
    .from('buku_kas')
    .select('nominal, tanggal, po_id')
    .eq('tenant_id', TENANT_ID)
    .eq('tipe', 'masuk')
    .gte('tanggal', `${firstMonth.yyyy}-${firstMonth.mm}-01`)
    .lte('tanggal', `${lastMonth.yyyy}-${lastMonth.mm}-${String(lastDayOfRange).padStart(2, '0')}`);

  if (bukuKas6Err) throw new Error(bukuKas6Err.message);

  // Gaji ledger 6 bulan terakhir (upah earned, belum/sudah lunas)
  const { data: gajiLedger6Bulan, error: gajiLedger6Err } = await supabase
    .from('gaji_ledger')
    .select('total, tipe, tanggal, sumber_id')
    .eq('tenant_id', TENANT_ID)
    .in('status', ['belum_lunas', 'lunas'])
    .gte('tanggal', `${firstMonth.yyyy}-${firstMonth.mm}-01`)
    .lte('tanggal', `${lastMonth.yyyy}-${lastMonth.mm}-${String(lastDayOfRange).padStart(2, '0')}`);

  if (gajiLedger6Err) throw new Error(gajiLedger6Err.message);

  // Biaya bahan 6 bulan dari catatan pemakaian (bukan jurnal)
  const { data: bahan6Bulan, error: bahan6Err } = await supabase.rpc('get_biaya_bahan_bulanan', {
    p_dari: `${firstMonth.yyyy}-${firstMonth.mm}-01`,
    p_sampai: `${lastMonth.yyyy}-${lastMonth.mm}-${String(lastDayOfRange).padStart(2, '0')}`,
    p_tenant_id: TENANT_ID,
    p_po_mulai: hanyaPeriodeBaru ? PO_AWAL_PERIODE : null,
  });
  if (bahan6Err) throw new Error(bahan6Err.message);
  const bahanPerBulan = new Map<string, number>(
    (bahan6Bulan ?? []).map((r: any) => [String(r.bulan), Number(r.biaya_kain ?? 0) + Number(r.biaya_aksesori ?? 0)]));

  const tren_6_bulan = months.map(month => {
    const monthBukuKas = saringKas(bukuKas6Bulan).filter((k: any) => {
      const d = k.tanggal as string;
      return d.startsWith(`${month.yyyy}-${month.mm}`);
    });

    const monthGajiLedger = saringUpah(gajiLedger6Bulan).filter((g: any) => {
      const d = g.tanggal as string;
      return d.startsWith(`${month.yyyy}-${month.mm}`);
    });

    const key = `${month.yyyy}-${month.mm}`;
    const db = Math.round((bahanPerBulan.get(key) ?? 0) + (pembantu6Bulan.get(key) ?? 0));
    const ov = Math.round(ov6Bulan.get(key) ?? 0);
    let pm = 0;

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
    .select('total, tipe, sumber_id')
    .eq('tenant_id', TENANT_ID)
    .eq('status', 'belum_lunas');

  if (ledgerErr) throw new Error(ledgerErr.message);

  const upah_outstanding = saringUpah(ledgerData).reduce(
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
      .filter(p => p.status === 'boncos' && (!hanyaPeriodeBaru || poPeriodeBaru(p.no_po)))
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
