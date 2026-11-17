/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Mesin hitung Kinerja Keuangan — SATU sumber angka laba untuk Kinerja Keuangan, Ringkasan & Laporan Per PO.
 *
 * Basis akrual (SAK EMKM):
 *  - Pendapatan diakui saat barang dikirim (Surat Jalan, dicocokkan validasi kantor).
 *  - HPP = biaya per pcs tiap PO × pcs yang dikirim. Biaya per pcs = bahan terpakai + upah
 *    (dibayar + terutang + perkiraan tahap tersisa) + overhead produksi.
 *  - Overhead produksi (Biaya Overhead, Bahan Pembantu, Peralatan, sewa per hari) dibebankan ke pcs
 *    yang dipotong di bulan yang sama → angka bulan yang sudah lewat tidak berubah lagi.
 *    Bulan tanpa pemotongan: overhead langsung jadi beban ("overhead tanpa produksi").
 *  - Beban operasional (Biaya Operasional, Lainnya) dibebankan di bulan terjadinya.
 *  - Pembelian bahan = persediaan (aset), baru jadi biaya saat dipakai.
 *  - Bahan pembantu lama (saldo awal = setoran modal berupa barang, tabel pembantu_saldo_awal):
 *    sisanya = aset; bagian yang terpakai jatah HPP jadi overhead produksi di bulan pemakaiannya.
 */
import { PO_AWAL_PERIODE, TANGGAL_AWAL_PERIODE, poPeriodeBaru } from './periode-po';
import { pendapatanSjPerBulan } from './pendapatan.server';
import { KATEGORI_BAYAR_KLIEN } from './pendapatan.server';
import { KATEGORI_SETORAN_MODAL } from '@/lib/actions/keuangan/buku-kas.types';
import { bulanBerjalan } from '@/lib/bulan-berjalan';

type Supa = any;
const TENANT_ID = 'STX-001';

export const KATEGORI_OVERHEAD_PRODUKSI = ['Biaya Overhead', 'Bahan Pembantu', 'Biaya Peralatan'];
export const KATEGORI_BEBAN_OPERASIONAL = ['Biaya Operasional', 'Lainnya'];

export type StatusPO = 'produksi' | 'kirim_sebagian' | 'terkirim';

export interface KolomLR {
  pendapatan: number;
  bahan: number;
  upah: number;
  overheadProduksi: number;
  hpp: number;
  labaKotor: number;
  /** Overhead bulan tanpa pemotongan — tidak bisa melekat ke barang */
  overheadTanpaProduksi: number;
  bebanOperasional: number;
  bebanUsaha: number;
  labaBersih: number;
}

export interface LRBulan extends KolomLR { bulan: string }

export interface Transaksi {
  tanggal: string;
  kategori: string;
  sub: string | null;
  keterangan: string | null;
  nominal: number;
}

export interface SewaAlokasi { nama: string; dari: string; sampai: string; hari: number; perHari: number; nominal: number }

export interface OverheadBulan {
  bulan: string;
  transaksi: Transaksi[];
  sewa: SewaAlokasi[];
  total: number;
  pcsPotong: number;
  /** Rp per pcs yang dipotong bulan ini (0 bila tidak ada pemotongan) */
  tarif: number;
}

export interface KinerjaPO {
  po_id: string;
  no_po: string;
  klien: string;
  status: StatusPO;
  pcs: number;
  pcs_kirim: number;
  nilai_jual: number;
  nilai_kirim: number;
  diterima: number;
  kain: number;
  aksesori: number;
  upah_lunas: number;
  upah_belum_lunas: number;
  upah_sisa: number;
  overhead: number;
  /** Nilai jual − bahan − upah − overhead produksi */
  laba: number;
  /** Pcs & nilai terkirim dalam periode yang dipilih */
  pcs_kirim_periode: number;
  nilai_kirim_periode: number;
}

export interface KinerjaData {
  /** 'semua' = sejak awal periode, atau 'YYYY-MM' */
  periode: string;
  dari: string;
  sampai: string;
  sejak: string;
  perTanggal: string;
  bulanTersedia: string[];

  lr: { aktual: KolomLR; berjalan: KolomLR | null; total: KolomLR };
  /** Barang sudah dipotong yang belum dikirim per hari ini (perkiraan), tidak ikut pilihan periode */
  orderBerjalan: KolomLR;
  lrPerBulan: LRBulan[];
  pendapatanSj: number;
  pendapatanBelumValidasi: number;

  rincian: {
    pendapatanLain: Transaksi[];
    overheadBulan: OverheadBulan[];
    bebanOperasional: Transaksi[];
  };

  posisi: {
    persediaanBahan: number;
    /** Bahan pembantu lama (setoran modal barang) yang belum terpakai */
    persediaanPembantu: number;
    barangDalamProses: number;
    piutang: number;
    totalAset: number;
    upahTerutang: number;
    uangMukaPelanggan: number;
    totalKewajiban: number;
  };
  stokTersisaRinci: { nama: string; qty: number; satuan: string; nilai: number }[];
  pembantuLamaRinci: { nama: string; awal: number; sisa: number }[];
  /** Info saja: sisa masa kontrak sewa (BUKAN aset — kontrak dibayar sebelum periode, tidak lewat Buku Kas) */
  sewaSisa: { nama: string; sejak: string; sampai: string; hari: number; nominal: number }[];

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
  arusKasPerBulan: { bulan: string; masuk: number; keluar: number; bersih: number; kumulatif: number }[];

  totalPcs: number;
  po: KinerjaPO[];
}

// ── util tanggal ──
const keUtc = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
const hariInklusif = (a: string, b: string) => Math.round((keUtc(b) - keUtc(a)) / 86_400_000) + 1;
const akhirBulan = (ym: string) =>
  `${ym}-${String(new Date(+ym.slice(0, 4), +ym.slice(5, 7), 0).getDate()).padStart(2, '0')}`;
const besok = (d: string) => new Date(keUtc(d) + 86_400_000).toISOString().slice(0, 10);
const maks = (a: string, b: string) => (a > b ? a : b);
const min = (a: string, b: string) => (a < b ? a : b);
const daftarBulan = (dari: string, sampai: string) => {
  const hasil: string[] = [];
  let y = +dari.slice(0, 4), m = +dari.slice(5, 7);
  while (`${y}-${String(m).padStart(2, '0')}` <= sampai) {
    hasil.push(`${y}-${String(m).padStart(2, '0')}`);
    if (++m > 12) { m = 1; y++; }
  }
  return hasil;
};

const kolom = (p: Omit<KolomLR, 'hpp' | 'labaKotor' | 'bebanUsaha' | 'labaBersih'>): KolomLR => {
  const hpp = p.bahan + p.upah + p.overheadProduksi;
  const bebanUsaha = p.overheadTanpaProduksi + p.bebanOperasional;
  return { ...p, hpp, labaKotor: p.pendapatan - hpp, bebanUsaha, labaBersih: p.pendapatan - hpp - bebanUsaha };
};
const nol = (): KolomLR => kolom({ pendapatan: 0, bahan: 0, upah: 0, overheadProduksi: 0, overheadTanpaProduksi: 0, bebanOperasional: 0 });
const jumlah = (a: KolomLR, b: KolomLR) => kolom({
  pendapatan: a.pendapatan + b.pendapatan, bahan: a.bahan + b.bahan, upah: a.upah + b.upah,
  overheadProduksi: a.overheadProduksi + b.overheadProduksi,
  overheadTanpaProduksi: a.overheadTanpaProduksi + b.overheadTanpaProduksi,
  bebanOperasional: a.bebanOperasional + b.bebanOperasional,
});

const keTransaksi = (k: any): Transaksi => {
  const sub = Array.isArray(k.overhead_sub) ? k.overhead_sub[0] : k.overhead_sub;
  return {
    tanggal: String(k.tanggal).slice(0, 10), kategori: k.kategori ?? 'Lainnya',
    sub: sub?.nama ?? null, keterangan: k.keterangan ?? null, nominal: Number(k.nominal ?? 0),
  };
};

export async function hitungKinerja(supabase: Supa, periode = 'semua'): Promise<KinerjaData> {
  const { bulan, tahun } = bulanBerjalan();
  const blnAwal = TANGGAL_AWAL_PERIODE.slice(0, 7);
  const blnSekarang = `${tahun}-${bulan}`;
  const bulanList = daftarBulan(blnAwal, blnSekarang);
  const periodeValid = periode !== 'semua' && bulanList.includes(periode) ? periode : 'semua';
  const dari = periodeValid === 'semua' ? TANGGAL_AWAL_PERIODE : maks(`${periodeValid}-01`, TANGGAL_AWAL_PERIODE);
  const sampai = akhirBulan(periodeValid === 'semua' ? blnSekarang : periodeValid);
  const akhirSekarang = akhirBulan(blnSekarang);
  const dalamPeriode = (ym: string) => periodeValid === 'semua' || ym === periodeValid;
  const perTanggal = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Jakarta' });

  const [poRes, poBulanRes, kasRes, lotRes, btRes, sjMap, pembRes, jenisRes] = await Promise.all([
    supabase.rpc('get_proyeksi_surplus_po', { p_tenant_id: TENANT_ID, p_po_mulai: PO_AWAL_PERIODE }),
    supabase.rpc('get_kinerja_po_bulan', { p_tenant_id: TENANT_ID, p_po_mulai: PO_AWAL_PERIODE }),
    supabase.from('buku_kas')
      .select('tanggal, tipe, kategori, nominal, keterangan, overhead_sub_id, po_id, po:po_id(no_po), overhead_sub:overhead_sub_id(nama)')
      .eq('tenant_id', TENANT_ID).gte('tanggal', TANGGAL_AWAL_PERIODE).order('tanggal'),
    supabase.from('inventory_batch')
      .select('qty_sisa, harga_satuan, item:inventory_item_id(nama, satuan, jenis)')
      .eq('tenant_id', TENANT_ID).gt('qty_sisa', 0),
    supabase.from('biaya_tetap')
      .select('nama, nominal, tanggal_mulai, tanggal_selesai, overhead_sub_id').eq('tenant_id', TENANT_ID),
    pendapatanSjPerBulan(supabase, TANGGAL_AWAL_PERIODE, akhirSekarang, true),
    supabase.rpc('get_mutasi_saldo_pembantu', { p_tenant_id: TENANT_ID, p_mulai: PO_AWAL_PERIODE }),
    supabase.from('pembantu_jenis').select('id, nama').eq('tenant_id', TENANT_ID),
  ]);
  for (const r of [poRes, poBulanRes, kasRes, lotRes, btRes, pembRes, jenisRes]) if (r.error) throw new Error(r.error.message);

  // ── Bahan pembantu lama (saldo awal = setoran modal barang) ──
  const namaJenis = new Map(((jenisRes.data ?? []) as any[]).map(j => [String(j.id), String(j.nama)]));
  const keBulanPeriode = (tgl: string) => {
    const m = String(tgl).slice(0, 7);
    return m < blnAwal ? blnAwal : m > blnSekarang ? blnSekarang : m;
  };
  /** bulan → jenis → nilai barang lama yang terpakai */
  const pakaiLama = new Map<string, Map<string, number>>();
  const lamaPerJenis = new Map<string, { awal: number; sisa: number }>();
  ((pembRes.data ?? []) as any[]).forEach(r => {
    const j = String(r.jenis_id);
    const cur = lamaPerJenis.get(j) ?? { awal: 0, sisa: 0 };
    if (r.tipe === 'modal') cur.awal += Number(r.nominal);
    cur.sisa = Number(r.saldo_modal ?? 0); // urut per jenis → baris terakhir = sisa
    lamaPerJenis.set(j, cur);
    const pakai = -Number(r.ke_modal ?? 0);
    if (r.tipe === 'jatah' && pakai > 0) {
      const m = keBulanPeriode(r.tanggal);
      const per = pakaiLama.get(m) ?? new Map<string, number>();
      per.set(j, (per.get(j) ?? 0) + pakai);
      pakaiLama.set(m, per);
    }
  });
  const pembantuLamaRinci = [...lamaPerJenis.entries()].filter(([, v]) => v.awal > 0)
    .map(([j, v]) => ({ nama: namaJenis.get(j) ?? '?', awal: v.awal, sisa: v.sisa }))
    .sort((a, b) => b.sisa - a.sisa);
  const persediaanPembantu = pembantuLamaRinci.reduce((s, x) => s + x.sisa, 0);

  // ── Buku Kas periode baru (baris bertanda PO lama diabaikan) ──
  const btData = (btRes.data ?? []) as any[];
  const subKontrak = new Set(btData.map(b => String(b.overhead_sub_id)));
  const kas = ((kasRes.data ?? []) as any[]).filter(k => {
    const noPo = (Array.isArray(k.po) ? k.po[0]?.no_po : k.po?.no_po) as string | undefined;
    return !noPo || poPeriodeBaru(noPo);
  });
  const ym = (k: any) => String(k.tanggal).slice(0, 7);
  // Pembayaran kontrak sewa diganti alokasi harian (untuk biaya); untuk arus kas tetap dihitung
  const kasBiaya = kas.filter(k => k.tipe === 'keluar' &&
    !(k.kategori === 'Biaya Overhead' && k.overhead_sub_id && subKontrak.has(String(k.overhead_sub_id))));
  const masuk = kas.filter(k => k.tipe === 'masuk');
  const isKlien = (k: any) => KATEGORI_BAYAR_KLIEN.includes(k.kategori);
  const isModal = (k: any) => k.kategori === KATEGORI_SETORAN_MODAL;
  const pendLainRows = masuk.filter(k => !isKlien(k) && !isModal(k));

  // ── Sewa per hari, per bulan (sejak tanggal awal periode) ──
  const perHariOf = (b: any) => Number(b.nominal) / hariInklusif(b.tanggal_mulai, b.tanggal_selesai);
  const sewaBulan = (m: string): SewaAlokasi[] => btData.map(b => {
    const d = maks(maks(`${m}-01`, TANGGAL_AWAL_PERIODE), b.tanggal_mulai);
    const s = min(akhirBulan(m), b.tanggal_selesai);
    const hari = s >= d ? hariInklusif(d, s) : 0;
    return { nama: b.nama as string, dari: d, sampai: s, hari, perHari: perHariOf(b), nominal: perHariOf(b) * hari };
  }).filter(x => x.hari > 0);

  // ── Per PO & per PO per bulan ──
  const diterimaPerPo = new Map<string, number>();
  masuk.filter(k => isKlien(k) && k.po_id).forEach(k =>
    diterimaPerPo.set(String(k.po_id), (diterimaPerPo.get(String(k.po_id)) ?? 0) + Number(k.nominal)));
  const poBulan = ((poBulanRes.data ?? []) as any[]).map(r => ({
    po_id: String(r.po_id), bulan: String(r.bulan),
    potong: Number(r.pcs_potong), kirim: Number(r.pcs_kirim), nilai: Number(r.nilai_kirim),
  }));

  // ── Overhead produksi per bulan → tarif per pcs potong bulan itu ──
  const overheadBulan: OverheadBulan[] = bulanList.map(m => {
    const transaksi = kasBiaya.filter(k => ym(k) === m && KATEGORI_OVERHEAD_PRODUKSI.includes(k.kategori)).map(keTransaksi);
    (pakaiLama.get(m) ?? new Map<string, number>()).forEach((nominal, j) => transaksi.push({
      tanggal: akhirBulan(m), kategori: 'Bahan Pembantu', sub: 'Barang lama (modal)',
      keterangan: `Pemakaian ${namaJenis.get(j) ?? 'bahan pembantu'} lama (saldo awal, tanpa uang keluar)`, nominal,
    }));
    const sewa = sewaBulan(m);
    const total = transaksi.reduce((s, t) => s + t.nominal, 0) + sewa.reduce((s, x) => s + x.nominal, 0);
    const pcsPotong = poBulan.filter(r => r.bulan === m).reduce((s, r) => s + r.potong, 0);
    return { bulan: m, transaksi, sewa, total, pcsPotong, tarif: pcsPotong > 0 ? total / pcsPotong : 0 };
  });
  const tarifBulan = new Map(overheadBulan.map(o => [o.bulan, o.tarif]));

  const po: KinerjaPO[] = ((poRes.data ?? []) as any[]).map(r => {
    const id = String(r.po_id);
    const baris = poBulan.filter(x => x.po_id === id);
    const pcs = Number(r.pcs_potong), pcs_kirim = Number(r.pcs_kirim ?? 0);
    const upah_sisa = Number(r.upah_sisa);
    const overhead = baris.reduce((s, x) => s + x.potong * (tarifBulan.get(x.bulan) ?? 0), 0);
    const p = {
      po_id: id, no_po: r.no_po, klien: r.klien ?? '-', pcs, pcs_kirim,
      nilai_jual: Number(r.nilai_jual), nilai_kirim: Number(r.nilai_kirim ?? 0),
      diterima: diterimaPerPo.get(id) ?? 0,
      kain: Number(r.biaya_kain), aksesori: Number(r.biaya_aksesori),
      upah_lunas: Number(r.upah_lunas), upah_belum_lunas: Number(r.upah_belum_lunas), upah_sisa,
      overhead,
      pcs_kirim_periode: baris.filter(x => dalamPeriode(x.bulan)).reduce((s, x) => s + x.kirim, 0),
      nilai_kirim_periode: baris.filter(x => dalamPeriode(x.bulan)).reduce((s, x) => s + x.nilai, 0),
      status: (pcs > 0 && pcs_kirim >= pcs && upah_sisa === 0 ? 'terkirim'
        : pcs_kirim > 0 ? 'kirim_sebagian' : 'produksi') as StatusPO,
    };
    const laba = p.nilai_jual - p.kain - p.aksesori - p.upah_lunas - p.upah_belum_lunas - p.upah_sisa - overhead;
    return { ...p, laba };
  });
  const poMap = new Map(po.map(p => [p.po_id, p]));
  const perPcs = (p: KinerjaPO) => p.pcs > 0 ? {
    bahan: (p.kain + p.aksesori) / p.pcs,
    upah: (p.upah_lunas + p.upah_belum_lunas + p.upah_sisa) / p.pcs,
    overhead: p.overhead / p.pcs,
  } : { bahan: 0, upah: 0, overhead: 0 };

  // ── Laba rugi per bulan (aktual: barang yang dikirim di bulan itu) ──
  const lrPerBulan: LRBulan[] = bulanList.map(m => {
    let bahan = 0, upah = 0, overheadProduksi = 0;
    poBulan.filter(r => r.bulan === m && r.kirim > 0).forEach(r => {
      const p = poMap.get(r.po_id);
      if (!p) return;
      const pp = perPcs(p);
      bahan += pp.bahan * r.kirim; upah += pp.upah * r.kirim; overheadProduksi += pp.overhead * r.kirim;
    });
    const ob = overheadBulan.find(o => o.bulan === m)!;
    return {
      bulan: m,
      ...kolom({
        pendapatan: (sjMap.get(m)?.nilai ?? 0) + pendLainRows.filter(k => ym(k) === m).reduce((s, k) => s + Number(k.nominal), 0),
        bahan, upah, overheadProduksi,
        overheadTanpaProduksi: ob.pcsPotong > 0 ? 0 : ob.total,
        bebanOperasional: kasBiaya.filter(k => ym(k) === m && KATEGORI_BEBAN_OPERASIONAL.includes(k.kategori))
          .reduce((s, k) => s + Number(k.nominal), 0),
      }),
    };
  });
  const aktual = lrPerBulan.filter(b => dalamPeriode(b.bulan)).reduce((s, b) => jumlah(s, b), nol());

  // ── Order berjalan (hanya tampilan "sejak awal periode"): barang dipotong yang belum dikirim ──
  let bjPendapatan = 0, bjBahan = 0, bjUpah = 0, bjOverhead = 0;
  po.forEach(p => {
    const sisa = Math.max(0, p.pcs - p.pcs_kirim);
    const pp = perPcs(p);
    bjPendapatan += Math.max(0, p.nilai_jual - p.nilai_kirim);
    bjBahan += pp.bahan * sisa; bjUpah += pp.upah * sisa; bjOverhead += pp.overhead * sisa;
  });
  const orderBerjalan = kolom({ pendapatan: bjPendapatan, bahan: bjBahan, upah: bjUpah,
    overheadProduksi: bjOverhead, overheadTanpaProduksi: 0, bebanOperasional: 0 });
  const berjalan = periodeValid === 'semua' ? orderBerjalan : null;
  const total = berjalan ? jumlah(aktual, berjalan) : aktual;

  let pendapatanSj = 0, pendapatanBelumValidasi = 0;
  sjMap.forEach((v, m) => { if (dalamPeriode(m)) { pendapatanSj += v.nilai; pendapatanBelumValidasi += v.belumValidasi; } });

  // ── Posisi per hari ini (selalu kumulatif) ──
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
  // Barang dalam proses: biaya yang SUDAH terjadi untuk barang belum dikirim (tanpa upah tahap yang belum dikerjakan)
  const barangDalamProses = po.reduce((s, p) => {
    const r = p.pcs > 0 ? Math.min(1, p.pcs_kirim / p.pcs) : 0;
    return s + (p.kain + p.aksesori + p.upah_lunas + p.upah_belum_lunas + p.overhead) * (1 - r);
  }, 0);
  const sjTotal = [...sjMap.values()].reduce((s, v) => s + v.nilai, 0);
  const masukKlienTotal = masuk.filter(isKlien).reduce((s, k) => s + Number(k.nominal), 0);
  const piutang = Math.max(0, sjTotal - masukKlienTotal);
  const uangMukaPelanggan = Math.max(0, masukKlienTotal - sjTotal);
  const sewaSisa = btData.map(b => {
    const d = maks(besok(akhirSekarang), b.tanggal_mulai);
    const hari = b.tanggal_selesai >= d ? hariInklusif(d, b.tanggal_selesai) : 0;
    return { nama: b.nama as string, sejak: d, sampai: b.tanggal_selesai as string, hari, nominal: perHariOf(b) * hari };
  }).filter(x => x.hari > 0);
  const upahTerutang = po.reduce((s, p) => s + p.upah_belum_lunas, 0);
  // Sisa kontrak sewa sengaja TIDAK dihitung sebagai aset (keputusan user 17 Nov 2026):
  // kontrak dibayar sebelum periode baru, tidak lewat Buku Kas & tidak bisa dicairkan.
  const totalAset = persediaanBahan + persediaanPembantu + barangDalamProses + piutang;

  // ── Arus kas periode terpilih ──
  const diRentang = (k: any) => dalamPeriode(ym(k));
  const jml = (rows: any[]) => rows.reduce((s, k) => s + Number(k.nominal), 0);
  const masukP = masuk.filter(diRentang);
  const keluarP = kas.filter(k => k.tipe === 'keluar' && diRentang(k));
  const kel = new Map<string, number>();
  keluarP.forEach(k => kel.set(k.kategori ?? 'Lainnya', (kel.get(k.kategori ?? 'Lainnya') ?? 0) + Number(k.nominal)));
  const keluar = [...kel.entries()].map(([kategori, nominal]) => ({ kategori, nominal })).sort((a, b) => b.nominal - a.nominal);
  const masukKlien = jml(masukP.filter(isKlien));
  const setoranModal = jml(masukP.filter(isModal));
  const pendapatanLain = jml(masukP.filter(k => !isKlien(k) && !isModal(k)));
  const totalMasuk = masukKlien + setoranModal + pendapatanLain;
  const totalKeluar = jml(keluarP);
  let kum = 0;
  const arusKasPerBulan = bulanList.map(m => {
    const mi = jml(masuk.filter(k => ym(k) === m));
    const ke = jml(kas.filter(k => k.tipe === 'keluar' && ym(k) === m));
    kum += mi - ke;
    return { bulan: m, masuk: mi, keluar: ke, bersih: mi - ke, kumulatif: kum };
  });

  return {
    periode: periodeValid, dari, sampai, sejak: TANGGAL_AWAL_PERIODE, perTanggal, bulanTersedia: bulanList,
    lr: { aktual, berjalan, total },
    orderBerjalan,
    lrPerBulan,
    pendapatanSj, pendapatanBelumValidasi,
    rincian: {
      pendapatanLain: pendLainRows.filter(diRentang).map(keTransaksi),
      overheadBulan: overheadBulan.filter(o => dalamPeriode(o.bulan)),
      bebanOperasional: kasBiaya.filter(k => diRentang(k) && KATEGORI_BEBAN_OPERASIONAL.includes(k.kategori)).map(keTransaksi),
    },
    posisi: {
      persediaanBahan, persediaanPembantu, barangDalamProses, piutang, totalAset,
      upahTerutang, uangMukaPelanggan, totalKewajiban: upahTerutang + uangMukaPelanggan,
    },
    stokTersisaRinci, pembantuLamaRinci, sewaSisa,
    arusKas: {
      masukKlien, masukKlienTanpaPo: jml(masukP.filter(k => isKlien(k) && !k.po_id)),
      setoranModal, pendapatanLain, totalMasuk, keluar, totalKeluar, bersih: totalMasuk - totalKeluar,
    },
    arusKasPerBulan,
    totalPcs: po.reduce((s, p) => s + p.pcs, 0),
    po,
  };
}
