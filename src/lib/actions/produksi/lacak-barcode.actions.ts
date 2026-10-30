'use server';

import { createClient } from '@/lib/supabase/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabase/admin';
import { revalidatePath } from 'next/cache';
import { matchesBundleSearch, tokenizeSearch } from '@/lib/search/bundle-search';
import { koreksiSerahTerimaJahit } from '@/lib/actions/produksi/scan-mutations.actions';

const TENANT_ID = 'STX-001';

const TAHAP_ORDER = ['cutting', 'jahit', 'lubang_kancing', 'buang_benang', 'qc', 'steam', 'packing'] as const;
const TAHAP_LABEL: Record<(typeof TAHAP_ORDER)[number], string> = {
  cutting: 'Cutting',
  jahit: 'Jahit',
  lubang_kancing: 'Lubang Kancing',
  buang_benang: 'Buang Benang',
  qc: 'QC',
  steam: 'Steam',
  packing: 'Packing',
};

export type TahapKoreksi = Exclude<(typeof TAHAP_ORDER)[number], 'cutting'>;

/** Satu kejadian di timeline Riwayat Lengkap. */
export interface RiwayatEvent {
  waktu: string | null;
  jenis: 'rencana' | 'cutting' | 'scan' | 'kirim' | 'koreksi' | 'reject' | 'pecahan' | 'upah';
  judul: string;
  detail: string | null;
  oleh: string | null;
  /** merah = ada qty yang berkurang tanpa penjelasan / sisa ditutup;
   *  kuning = koreksi manual; hijau = kirim; abu = info (upah dsb). */
  nada: 'normal' | 'merah' | 'kuning' | 'hijau' | 'abu';
}

/** Satu baris "Alur Qty": rencana → cutting → tiap tahap → kirim. */
export interface AlurQtyRow {
  label: string;
  qty: number | null;
  /** Selisih terhadap baris sebelumnya yang punya qty (negatif = berkurang). */
  selisih: number | null;
  catatan: string | null;
}

export interface TahapDetail {
  tahap: TahapKoreksi;
  label: string;
  status: string;
  qty_terima: number | null;
  qty_selesai: number | null;
}

export interface LacakBarcodeResult {
  bundle_id: string;
  barcode: string;
  no_po: string;
  klien_nama: string;
  model_nama: string | null;
  warna: string;
  size: string;
  qty_per_bundle: number;
  qty_rencana: number;
  tahap_sekarang: string;
  status_kirim: 'belum_dikirim' | 'sudah_dikirim';
  nomor_sj: string | null;
  tanggal_kirim: string | null;
  penjahit_nama: string | null;
  penjahit_waktu: string | null;
  penjahit_id: string | null;
  alur_qty: AlurQtyRow[];
  riwayat: RiwayatEvent[];
  /** Tahap jahit s/d packing yang sudah tersentuh — pilihan di modal Koreksi. */
  tahap_detail: TahapDetail[];
  /** Sisa cutting yang ditutup dan bisa dibuka lagi (0 = tidak bisa). */
  sisa_cutting_ditutup: number;
  cutting_partial: boolean;
  is_pecahan: boolean;
  pengiriman: { nomor_sj: string; tanggal: string | null; qty_kirim: number; divalidasi: boolean }[];
}

export interface LacakBarcodeCandidate {
  barcode: string;
  no_po: string;
  klien_nama: string;
  model_nama: string | null;
  warna: string;
  size: string;
  qty: number;
  tahap_sekarang: string;
  status_kirim: 'belum_dikirim' | 'sudah_dikirim';
}

/**
 * Ringkasan per nomor PO dari hasil pencarian — dipakai supaya pertanyaan
 * "model ini ada di PO mana saja" bisa langsung terjawab tanpa harus
 * menyisir daftar bundle satu-satu. Dihitung dari SELURUH hasil cocok
 * (tidak dipangkas seperti candidates), karena daftar PO jauh lebih
 * ringkas daripada daftar bundle.
 */
export interface LacakBarcodePoGroup {
  no_po: string;
  klien_nama: string;
  jumlah_bundle: number;
  belum_dikirim: number;
  /** Kombinasi model/warna/size yang cocok di PO ini, misal "Zubair / Navy / XL". */
  varian: string[];
}

export type LacakBarcodeResponse =
  | { type: 'found'; data: LacakBarcodeResult }
  /** `total` bisa lebih besar dari jumlah candidates kalau hasilnya dipangkas. */
  | { type: 'multiple'; candidates: LacakBarcodeCandidate[]; total: number; poGroups: LacakBarcodePoGroup[] }
  | { type: 'not_found' };

/** Batas kandidat yang dikirim ke layar. PO terbesar punya 54 bundle, jadi
 *  satu nomor PO utuh masih muat tanpa terpotong. */
const MAKS_KANDIDAT = 60;

/** Tahap pertama dalam urutan yang belum berstatus 'selesai'. Cutting
 *  partial yang sudah ada hasilnya dianggap beres (sama dengan
 *  tahap_sudah_beres di database) — sisa potongnya menyusul sebagai
 *  bundle susulan, bundle ini sendiri sudah boleh lanjut. */
function tahapBerjalan(statusTahap: any): string {
  const st = (statusTahap ?? {}) as Record<string, { status?: string; qty_aktual?: number }>;
  for (const t of TAHAP_ORDER) {
    const beres = st[t]?.status === 'selesai'
      || (t === 'cutting' && st[t]?.status === 'partial' && Number(st[t]?.qty_aktual ?? 0) > 0);
    if (!beres) return TAHAP_LABEL[t];
  }
  return 'Selesai Semua Tahap';
}

/**
 * Qty sebenarnya bundle ini: diambil dari tahap PALING AKHIR yang sudah
 * tersentuh, bukan dari qty_per_bundle rencana — karena untuk bundle hasil
 * Split atau cutting partial kedua angka itu berbeda.
 */
function qtyEfektifBundle(statusTahap: any, qtyRencana: number): number {
  const st = (statusTahap ?? {}) as Record<string, any>;
  for (const t of [...TAHAP_ORDER].reverse()) {
    const info = st[t];
    if (!info) continue;
    if (t === 'cutting') {
      if (info.qty_aktual != null) return info.qty_aktual;
    } else {
      if (info.qty_selesai != null) return info.qty_selesai;
      if (info.qty_terima != null) return info.qty_terima;
    }
  }
  return qtyRencana;
}

const one = <T,>(v: T | T[] | null | undefined): T | undefined => (Array.isArray(v) ? v[0] : v ?? undefined);
const num = (v: unknown): number | null => (v == null || v === '' ? null : Number(v));
const rupiah = (n: number) => 'Rp' + Math.round(n).toLocaleString('id-ID');
const labelTahap = (t: string) => (TAHAP_LABEL as Record<string, string>)[t] ?? t;

// Ambil detail lengkap 1 bundle by barcode PERSIS (case-insensitive, tanpa wildcard).
async function fetchDetail(supabase: SupabaseClient, barcode: string): Promise<LacakBarcodeResult | null> {
  const { data, error } = await supabase
    .from('bundle')
    .select(`
      id,
      barcode,
      created_at,
      parent_bundle_id,
      status_tahap,
      po:po_id(no_po, klien:klien_id(nama)),
      po_item:po_item_id(warna, size, qty_per_bundle, produk:produk_id(model_produk:model_id(nama))),
      surat_jalan_item(id, qty_kirim, qty_diterima, created_at, sj:sj_id(nomor_sj, tanggal))
    `)
    .ilike('barcode', barcode)
    .eq('tenant_id', TENANT_ID)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) return null;

  const row = data as any;
  const po = one<any>(row.po);
  const klien = one<any>(po?.klien);
  const poItem = one<any>(row.po_item);
  const produk = one<any>(poItem?.produk);
  const model = one<any>(produk?.model_produk);
  const sjItems = ((row.surat_jalan_item ?? []) as any[])
    .map(s => ({ ...s, sj: one<any>(s.sj) }))
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  const sjTerakhir = sjItems[sjItems.length - 1]?.sj;

  const statusTahap = (row.status_tahap ?? {}) as Record<string, any>;
  const qtyRencana = Number(poItem?.qty_per_bundle ?? 0);

  // ── Semua jejak bundle, diambil paralel ──
  // audit_log & user_profile hanya bisa dibaca owner lewat RLS, padahal
  // timeline koreksi harus terlihat oleh siapa pun yang membuka Lacak
  // Barcode — dibaca lewat admin client, dibatasi ke barcode ini saja.
  const admin = createAdminClient();
  const [scanRes, anakRes, indukRes, rejectRes, koreksiRes, auditRes, upahRes] = await Promise.all([
    supabase.from('scan_log')
      .select('tahap, tipe, qty, karyawan_id, user_id, catatan, alasan_qty_id, is_qty_lebih, created_at')
      .eq('bundle_id', row.id).order('created_at'),
    supabase.from('bundle')
      .select('barcode, created_at, status_tahap')
      .eq('parent_bundle_id', row.id).eq('tenant_id', TENANT_ID).order('created_at'),
    row.parent_bundle_id
      ? supabase.from('bundle').select('barcode').eq('id', row.parent_bundle_id).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase.from('reject_log')
      .select('nomor_reject, qty_reject, tahap_ditemukan, keterangan, status, created_at, created_by, alasan_reject_id')
      .eq('bundle_id', row.id).order('created_at'),
    supabase.from('koreksi_qty')
      .select('tahap, tipe, qty, status, alasan, created_at, created_by')
      .eq('bundle_id', row.id).order('created_at'),
    admin.from('audit_log')
      .select('aksi, metadata, user_id, created_at')
      .eq('tenant_id', TENANT_ID).eq('target', row.barcode).order('created_at'),
    supabase.from('gaji_ledger')
      .select('keterangan, total, status, karyawan_id, tanggal, created_at')
      .eq('tenant_id', TENANT_ID).like('keterangan', `% - ${row.barcode}`).order('created_at'),
  ]);

  const scans = (scanRes.data ?? []) as any[];
  const anak = (anakRes.data ?? []) as any[];
  const rejects = (rejectRes.data ?? []) as any[];
  const koreksi = (koreksiRes.data ?? []) as any[];
  const audits = (auditRes.data ?? []) as any[];
  const upahs = (upahRes.data ?? []) as any[];

  // ── Nama karyawan, user & label alasan ──
  const karyawanIds = new Set<string>();
  const userIds = new Set<string>();
  const add = (set: Set<string>, v: unknown) => { if (typeof v === 'string' && v) set.add(v); };
  for (const t of Object.values(statusTahap)) add(karyawanIds, t?.karyawan_id);
  for (const s of scans) { add(karyawanIds, s.karyawan_id); add(userIds, s.user_id); }
  for (const u of upahs) add(karyawanIds, u.karyawan_id);
  for (const a of audits) {
    add(userIds, a.user_id);
    add(karyawanIds, a.metadata?.karyawan_id_lama);
    add(karyawanIds, a.metadata?.karyawan_id_baru);
  }
  for (const r of [...rejects, ...koreksi]) add(userIds, r.created_by);
  add(userIds, statusTahap.cutting?.closed_by);

  const alasanQtyIds = [...new Set(scans.map(s => s.alasan_qty_id).filter(Boolean))] as string[];
  const alasanRejectIds = [...new Set(rejects.map(r => r.alasan_reject_id).filter(Boolean))] as string[];

  const [karyawanRes, userRes, alasanQtyRes, alasanRejectRes] = await Promise.all([
    karyawanIds.size
      ? supabase.from('karyawan').select('id, nama').in('id', [...karyawanIds])
      : Promise.resolve({ data: [] }),
    userIds.size
      ? admin.from('user_profile').select('id, nama').in('id', [...userIds])
      : Promise.resolve({ data: [] }),
    alasanQtyIds.length
      ? supabase.from('alasan_qty').select('id, label').in('id', alasanQtyIds)
      : Promise.resolve({ data: [] }),
    alasanRejectIds.length
      ? supabase.from('alasan_reject').select('id, nama').in('id', alasanRejectIds)
      : Promise.resolve({ data: [] }),
  ]);

  const namaKaryawan = new Map(((karyawanRes.data ?? []) as any[]).map(k => [k.id, k.nama as string]));
  const namaUser = new Map(((userRes.data ?? []) as any[]).map(u => [u.id, u.nama as string]));
  const alasanQty = new Map(((alasanQtyRes.data ?? []) as any[]).map(a => [a.id, a.label as string]));
  const alasanReject = new Map(((alasanRejectRes.data ?? []) as any[]).map(a => [a.id, a.nama as string]));
  const kar = (id: unknown) => (typeof id === 'string' ? namaKaryawan.get(id) ?? null : null);
  const usr = (id: unknown) => (typeof id === 'string' ? namaUser.get(id) ?? null : null);

  // ── Cutting: qty dipotong + susulan ──
  const cutting = statusTahap.cutting ?? {};
  const qtyDipotongSendiri = num(cutting.qty_dipotong) ?? num(cutting.qty_aktual);
  const susulan = anak.filter(a => a.barcode.startsWith(row.barcode + 'c'));
  const pecahan = anak.filter(a => a.barcode.startsWith(row.barcode + 'h'));
  const qtySusulan = susulan.reduce((s, a) => s + Number(a.status_tahap?.cutting?.qty_aktual ?? 0), 0);
  const totalDipotong = (qtyDipotongSendiri ?? 0) + qtySusulan;
  const isPecahan = !!row.parent_bundle_id;
  const sisaCuttingDitutup =
    !isPecahan && cutting.status === 'selesai' && qtyDipotongSendiri != null
      ? Math.max(qtyRencana - totalDipotong, 0)
      : 0;

  // ── Alur Qty ──
  const alur: AlurQtyRow[] = [];
  const pushAlur = (label: string, qty: number | null, catatan: string | null = null) => {
    const sebelum = [...alur].reverse().find(r => r.qty != null)?.qty ?? null;
    alur.push({ label, qty, selisih: qty != null && sebelum != null ? qty - sebelum : null, catatan });
  };
  if (!isPecahan) pushAlur('Rencana', qtyRencana);
  if (qtyDipotongSendiri != null) {
    const catatan: string[] = [];
    if (qtySusulan > 0) catatan.push(`+${qtySusulan} pcs susulan di ${susulan.map(s => s.barcode).join(', ')}`);
    if (cutting.status === 'partial') catatan.push(`masih partial, sisa ${Math.max(qtyRencana - totalDipotong, 0)} pcs`);
    if (sisaCuttingDitutup > 0) catatan.push(`sisa ${sisaCuttingDitutup} pcs DITUTUP`);
    pushAlur('Cutting', qtyDipotongSendiri, catatan.join(' · ') || null);
  }
  // Split di awal jahit memindahkan sebagian qty ke pecahan (…h1) —
  // tampilkan supaya penurunannya terjelaskan.
  if (cutting.qty_dipotong != null && num(cutting.qty_aktual) !== num(cutting.qty_dipotong)) {
    pushAlur('Sisa di bundle ini setelah Split', num(cutting.qty_aktual),
      pecahan.length ? `dipecah ke ${pecahan.map(p => p.barcode).join(', ')}` : null);
  }
  for (const t of TAHAP_ORDER) {
    if (t === 'cutting') continue;
    const info = statusTahap[t];
    if (!info) continue;
    pushAlur(`${TAHAP_LABEL[t]} — terima`, num(info.qty_terima));
    if (info.status === 'selesai') pushAlur(`${TAHAP_LABEL[t]} — selesai`, num(info.qty_selesai) ?? num(info.qty_terima));
  }
  if (sjItems.length) {
    pushAlur('Dikirim', sjItems.reduce((s, x) => s + Number(x.qty_kirim ?? 0), 0),
      sjItems.map(x => `${x.sj?.nomor_sj ?? '-'} (${x.qty_kirim} pcs)`).join(', '));
  }

  // ── Timeline ──
  const ev: RiwayatEvent[] = [];
  if (isPecahan) {
    ev.push({
      waktu: row.created_at, jenis: 'pecahan', nada: 'normal',
      judul: `Bundle pecahan dari ${one<any>(indukRes.data)?.barcode ?? '-'}`,
      detail: cutting.susulan_dari ? 'Hasil potongan susulan (Lanjut Cutting)' : 'Hasil Split',
      oleh: null,
    });
  } else {
    ev.push({ waktu: row.created_at, jenis: 'rencana', nada: 'normal',
      judul: `Bundle dibuat — rencana ${qtyRencana} pcs`, detail: null, oleh: null });
  }

  if (qtyDipotongSendiri != null) {
    const kurang = !isPecahan && qtyDipotongSendiri < qtyRencana;
    ev.push({
      waktu: cutting.waktu_selesai ?? null, jenis: 'cutting', nada: kurang ? 'merah' : 'normal',
      judul: `Cutting — ${qtyDipotongSendiri} pcs${kurang ? ` dari rencana ${qtyRencana} (kurang ${qtyRencana - qtyDipotongSendiri})` : ''}`,
      detail: kurang ? 'Dipotong sebagian (partial)' : null,
      oleh: kar(cutting.karyawan_id),
    });
  }

  // "Tutup" lama belum tercatat di audit_log — tampilkan dari penanda
  // closed_at di status cutting supaya tetap kelihatan.
  const adaAuditTutup = audits.some(a => a.aksi === 'Tutup Sisa Cutting');
  if (cutting.closed_at && !adaAuditTutup && sisaCuttingDitutup > 0) {
    ev.push({
      waktu: cutting.closed_at, jenis: 'cutting', nada: 'merah',
      judul: `Sisa cutting DITUTUP — ${sisaCuttingDitutup} pcs dianggap batal dipotong`,
      detail: 'Tombol "Tutup" di Pending Cutting (tanpa alasan tercatat)',
      oleh: usr(cutting.closed_by),
    });
  }

  for (const s of susulan) {
    ev.push({
      waktu: s.status_tahap?.cutting?.waktu_selesai ?? s.created_at, jenis: 'pecahan', nada: 'normal',
      judul: `Potongan susulan ${s.barcode} — ${s.status_tahap?.cutting?.qty_aktual ?? 0} pcs`,
      detail: 'Bundle baru, lanjut sendiri ke Jahit', oleh: kar(s.status_tahap?.cutting?.karyawan_id),
    });
  }
  for (const p of pecahan) {
    const tahapPertama = TAHAP_ORDER.find(t => t !== 'cutting' && p.status_tahap?.[t]);
    const qtyP = tahapPertama ? p.status_tahap[tahapPertama]?.qty_terima : null;
    ev.push({
      waktu: p.created_at, jenis: 'pecahan', nada: 'normal',
      judul: `Di-split → ${p.barcode}${qtyP != null ? ` (${qtyP} pcs)` : ''}`,
      detail: tahapPertama ? `di tahap ${TAHAP_LABEL[tahapPertama]}` : null, oleh: null,
    });
  }

  // Qty yang diharapkan di tiap scan: terima ← hasil tahap sebelumnya,
  // selesai ← qty terima tahap yang sama.
  const hasilTahap = (t: string): number | null => {
    const info = statusTahap[t];
    if (!info) return null;
    if (t === 'cutting') return num(info.qty_aktual);
    return num(info.qty_selesai) ?? num(info.qty_terima);
  };
  for (const s of scans) {
    const t = String(s.tahap);
    const idx = TAHAP_ORDER.indexOf(t as any);
    const harap = s.tipe === 'terima'
      ? (idx > 0 ? hasilTahap(TAHAP_ORDER[idx - 1]) : null)
      : num(statusTahap[t]?.qty_terima);
    const qty = Number(s.qty ?? 0);
    const kurang = harap != null && qty < harap;
    const alasan = s.alasan_qty_id ? alasanQty.get(s.alasan_qty_id) : null;
    const detail = [
      kurang ? `kurang ${harap! - qty} pcs dari ${harap}` : null,
      alasan ? `alasan: ${alasan}` : null,
      s.is_qty_lebih ? 'qty lebih (perlu approval)' : null,
      s.catatan || null,
    ].filter(Boolean).join(' · ');
    ev.push({
      waktu: s.created_at, jenis: 'scan',
      nada: kurang ? (alasan ? 'kuning' : 'merah') : 'normal',
      judul: `${labelTahap(t)} — ${s.tipe === 'terima' ? 'terima' : 'selesai'} ${qty} pcs`,
      detail: detail || null,
      oleh: [kar(s.karyawan_id), usr(s.user_id) ? `input: ${usr(s.user_id)}` : null].filter(Boolean).join(' · ') || null,
    });
  }

  const hasilAkhir = hasilTahap('packing');
  for (const x of sjItems) {
    const kurang = hasilAkhir != null && Number(x.qty_kirim) < hasilAkhir && sjItems.length === 1;
    ev.push({
      waktu: x.created_at, jenis: 'kirim', nada: kurang ? 'merah' : 'hijau',
      judul: `Dikirim — ${x.sj?.nomor_sj ?? '-'} · ${x.qty_kirim} pcs`,
      detail: [
        x.sj?.tanggal ? `tanggal SJ ${x.sj.tanggal}` : null,
        kurang ? `kurang ${hasilAkhir! - Number(x.qty_kirim)} pcs dari hasil packing` : null,
        x.qty_diterima != null ? `diterima klien ${x.qty_diterima} pcs` : null,
      ].filter(Boolean).join(' · ') || null,
      oleh: null,
    });
  }

  for (const r of rejects) {
    ev.push({
      waktu: r.created_at, jenis: 'reject', nada: 'kuning',
      judul: `Reject ${r.qty_reject} pcs${r.tahap_ditemukan ? ` di ${labelTahap(r.tahap_ditemukan)}` : ''}`,
      detail: [r.nomor_reject, alasanReject.get(r.alasan_reject_id) || null, r.keterangan, r.status].filter(Boolean).join(' · ') || null,
      oleh: usr(r.created_by),
    });
  }

  for (const k of koreksi) {
    ev.push({
      waktu: k.created_at, jenis: 'koreksi', nada: 'kuning',
      judul: `Koreksi qty ${labelTahap(String(k.tahap))} — ${k.tipe} ${k.qty} pcs (${k.status})`,
      detail: k.alasan ?? null, oleh: usr(k.created_by),
    });
  }

  for (const a of audits) {
    const m = a.metadata ?? {};
    let judul = a.aksi as string;
    const detail: string[] = [];
    switch (a.aksi) {
      case 'Tutup Sisa Cutting':
        judul = `Sisa cutting DITUTUP — ${m.sisa_ditutup ?? '?'} pcs dianggap batal dipotong`;
        break;
      case 'Buka Kembali Cutting':
        judul = `Cutting DIBUKA KEMBALI — sisa ${m.sisa} pcs bisa dilanjutkan`;
        if (m.closed_at_lama) detail.push(`sebelumnya ditutup ${new Date(m.closed_at_lama).toLocaleDateString('id-ID')}`);
        break;
      case 'Kembalikan Tahap': {
        judul = `Dikembalikan ke tahap ${labelTahap(m.tahap_tujuan)}`;
        const dihapus = (m.tahap_dihapus ?? []) as string[];
        if (dihapus.length) detail.push(`dibatalkan: ${dihapus.map(labelTahap).join(', ')}`);
        for (const sj of (m.surat_jalan ?? []) as any[]) {
          detail.push(`ditarik dari ${sj.nomor_sj} (${sj.qty_kirim} pcs)${sj.sj_dihapus ? ' — SJ kosong, dihapus' : ''}`);
        }
        const upahBatal = [
          ...((m.upah_dibatalkan ?? []) as any[]),
          ...((m.surat_jalan ?? []) as any[]).flatMap((sj: any) => sj.upah_dibatalkan ?? []),
        ];
        if (upahBatal.length) {
          detail.push(`upah dibatalkan ${rupiah(upahBatal.reduce((s, u) => s + Number(u.total ?? 0), 0))}`);
        }
        break;
      }
      case 'Koreksi Qty Tahap':
        judul = `Koreksi qty ${labelTahap(m.tahap)}`;
        if (m.qty_terima_lama !== m.qty_terima_baru) detail.push(`terima ${m.qty_terima_lama} → ${m.qty_terima_baru}`);
        if (m.qty_selesai_baru != null && m.qty_selesai_lama !== m.qty_selesai_baru) detail.push(`selesai ${m.qty_selesai_lama} → ${m.qty_selesai_baru}`);
        break;
      case 'Koreksi Serah Terima Jahit':
        if (m.qty_lama !== m.qty_baru) detail.push(`qty ${m.qty_lama} → ${m.qty_baru}`);
        if (m.karyawan_id_lama !== m.karyawan_id_baru) detail.push(`penjahit ${kar(m.karyawan_id_lama) ?? '-'} → ${kar(m.karyawan_id_baru) ?? '-'}`);
        break;
      case 'Koreksi Hasil Cutting':
        detail.push(`qty ${m.qty_lama} → ${m.qty_baru}`);
        break;
    }
    if (m.alasan) detail.push(`alasan: ${m.alasan}`);
    ev.push({
      waktu: a.created_at, jenis: 'koreksi',
      nada: a.aksi === 'Tutup Sisa Cutting' ? 'merah' : 'kuning',
      judul, detail: detail.join(' · ') || null, oleh: usr(a.user_id),
    });
  }

  for (const u of upahs) {
    const m = /^Upah (\S+) - /.exec(u.keterangan ?? '');
    const status = u.status === 'lunas' ? 'lunas' : u.status === 'cancelled' ? 'dibatalkan' : u.status === 'escrow' ? 'ditahan' : 'belum dibayar';
    ev.push({
      waktu: u.created_at, jenis: 'upah', nada: 'abu',
      judul: `Upah ${m ? labelTahap(m[1]) : ''} ${rupiah(Number(u.total ?? 0))} — ${status}`,
      detail: null, oleh: kar(u.karyawan_id),
    });
  }

  ev.sort((a, b) => {
    if (!a.waktu) return 1;
    if (!b.waktu) return -1;
    return new Date(a.waktu).getTime() - new Date(b.waktu).getTime();
  });

  // ── Penjahit ──
  // Khusus tahap jahit, karena hanya tahap ini yang mewajibkan assign
  // karyawan per bundle (tahap lain sifatnya borongan/kelompok).
  const jahitInfo = statusTahap.jahit;
  const penjahitId: string | null = jahitInfo?.karyawan_id ?? null;

  const tahapDetail: TahapDetail[] = TAHAP_ORDER
    .filter((t): t is TahapKoreksi => t !== 'cutting' && !!statusTahap[t])
    .map(t => ({
      tahap: t,
      label: TAHAP_LABEL[t],
      status: String(statusTahap[t]?.status ?? ''),
      qty_terima: num(statusTahap[t]?.qty_terima),
      qty_selesai: num(statusTahap[t]?.qty_selesai),
    }));

  return {
    bundle_id: row.id,
    barcode: row.barcode,
    no_po: po?.no_po ?? '',
    klien_nama: klien?.nama ?? '',
    model_nama: model?.nama ?? null,
    warna: poItem?.warna ?? '',
    size: poItem?.size ?? '',
    qty_per_bundle: qtyEfektifBundle(statusTahap, qtyRencana),
    qty_rencana: qtyRencana,
    tahap_sekarang: tahapBerjalan(statusTahap),
    status_kirim: sjItems.length ? 'sudah_dikirim' : 'belum_dikirim',
    nomor_sj: sjTerakhir?.nomor_sj ?? null,
    tanggal_kirim: sjTerakhir?.tanggal ?? null,
    penjahit_nama: kar(penjahitId),
    penjahit_waktu: penjahitId ? (jahitInfo.waktu_selesai ?? jahitInfo.waktu_terima ?? null) : null,
    penjahit_id: penjahitId,
    alur_qty: alur,
    riwayat: ev,
    tahap_detail: tahapDetail,
    sisa_cutting_ditutup: sisaCuttingDitutup,
    cutting_partial: cutting.status === 'partial',
    is_pecahan: isPecahan,
    pengiriman: sjItems.map(x => ({
      nomor_sj: x.sj?.nomor_sj ?? '-',
      tanggal: x.sj?.tanggal ?? null,
      qty_kirim: Number(x.qty_kirim ?? 0),
      divalidasi: x.qty_diterima != null,
    })),
  };
}

// Cek status bundle via barcode: posisi tahap saat ini, sudah dikirim atau
// belum, dan siapa penjahit yang mengerjakannya — dipakai terutama saat
// menangani retur, supaya bisa langsung tahu penjahitnya tanpa telusuri manual.
//
// Barcode asli formatnya "PO-{no_po}-{5 digit urut global}-bdl{3 digit}",
// tapi di lapangan orang sering cuma ingat/ketik sebagian (mis. cuma nomor
// urut tengahnya, "00311"). Jadi: coba exact match dulu, kalau tidak ketemu
// baru cari partial match di seluruh barcode.
export async function lacakBarcode(query: string): Promise<LacakBarcodeResponse> {
  const trimmed = query.trim();
  if (!trimmed) return { type: 'not_found' };

  const supabase = await createClient();

  const exact = await fetchDetail(supabase, trimmed);
  if (exact) return { type: 'found', data: exact };

  // Pencarian tidak lagi terbatas ke kolom barcode. Nomor PO memang kebetulan
  // ikut ketemu karena tercetak di dalam barcode, tapi nama artikel (model,
  // warna, size) tersimpan di tabel lain — mengetik "zubair navy xxl" dulu
  // menghasilkan nol. Sekarang seluruh field dicocokkan per kata dan bebas
  // urutan lewat helper yang sama dengan Packing & Buat Surat Jalan, sehingga
  // "2XL" pun mengerti bahwa di data tertulis "XXL".
  const { data: rows, error } = await supabase
    .from('bundle')
    .select(`
      barcode,
      status_tahap,
      po:po_id(no_po, klien:klien_id(nama)),
      po_item:po_item_id(warna, size, qty_per_bundle, produk:produk_id(model_produk:model_id(nama))),
      surat_jalan_item(id)
    `)
    .eq('tenant_id', TENANT_ID);

  if (error) throw new Error(error.message);
  if (!rows || rows.length === 0) return { type: 'not_found' };

  const tokens = tokenizeSearch(trimmed);

  const cocok = (rows as any[])
    .map(m => {
      const po = Array.isArray(m.po) ? m.po[0] : m.po;
      const klien = Array.isArray(po?.klien) ? po.klien[0] : po?.klien;
      const poItem = Array.isArray(m.po_item) ? m.po_item[0] : m.po_item;
      const produk = Array.isArray(poItem?.produk) ? poItem.produk[0] : poItem?.produk;
      const model = Array.isArray(produk?.model_produk) ? produk.model_produk[0] : produk?.model_produk;

      return {
        barcode: m.barcode as string,
        no_po: po?.no_po ?? '',
        klien_nama: klien?.nama ?? '',
        model_nama: model?.nama ?? null,
        warna: poItem?.warna ?? '',
        size: poItem?.size ?? '',
        qty: qtyEfektifBundle(m.status_tahap, poItem?.qty_per_bundle ?? 0),
        tahap_sekarang: tahapBerjalan(m.status_tahap),
        status_kirim: ((m.surat_jalan_item ?? []).length > 0
          ? 'sudah_dikirim' : 'belum_dikirim') as 'sudah_dikirim' | 'belum_dikirim',
      };
    })
    .filter(c => matchesBundleSearch(c, tokens));

  if (cocok.length === 0) return { type: 'not_found' };

  if (cocok.length === 1) {
    const detail = await fetchDetail(supabase, cocok[0].barcode);
    return detail ? { type: 'found', data: detail } : { type: 'not_found' };
  }

  cocok.sort((a, b) =>
    a.no_po.localeCompare(b.no_po) || a.barcode.localeCompare(b.barcode));

  return {
    type: 'multiple',
    candidates: cocok.slice(0, MAKS_KANDIDAT),
    total: cocok.length,
    poGroups: kelompokkanPerPo(cocok),
  };
}

/**
 * Kelompokkan seluruh hasil cocok (bukan yang sudah dipangkas ke MAKS_KANDIDAT)
 * per nomor PO — supaya "model ini ada di PO mana saja" tetap lengkap walau
 * jumlah bundle-nya ratusan.
 */
function kelompokkanPerPo(
  cocok: {
    no_po: string;
    klien_nama: string;
    model_nama: string | null;
    warna: string;
    size: string;
    status_kirim: 'belum_dikirim' | 'sudah_dikirim';
  }[],
): LacakBarcodePoGroup[] {
  const map = new Map<string, LacakBarcodePoGroup & { varianSet: Set<string> }>();

  for (const c of cocok) {
    if (!c.no_po) continue;
    let g = map.get(c.no_po);
    if (!g) {
      g = { no_po: c.no_po, klien_nama: c.klien_nama, jumlah_bundle: 0, belum_dikirim: 0, varian: [], varianSet: new Set() };
      map.set(c.no_po, g);
    }
    g.jumlah_bundle += 1;
    if (c.status_kirim === 'belum_dikirim') g.belum_dikirim += 1;
    g.varianSet.add(`${c.model_nama ?? '-'} / ${c.warna} / ${c.size}`);
  }

  return Array.from(map.values())
    .map(({ varianSet, ...g }) => ({ ...g, varian: Array.from(varianSet).sort() }))
    .sort((a, b) => a.no_po.localeCompare(b.no_po));
}

// Resolusi 1 barcode persis — dipakai saat user memilih salah satu dari
// daftar kandidat hasil partial search.
export async function lacakBarcodeExact(barcode: string): Promise<LacakBarcodeResult | null> {
  const supabase = await createClient();
  return fetchDetail(supabase, barcode);
}

// ─── Koreksi bundle dari Lacak Barcode ───────────────────────────────────────
// Semua jalur di bawah wajib alasan dan tercatat di audit_log, yang tampil
// sebagai timeline Riwayat Lengkap — itulah pengganti PIN/izin khusus.

async function resolveUserId(supabase: SupabaseClient): Promise<string> {
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) throw new Error('Sesi Anda sudah habis, silakan login ulang.');
  return user.id;
}

function revalidateProduksi() {
  revalidatePath('/app/lacak-barcode');
  revalidatePath('/app/produksi', 'layout');
  revalidatePath('/app/pengiriman', 'layout');
}

/** Batalkan "Tutup" cutting: sisa muncul lagi di Pending Cutting. */
export async function bukaKembaliCutting(bundle_id: string, alasan: string): Promise<{ sisa: number }> {
  const supabase = await createClient();
  const user_id = await resolveUserId(supabase);
  const { data, error } = await supabase.rpc('buka_kembali_cutting', {
    p_bundle_id: bundle_id,
    p_alasan:    alasan,
    p_user_id:   user_id,
    p_tenant_id: TENANT_ID,
  });
  if (error) throw new Error(error.message);
  revalidateProduksi();
  return { sisa: Number((data as any)?.sisa ?? 0) };
}

/** Mundurkan bundle ke tahap tujuan (sedang dikerjakan), walau sudah terkirim. */
export async function kembalikanTahapBundle(
  bundle_id: string,
  tahap_tujuan: TahapKoreksi,
  alasan: string,
): Promise<{ tahap_dihapus: string[]; surat_jalan: { nomor_sj: string; sj_dihapus: boolean }[] }> {
  const supabase = await createClient();
  const user_id = await resolveUserId(supabase);
  const { data, error } = await supabase.rpc('kembalikan_tahap_bundle', {
    p_bundle_id:    bundle_id,
    p_tahap_tujuan: tahap_tujuan,
    p_alasan:       alasan,
    p_user_id:      user_id,
    p_tenant_id:    TENANT_ID,
  });
  if (error) throw new Error(error.message);
  revalidateProduksi();
  const r = (data ?? {}) as any;
  return {
    tahap_dihapus: r.tahap_dihapus ?? [],
    surat_jalan: ((r.surat_jalan ?? []) as any[]).map(s => ({ nomor_sj: s.nomor_sj, sj_dihapus: !!s.sj_dihapus })),
  };
}

/**
 * Betulkan qty satu tahap. Qty terima Jahit punya efek ke stok aksesori
 * jahit, jadi diteruskan ke koreksi_serah_terima_jahit (jalur yang sama
 * dengan Koreksi Serah Terima di Antrian Jahit); sisanya lewat
 * koreksi_qty_tahap.
 */
export async function koreksiQtyTahap(input: {
  bundle_id: string;
  tahap: TahapKoreksi;
  qty_terima: number;
  qty_selesai: number | null;
  alasan: string;
  /** Wajib untuk koreksi qty terima Jahit — penjahitnya tidak diganti. */
  penjahit_id?: string | null;
  qty_terima_lama?: number | null;
}): Promise<void> {
  const supabase = await createClient();

  if (input.tahap === 'jahit' && input.qty_terima !== input.qty_terima_lama) {
    if (input.qty_selesai != null) {
      throw new Error('Jahit sudah selesai — kembalikan dulu ke tahap Jahit, baru qty terimanya bisa dibetulkan');
    }
    if (!input.penjahit_id) throw new Error('Penjahit bundle ini tidak tercatat');
    await koreksiSerahTerimaJahit({
      bundle_id:       input.bundle_id,
      karyawan_id:     input.penjahit_id,
      qty:             input.qty_terima,
      alasan:          input.alasan,
      koreksi_cutting: false,
    });
    revalidateProduksi();
    return;
  }

  const user_id = await resolveUserId(supabase);
  const { error } = await supabase.rpc('koreksi_qty_tahap', {
    p_bundle_id:   input.bundle_id,
    p_tahap:       input.tahap,
    p_qty_terima:  input.qty_terima,
    p_qty_selesai: input.qty_selesai,
    p_alasan:      input.alasan,
    p_user_id:     user_id,
    p_tenant_id:   TENANT_ID,
  });
  if (error) throw new Error(error.message);
  revalidateProduksi();
}
