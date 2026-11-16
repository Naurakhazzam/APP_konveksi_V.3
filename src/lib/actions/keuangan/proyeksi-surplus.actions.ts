'use server';
/* eslint-disable @typescript-eslint/no-explicit-any */

import { createClient } from '@/lib/supabase/server';
import { PO_AWAL_PERIODE, TANGGAL_AWAL_PERIODE } from '@/lib/keuangan/periode-po';
import { KATEGORI_SETORAN_MODAL } from './buku-kas.types';
import { bulanBerjalan } from '@/lib/bulan-berjalan';

const TENANT_ID = 'STX-001';

/** Kategori Buku Kas keluar yang dibagi rata per pcs ke tiap PO (bukan kain & bukan upah borongan) */
const KATEGORI_DIBAGI = ['Biaya Overhead', 'Bahan Pembantu', 'Biaya Operasional', 'Biaya Peralatan', 'Lainnya'];

/** Uang masuk dari klien (mengurangi sisa tagihan). Pendapatan Lain tidak termasuk. */
const KATEGORI_MASUK_KLIEN = ['DP Klien', 'Pelunasan Klien'];

export type StatusPO = 'produksi' | 'kirim_sebagian' | 'terkirim';

export interface ProyeksiPO {
  po_id: string;
  no_po: string;
  klien: string;
  pcs: number;
  nilai_jual: number;
  pcs_kirim: number;
  nilai_kirim: number;
  /** Uang masuk Buku Kas (DP/Pelunasan Klien) yang ditandai ke PO ini */
  diterima: number;
  kain: number;
  aksesori: number;
  upah_lunas: number;
  upah_belum_lunas: number;
  upah_sisa: number;
  /** Bagian overhead + bahan pembantu + lainnya (uang Buku Kas) + sewa menurut porsi pcs */
  alokasi: number;
  surplus: number;
  status: StatusPO;
}

export interface RealisasiBulan {
  /** 'YYYY-MM' */
  bulan: string;
  masuk: number;
  keluar: number;
  sewa: number;
  hasil: number;
  kumulatif: number;
}

export interface ProyeksiSurplusData {
  sejak: string;
  /** Uang masuk Buku Kas per kategori, tanpa setoran modal */
  masuk: { kategori: string; nominal: number }[];
  /** DP + Pelunasan Klien */
  masukKlien: number;
  /** Uang klien yang tidak ditandai ke PO mana pun */
  masukKlienTanpaPo: number;
  setoranModal: number;
  keluar: { kategori: string; nominal: number }[];
  /** Alokasi harian biaya tetap (kontrak) dari awal bulan periode s/d akhir bulan berjalan */
  biayaTetap: { nama: string; hari: number; perHari: number; nominal: number }[];
  totalBiayaTetap: number;
  biayaTetapDari: string;
  biayaTetapSampai: string;
  totalNilaiJual: number;
  totalNilaiKirim: number;
  upahBelumLunas: number;
  upahSisa: number;
  /** A. uang masuk − uang keluar − sewa (yang benar-benar terjadi) */
  realisasi: number;
  /** B. sisa tagihan − upah yang masih harus dibayar */
  proyeksiSisa: number;
  /** A + B */
  totalPerkiraan: number;
  /** max(0, nilai jual hasil potong − uang klien) */
  sisaTagihan: number;
  /** Uang klien yang melebihi nilai jual hasil potong (mis. DP untuk beli bahan) = utang barang ke klien */
  dpLebih: number;
  perBulan: RealisasiBulan[];
  /** Bahan utama yang sudah dibeli tapi belum terpakai (LOT qty_sisa × harga) */
  stokTersisa: number;
  stokTersisaRinci: { nama: string; qty: number; satuan: string; nilai: number }[];
  po: ProyeksiPO[];
}

const keUtc = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));

/** Selisih hari inklusif antara dua tanggal 'YYYY-MM-DD' */
const hariInklusif = (a: string, b: string) => Math.round((keUtc(b) - keUtc(a)) / 86_400_000) + 1;

const akhirBulan = (ym: string) =>
  `${ym}-${String(new Date(+ym.slice(0, 4), +ym.slice(5, 7), 0).getDate()).padStart(2, '0')}`;

/** Daftar 'YYYY-MM' dari dari s/d sampai (inklusif) */
const daftarBulan = (dari: string, sampai: string) => {
  const hasil: string[] = [];
  let y = +dari.slice(0, 4), m = +dari.slice(5, 7);
  while (`${y}-${String(m).padStart(2, '0')}` <= sampai) {
    hasil.push(`${y}-${String(m).padStart(2, '0')}`);
    if (++m > 12) { m = 1; y++; }
  }
  return hasil;
};

const kelompok = (rows: any[]) => {
  const m = new Map<string, number>();
  rows.forEach(r => m.set(r.kategori ?? 'Lainnya', (m.get(r.kategori ?? 'Lainnya') ?? 0) + Number(r.nominal ?? 0)));
  return [...m.entries()].map(([kategori, nominal]) => ({ kategori, nominal })).sort((a, b) => b.nominal - a.nominal);
};

export async function getProyeksiSurplus(): Promise<ProyeksiSurplusData> {
  const supabase = await createClient();

  const [poRes, kasRes, lotRes, btRes] = await Promise.all([
    supabase.rpc('get_proyeksi_surplus_po', { p_tenant_id: TENANT_ID, p_po_mulai: PO_AWAL_PERIODE }),
    supabase.from('buku_kas').select('tanggal, tipe, kategori, nominal, overhead_sub_id, po_id')
      .eq('tenant_id', TENANT_ID).gte('tanggal', TANGGAL_AWAL_PERIODE),
    supabase.from('inventory_batch')
      .select('qty_sisa, harga_satuan, item:inventory_item_id(nama, satuan, jenis)')
      .eq('tenant_id', TENANT_ID).gt('qty_sisa', 0),
    supabase.from('biaya_tetap')
      .select('nama, nominal, tanggal_mulai, tanggal_selesai, overhead_sub_id').eq('tenant_id', TENANT_ID),
  ]);
  if (poRes.error) throw new Error(poRes.error.message);
  if (kasRes.error) throw new Error(kasRes.error.message);
  if (lotRes.error) throw new Error(lotRes.error.message);
  if (btRes.error) throw new Error(btRes.error.message);

  // Biaya tetap (kontrak). Pembayaran Buku Kas untuk sub-kelompok yang punya kontrak diganti alokasi
  // hariannya (sama seperti menu Biaya Overhead), supaya tidak terhitung dua kali.
  const btData = (btRes.data ?? []) as any[];
  const subKontrak = new Set(btData.map(b => String(b.overhead_sub_id)));

  const kas = ((kasRes.data ?? []) as any[]).filter(k =>
    !(k.kategori === 'Biaya Overhead' && k.overhead_sub_id && subKontrak.has(String(k.overhead_sub_id))));
  const masukSemua = kas.filter(k => k.tipe === 'masuk');
  const setoranModal = masukSemua.filter(k => k.kategori === KATEGORI_SETORAN_MODAL)
    .reduce((s, k) => s + Number(k.nominal), 0);
  const masukTanpaModal = masukSemua.filter(k => k.kategori !== KATEGORI_SETORAN_MODAL);
  const masukKlienRows = masukTanpaModal.filter(k => KATEGORI_MASUK_KLIEN.includes(k.kategori));
  const masukKlien = masukKlienRows.reduce((s, k) => s + Number(k.nominal), 0);
  const masukKlienTanpaPo = masukKlienRows.filter(k => !k.po_id).reduce((s, k) => s + Number(k.nominal), 0);
  const diterimaPerPo = new Map<string, number>();
  masukKlienRows.filter(k => k.po_id).forEach(k =>
    diterimaPerPo.set(String(k.po_id), (diterimaPerPo.get(String(k.po_id)) ?? 0) + Number(k.nominal)));
  const masuk = kelompok(masukTanpaModal);
  const keluarRows = kas.filter(k => k.tipe === 'keluar');
  const keluar = kelompok(keluarRows);

  // Alokasi harian biaya tetap dari awal bulan periode sampai akhir bulan berjalan
  const { bulan, tahun } = bulanBerjalan();
  const blnAwal = TANGGAL_AWAL_PERIODE.slice(0, 7);
  const blnSekarang = `${tahun}-${bulan}`;
  const sewaDari = `${blnAwal}-01`;
  const sewaSampai = akhirBulan(blnSekarang);
  const sewaDalam = (b: any, dari: string, sampai: string) => {
    const awal = b.tanggal_mulai > dari ? b.tanggal_mulai : dari;
    const akhir = b.tanggal_selesai < sampai ? b.tanggal_selesai : sampai;
    return akhir >= awal ? hariInklusif(awal, akhir) : 0;
  };
  const perHariOf = (b: any) => Number(b.nominal) / hariInklusif(b.tanggal_mulai, b.tanggal_selesai);
  const biayaTetap = btData.map(b => {
    const perHari = perHariOf(b);
    const hari = sewaDalam(b, sewaDari, sewaSampai);
    return { nama: b.nama as string, hari, perHari, nominal: perHari * hari };
  }).filter(b => b.hari > 0);
  const totalBiayaTetap = biayaTetap.reduce((s, b) => s + b.nominal, 0);

  // Realisasi per bulan
  let kumulatif = 0;
  const perBulan: RealisasiBulan[] = daftarBulan(blnAwal, blnSekarang).map(ym => {
    const diBulan = (k: any) => String(k.tanggal).slice(0, 7) === ym;
    const m = masukTanpaModal.filter(diBulan).reduce((s, k) => s + Number(k.nominal), 0);
    const kl = keluarRows.filter(diBulan).reduce((s, k) => s + Number(k.nominal), 0);
    const sw = btData.reduce((s, b) => s + perHariOf(b) * sewaDalam(b, `${ym}-01`, akhirBulan(ym)), 0);
    const hasil = m - kl - sw;
    kumulatif += hasil;
    return { bulan: ym, masuk: m, keluar: kl, sewa: sw, hasil, kumulatif };
  });

  const poolDibagi = keluar.filter(k => KATEGORI_DIBAGI.includes(k.kategori)).reduce((s, k) => s + k.nominal, 0)
    + totalBiayaTetap;

  // Stok bahan utama tersisa
  const stokMap = new Map<string, { nama: string; qty: number; satuan: string; nilai: number }>();
  ((lotRes.data ?? []) as any[]).forEach(b => {
    const item = Array.isArray(b.item) ? b.item[0] : b.item;
    if (!item || item.jenis === 'pembantu') return;
    const cur = stokMap.get(item.nama) ?? { nama: item.nama, qty: 0, satuan: item.satuan ?? '', nilai: 0 };
    cur.qty += Number(b.qty_sisa);
    cur.nilai += Number(b.qty_sisa) * Number(b.harga_satuan ?? 0);
    stokMap.set(item.nama, cur);
  });
  const stokTersisaRinci = [...stokMap.values()].filter(s => s.nilai > 0).sort((a, b) => b.nilai - a.nilai);

  // Per PO
  const raw = ((poRes.data ?? []) as any[]).map(r => ({
    po_id: r.po_id, no_po: r.no_po, klien: r.klien ?? '-',
    pcs: Number(r.pcs_potong), nilai_jual: Number(r.nilai_jual),
    pcs_kirim: Number(r.pcs_kirim ?? 0), nilai_kirim: Number(r.nilai_kirim ?? 0),
    diterima: diterimaPerPo.get(String(r.po_id)) ?? 0,
    kain: Number(r.biaya_kain), aksesori: Number(r.biaya_aksesori),
    upah_lunas: Number(r.upah_lunas), upah_belum_lunas: Number(r.upah_belum_lunas),
    upah_sisa: Number(r.upah_sisa),
  }));
  const totalPcs = raw.reduce((s, r) => s + r.pcs, 0);
  const po: ProyeksiPO[] = raw.map(r => {
    const alokasi = totalPcs > 0 ? poolDibagi * r.pcs / totalPcs : 0;
    const status: StatusPO = r.pcs > 0 && r.pcs_kirim >= r.pcs && r.upah_sisa === 0 ? 'terkirim'
      : r.pcs_kirim > 0 ? 'kirim_sebagian' : 'produksi';
    return {
      ...r, alokasi, status,
      surplus: r.nilai_jual - r.kain - r.aksesori - r.upah_lunas - r.upah_belum_lunas - r.upah_sisa - alokasi,
    };
  });

  const totalNilaiJual = po.reduce((s, p) => s + p.nilai_jual, 0);
  const upahBelumLunas = po.reduce((s, p) => s + p.upah_belum_lunas, 0);
  const upahSisa = po.reduce((s, p) => s + p.upah_sisa, 0);
  const totalMasuk = masuk.reduce((s, m) => s + m.nominal, 0);
  const totalKeluar = keluar.reduce((s, k) => s + k.nominal, 0);
  const realisasi = totalMasuk - totalKeluar - totalBiayaTetap;
  // DP bisa lebih besar dari nilai barang yang sudah dipotong (klien membiayai pembelian bahan di depan).
  // Kelebihannya = titipan klien yang nanti dibayar dengan barang.
  const sisaTagihan = Math.max(0, totalNilaiJual - masukKlien);
  const dpLebih = Math.max(0, masukKlien - totalNilaiJual);
  const proyeksiSisa = sisaTagihan - dpLebih - upahBelumLunas - upahSisa;

  return {
    sejak: TANGGAL_AWAL_PERIODE,
    masuk, masukKlien, masukKlienTanpaPo, setoranModal, keluar,
    biayaTetap, totalBiayaTetap, biayaTetapDari: sewaDari, biayaTetapSampai: sewaSampai,
    totalNilaiJual,
    totalNilaiKirim: po.reduce((s, p) => s + p.nilai_kirim, 0),
    upahBelumLunas, upahSisa,
    realisasi, proyeksiSisa, totalPerkiraan: realisasi + proyeksiSisa,
    sisaTagihan, dpLebih,
    perBulan,
    stokTersisa: stokTersisaRinci.reduce((s, x) => s + x.nilai, 0),
    stokTersisaRinci,
    po,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Detail satu PO (pop-up): artikel apa saja & posisi pcs di tiap tahap
// ─────────────────────────────────────────────────────────────────────────────

export interface ProyeksiTahap {
  tahap: string;
  selesai: number;
  proses: number;
  belum: number;
}

export interface ProyeksiArtikel {
  po_item_id: string;
  model: string;
  warna: string;
  size: string;
  qty_order: number;
  pcs_potong: number;
  pcs_kirim: number;
  tahap: ProyeksiTahap[];
}

export async function getProyeksiPoDetail(poId: string): Promise<ProyeksiArtikel[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('get_proyeksi_po_detail', {
    p_tenant_id: TENANT_ID, p_po_id: poId, p_po_mulai: PO_AWAL_PERIODE,
  });
  if (error) throw new Error(error.message);

  const map = new Map<string, ProyeksiArtikel>();
  ((data ?? []) as any[]).forEach(r => {
    let a = map.get(r.po_item_id);
    if (!a) {
      a = {
        po_item_id: r.po_item_id, model: r.model ?? '-', warna: r.warna ?? '', size: r.size ?? '',
        qty_order: Number(r.qty_order ?? 0), pcs_potong: Number(r.pcs_potong), pcs_kirim: Number(r.pcs_kirim),
        tahap: [],
      };
      map.set(r.po_item_id, a);
    }
    a.tahap.push({
      tahap: r.tahap, selesai: Number(r.pcs_selesai), proses: Number(r.pcs_proses), belum: Number(r.pcs_belum),
    });
  });
  return [...map.values()];
}
