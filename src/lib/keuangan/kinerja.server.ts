/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Mesin hitung Kinerja Keuangan — SATU sumber angka laba untuk Kinerja Keuangan, Ringkasan & Laporan Per PO.
 *
 * Basis akrual (SAK EMKM):
 *  - Pendapatan diakui saat barang dikirim (Surat Jalan, dicocokkan validasi kantor).
 *  - Retur & Reject kantor jadi pengurang pendapatan di tanggal reject dilaporkan; pemulihannya (kirim ulang
 *    diterima / dibeli kantor) di tanggal kejadiannya. Reject barang lama (di luar sistem) = kerugian reject.
 *  - HPP = biaya per pcs tiap PO × pcs yang dikirim. Biaya per pcs = bahan terpakai + upah
 *    (dibayar + terutang + perkiraan tahap tersisa) + overhead produksi.
 *  - Overhead produksi (Biaya Overhead, Peralatan, Bahan Pembantu tanpa jenis, sewa per hari) memakai
 *    metode pcs-hari: overhead tiap bulan diratakan per hari kalender (bulan berjalan: s/d hari ini),
 *    lalu tiap hari dibagi ke barang dalam proses (selesai cutting s/d selesai packing) sebanding
 *    pcs × overhead HPP per pcs produknya. Hari tanpa barang dalam proses = beban bulan itu
 *    ("overhead tanpa produksi"). Angka bulan berjalan masih SEMENTARA (final setelah bulan tutup).
 *  - Overhead bertanda PO (mis. pembuatan sampel) langsung ke PO itu; bahan pembantu bertanda jenis
 *    tidak masuk overhead umum — pemakaiannya langsung ke PO (get_pembantu_per_po).
 *  - Beban operasional (Biaya Operasional, Lainnya) dibebankan di bulan terjadinya.
 *  - Pembelian bahan = persediaan (aset), baru jadi biaya saat dipakai.
 *  - Bahan pembantu (barang lama = setoran modal barang, dan belanja Buku Kas yang bertanda jenis):
 *    mengikuti Saldo Bahan Pembantu. Yang terpakai jatah HPP jadi overhead produksi di bulan pemakaiannya;
 *    sisa saldo = aset. Jatah yang tidak tertutup saldo = penghematan permanen (margin, tanpa biaya);
 *    belanja berikutnya hanya menambah saldo, tidak menutup penghematan lalu.
 *  - Laba PO = nilai jual − (biaya aktual + sisa perkiraan LENGKAP): upah tahap tersisa, aksesori &
 *    bahan pembantu untuk pcs yang belum sampai tahapnya / masih menunggu harga, biaya lain yang belum
 *    tercatat (komponen-po.ts). Angka ini sama persis dengan margin di Laporan Per PO.
 */
import { PO_AWAL_PERIODE, TANGGAL_AWAL_PERIODE, poPeriodeBaru } from './periode-po';
import { pendapatanSjPerBulan, returRejectKejadian, type KejadianReject } from './pendapatan.server';
import { KATEGORI_BAYAR_KLIEN } from './pendapatan.server';
import { KATEGORI_SETORAN_MODAL } from '@/lib/actions/keuangan/buku-kas.types';
import { bulanBerjalan } from '@/lib/bulan-berjalan';
import { susunKomponen, sisaNonUpah, type BarisKomponen, type OverheadRinci } from './komponen-po';

type Supa = any;
const TENANT_ID = 'STX-001';

export const KATEGORI_OVERHEAD_PRODUKSI = ['Biaya Overhead', 'Bahan Pembantu', 'Biaya Peralatan'];
export const KATEGORI_BEBAN_OPERASIONAL = ['Biaya Operasional', 'Lainnya'];

export type StatusPO = 'produksi' | 'kirim_sebagian' | 'terkirim';

export interface KolomLR {
  /** Nilai Surat Jalan + pendapatan lain (sebelum retur & reject) */
  penjualan: number;
  /** Retur & reject kantor bersih (reject dilaporkan − pemulihan); positif = mengurangi pendapatan */
  returReject: number;
  /** Pendapatan bersih = penjualan − returReject */
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
  /** Overhead umum (Buku Kas) yang diratakan per hari */
  transaksi: Transaksi[];
  sewa: SewaAlokasi[];
  /** Overhead umum + sewa bulan ini (yang dibagi pcs-hari) */
  total: number;
  /** Hari yang dihitung (bulan berjalan: s/d hari ini) & hari tanpa barang dalam proses */
  hari: number;
  hariTanpaProduksi: number;
  /** Σ pcs × hari barang dalam proses */
  pcsHari: number;
  /** Bagian total yang melekat ke barang & yang jadi beban bulan (hari tanpa produksi) */
  teralokasi: number;
  tanpaProduksi: number;
  /** Biaya langsung ke PO bulan ini: bahan pembantu terpakai & overhead bertanda PO */
  langsung: Transaksi[];
  /** true = bulan berjalan, angka masih bisa berubah sampai bulan tutup */
  sementara: boolean;
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
  /** Overhead produksi total = alokasi pcs-hari + langsung (pembantu & overhead bertanda PO) */
  overhead: number;
  overhead_alokasi: number;
  overhead_pembantu: number;
  overhead_langsung_kas: number;
  /** Bagian overhead yang sudah ikut barang terkirim (semua bulan / periode terpilih) */
  overhead_kirim: number;
  overhead_kirim_periode: number;
  /** Perkiraan aksesori & biaya lain untuk pcs yang belum tercatat (termasuk menunggu harga) */
  sisa_bahan: number;
  /** Perkiraan bahan pembantu untuk pcs yang belum selesai jahit */
  sisa_pembantu: number;
  /** Rincian per komponen HPP (Perkiraan | Aktual | Sisa | Selisih) */
  komponen: BarisKomponen[];
  /** Nilai jual − bahan − upah − overhead produksi − sisa perkiraan */
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
  /** true bila periode memuat bulan berjalan → overhead masih sementara */
  overheadSementara: boolean;

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
    returReject: KejadianReject[];
  };

  posisi: {
    persediaanBahan: number;
    /** Saldo bahan pembantu yang belum terpakai jatah HPP (barang lama + belanja) */
    persediaanPembantu: number;
    /** Bagian persediaan pembantu yang berasal dari barang lama (setoran modal barang) */
    persediaanPembantuLama: number;
    barangDalamProses: number;
    piutang: number;
    totalAset: number;
    upahTerutang: number;
    uangMukaPelanggan: number;
    totalKewajiban: number;
  };
  stokTersisaRinci: { nama: string; qty: number; satuan: string; nilai: number }[];
  /** Per jenis bahan pembantu: barang lama & belanja yang masuk, sisa saldo (aset) dan bagian sisa dari barang lama */
  pembantuLamaRinci: { nama: string; lama: number; belanja: number; sisa: number; sisaLama: number }[];
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

const kolom = (p: Omit<KolomLR, 'pendapatan' | 'hpp' | 'labaKotor' | 'bebanUsaha' | 'labaBersih'>): KolomLR => {
  const pendapatan = p.penjualan - p.returReject;
  const hpp = p.bahan + p.upah + p.overheadProduksi;
  const bebanUsaha = p.overheadTanpaProduksi + p.bebanOperasional;
  return { ...p, pendapatan, hpp, labaKotor: pendapatan - hpp, bebanUsaha, labaBersih: pendapatan - hpp - bebanUsaha };
};
const nol = (): KolomLR => kolom({ penjualan: 0, returReject: 0, bahan: 0, upah: 0, overheadProduksi: 0, overheadTanpaProduksi: 0, bebanOperasional: 0 });
const jumlah = (a: KolomLR, b: KolomLR) => kolom({
  penjualan: a.penjualan + b.penjualan, returReject: a.returReject + b.returReject, bahan: a.bahan + b.bahan, upah: a.upah + b.upah,
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

  const [poRes, poBulanRes, kasRes, lotRes, btRes, sjMap, pembRes, jenisRes, ohBundleRes, pembPoRes, perkRes, aktRes, bedaRes, rejectKejadian,
         subRes, kompOhRes, kainRes] = await Promise.all([
    supabase.rpc('get_proyeksi_surplus_po', { p_tenant_id: TENANT_ID, p_po_mulai: PO_AWAL_PERIODE }),
    supabase.rpc('get_kinerja_po_bulan', { p_tenant_id: TENANT_ID, p_po_mulai: PO_AWAL_PERIODE }),
    supabase.from('buku_kas')
      .select('tanggal, tipe, kategori, nominal, keterangan, overhead_sub_id, pembantu_jenis_id, po_id, po:po_id(no_po), overhead_sub:overhead_sub_id(nama)')
      .eq('tenant_id', TENANT_ID).gte('tanggal', TANGGAL_AWAL_PERIODE).order('tanggal'),
    supabase.from('inventory_batch')
      .select('qty_sisa, harga_satuan, item:inventory_item_id(nama, satuan, jenis)')
      .eq('tenant_id', TENANT_ID).gt('qty_sisa', 0),
    supabase.from('biaya_tetap')
      .select('nama, nominal, tanggal_mulai, tanggal_selesai, overhead_sub_id').eq('tenant_id', TENANT_ID),
    pendapatanSjPerBulan(supabase, TANGGAL_AWAL_PERIODE, akhirSekarang, true),
    supabase.rpc('get_mutasi_saldo_pembantu', { p_tenant_id: TENANT_ID, p_mulai: PO_AWAL_PERIODE }),
    supabase.from('pembantu_jenis').select('id, nama').eq('tenant_id', TENANT_ID),
    supabase.rpc('get_overhead_bundle', { p_tenant_id: TENANT_ID, p_po_mulai: PO_AWAL_PERIODE }),
    supabase.rpc('get_pembantu_per_po', { p_tenant_id: TENANT_ID, p_mulai: PO_AWAL_PERIODE }),
    supabase.rpc('get_laporan_po_perkiraan', { p_tenant_id: TENANT_ID, p_po_mulai: PO_AWAL_PERIODE }),
    supabase.rpc('get_laporan_po_aktual', { p_tenant_id: TENANT_ID, p_po_mulai: PO_AWAL_PERIODE }),
    supabase.rpc('get_laporan_po_beda_tarif', { p_tenant_id: TENANT_ID, p_po_mulai: PO_AWAL_PERIODE }),
    returRejectKejadian(supabase, true),
    supabase.from('overhead_sub').select('id, nama, hpp_komponen_id').eq('tenant_id', TENANT_ID),
    supabase.from('hpp_komponen').select('id, nama').eq('tenant_id', TENANT_ID).eq('kategori', 'overhead'),
    supabase.rpc('get_laporan_po_kain', { p_tenant_id: TENANT_ID, p_po_mulai: PO_AWAL_PERIODE }),
  ]);
  for (const r of [poRes, poBulanRes, kasRes, lotRes, btRes, pembRes, jenisRes, ohBundleRes, pembPoRes, perkRes, aktRes, bedaRes, subRes, kompOhRes, kainRes]) if (r.error) throw new Error(r.error.message);

  // ── Bahan pembantu lama (saldo awal = setoran modal barang) ──
  const namaJenis = new Map(((jenisRes.data ?? []) as any[]).map(j => [String(j.id), String(j.nama)]));
  const keBulanPeriode = (tgl: string) => {
    const m = String(tgl).slice(0, 7);
    return m < blnAwal ? blnAwal : m > blnSekarang ? blnSekarang : m;
  };
  /** bulan → sumber ('lama' | 'belanja') → jenis → nilai bahan pembantu yang jadi biaya */
  const pakaiPembantu = new Map<string, Map<'lama' | 'belanja', Map<string, number>>>();
  const tambahPakai = (tgl: string, sumber: 'lama' | 'belanja', j: string, n: number) => {
    if (!(n > 0.005)) return;
    const m = keBulanPeriode(tgl);
    const perSumber = pakaiPembantu.get(m) ?? new Map<'lama' | 'belanja', Map<string, number>>();
    const per = perSumber.get(sumber) ?? new Map<string, number>();
    per.set(j, (per.get(j) ?? 0) + n);
    perSumber.set(sumber, per);
    pakaiPembantu.set(m, perSumber);
  };
  const pembantuPerJenis = new Map<string, { lama: number; belanja: number; sisa: number; sisaLama: number }>();
  ((pembRes.data ?? []) as any[]).forEach(r => {
    const j = String(r.jenis_id);
    const cur = pembantuPerJenis.get(j) ?? { lama: 0, belanja: 0, sisa: 0, sisaLama: 0 };
    if (r.tipe === 'modal') cur.lama += Number(r.nominal);
    if (r.tipe === 'beli' || r.tipe === 'potong') cur.belanja += Number(r.nominal); // potong variasi: nilai pindah dari stok bahan utama
    cur.sisa = Number(r.saldo ?? 0);            // urut per jenis → baris terakhir = sisa
    cur.sisaLama = Number(r.saldo_modal ?? 0);
    pembantuPerJenis.set(j, cur);
    if (r.tipe === 'jatah') {
      const dariSaldo = -Number(r.ke_saldo ?? 0);
      const dariLama = -Number(r.ke_modal ?? 0);
      tambahPakai(r.tanggal, 'lama', j, dariLama);
      tambahPakai(r.tanggal, 'belanja', j, dariSaldo - dariLama);
    }
  });
  const pembantuLamaRinci = [...pembantuPerJenis.entries()].filter(([, v]) => v.lama + v.belanja > 0)
    .map(([j, v]) => ({ nama: namaJenis.get(j) ?? '?', lama: v.lama, belanja: v.belanja, sisa: v.sisa, sisaLama: v.sisaLama }))
    .sort((a, b) => b.sisa - a.sisa);
  const persediaanPembantu = pembantuLamaRinci.reduce((s, x) => s + x.sisa, 0);
  const persediaanPembantuLama = pembantuLamaRinci.reduce((s, x) => s + x.sisaLama, 0);

  // ── Buku Kas periode baru (baris bertanda PO lama diabaikan) ──
  const btData = (btRes.data ?? []) as any[];
  const subKontrak = new Set(btData.map(b => String(b.overhead_sub_id)));
  const kas = ((kasRes.data ?? []) as any[]).filter(k => {
    const noPo = (Array.isArray(k.po) ? k.po[0]?.no_po : k.po?.no_po) as string | undefined;
    return !noPo || poPeriodeBaru(noPo);
  });
  const ym = (k: any) => String(k.tanggal).slice(0, 7);
  // Pembayaran kontrak sewa diganti alokasi harian (untuk biaya); untuk arus kas tetap dihitung.
  // Belanja bahan pembantu bertanda jenis → biaya mengikuti pemakaian (pakaiPembantu); arus kas tetap dihitung.
  const kasBiaya = kas.filter(k => k.tipe === 'keluar' &&
    !(k.kategori === 'Biaya Overhead' && k.overhead_sub_id && subKontrak.has(String(k.overhead_sub_id))) &&
    !(k.kategori === 'Bahan Pembantu' && k.pembantu_jenis_id));
  const masuk = kas.filter(k => k.tipe === 'masuk');
  const isKlien = (k: any) => KATEGORI_BAYAR_KLIEN.includes(k.kategori);
  const isModal = (k: any) => k.kategori === KATEGORI_SETORAN_MODAL;
  const pendLainRows = masuk.filter(k => !isKlien(k) && !isModal(k));

  // ── Hari yang dihitung per bulan: sejak awal periode, bulan berjalan s/d hari ini ──
  const awalHitung = (m: string) => maks(`${m}-01`, TANGGAL_AWAL_PERIODE);
  const akhirHitung = (m: string) => min(akhirBulan(m), perTanggal);

  // ── Sewa per hari, per bulan ──
  const perHariOf = (b: any) => Number(b.nominal) / hariInklusif(b.tanggal_mulai, b.tanggal_selesai);
  const sewaBulan = (m: string): SewaAlokasi[] => btData.map(b => {
    const d = maks(awalHitung(m), b.tanggal_mulai);
    const s = min(akhirHitung(m), b.tanggal_selesai);
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

  // ── Overhead produksi: metode pcs-hari ──
  const noPoOf = (k: any) => (Array.isArray(k.po) ? k.po[0]?.no_po : k.po?.no_po) as string | undefined;
  const kasOverhead = kasBiaya.filter(k => KATEGORI_OVERHEAD_PRODUKSI.includes(k.kategori));
  const kasUmum = kasOverhead.filter(k => !k.po_id);
  const kasLangsung = kasOverhead.filter(k => k.po_id);

  // Asal biaya overhead → jenis HPP (sub-kelompok tertaut komponen HPP; tanpa tautan / tanpa sub = Operasional)
  const kompOh = new Map(((kompOhRes.data ?? []) as any[]).map(k => [String(k.id), String(k.nama)]));
  const idOperasional = [...kompOh.entries()].find(([, n]) => n.toLowerCase() === 'operasional')?.[0] ?? 'operasional';
  const subInfo = new Map(((subRes.data ?? []) as any[]).map(x => [String(x.id), {
    nama: String(x.nama), jenis: x.hpp_komponen_id && kompOh.has(String(x.hpp_komponen_id)) ? String(x.hpp_komponen_id) : idOperasional,
  }]));
  type Asal = { kunci: string; label: string; jenis_id: string };
  const asalKas = (k: any): Asal => {
    const sub = k.overhead_sub_id ? subInfo.get(String(k.overhead_sub_id)) : undefined;
    return sub ? { kunci: `sub:${k.overhead_sub_id}`, label: sub.nama, jenis_id: sub.jenis }
      : { kunci: `kat:${k.kategori}`, label: `${k.kategori ?? 'Lainnya'} (tanpa sub-kelompok)`, jenis_id: idOperasional };
  };
  const asalBt = (b: any): Asal => {
    const sub = b.overhead_sub_id ? subInfo.get(String(b.overhead_sub_id)) : undefined;
    return { kunci: `bt:${b.nama}`, label: `${b.nama} (kontrak)`, jenis_id: sub?.jenis ?? idOperasional };
  };
  const asalMap = new Map<string, Asal>();

  type BundleOH = { po: string; pcs: number; mulai: string; selesai: string | null; bobot: number; kirim: { bulan: string; pcs: number }[]; oh: number;
                    ohAsal: Map<string, number> };
  const bundles: BundleOH[] = ((ohBundleRes.data ?? []) as any[]).map(r => ({
    po: String(r.po_id), pcs: Number(r.pcs),
    mulai: String(r.tgl_mulai).slice(0, 10), selesai: r.tgl_selesai ? String(r.tgl_selesai).slice(0, 10) : null,
    bobot: Number(r.bobot ?? 0),
    kirim: ((r.kirim ?? []) as any[]).map(x => ({ bulan: String(x.bulan), pcs: Number(x.pcs) })),
    oh: 0, ohAsal: new Map<string, number>(),
  })).filter(b => b.pcs > 0 && !(b.selesai && b.selesai < TANGGAL_AWAL_PERIODE)); // selesai sebelum periode: tidak ikut
  // Produk tanpa overhead HPP → bobot rata-rata produk lain (atau 1 bila semua kosong)
  const bobotAda = bundles.filter(b => b.bobot > 0);
  const bobotRata = bobotAda.length ? bobotAda.reduce((s, b) => s + b.bobot, 0) / bobotAda.length : 1;
  bundles.forEach(b => { if (!(b.bobot > 0)) b.bobot = bobotRata; });

  const overheadBulan: OverheadBulan[] = bulanList.map(m => {
    const transaksi = kasUmum.filter(k => ym(k) === m).map(keTransaksi);
    const sewa = sewaBulan(m);
    const kasTotal = transaksi.reduce((s, t) => s + t.nominal, 0);
    const d0 = awalHitung(m), d1 = akhirHitung(m);
    const hari = d1 >= d0 ? hariInklusif(d0, d1) : 0;
    // Pool harian per asal biaya (sub-kelompok Buku Kas) — jumlahnya = kasTotal / hari
    const kasHarianAsal = new Map<string, number>();
    kasUmum.filter(k => ym(k) === m).forEach(k => {
      const a = asalKas(k); asalMap.set(a.kunci, a);
      if (hari > 0) kasHarianAsal.set(a.kunci, (kasHarianAsal.get(a.kunci) ?? 0) + Number(k.nominal ?? 0) / hari);
    });
    const sewaAsal = btData.map(b => { const a = asalBt(b); asalMap.set(a.kunci, a); return a.kunci; });
    let teralokasi = 0, tanpaProduksi = hari > 0 ? 0 : kasTotal, pcsHari = 0, hariTanpaProduksi = 0;
    for (let d = d0; hari > 0 && d <= d1; d = besok(d)) {
      const poolAsal = new Map(kasHarianAsal);
      sewa.forEach(x => {
        if (!(d >= x.dari && d <= x.sampai)) return;
        const kunci = sewaAsal[btData.findIndex(b => b.nama === x.nama)] ?? `bt:${x.nama}`;
        poolAsal.set(kunci, (poolAsal.get(kunci) ?? 0) + x.perHari);
      });
      const pool = [...poolAsal.values()].reduce((s, n) => s + n, 0);
      const aktif = bundles.filter(b => b.mulai <= d && (b.selesai === null || d <= maks(b.selesai, b.mulai)));
      const w = aktif.reduce((s, b) => s + b.pcs * b.bobot, 0);
      if (w > 0) {
        aktif.forEach(b => {
          const f = (b.pcs * b.bobot) / w;
          b.oh += pool * f;
          poolAsal.forEach((n, kunci) => b.ohAsal.set(kunci, (b.ohAsal.get(kunci) ?? 0) + n * f));
        });
        teralokasi += pool;
        pcsHari += aktif.reduce((s, b) => s + b.pcs, 0);
      } else {
        tanpaProduksi += pool;
        hariTanpaProduksi++;
      }
    }
    const langsung: Transaksi[] = kasLangsung.filter(k => ym(k) === m).map(k => {
      const t = keTransaksi(k);
      return { ...t, keterangan: `${noPoOf(k) ?? 'PO'} · ${t.keterangan ?? t.sub ?? t.kategori}` };
    });
    const perSumber = pakaiPembantu.get(m);
    (['lama', 'belanja'] as const).forEach(sumber => (perSumber?.get(sumber) ?? new Map<string, number>()).forEach((nominal, j) => langsung.push({
      tanggal: akhirBulan(m), kategori: 'Bahan Pembantu', sub: sumber === 'lama' ? 'Barang lama terpakai' : 'Belanja terpakai',
      keterangan: `Pemakaian ${namaJenis.get(j) ?? 'bahan pembantu'} (jatah HPP, langsung ke PO)`, nominal,
    })));
    const total = kasTotal + sewa.reduce((s, x) => s + x.nominal, 0);
    return { bulan: m, transaksi, sewa, total, hari, hariTanpaProduksi, pcsHari, teralokasi, tanpaProduksi, langsung, sementara: m === blnSekarang };
  });

  // Per PO: alokasi pcs-hari & bagian yang sudah terkirim per bulan (per bundle)
  const ohPo = new Map<string, { alokasi: number; kirimBulan: Map<string, number> }>();
  bundles.forEach(b => {
    const cur = ohPo.get(b.po) ?? { alokasi: 0, kirimBulan: new Map<string, number>() };
    cur.alokasi += b.oh;
    let sisaPcs = b.pcs;
    b.kirim.forEach(k => {
      const q = Math.min(k.pcs, sisaPcs);
      if (q <= 0) return;
      sisaPcs -= q;
      cur.kirimBulan.set(k.bulan, (cur.kirimBulan.get(k.bulan) ?? 0) + b.oh * q / b.pcs);
    });
    ohPo.set(b.po, cur);
  });
  const pembantuPo = new Map<string, number>();
  ((pembPoRes.data ?? []) as any[]).forEach(r =>
    pembantuPo.set(String(r.po_id), (pembantuPo.get(String(r.po_id)) ?? 0) + Number(r.pakai ?? 0)));
  const kasLangsungPo = new Map<string, number>();
  kasLangsung.forEach(k => kasLangsungPo.set(String(k.po_id), (kasLangsungPo.get(String(k.po_id)) ?? 0) + Number(k.nominal)));
  /** po → bulan → overhead yang ikut barang terkirim bulan itu */
  const ohKirim = new Map<string, Map<string, number>>();

  // Rincian per komponen HPP (sumber sisa perkiraan lengkap)
  const ohAktualPo = new Map<string, number>();
  ohPo.forEach((v, id) => ohAktualPo.set(id, v.alokasi));
  kasLangsungPo.forEach((n, id) => ohAktualPo.set(id, (ohAktualPo.get(id) ?? 0) + n));
  // Overhead per asal biaya per PO (rincian Laporan Per PO): alokasi pcs-hari + bertanda PO
  const ohRinciPo = new Map<string, Map<string, OverheadRinci>>();
  const tambahRinci = (po: string, a: Asal, n: number, langsung: boolean) => {
    const m = ohRinciPo.get(po) ?? new Map<string, OverheadRinci>();
    const kunci = `${langsung ? 'L' : 'A'}|${a.kunci}`;
    const cur = m.get(kunci) ?? { kunci, label: a.label, jenis_id: a.jenis_id, jenis: kompOh.get(a.jenis_id) ?? 'Operasional', nominal: 0, langsung };
    cur.nominal += n; m.set(kunci, cur); ohRinciPo.set(po, m);
  };
  bundles.forEach(b => b.ohAsal.forEach((n, kunci) => { const a = asalMap.get(kunci); if (a) tambahRinci(b.po, a, n, false); }));
  kasLangsung.forEach(k => tambahRinci(String(k.po_id), asalKas(k), Number(k.nominal ?? 0), true));

  const komponenPo = susunKomponen({
    perkiraan: (perkRes.data ?? []) as any[], aktual: (aktRes.data ?? []) as any[],
    pembantu: (pembPoRes.data ?? []) as any[], bedaTarif: (bedaRes.data ?? []) as any[],
    namaJenis, overhead: ohAktualPo,
    overheadRinci: new Map([...ohRinciPo.entries()].map(([po, m]) => [po, [...m.values()]])),
    kain: (kainRes.data ?? []) as any[],
  });

  /** po → bulan → perkiraan bahan pembantu yang ikut barang terkirim (HPP, seperti upah sisa) */
  const sisaPembantuKirim = new Map<string, Map<string, number>>();

  const po: KinerjaPO[] = ((poRes.data ?? []) as any[]).map(r => {
    const id = String(r.po_id);
    const baris = poBulan.filter(x => x.po_id === id);
    const pcs = Number(r.pcs_potong), pcs_kirim = Number(r.pcs_kirim ?? 0);
    const upah_sisa = Number(r.upah_sisa);
    const oh = ohPo.get(id);
    const overhead_alokasi = oh?.alokasi ?? 0;
    const overhead_pembantu = pembantuPo.get(id) ?? 0;
    const overhead_langsung_kas = kasLangsungPo.get(id) ?? 0;
    const langsungTotal = overhead_pembantu + overhead_langsung_kas;
    const overhead = overhead_alokasi + langsungTotal;
    const komponen = komponenPo.get(id) ?? [];
    const { bahan: sisa_bahan, pembantu: sisa_pembantu } = sisaNonUpah(komponen);
    // Alokasi pcs-hari ikut bundle yang dikirim; biaya langsung PO ikut barang terkirim sebanding pcs
    const perBulan = new Map<string, number>();
    const sisaKirimBulan = new Map<string, number>();
    bulanList.forEach(m => {
      const kirimM = baris.filter(x => x.bulan === m).reduce((s, x) => s + x.kirim, 0);
      const n = (oh?.kirimBulan.get(m) ?? 0) + (pcs > 0 ? langsungTotal * Math.min(1, kirimM / pcs) : 0);
      if (n > 0) perBulan.set(m, n);
      if (pcs > 0 && sisa_pembantu > 0 && kirimM > 0) sisaKirimBulan.set(m, sisa_pembantu * Math.min(1, kirimM / pcs));
    });
    sisaPembantuKirim.set(id, sisaKirimBulan);
    ohKirim.set(id, perBulan);
    const kirimSemua = [...perBulan.values()].reduce((s, n) => s + n, 0);
    const p = {
      po_id: id, no_po: r.no_po, klien: r.klien ?? '-', pcs, pcs_kirim,
      nilai_jual: Number(r.nilai_jual), nilai_kirim: Number(r.nilai_kirim ?? 0),
      diterima: diterimaPerPo.get(id) ?? 0,
      kain: Number(r.biaya_kain), aksesori: Number(r.biaya_aksesori),
      upah_lunas: Number(r.upah_lunas), upah_belum_lunas: Number(r.upah_belum_lunas), upah_sisa,
      overhead, overhead_alokasi, overhead_pembantu, overhead_langsung_kas,
      sisa_bahan, sisa_pembantu, komponen,
      overhead_kirim: Math.min(overhead, kirimSemua),
      overhead_kirim_periode: [...perBulan.entries()].filter(([m]) => dalamPeriode(m)).reduce((s, [, n]) => s + n, 0),
      pcs_kirim_periode: baris.filter(x => dalamPeriode(x.bulan)).reduce((s, x) => s + x.kirim, 0),
      nilai_kirim_periode: baris.filter(x => dalamPeriode(x.bulan)).reduce((s, x) => s + x.nilai, 0),
      status: (pcs > 0 && pcs_kirim >= pcs && upah_sisa === 0 ? 'terkirim'
        : pcs_kirim > 0 ? 'kirim_sebagian' : 'produksi') as StatusPO,
    };
    const laba = p.nilai_jual - p.kain - p.aksesori - p.upah_lunas - p.upah_belum_lunas - p.upah_sisa - overhead
      - sisa_bahan - sisa_pembantu;
    return { ...p, laba };
  });
  const poMap = new Map(po.map(p => [p.po_id, p]));
  const perPcs = (p: KinerjaPO) => p.pcs > 0 ? {
    bahan: (p.kain + p.aksesori + p.sisa_bahan) / p.pcs,
    upah: (p.upah_lunas + p.upah_belum_lunas + p.upah_sisa) / p.pcs,
  } : { bahan: 0, upah: 0 };

  // ── Laba rugi per bulan (aktual: barang yang dikirim di bulan itu) ──
  const lrPerBulan: LRBulan[] = bulanList.map(m => {
    let bahan = 0, upah = 0, overheadProduksi = 0;
    poBulan.filter(r => r.bulan === m && r.kirim > 0).forEach(r => {
      const p = poMap.get(r.po_id);
      if (!p) return;
      const pp = perPcs(p);
      bahan += pp.bahan * r.kirim; upah += pp.upah * r.kirim;
      overheadProduksi += (ohKirim.get(r.po_id)?.get(m) ?? 0) + (sisaPembantuKirim.get(r.po_id)?.get(m) ?? 0);
    });
    const ob = overheadBulan.find(o => o.bulan === m)!;
    return {
      bulan: m,
      ...kolom({
        penjualan: (sjMap.get(m)?.nilai ?? 0) + pendLainRows.filter(k => ym(k) === m).reduce((s, k) => s + Number(k.nominal), 0),
        returReject: rejectKejadian.filter(e => e.tanggal.slice(0, 7) === m).reduce((s, e) => s + e.nilai, 0),
        bahan, upah, overheadProduksi,
        overheadTanpaProduksi: ob.tanpaProduksi,
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
    bjBahan += pp.bahan * sisa; bjUpah += pp.upah * sisa;
    const sisaPembKirim = [...(sisaPembantuKirim.get(p.po_id)?.values() ?? [])].reduce((s, n) => s + n, 0);
    bjOverhead += Math.max(0, p.overhead - p.overhead_kirim) + Math.max(0, p.sisa_pembantu - sisaPembKirim);
  });
  const orderBerjalan = kolom({ penjualan: bjPendapatan, returReject: 0, bahan: bjBahan, upah: bjUpah,
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
    return s + (p.kain + p.aksesori + p.upah_lunas + p.upah_belum_lunas) * (1 - r) + Math.max(0, p.overhead - p.overhead_kirim);
  }, 0);
  // Piutang memakai tagihan bersih: nilai SJ − potongan reject yang memotong invoice (barang lama tidak).
  const sjTotal = [...sjMap.values()].reduce((s, v) => s + v.nilai, 0)
    - rejectKejadian.filter(e => e.sumber === 'sj').reduce((s, e) => s + e.nilai, 0);
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
    overheadSementara: dalamPeriode(blnSekarang),
    lr: { aktual, berjalan, total },
    orderBerjalan,
    lrPerBulan,
    pendapatanSj, pendapatanBelumValidasi,
    rincian: {
      pendapatanLain: pendLainRows.filter(diRentang).map(keTransaksi),
      overheadBulan: overheadBulan.filter(o => dalamPeriode(o.bulan)),
      bebanOperasional: kasBiaya.filter(k => diRentang(k) && KATEGORI_BEBAN_OPERASIONAL.includes(k.kategori)).map(keTransaksi),
      returReject: rejectKejadian.filter(e => dalamPeriode(e.tanggal.slice(0, 7))),
    },
    posisi: {
      persediaanBahan, persediaanPembantu, persediaanPembantuLama, barangDalamProses, piutang, totalAset,
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
