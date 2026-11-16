'use server';
/* eslint-disable @typescript-eslint/no-explicit-any */

import { createClient } from '@/lib/supabase/server';
import { PO_AWAL_PERIODE, TANGGAL_AWAL_PERIODE, poPeriodeBaru } from '@/lib/keuangan/periode-po';
import { getLaporanLR } from './laporan-lr.actions';
import { KATEGORI_SETORAN_MODAL } from './buku-kas.types';
import { bulanBerjalan } from '@/lib/bulan-berjalan';

const TENANT_ID = 'STX-001';

/** Overhead produksi (masuk HPP): dibagi rata per pcs ke tiap PO */
const KATEGORI_OVERHEAD_PRODUKSI = ['Biaya Overhead', 'Bahan Pembantu', 'Biaya Peralatan'];
/** Beban usaha di luar produksi (sama dengan Laporan L/R: sewa ikut Operasional) */
const KATEGORI_BEBAN_USAHA = ['Biaya Operasional', 'Lainnya'];

/** Uang dari klien = pembayaran tagihan (bukan pendapatan; pendapatan diakui dari Surat Jalan). */
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
  /** Bagian overhead produksi + beban usaha + sewa menurut porsi pcs */
  alokasi: number;
  /** Laba bersih PO (nilai jual − semua biaya) */
  surplus: number;
  status: StatusPO;
}

/** Satu kolom laporan laba rugi (basis akrual: biaya mengikuti barang yang dijual) */
export interface KolomLR {
  pendapatan: number;
  bahan: number;
  upah: number;
  overheadProduksi: number;
  hpp: number;
  labaKotor: number;
  sewa: number;
  bebanLain: number;
  bebanUsaha: number;
  labaBersih: number;
}

export interface ArusKasBulan {
  /** 'YYYY-MM' */
  bulan: string;
  /** Pendapatan diakui (nilai Surat Jalan + Pendapatan Lain) — sama dengan Laporan L/R */
  pendapatan: number;
  kasKlien: number;
  kasLain: number;
  modal: number;
  keluar: number;
  bersih: number;
  kumulatif: number;
}

export interface ProyeksiSurplusData {
  sejak: string;
  /** Hari ini (WIB) — tanggal posisi keuangan */
  perTanggal: string;

  /** Laba rugi akrual: barang sudah dikirim, order masih berjalan, dan total */
  lr: { dikirim: KolomLR; berjalan: KolomLR; total: KolomLR };
  /** Rincian beban per kategori Buku Kas (sebelum dibagi dikirim/berjalan) */
  rincianOverhead: { kategori: string; nominal: number }[];
  rincianBebanLain: { kategori: string; nominal: number }[];
  pendapatanBelumValidasi: number;
  pendapatanLain: number;

  /** Posisi keuangan per hari ini (tanpa kas — saldo kas awal sebelum periode belum tercatat) */
  posisi: {
    persediaanBahan: number;
    barangDalamProses: number;
    piutang: number;
    sewaDibayarDimuka: number;
    totalAset: number;
    upahTerutang: number;
    uangMukaPelanggan: number;
    totalKewajiban: number;
  };
  stokTersisaRinci: { nama: string; qty: number; satuan: string; nilai: number }[];
  biayaTetap: { nama: string; hari: number; perHari: number; nominal: number; sisaHari: number; sisaNilai: number }[];
  biayaTetapDari: string;
  biayaTetapSampai: string;

  /** Arus kas Buku Kas sejak awal periode */
  arusKas: {
    masukKlien: number;
    masukKlienTanpaPo: number;
    setoranModal: number;
    pendapatanLain: number;
    totalMasuk: number;
    keluar: { kategori: string; nominal: number }[];
    totalKeluar: number;
    bersih: number;
  };
  perBulan: ArusKasBulan[];

  totalPcs: number;
  po: ProyeksiPO[];
}

const keUtc = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));

/** Selisih hari inklusif antara dua tanggal 'YYYY-MM-DD' */
const hariInklusif = (a: string, b: string) => Math.round((keUtc(b) - keUtc(a)) / 86_400_000) + 1;

const akhirBulan = (ym: string) =>
  `${ym}-${String(new Date(+ym.slice(0, 4), +ym.slice(5, 7), 0).getDate()).padStart(2, '0')}`;

const besok = (d: string) => new Date(keUtc(d) + 86_400_000).toISOString().slice(0, 10);

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

const kolomLR = (pendapatan: number, bahan: number, upah: number, overheadProduksi: number,
  sewa: number, bebanLain: number): KolomLR => {
  const hpp = bahan + upah + overheadProduksi;
  const bebanUsaha = sewa + bebanLain;
  return {
    pendapatan, bahan, upah, overheadProduksi, hpp, labaKotor: pendapatan - hpp,
    sewa, bebanLain, bebanUsaha, labaBersih: pendapatan - hpp - bebanUsaha,
  };
};

export async function getProyeksiSurplus(): Promise<ProyeksiSurplusData> {
  const supabase = await createClient();

  const [poRes, kasRes, lotRes, btRes] = await Promise.all([
    supabase.rpc('get_proyeksi_surplus_po', { p_tenant_id: TENANT_ID, p_po_mulai: PO_AWAL_PERIODE }),
    supabase.from('buku_kas').select('tanggal, tipe, kategori, nominal, overhead_sub_id, po_id, po:po_id(no_po)')
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

  // Sama dengan Laporan L/R: baris yang ditandai ke PO lama tidak dihitung
  const kasPeriode = ((kasRes.data ?? []) as any[]).filter(k => {
    const noPo = (Array.isArray(k.po) ? k.po[0]?.no_po : k.po?.no_po) as string | undefined;
    return !noPo || poPeriodeBaru(noPo);
  });
  // Untuk biaya: pembayaran kontrak sewa diganti alokasi harian. Untuk arus kas: tetap dihitung (uangnya keluar).
  const kasBiaya = kasPeriode.filter(k =>
    !(k.kategori === 'Biaya Overhead' && k.overhead_sub_id && subKontrak.has(String(k.overhead_sub_id))));

  const masukSemua = kasPeriode.filter(k => k.tipe === 'masuk');
  const setoranModal = masukSemua.filter(k => k.kategori === KATEGORI_SETORAN_MODAL)
    .reduce((s, k) => s + Number(k.nominal), 0);
  const masukTanpaModal = masukSemua.filter(k => k.kategori !== KATEGORI_SETORAN_MODAL);
  const masukKlienRows = masukTanpaModal.filter(k => KATEGORI_MASUK_KLIEN.includes(k.kategori));
  const masukLainRows = masukTanpaModal.filter(k => !KATEGORI_MASUK_KLIEN.includes(k.kategori));
  const masukKlien = masukKlienRows.reduce((s, k) => s + Number(k.nominal), 0);
  const masukKlienTanpaPo = masukKlienRows.filter(k => !k.po_id).reduce((s, k) => s + Number(k.nominal), 0);
  const pendapatanLain = masukLainRows.reduce((s, k) => s + Number(k.nominal), 0);
  const diterimaPerPo = new Map<string, number>();
  masukKlienRows.filter(k => k.po_id).forEach(k =>
    diterimaPerPo.set(String(k.po_id), (diterimaPerPo.get(String(k.po_id)) ?? 0) + Number(k.nominal)));

  const keluarKasRows = kasPeriode.filter(k => k.tipe === 'keluar');
  const keluarBiaya = kelompok(kasBiaya.filter(k => k.tipe === 'keluar'));
  const rincianOverhead = keluarBiaya.filter(k => KATEGORI_OVERHEAD_PRODUKSI.includes(k.kategori));
  const rincianBebanLain = keluarBiaya.filter(k => KATEGORI_BEBAN_USAHA.includes(k.kategori));
  const totalOverhead = rincianOverhead.reduce((s, k) => s + k.nominal, 0);
  const totalBebanLain = rincianBebanLain.reduce((s, k) => s + k.nominal, 0);

  // Sewa (biaya tetap): dialokasikan per hari sejak tanggal awal periode s/d akhir bulan berjalan
  const { bulan, tahun } = bulanBerjalan();
  const blnAwal = TANGGAL_AWAL_PERIODE.slice(0, 7);
  const blnSekarang = `${tahun}-${bulan}`;
  const perTanggal = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Jakarta' });
  const sewaDari = TANGGAL_AWAL_PERIODE;
  const sewaSampai = akhirBulan(blnSekarang);
  const hariDalam = (b: any, dari: string, sampai: string) => {
    const awal = b.tanggal_mulai > dari ? b.tanggal_mulai : dari;
    const akhir = b.tanggal_selesai < sampai ? b.tanggal_selesai : sampai;
    return akhir >= awal ? hariInklusif(awal, akhir) : 0;
  };
  const perHariOf = (b: any) => Number(b.nominal) / hariInklusif(b.tanggal_mulai, b.tanggal_selesai);
  const biayaTetap = btData.map(b => {
    const perHari = perHariOf(b);
    const hari = hariDalam(b, sewaDari, sewaSampai);
    // Sisa kontrak setelah bagian yang sudah dibebankan (s/d akhir bulan berjalan) = aset (sewa dibayar di muka)
    const sisaHari = hariDalam(b, besok(sewaSampai), b.tanggal_selesai);
    return { nama: b.nama as string, hari, perHari, nominal: perHari * hari, sisaHari, sisaNilai: perHari * sisaHari };
  }).filter(b => b.hari > 0 || b.sisaHari > 0);
  const totalSewa = biayaTetap.reduce((s, b) => s + b.nominal, 0);

  // Pendapatan per bulan (sama dengan Laporan L/R: nilai Surat Jalan setelah validasi + Pendapatan Lain)
  const tahunList = [...new Set(daftarBulan(blnAwal, blnSekarang).map(ym => +ym.slice(0, 4)))];
  const lrList = await Promise.all(tahunList.map(t => getLaporanLR(t, undefined, undefined, true)));
  const lrBulan = new Map<string, { pendapatan: number; belumValidasi: number }>();
  lrList.forEach(lr => lr.bulan_list.forEach(b =>
    lrBulan.set(`${b.tahun}-${String(b.bulan).padStart(2, '0')}`, { pendapatan: b.pendapatan, belumValidasi: b.pendapatan_belum_validasi })));

  let kumulatif = 0;
  let pendapatanTotal = 0;
  let pendapatanBelumValidasi = 0;
  const perBulan: ArusKasBulan[] = daftarBulan(blnAwal, blnSekarang).map(ym => {
    const diBulan = (k: any) => String(k.tanggal).slice(0, 7) === ym;
    const lr = lrBulan.get(ym) ?? { pendapatan: 0, belumValidasi: 0 };
    const jml = (rows: any[]) => rows.filter(diBulan).reduce((s, k) => s + Number(k.nominal), 0);
    const kasKlien = jml(masukKlienRows);
    const kasLain = jml(masukLainRows);
    const modal = jml(masukSemua.filter(k => k.kategori === KATEGORI_SETORAN_MODAL));
    const keluar = jml(keluarKasRows);
    const bersih = kasKlien + kasLain + modal - keluar;
    kumulatif += bersih;
    pendapatanTotal += lr.pendapatan;
    pendapatanBelumValidasi += lr.belumValidasi;
    return { bulan: ym, pendapatan: lr.pendapatan, kasKlien, kasLain, modal, keluar, bersih, kumulatif };
  });
  const pendapatanSj = pendapatanTotal - pendapatanLain;

  // Stok bahan utama tersisa (persediaan)
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
  const persediaanBahan = stokTersisaRinci.reduce((s, x) => s + x.nilai, 0);

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
  const porsi = (pcs: number) => totalPcs > 0 ? pcs / totalPcs : 0;
  const poolBiaya = totalOverhead + totalBebanLain + totalSewa;
  const po: ProyeksiPO[] = raw.map(r => {
    const alokasi = poolBiaya * porsi(r.pcs);
    const status: StatusPO = r.pcs > 0 && r.pcs_kirim >= r.pcs && r.upah_sisa === 0 ? 'terkirim'
      : r.pcs_kirim > 0 ? 'kirim_sebagian' : 'produksi';
    return {
      ...r, alokasi, status,
      surplus: r.nilai_jual - r.kain - r.aksesori - r.upah_lunas - r.upah_belum_lunas - r.upah_sisa - alokasi,
    };
  });

  // ── Laba rugi akrual: biaya tiap PO dibagi ke bagian yang sudah dikirim & yang belum ──
  const rasioKirim = (p: { pcs: number; pcs_kirim: number }) => p.pcs > 0 ? Math.min(1, p.pcs_kirim / p.pcs) : 0;
  let bahanKirim = 0, bahanJalan = 0, upahKirim = 0, upahJalan = 0, pcsKirim = 0, nilaiBelumKirim = 0;
  let wip = 0;
  po.forEach(p => {
    const r = rasioKirim(p);
    const bahan = p.kain + p.aksesori;
    const upah = p.upah_lunas + p.upah_belum_lunas + p.upah_sisa;
    bahanKirim += bahan * r; bahanJalan += bahan * (1 - r);
    upahKirim += upah * r;  upahJalan += upah * (1 - r);
    pcsKirim += Math.min(p.pcs, p.pcs_kirim);
    nilaiBelumKirim += Math.max(0, p.nilai_jual - p.nilai_kirim);
    // Barang dalam proses: biaya yang SUDAH terjadi untuk barang yang belum dikirim
    // (bahan + upah tercatat + overhead produksi; tanpa upah tahap yang belum dikerjakan)
    wip += (bahan + p.upah_lunas + p.upah_belum_lunas + totalOverhead * porsi(p.pcs)) * (1 - r);
  });
  const rKirim = totalPcs > 0 ? pcsKirim / totalPcs : 0;
  const dikirim = kolomLR(pendapatanTotal, bahanKirim, upahKirim, totalOverhead * rKirim,
    totalSewa * rKirim, totalBebanLain * rKirim);
  const berjalan = kolomLR(nilaiBelumKirim, bahanJalan, upahJalan, totalOverhead * (1 - rKirim),
    totalSewa * (1 - rKirim), totalBebanLain * (1 - rKirim));
  const total = kolomLR(dikirim.pendapatan + berjalan.pendapatan, dikirim.bahan + berjalan.bahan,
    dikirim.upah + berjalan.upah, totalOverhead, totalSewa, totalBebanLain);

  // ── Posisi keuangan ──
  const upahTerutang = po.reduce((s, p) => s + p.upah_belum_lunas, 0);
  const piutang = Math.max(0, pendapatanSj - masukKlien);
  const uangMukaPelanggan = Math.max(0, masukKlien - pendapatanSj);
  const sewaDibayarDimuka = biayaTetap.reduce((s, b) => s + b.sisaNilai, 0);
  const totalAset = persediaanBahan + wip + piutang + sewaDibayarDimuka;
  const totalKewajiban = upahTerutang + uangMukaPelanggan;

  const keluarKas = kelompok(keluarKasRows);
  const totalKeluar = keluarKas.reduce((s, k) => s + k.nominal, 0);
  const totalMasuk = masukKlien + setoranModal + pendapatanLain;

  return {
    sejak: TANGGAL_AWAL_PERIODE,
    perTanggal,
    lr: { dikirim, berjalan, total },
    rincianOverhead, rincianBebanLain,
    pendapatanBelumValidasi, pendapatanLain,
    posisi: {
      persediaanBahan, barangDalamProses: wip, piutang, sewaDibayarDimuka, totalAset,
      upahTerutang, uangMukaPelanggan, totalKewajiban,
    },
    stokTersisaRinci,
    biayaTetap, biayaTetapDari: sewaDari, biayaTetapSampai: sewaSampai,
    arusKas: {
      masukKlien, masukKlienTanpaPo, setoranModal, pendapatanLain, totalMasuk,
      keluar: keluarKas, totalKeluar, bersih: totalMasuk - totalKeluar,
    },
    perBulan,
    totalPcs,
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
