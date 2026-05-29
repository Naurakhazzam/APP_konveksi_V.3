'use server';

import { createClient } from '@/lib/supabase/server';

const TENANT_ID = 'STX-001';
const TAHAP_ORDER = ['cutting', 'jahit', 'buang_benang', 'lubang_kancing', 'qc', 'steam', 'packing'] as const;
type Tahap = typeof TAHAP_ORDER[number];

export interface BundleStageDetail {
  status: 'selesai' | 'progress' | null;
  qty_terima: number | null;
  qty_selesai: number | null;
  qty_aktual: number | null;
  karyawan_id: string | null;
  karyawan_nama: string | null;
  waktu_selesai: string | null;
  waktu_terima: string | null;
}

export interface BundleRejectItem {
  nomor_reject: string;
  qty_reject: number;
  tahap_ditemukan: string;
  alasan: string;
  keterangan: string | null;
  source: string;
  status: string;
}

export interface BundleQtyMismatch {
  tahap: string;
  qty_terima: number;
  qty_selesai: number;
  selisih: number;
  tipe: 'kurang' | 'lebih';
  alasan: string | null;
  catatan: string | null;
}

export interface BundleDetailItem {
  id: string;
  barcode: string;
  no_urut: number;
  parent_bundle_id: string | null;
  parent_barcode: string | null;
  child_barcodes: string[];
  tahap_aktif: string | null;
  status_overall: 'selesai' | 'proses' | 'belum';
  stages: Record<Tahap, BundleStageDetail>;
  surat_jalan_id: string | null;
  nomor_sj: string | null;
  tanggal_sj: string | null;
  total_gaji: number;
  gaji_status: 'lunas' | 'belum_lunas' | null;
  rejects: BundleRejectItem[];
  qty_mismatches: BundleQtyMismatch[];
}

export async function getPoItemBundleDetail(poItemId: string): Promise<BundleDetailItem[]> {
  const supabase = await createClient();

  const { data: bundles, error: bundlesErr } = await supabase
    .from('bundle')
    .select('id, barcode, no_urut, status_tahap, surat_jalan_id, parent_bundle_id')
    .eq('po_item_id', poItemId)
    .eq('tenant_id', TENANT_ID)
    .order('no_urut')
    .order('created_at');

  if (bundlesErr) throw new Error(bundlesErr.message);
  if (!bundles || bundles.length === 0) return [];

  const bundleIds = bundles.map(b => b.id);

  // Kumpulkan semua karyawan_id dari status_tahap
  const karyawanIds = new Set<string>();
  for (const b of bundles) {
    const st = (b.status_tahap || {}) as Record<string, any>;
    for (const t of Object.values(st)) {
      if (t?.karyawan_id) karyawanIds.add(t.karyawan_id);
    }
  }

  // Fetch karyawan names
  let karyawanMap = new Map<string, string>();
  if (karyawanIds.size > 0) {
    const { data: kList } = await supabase
      .from('karyawan')
      .select('id, nama')
      .in('id', [...karyawanIds]);
    karyawanMap = new Map((kList || []).map(k => [k.id, k.nama]));
  }

  // Fetch surat_jalan
  const sjIds = bundles.filter(b => b.surat_jalan_id).map(b => b.surat_jalan_id!);
  let sjMap = new Map<string, { nomor_sj: string; tanggal: string }>();
  if (sjIds.length > 0) {
    const { data: sjList } = await supabase
      .from('surat_jalan')
      .select('id, nomor_sj, tanggal')
      .in('id', sjIds);
    sjMap = new Map((sjList || []).map(s => [s.id, s]));
  }

  // Fetch parent barcodes
  const parentIds = bundles.filter(b => b.parent_bundle_id).map(b => b.parent_bundle_id!);
  let parentMap = new Map<string, string>();
  if (parentIds.length > 0) {
    const { data: pList } = await supabase
      .from('bundle')
      .select('id, barcode')
      .in('id', parentIds);
    parentMap = new Map((pList || []).map(p => [p.id, p.barcode]));
  }

  // Fetch child bundles (split)
  const { data: children } = await supabase
    .from('bundle')
    .select('id, barcode, parent_bundle_id')
    .in('parent_bundle_id', bundleIds);
  const childMap = new Map<string, string[]>();
  for (const c of (children || [])) {
    if (c.parent_bundle_id) {
      if (!childMap.has(c.parent_bundle_id)) childMap.set(c.parent_bundle_id, []);
      childMap.get(c.parent_bundle_id)!.push(c.barcode);
    }
  }

  // Fetch gaji_ledger
  const { data: gajiList } = await supabase
    .from('gaji_ledger')
    .select('sumber_id, total, status')
    .in('sumber_id', bundleIds);
  const gajiMap = new Map<string, { total: number; all_lunas: boolean }>();
  for (const g of (gajiList || [])) {
    const ex = gajiMap.get(g.sumber_id);
    if (ex) {
      ex.total += Number(g.total);
      if (g.status !== 'lunas') ex.all_lunas = false;
    } else {
      gajiMap.set(g.sumber_id, { total: Number(g.total), all_lunas: g.status === 'lunas' });
    }
  }

  // Fetch reject_log
  const { data: rejectList } = await supabase
    .from('reject_log')
    .select('bundle_id, nomor_reject, qty_reject, tahap_ditemukan, keterangan, source, status, alasan_reject:alasan_reject_id(label)')
    .in('bundle_id', bundleIds)
    .eq('tenant_id', TENANT_ID);
  const rejectMap = new Map<string, any[]>();
  for (const r of (rejectList || [])) {
    if (!rejectMap.has(r.bundle_id)) rejectMap.set(r.bundle_id, []);
    rejectMap.get(r.bundle_id)!.push(r);
  }

  // Fetch scan_log untuk qty mismatch
  const { data: scanLogs } = await supabase
    .from('scan_log')
    .select('bundle_id, tahap, qty, catatan, is_qty_lebih, alasan_qty:alasan_qty_id(label)')
    .in('bundle_id', bundleIds)
    .eq('tipe', 'selesai')
    .eq('tenant_id', TENANT_ID);
  const scanMap = new Map<string, any[]>();
  for (const s of (scanLogs || [])) {
    if (!scanMap.has(s.bundle_id)) scanMap.set(s.bundle_id, []);
    scanMap.get(s.bundle_id)!.push(s);
  }

  return bundles.map(b => {
    const st = (b.status_tahap || {}) as Record<string, any>;

    // Build stages
    const stages = {} as Record<Tahap, BundleStageDetail>;
    for (const tahap of TAHAP_ORDER) {
      const td = st[tahap];
      const kid = td?.karyawan_id ?? null;
      stages[tahap] = {
        status: td?.status ?? null,
        qty_terima: td?.qty_terima ?? null,
        qty_selesai: td?.qty_selesai ?? null,
        qty_aktual: td?.qty_aktual ?? null,
        karyawan_id: kid,
        karyawan_nama: kid ? (karyawanMap.get(kid) ?? null) : null,
        waktu_selesai: td?.waktu_selesai ?? null,
        waktu_terima: td?.waktu_terima ?? null,
      };
    }

    // Tentukan tahap aktif & status overall
    let tahap_aktif: string | null = null;
    let status_overall: 'selesai' | 'proses' | 'belum' = 'belum';
    for (const tahap of [...TAHAP_ORDER].reverse()) {
      if (st[tahap]) {
        tahap_aktif = tahap;
        if (st[tahap].status === 'selesai') {
          status_overall = tahap === 'packing' ? 'selesai' : 'proses';
        } else {
          status_overall = 'proses';
        }
        break;
      }
    }

    const sj = b.surat_jalan_id ? sjMap.get(b.surat_jalan_id) : null;
    const gaji = gajiMap.get(b.id);

    const rejects: BundleRejectItem[] = (rejectMap.get(b.id) || []).map((r: any) => ({
      nomor_reject: r.nomor_reject,
      qty_reject: r.qty_reject,
      tahap_ditemukan: r.tahap_ditemukan,
      alasan: (r.alasan_reject as any)?.label ?? '-',
      keterangan: r.keterangan ?? null,
      source: r.source,
      status: r.status,
    }));

    const qty_mismatches: BundleQtyMismatch[] = [];
    for (const s of (scanMap.get(b.id) || [])) {
      const td = st[s.tahap];
      const qtyTerima = td?.qty_terima ?? td?.qty_aktual ?? null;
      if (qtyTerima === null) continue;
      if (s.is_qty_lebih && s.qty > qtyTerima) {
        qty_mismatches.push({ tahap: s.tahap, qty_terima: qtyTerima, qty_selesai: s.qty, selisih: s.qty - qtyTerima, tipe: 'lebih', alasan: null, catatan: s.catatan ?? null });
      } else if (!s.is_qty_lebih && s.qty < qtyTerima) {
        qty_mismatches.push({ tahap: s.tahap, qty_terima: qtyTerima, qty_selesai: s.qty, selisih: qtyTerima - s.qty, tipe: 'kurang', alasan: (s.alasan_qty as any)?.label ?? null, catatan: s.catatan ?? null });
      }
    }

    return {
      id: b.id,
      barcode: b.barcode,
      no_urut: b.no_urut,
      parent_bundle_id: b.parent_bundle_id ?? null,
      parent_barcode: b.parent_bundle_id ? (parentMap.get(b.parent_bundle_id) ?? null) : null,
      child_barcodes: childMap.get(b.id) ?? [],
      tahap_aktif,
      status_overall,
      stages,
      surat_jalan_id: b.surat_jalan_id ?? null,
      nomor_sj: sj?.nomor_sj ?? null,
      tanggal_sj: sj?.tanggal ?? null,
      total_gaji: gaji?.total ?? 0,
      gaji_status: gaji ? (gaji.all_lunas ? 'lunas' : 'belum_lunas') : null,
      rejects,
      qty_mismatches,
    };
  });
}
