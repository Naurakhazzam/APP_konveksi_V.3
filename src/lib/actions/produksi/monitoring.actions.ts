'use server';

import { createClient } from '@/lib/supabase/server';
import { getCurrentUserProfile } from '@/lib/auth/permissions';

const TENANT_ID = 'STX-001';

export interface MonitoringStats {
  po_aktif: number;
  total_bundle: number;
  bundle_selesai: number;
  bundle_terkirim: number;
  bermasalah: number;
}

export interface PoRow {
  id: string;
  no_po: string;
  klien_nama: string;
  total_bundle: number;
  progress: Record<string, { done: number; total: number }>;
}

export interface PoGrouped {
  belum_mulai: PoRow[];
  sedang_diproses: PoRow[];
  selesai_produksi: PoRow[];
  selesai_dikirim: PoRow[];
}

export interface SjHistoryEntry {
  nomor_sj: string;
  tanggal: string;
  qty_kirim: number;
  qty_diterima: number | null;
}

export interface ArtikelRow {
  id: string;
  no_po: string;
  klien_nama: string;
  model_nama: string;
  warna: string;
  size: string;
  qty_order: number;
  total_bundle: number;
  progress: Record<string, { done: number; total: number; pct: number }>;
  qty_terkirim: number;
  qty_diterima: number;
  sj_history: SjHistoryEntry[];
}

export interface WarningRow {
  bundle_id: string;
  barcode: string;
  no_po: string;
  tahap: string;
  jenis: 'mandek';
  detail: string;
  waktu: string;
}

const STAGES = ['cutting', 'jahit', 'buang_benang', 'lubang_kancing', 'qc', 'steam', 'packing'];

/**
 * Mengambil ringkasan statistik produksi untuk dashboard monitoring.
 */
export async function getMonitoringStats(): Promise<MonitoringStats> {
  const profile = await getCurrentUserProfile();
  if (!profile) throw new Error('Unauthorized');

  const supabase = await createClient();

  // 1. Hitung PO Aktif
  const { count: poAktifCount, error: poErr } = await supabase
    .from('po')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'aktif')
    .eq('tenant_id', TENANT_ID);

  if (poErr) throw new Error(`Gagal hitung PO aktif: ${poErr.message}`);

  // 2. Hitung Total Bundle
  const { count: bundleCount, error: bdlErr } = await supabase
    .from('bundle')
    .select('*', { count: 'exact', head: true })
    .eq('tenant_id', TENANT_ID);

  if (bdlErr) throw new Error(`Gagal hitung total bundle: ${bdlErr.message}`);

  // 3. Hitung Bundle Selesai (sudah discan packing selesai)
  // Gunakan unique bundle_id dari scan_log
  const { data: logs, error: logsErr } = await supabase
    .from('scan_log')
    .select('bundle_id')
    .eq('tahap', 'packing')
    .eq('tipe', 'selesai')
    .eq('tenant_id', TENANT_ID);

  if (logsErr) throw new Error(`Gagal ambil logs packing: ${logsErr.message}`);

  const uniqueSelesaiCount = new Set((logs ?? []).map((l: any) => l.bundle_id)).size;

  // 4. Hitung Bundle Terkirim (sudah punya surat_jalan_id)
  const { count: terkirimCount, error: terkirimErr } = await supabase
    .from('bundle')
    .select('*', { count: 'exact', head: true })
    .not('surat_jalan_id', 'is', null)
    .eq('tenant_id', TENANT_ID);

  if (terkirimErr) throw new Error(`Gagal hitung bundle terkirim: ${terkirimErr.message}`);

  // M-04: Calculate warnings count (default 24h)
  const warnings = await getMonitoringWarnings(24);

  return {
    po_aktif: poAktifCount || 0,
    total_bundle: bundleCount || 0,
    bundle_selesai: uniqueSelesaiCount,
    bundle_terkirim: terkirimCount || 0,
    bermasalah: warnings.length,
  };
}

/**
 * Mengambil daftar PO aktif yang dikelompokkan berdasarkan kemajuan produksi.
 */
export async function getPoGrouped(): Promise<PoGrouped> {
  const profile = await getCurrentUserProfile();
  if (!profile) throw new Error('Unauthorized');

  const supabase = await createClient();

  // Fetch PO aktif + bundle + scan_log + status_tahap
  const { data, error } = await supabase
    .from('po')
    .select(`
      id, no_po, status,
      klien:klien_id(nama),
      bundle(
        id,
        status_tahap,
        surat_jalan_id,
        scan_log(tahap, tipe)
      )
    `)
    .eq('status', 'aktif')
    .eq('tenant_id', TENANT_ID)
    .limit(100)
    .order('created_at', { ascending: false });

  if (error) throw new Error(`Gagal ambil data PO grouped: ${error.message}`);

  const belum_mulai: PoRow[] = [];
  const sedang_diproses: PoRow[] = [];
  const selesai_produksi: PoRow[] = [];
  const selesai_dikirim: PoRow[] = [];

  (data as any[]).forEach((po) => {
    const total_bundle = po.bundle?.length ?? 0;
    const progress: Record<string, { done: number; total: number }> = {};

    // Initialize progress for all stages + pengiriman
    STAGES.forEach(s => progress[s] = { done: 0, total: total_bundle });
    progress['pengiriman'] = { done: 0, total: total_bundle };

    let hasAnyScan = false;
    let allFinishedPacking = total_bundle > 0;
    let allShipped = total_bundle > 0;

    po.bundle?.forEach((b: any) => {
      const logs = b.scan_log || [];
      if (logs.length > 0) hasAnyScan = true;

      // Check per stage completion for this bundle
      // Cutting: stored in status_tahap JSONB, not scan_log
      STAGES.forEach(stage => {
        let isDone: boolean;
        if (stage === 'cutting') {
          isDone = b.status_tahap?.cutting?.status === 'selesai';
          if (isDone) hasAnyScan = true; // cutting selesai = sudah mulai
        } else {
          isDone = logs.some((l: any) => l.tahap === stage && l.tipe === 'selesai');
        }
        if (isDone) progress[stage].done++;
      });

      // Pengiriman: bundle sudah punya surat_jalan_id
      if (b.surat_jalan_id) {
        progress['pengiriman'].done++;
      } else {
        allShipped = false;
      }

      // Special check for packing
      const isPackingDone = logs.some((l: any) => l.tahap === 'packing' && l.tipe === 'selesai');
      if (!isPackingDone) allFinishedPacking = false;
    });

    const row: PoRow = {
      id: po.id,
      no_po: po.no_po,
      klien_nama: po.klien?.nama ?? '-',
      total_bundle,
      progress
    };

    if (!hasAnyScan && total_bundle > 0) {
      belum_mulai.push(row);
    } else if (allFinishedPacking && allShipped && total_bundle > 0) {
      selesai_dikirim.push(row);
    } else if (allFinishedPacking && total_bundle > 0) {
      selesai_produksi.push(row);
    } else {
      sedang_diproses.push(row);
    }
  });

  return { belum_mulai, sedang_diproses, selesai_produksi, selesai_dikirim };
}

/**
 * Mengambil data monitoring per artikel, dikelompokkan berdasarkan
 * (no_po + model + warna + size) sehingga banyak po_item dengan
 * kombinasi yang sama tampil sebagai satu baris teragregasi.
 */
export async function getMonitoringPerArtikel(): Promise<ArtikelRow[]> {
  const profile = await getCurrentUserProfile();
  if (!profile) throw new Error('Unauthorized');

  const supabase = await createClient();

  // Fetch po_item + po (hanya aktif) + produk + model + bundle + scan_log
  const { data, error } = await supabase
    .from('po_item')
    .select(`
      id, warna, size, qty_order,
      po:po_id!inner(
        id,
        no_po,
        status,
        klien:klien_id(nama)
      ),
      produk:produk_id(
        model:model_id(id, nama)
      ),
      bundle(
        id,
        status_tahap,
        surat_jalan_id,
        scan_log(tahap, tipe)
      )
    `)
    .eq('tenant_id', TENANT_ID)
    .eq('po.status', 'aktif')
    .limit(500);

  if (error) throw new Error(`Gagal ambil data monitoring artikel: ${error.message}`);

  // Sudah difilter di DB — ambil semua hasil
  const filteredData = (data as any[]).filter(item => item.po !== null);

  // Group by (po_id + model_id + warna + size)
  const groupMap: Record<string, {
    id: string;
    no_po: string;
    klien_nama: string;
    model_nama: string;
    warna: string;
    size: string;
    qty_order: number;
    bundles: any[];
  }> = {};

  filteredData.forEach((item) => {
    const po_id    = item.po?.id ?? '';
    const model_id = item.produk?.model?.id ?? '';
    const key      = `${po_id}|${model_id}|${item.warna}|${item.size}`;

    if (!groupMap[key]) {
      groupMap[key] = {
        id        : key,
        no_po     : item.po.no_po,
        klien_nama: item.po.klien?.nama ?? '-',
        model_nama: item.produk?.model?.nama ?? '-',
        warna     : item.warna,
        size      : item.size,
        qty_order : 0,
        bundles   : [],
      };
    }

    groupMap[key].qty_order += Number(item.qty_order ?? 0);
    groupMap[key].bundles.push(...(item.bundle ?? []));
  });

  // Kumpulkan semua bundle yang sudah punya surat_jalan_id, untuk agregasi qty terkirim/diterima
  const shippedBundleIds: string[] = [];
  Object.values(groupMap).forEach(g => {
    g.bundles.forEach((b: any) => {
      if (b.surat_jalan_id) shippedBundleIds.push(b.id);
    });
  });

  const sjiMap = new Map<string, { qty_kirim: number; qty_diterima: number | null; sj_id: string }>();
  const sjMap = new Map<string, { nomor_sj: string; tanggal: string }>();

  if (shippedBundleIds.length > 0) {
    const { data: sjiList, error: sjiErr } = await supabase
      .from('surat_jalan_item')
      .select('bundle_id, sj_id, qty_kirim, qty_diterima')
      .in('bundle_id', shippedBundleIds)
      .eq('tenant_id', TENANT_ID);

    if (sjiErr) throw new Error(`Gagal ambil data surat_jalan_item: ${sjiErr.message}`);

    (sjiList ?? []).forEach((s: any) => {
      sjiMap.set(s.bundle_id, { qty_kirim: s.qty_kirim, qty_diterima: s.qty_diterima, sj_id: s.sj_id });
    });

    const sjIds = [...new Set((sjiList ?? []).map((s: any) => s.sj_id))];
    if (sjIds.length > 0) {
      const { data: sjList, error: sjErr } = await supabase
        .from('surat_jalan')
        .select('id, nomor_sj, tanggal')
        .in('id', sjIds);

      if (sjErr) throw new Error(`Gagal ambil data surat_jalan: ${sjErr.message}`);

      (sjList ?? []).forEach((s: any) => sjMap.set(s.id, { nomor_sj: s.nomor_sj, tanggal: s.tanggal }));
    }
  }

  // Build ArtikelRow dari setiap group
  const result: ArtikelRow[] = Object.values(groupMap).map((group) => {
    const total_bundle = group.bundles.length;
    const progress: Record<string, { done: number; total: number; pct: number }> = {};

    STAGES.forEach(s => {
      progress[s] = { done: 0, total: total_bundle, pct: 0 };
    });
    progress['pengiriman'] = { done: 0, total: total_bundle, pct: 0 };

    let qty_terkirim = 0;
    let qty_diterima = 0;

    // Agregasi riwayat SJ per group (bundle bisa tersebar di beberapa SJ berbeda)
    const sjAgg: Record<string, { nomor_sj: string; tanggal: string; qty_kirim: number; qty_diterima: number; hasNullDiterima: boolean }> = {};

    group.bundles.forEach((b: any) => {
      const logs = b.scan_log || [];
      STAGES.forEach(stage => {
        let isDone: boolean;
        if (stage === 'cutting') {
          isDone = b.status_tahap?.cutting?.status === 'selesai';
        } else {
          isDone = logs.some((l: any) => l.tahap === stage && l.tipe === 'selesai');
        }
        if (isDone) progress[stage].done++;
      });

      if (b.surat_jalan_id) {
        progress['pengiriman'].done++;

        const sji = sjiMap.get(b.id);
        if (sji) {
          qty_terkirim += sji.qty_kirim ?? 0;
          if (sji.qty_diterima != null) qty_diterima += sji.qty_diterima;

          const sjInfo = sjMap.get(sji.sj_id);
          if (sjInfo) {
            if (!sjAgg[sji.sj_id]) {
              sjAgg[sji.sj_id] = { nomor_sj: sjInfo.nomor_sj, tanggal: sjInfo.tanggal, qty_kirim: 0, qty_diterima: 0, hasNullDiterima: false };
            }
            sjAgg[sji.sj_id].qty_kirim += sji.qty_kirim ?? 0;
            if (sji.qty_diterima == null) {
              sjAgg[sji.sj_id].hasNullDiterima = true;
            } else {
              sjAgg[sji.sj_id].qty_diterima += sji.qty_diterima;
            }
          }
        }
      }
    });

    // Hitung pct
    [...STAGES, 'pengiriman'].forEach(s => {
      if (progress[s].total > 0) {
        progress[s].pct = Math.round((progress[s].done / progress[s].total) * 100);
      }
    });

    const sj_history: SjHistoryEntry[] = Object.values(sjAgg)
      .map(s => ({
        nomor_sj: s.nomor_sj,
        tanggal: s.tanggal,
        qty_kirim: s.qty_kirim,
        qty_diterima: s.hasNullDiterima ? null : s.qty_diterima,
      }))
      .sort((a, b) => a.tanggal.localeCompare(b.tanggal));

    return {
      id         : group.id,
      no_po      : group.no_po,
      klien_nama : group.klien_nama,
      model_nama : group.model_nama,
      warna      : group.warna,
      size       : group.size,
      qty_order  : group.qty_order,
      total_bundle,
      progress,
      qty_terkirim,
      qty_diterima,
      sj_history,
    };
  });

  // Urutkan: no_po asc, model asc, warna asc, size asc
  result.sort((a, b) =>
    a.no_po.localeCompare(b.no_po) ||
    a.model_nama.localeCompare(b.model_nama) ||
    a.warna.localeCompare(b.warna) ||
    a.size.localeCompare(b.size)
  );

  return result;
}

/**
 * Mengambil daftar warning (bundle mandek) berdasarkan ambang batas jam.
 */
export async function getMonitoringWarnings(thresholdHours: number): Promise<WarningRow[]> {
  const profile = await getCurrentUserProfile();
  if (!profile) throw new Error('Unauthorized');

  const supabase = await createClient();

  // 1. Fetch scan_log dalam 60 hari terakhir untuk deteksi bundle mandek
  const since = new Date();
  since.setDate(since.getDate() - 60);

  const { data, error } = await supabase
    .from('scan_log')
    .select(`
      id, bundle_id, tahap, tipe, created_at,
      bundle:bundle_id(
        barcode,
        po:po_id(no_po, status)
      )
    `)
    .eq('tenant_id', TENANT_ID)
    .gte('created_at', since.toISOString())
    .limit(5000);

  if (error) throw new Error(`Gagal ambil logs for warnings: ${error.message}`);

  const logs = (data as any[]).filter(l =>
    l.bundle !== null &&
    l.bundle.po !== null &&
    l.bundle.po.status !== 'dibatalkan' &&
    l.bundle.po.status !== 'selesai'
  );

  // 2. Identify stuck bundles
  const result: WarningRow[] = [];
  const now = new Date();

  // Group logs by bundle_id + tahap
  const groups: Record<string, any[]> = {};
  logs.forEach(l => {
    const key = `${l.bundle_id}-${l.tahap}`;
    if (!groups[key]) groups[key] = [];
    groups[key].push(l);
  });

  Object.values(groups).forEach(groupLogs => {
    const terimaLog = groupLogs.find(l => l.tipe === 'terima');
    const selesaiLog = groupLogs.find(l => l.tipe === 'selesai');

    if (terimaLog && !selesaiLog) {
      const startTime = new Date(terimaLog.created_at);
      const diffMs = now.getTime() - startTime.getTime();
      const diffHours = diffMs / (1000 * 60 * 60);

      if (diffHours > thresholdHours) {
        result.push({
          bundle_id: terimaLog.bundle_id,
          barcode: terimaLog.bundle.barcode,
          no_po: terimaLog.bundle.po.no_po,
          tahap: terimaLog.tahap,
          jenis: 'mandek',
          detail: `Sudah >${thresholdHours} jam belum diselesaikan`,
          waktu: terimaLog.created_at
        });
      }
    }
  });

  return result;
}
