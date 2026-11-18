/* eslint-disable @typescript-eslint/no-explicit-any */
import { batasAwalPeriode } from './periode-po';
import { getBundleIdsPeriodeBaru } from './periode-po.server';

type Supa = { rpc: (fn: string, args: Record<string, unknown>) => any; from: (t: string) => any };

const TENANT_ID = 'STX-001';

/**
 * Uang dari klien (DP/pelunasan) = pembayaran tagihan, BUKAN pendapatan.
 * Pendapatan diakui dari Surat Jalan (lihat pendapatanSjPerBulan).
 */
export const KATEGORI_BAYAR_KLIEN = ['DP Klien', 'Pelunasan Klien'];

export interface PendapatanBulan {
  /** Nilai invoice SEBELUM potongan reject kantor (setelah validasi kirim). Reject dicatat
   *  terpisah sebagai "Retur & Reject" per tanggal kejadian — lihat returRejectKejadian. */
  nilai: number;
  /** Bagian nilai dari SJ yang belum divalidasi kantor (masih pakai qty kirim) */
  belumValidasi: number;
}

/**
 * Pendapatan per bulan ('YYYY-MM') dari Surat Jalan: invoice otomatis (qty kirim × harga jual saat
 * SJ dibuat), dikoreksi saat Validasi Kirim (qty diterima, qty lebih disetujui). Potongan reject kantor
 * TIDAK dikurangkan di sini (diakui di tanggal reject dilaporkan, lihat returRejectKejadian).
 * Dicatat di bulan tanggal invoice (= tanggal SJ). Dipakai mesin Kinerja Keuangan
 * (lib/keuangan/kinerja.server.ts) untuk Kinerja Keuangan, Ringkasan & Laporan Per PO.
 * Periode baru: hanya porsi barang bundle PO periode baru, dan invoice mulai TANGGAL_AWAL_PERIODE.
 */
export async function pendapatanSjPerBulan(
  supabase: Supa, dari: string, sampai: string, hanyaPeriodeBaru: boolean,
): Promise<Map<string, PendapatanBulan>> {
  const dariEfektif = hanyaPeriodeBaru ? batasAwalPeriode(dari) : dari;
  const hasil = new Map<string, PendapatanBulan>();
  if (dariEfektif > sampai) return hasil;

  const { data: invRaw, error: invErr } = await supabase
    .from('invoice')
    .select('id, tanggal, total_nilai, potongan_reject, surat_jalan_id, surat_jalan:surat_jalan_id(tanggal_validasi)')
    .eq('tenant_id', TENANT_ID)
    .gte('tanggal', dariEfektif)
    .lte('tanggal', sampai);
  if (invErr) throw new Error(invErr.message);
  const invData = (invRaw ?? []) as any[];

  // Porsi PO periode baru per SJ = nilai barang bundle periode baru ÷ nilai seluruh barang SJ
  const porsiSj = new Map<string, number>();
  if (hanyaPeriodeBaru) {
    const sjIds = [...new Set(invData.map(i => i.surat_jalan_id).filter(Boolean))] as string[];
    if (sjIds.length) {
      const bundleBaru = await getBundleIdsPeriodeBaru(supabase);
      const { data: sjItems, error: sjErr } = await supabase
        .from('surat_jalan_item')
        .select('sj_id, bundle_id, qty_kirim, qty_diterima, harga_satuan')
        .in('sj_id', sjIds);
      if (sjErr) throw new Error(sjErr.message);
      const nilai = new Map<string, { baru: number; semua: number }>();
      ((sjItems ?? []) as any[]).forEach(it => {
        const kirim = Number(it.qty_kirim ?? 0);
        const akui  = it.qty_diterima == null ? kirim : Math.min(Number(it.qty_diterima), kirim);
        const v     = akui * Number(it.harga_satuan ?? 0);
        const cur   = nilai.get(it.sj_id) ?? { baru: 0, semua: 0 };
        cur.semua += v;
        if (bundleBaru.has(String(it.bundle_id))) cur.baru += v;
        nilai.set(it.sj_id, cur);
      });
      nilai.forEach((n, id) => porsiSj.set(id, n.semua > 0 ? n.baru / n.semua : 0));
    }
  }

  invData.forEach(i => {
    const netto = Math.max(0, Number(i.total_nilai ?? 0));
    const porsi = hanyaPeriodeBaru ? (porsiSj.get(i.surat_jalan_id) ?? 0) : 1;
    const v = Math.round(netto * porsi);
    if (!v) return;
    const bulan = String(i.tanggal).slice(0, 7);
    const cur = hasil.get(bulan) ?? { nilai: 0, belumValidasi: 0 };
    cur.nilai += v;
    const sj = Array.isArray(i.surat_jalan) ? i.surat_jalan[0] : i.surat_jalan;
    if (!sj?.tanggal_validasi) cur.belumValidasi += v;
    hasil.set(bulan, cur);
  });
  return hasil;
}

export type JenisKejadianReject = 'reject' | 'kirim_ulang' | 'dibeli_kantor';

/** Satu kejadian yang mengubah "Retur & Reject" di L/R. nilai > 0 = mengurangi pendapatan, < 0 = pemulihan. */
export interface KejadianReject {
  tanggal: string;
  jenis: JenisKejadianReject;
  reject_id: string;
  nomor_reject: string;
  produk: string;
  sumber: 'sj' | 'barang_lama';
  nomor_sj: string;
  /** SJ kirim ulang (untuk jenis kirim_ulang) */
  nomor_sj_kirim_ulang?: string;
  qty: number;
  harga: number;
  nilai: number;
}

/**
 * Kejadian Retur & Reject kantor (keputusan user 18 Nov 2026):
 *  - reject dilaporkan → mengurangi pendapatan di tanggal lapor (qty × harga SJ asal);
 *  - dikirim ulang     → pemulihan di tanggal diterima kantor (tanggal validasi SJ kirim ulang,
 *                        sebelum divalidasi: tanggal SJ kirim ulang & qty kirim — sama dengan potongan invoice);
 *  - dibeli kantor     → pemulihan harga beli × sisa pcs di tanggal keputusan.
 * Jumlah seluruhnya = potongan tagihan yang masih aktif/permanen (invoice.potongan_reject) + kerugian barang lama.
 * Barang lama (di luar sistem) tidak memotong invoice tapi tetap masuk sebagai kerugian reject.
 * Periode baru: reject dari SJ hanya dihitung bila bundle-nya PO periode baru (sejalan dengan porsi pendapatan).
 */
export async function returRejectKejadian(
  supabase: Supa, hanyaPeriodeBaru: boolean,
): Promise<KejadianReject[]> {
  const { data, error } = await supabase
    .from('reject_kantor')
    .select(`
      id, nomor_reject, tanggal, tanggal_dibeli, qty, harga_satuan, harga_beli_kantor, status, sumber, bundle_id,
      produk:produk_id ( nama ),
      surat_jalan:surat_jalan_id ( nomor_sj ),
      kirim_ulang_item ( qty, qty_diterima, sj:sj_id ( nomor_sj, tanggal, tanggal_validasi ) )
    `)
    .eq('tenant_id', TENANT_ID);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as any[];
  if (!rows.length) return [];

  const bundleBaru = hanyaPeriodeBaru && rows.some(r => r.sumber !== 'barang_lama')
    ? await getBundleIdsPeriodeBaru(supabase) : null;
  const one = (v: any) => (Array.isArray(v) ? v[0] : v) ?? null;
  const tgl = (d: string) => batasAwalPeriode(String(d).slice(0, 10));

  const hasil: KejadianReject[] = [];
  rows.forEach(r => {
    const sumber: 'sj' | 'barang_lama' = r.sumber === 'barang_lama' ? 'barang_lama' : 'sj';
    if (bundleBaru && sumber === 'sj' && r.bundle_id && !bundleBaru.has(String(r.bundle_id))) return;
    const harga = Number(r.harga_satuan ?? 0);
    const qty = Number(r.qty ?? 0);
    const dasar = {
      reject_id: r.id, nomor_reject: r.nomor_reject, produk: one(r.produk)?.nama ?? '-', sumber,
      nomor_sj: one(r.surat_jalan)?.nomor_sj ?? 'Barang lama',
    };
    hasil.push({ ...dasar, tanggal: tgl(r.tanggal), jenis: 'reject', qty, harga, nilai: qty * harga });

    let terkirim = 0;
    ((r.kirim_ulang_item ?? []) as any[]).forEach(k => {
      const sj = one(k.sj);
      const q = Number(k.qty_diterima ?? k.qty ?? 0);
      terkirim += q;
      if (!q) return;
      hasil.push({
        ...dasar, tanggal: tgl(sj?.tanggal_validasi ?? sj?.tanggal ?? r.tanggal), jenis: 'kirim_ulang',
        nomor_sj_kirim_ulang: sj?.nomor_sj ?? '-', qty: q, harga, nilai: -q * harga,
      });
    });

    if (r.status === 'dibeli_kantor') {
      const sisa = Math.max(qty - terkirim, 0);
      const hb = Math.min(Number(r.harga_beli_kantor ?? 0), harga);
      if (sisa > 0 && hb > 0) {
        hasil.push({ ...dasar, tanggal: tgl(r.tanggal_dibeli ?? r.tanggal), jenis: 'dibeli_kantor', qty: sisa, harga: hb, nilai: -sisa * hb });
      }
    }
  });
  return hasil.sort((a, b) => a.tanggal.localeCompare(b.tanggal) || a.nomor_reject.localeCompare(b.nomor_reject));
}
