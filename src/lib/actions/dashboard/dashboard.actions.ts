'use server';

import { createClient } from '@/lib/supabase/server';

const TENANT_ID = 'STX-001';

// ─── Pipeline stage order (akhir → awal) untuk penentuan tahap terkini ─────────
const STAGE_ORDER = [
  'packing',
  'steam',
  'qc',
  'lubang_kancing',
  'buang_benang',
  'jahit',
  'cutting',
] as const;

export interface DashboardKPI {
  po_aktif: number;
  bundle_selesai_bulan_ini: number;
  bundle_berjalan: number;
  reject_bulan_ini: number;
  gaji_belum_bayar_nominal: number;
  gaji_belum_bayar_karyawan: number;
  kasbon_outstanding: number;
  total_bayar_gaji_bulan_ini: number;
  inventory_kritis: number;
  chart_pipeline: { tahap: string; jumlah: number }[];
  chart_output_mingguan: { label: string; jumlah: number }[];
}

// ─── Helper: Hitung batas tanggal dari bulan + tahun ────────────────────────
function getDateRange(bulan: string, tahun: string): { start: string; end: string } {
  const mm = bulan.padStart(2, '0');
  const lastDay = new Date(Number(tahun), Number(mm), 0).getDate();
  return {
    start: `${tahun}-${mm}-01`,
    end: `${tahun}-${mm}-${String(lastDay).padStart(2, '0')}`,
  };
}

// ─── Helper: Default bulan & tahun saat ini ──────────────────────────────────
function resolveFilter(bulan?: string, tahun?: string): { bulan: string; tahun: string } {
  const now = new Date();
  return {
    bulan: bulan ?? String(now.getMonth() + 1),
    tahun: tahun ?? String(now.getFullYear()),
  };
}

// ─── Main Function ───────────────────────────────────────────────────────────
export async function getDashboardKPI(
  bulan?: string,
  tahun?: string
): Promise<DashboardKPI> {
  const supabase = await createClient();
  const { bulan: b, tahun: t } = resolveFilter(bulan, tahun);
  const { start, end } = getDateRange(b, t);

  // ── 1. PO Aktif ─────────────────────────────────────────────────────────────
  const { count: po_aktif, error: poError } = await supabase
    .from('po')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', TENANT_ID)
    .in('status', ['draft', 'aktif']);

  if (poError) throw new Error('po_aktif: ' + poError.message);

  // ── 2. Bundle (selesai + berjalan + chart_pipeline) ──────────────────────────
  // chart_pipeline = snapshot real-time (TIDAK difilter bulan/tahun)
  const { data: bundleData, error: bundleError } = await supabase
    .from('bundle')
    .select('id, status_tahap')
    .eq('tenant_id', TENANT_ID);

  if (bundleError) throw new Error('bundle: ' + bundleError.message);

  let bundle_selesai_bulan_ini = 0;
  let bundle_berjalan = 0;
  const pipelineCount: Record<string, number> = {};

  (bundleData ?? []).forEach((row: any) => {
    const st = row.status_tahap ?? {};
    const packingStatus = st?.packing?.status;
    const packingWaktuSelesai: string | undefined = st?.packing?.waktu_selesai;

    // Cek apakah bundle selesai DAN jatuh dalam bulan/tahun filter
    const isSelesai =
      packingStatus === 'selesai' &&
      packingWaktuSelesai &&
      packingWaktuSelesai >= `${start}T00:00:00` &&
      packingWaktuSelesai <= `${end}T23:59:59`;

    if (isSelesai) {
      bundle_selesai_bulan_ini += 1;
    } else if (packingStatus !== 'selesai') {
      bundle_berjalan += 1;
    }

    // chart_pipeline: tentukan tahap terkini (tidak difilter bulan/tahun)
    let currentStage = 'belum_mulai';
    for (const stage of STAGE_ORDER) {
      if (st?.[stage]?.status === 'selesai' || st?.[stage]?.status === 'berjalan') {
        currentStage = stage;
        break;
      }
    }
    pipelineCount[currentStage] = (pipelineCount[currentStage] ?? 0) + 1;
  });

  // Susun chart_pipeline dengan urutan tetap
  const PIPELINE_LABELS = [...STAGE_ORDER, 'belum_mulai'] as string[];
  const chart_pipeline = PIPELINE_LABELS
    .filter((s) => pipelineCount[s] !== undefined)
    .map((s) => ({ tahap: s, jumlah: pipelineCount[s] ?? 0 }));

  // ── 3. Reject Bulan Ini ──────────────────────────────────────────────────────
  const { count: reject_bulan_ini, error: rejectError } = await supabase
    .from('reject_log')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', TENANT_ID)
    .gte('created_at', `${start}T00:00:00`)
    .lte('created_at', `${end}T23:59:59`);

  if (rejectError) throw new Error('reject_log: ' + rejectError.message);

  // ── 4. Gaji Belum Bayar (outstanding, tanpa filter bulan/tahun) ───────────────
  const { data: ledgerData, error: ledgerError } = await supabase
    .from('gaji_ledger')
    .select('karyawan_id, total')
    .eq('tenant_id', TENANT_ID)
    .eq('status', 'belum_lunas');

  if (ledgerError) throw new Error('gaji_ledger: ' + ledgerError.message);

  let gaji_belum_bayar_nominal = 0;
  const uniqueKaryawan = new Set<string>();
  (ledgerData ?? []).forEach((row: any) => {
    gaji_belum_bayar_nominal += Number(row.total) || 0;
    if (row.karyawan_id) uniqueKaryawan.add(row.karyawan_id);
  });
  const gaji_belum_bayar_karyawan = uniqueKaryawan.size;

  // ── 5. Kasbon Outstanding (tanpa filter bulan/tahun) ─────────────────────────
  const { data: kasbonData, error: kasbonError } = await supabase
    .from('kasbon')
    .select('jumlah')
    .eq('tenant_id', TENANT_ID)
    .eq('status', 'belum_lunas');

  if (kasbonError) throw new Error('kasbon: ' + kasbonError.message);

  const kasbon_outstanding = (kasbonData ?? []).reduce(
    (acc: number, row: any) => acc + (Number(row.jumlah) || 0),
    0
  );

  // ── 6. Total Bayar Gaji Bulan Ini ────────────────────────────────────────────
  const { data: paymentData, error: paymentError } = await supabase
    .from('gaji_payment')
    .select('total_bayar')
    .eq('tenant_id', TENANT_ID)
    .gte('tanggal_bayar', `${start}`)
    .lte('tanggal_bayar', `${end}`);

  if (paymentError) throw new Error('gaji_payment: ' + paymentError.message);

  const total_bayar_gaji_bulan_ini = (paymentData ?? []).reduce(
    (acc: number, row: any) => acc + (Number(row.total_bayar) || 0),
    0
  );

  // ── 7. Inventory Kritis ──────────────────────────────────────────────────────
  const { data: inventoryData, error: inventoryError } = await supabase
    .from('inventory_item')
    .select('stok_aktual, stok_minimum')
    .eq('tenant_id', TENANT_ID)
    .not('stok_minimum', 'is', null);

  if (inventoryError) throw new Error('inventory_item: ' + inventoryError.message);

  const inventory_kritis = (inventoryData ?? []).filter(
    (i: any) => Number(i.stok_aktual) < Number(i.stok_minimum)
  ).length;

  // ── 8. Chart Output Mingguan ─────────────────────────────────────────────────
  const { data: scanData, error: scanError } = await supabase
    .from('scan_log')
    .select('created_at')
    .eq('tenant_id', TENANT_ID)
    .eq('tipe', 'selesai')
    .gte('created_at', `${start}T00:00:00`)
    .lte('created_at', `${end}T23:59:59`);

  if (scanError) throw new Error('scan_log: ' + scanError.message);

  const weeklyCount: Record<number, number> = {};
  (scanData ?? []).forEach((row: any) => {
    const day = new Date(row.created_at).getDate();
    const minggu = Math.ceil(day / 7);
    weeklyCount[minggu] = (weeklyCount[minggu] ?? 0) + 1;
  });

  const chart_output_mingguan = Object.entries(weeklyCount)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([minggu, jumlah]) => ({
      label: `Minggu ${minggu}`,
      jumlah,
    }));

  // ── Return ───────────────────────────────────────────────────────────────────
  return {
    po_aktif: po_aktif ?? 0,
    bundle_selesai_bulan_ini,
    bundle_berjalan,
    reject_bulan_ini: reject_bulan_ini ?? 0,
    gaji_belum_bayar_nominal,
    gaji_belum_bayar_karyawan,
    kasbon_outstanding,
    total_bayar_gaji_bulan_ini,
    inventory_kritis,
    chart_pipeline,
    chart_output_mingguan,
  };
}
