/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Rincian biaya per PO × komponen HPP — dipakai mesin Kinerja Keuangan (kinerja.server.ts) dan
 * Laporan Per PO, supaya laba di kedua menu SAMA.
 *
 * Kolom tiap komponen: Perkiraan | Aktual sejauh ini | Sisa perkiraan | Selisih
 *   - Perkiraan  = HPP sheet (sekarang) × pcs yang dipotong (get_laporan_po_perkiraan).
 *   - Aktual     = kain & aksesori modal FIFO, upah tercatat (lunas + terutang),
 *                  bahan pembantu = pemakaian dari Saldo Bahan Pembantu, overhead = metode pcs-hari.
 *   - Sisa       = bagian perkiraan untuk pcs yang biayanya belum tercatat (tahap belum selesai,
 *                  aksesori yang masih menunggu harga LOT, biaya lain yang belum tercatat).
 *   - Selisih    = aktual + sisa − perkiraan (positif = boros, negatif = hemat).
 *   - Upah yang sudah dicatat: perkiraannya memakai tarif yang dibayar saat itu
 *     (get_laporan_po_beda_tarif), bukan tarif HPP sekarang — tarif berubah ≠ hemat/boros.
 */

export type GrupKomponen = 'bahan' | 'aksesori' | 'pembantu' | 'upah' | 'lain' | 'overhead';
export type TandaBaris = 'final' | 'berjalan' | 'menunggu_harga' | 'belum_tercatat' | 'sementara';

export interface BarisKomponen {
  grup: GrupKomponen;
  nama: string;
  keterangan: string | null;
  perkiraan: number;
  aktual: number;
  sisa: number;
  /** aktual + sisa − perkiraan */
  selisih: number;
  /** Bagian selisih karena tarif HPP berubah (upah) — tidak dihitung hemat/boros */
  beda_tarif: number;
  tanda: TandaBaris;
}

export const LABEL_TAHAP: Record<string, string> = {
  cutting: 'Cutting', jahit: 'Jahit', buang_benang: 'Buang Benang', lubang_kancing: 'Lubang Kancing',
  steam: 'Steam', packing: 'Packing', qc: 'QC', pengiriman: 'Pengiriman', lainnya: 'Lainnya',
};
const URUT_TAHAP = Object.keys(LABEL_TAHAP);
const URUT_GRUP: GrupKomponen[] = ['bahan', 'aksesori', 'pembantu', 'upah', 'lain', 'overhead'];

/** Aksesori (item inventory) → nama komponen HPP */
function komponenAksesori(item: string, adaKomponen: Set<string>): string {
  const n = item.toLowerCase();
  if (n.includes('puring')) return 'Puring';
  if (n.includes('sleting') && n.includes('saku')) return 'Sleting Saku';
  if (n.includes('sleting')) return 'Sleting Badan';
  const sama = [...adaKomponen].find(k => k.toLowerCase() === n);
  return sama ?? item;
}

export interface SumberKomponen {
  perkiraan: any[];   // get_laporan_po_perkiraan
  aktual: any[];      // get_laporan_po_aktual
  pembantu: any[];    // get_pembantu_per_po
  bedaTarif: any[];   // get_laporan_po_beda_tarif
  namaJenis: Map<string, string>;
  /** po → overhead aktual (alokasi pcs-hari + bertanda PO di Buku Kas; pembantu di grupnya sendiri) */
  overhead: Map<string, number>;
}

export function susunKomponen(s: SumberKomponen): Map<string, BarisKomponen[]> {
  type Acc = { grup: GrupKomponen; nama: string; ket: Set<string>; perkiraan: number; aktual: number; sisa: number;
               qty: number; qtyTunggu: number; beda: number };
  const perPo = new Map<string, Map<string, Acc>>();
  const ambil = (po: string, kunci: string, grup: GrupKomponen, nama: string): Acc => {
    const m = perPo.get(po) ?? new Map<string, Acc>();
    perPo.set(po, m);
    let a = m.get(kunci);
    if (!a) { a = { grup, nama, ket: new Set(), perkiraan: 0, aktual: 0, sisa: 0, qty: 0, qtyTunggu: 0, beda: 0 }; m.set(kunci, a); }
    return a;
  };
  const labelUpah = (t: string) => `Upah ${LABEL_TAHAP[t] ?? t}`;

  // Perkiraan & sisa
  const komponenAks = new Map<string, Set<string>>(); // po → nama komponen aksesori
  s.perkiraan.forEach(r => {
    const po = String(r.po_id), nama = String(r.nama), perk = Number(r.perkiraan), sisa = Number(r.sisa);
    let a: Acc;
    if (r.kategori === 'overhead') {
      a = ambil(po, 'overhead', 'overhead', 'Overhead produksi'); a.ket.add(nama);
    } else if (r.jenis_id) {
      const j = String(r.jenis_id);
      a = ambil(po, `pembantu:${j}`, 'pembantu', s.namaJenis.get(j) ?? 'Bahan pembantu');
      if (nama !== a.nama) a.ket.add(`HPP ${nama}`);
    } else if (r.tahap) {
      a = ambil(po, `upah:${r.tahap}`, 'upah', labelUpah(String(r.tahap)));
    } else if (r.kategori === 'bahan_baku' && nama === 'HPP Bahan') {
      a = ambil(po, 'kain', 'bahan', 'Kain');
    } else if (r.kategori === 'bahan_baku') {
      a = ambil(po, `aks:${nama}`, 'aksesori', nama);
      const set = komponenAks.get(po) ?? new Set<string>(); set.add(nama); komponenAks.set(po, set);
    } else {
      a = ambil(po, `lain:${nama}`, 'lain', nama);
    }
    a.perkiraan += perk; a.sisa += sisa;
  });

  // Aktual kain, aksesori, upah
  s.aktual.forEach(r => {
    const po = String(r.po_id), n = Number(r.nominal);
    if (r.sumber === 'kain') {
      const a = ambil(po, 'kain', 'bahan', 'Kain'); a.aktual += n; a.ket.add(String(r.kunci));
    } else if (r.sumber === 'aksesori') {
      const nama = komponenAksesori(String(r.kunci), komponenAks.get(po) ?? new Set());
      const a = ambil(po, `aks:${nama}`, 'aksesori', nama);
      a.aktual += n; a.qty += Number(r.qty); a.qtyTunggu += Number(r.qty_tunggu);
      if (String(r.kunci) !== nama) a.ket.add(String(r.kunci));
    } else if (r.sumber === 'upah') {
      const t = String(r.kunci);
      const a = ambil(po, `upah:${t}`, 'upah', labelUpah(t)); a.aktual += n;
    }
  });

  // Beda tarif upah
  s.bedaTarif.forEach(r => {
    const t = String(r.tahap);
    const a = ambil(String(r.po_id), `upah:${t}`, 'upah', labelUpah(t));
    a.beda += Number(r.beda);
  });

  // Bahan pembantu: biaya aktual = pemakaian dari saldo (jatah yang tak tertutup saldo = penghematan)
  const hematPembantu = new Map<string, number>();
  s.pembantu.forEach(r => {
    const po = String(r.po_id), j = String(r.jenis_id);
    const a = ambil(po, `pembantu:${j}`, 'pembantu', s.namaJenis.get(j) ?? 'Bahan pembantu');
    a.aktual += Number(r.pakai ?? 0);
    hematPembantu.set(`${po}|${j}`, (hematPembantu.get(`${po}|${j}`) ?? 0) + Number(r.hemat ?? 0));
  });

  // Overhead pcs-hari & bertanda PO
  s.overhead.forEach((n, po) => {
    if (n > 0 || perPo.has(po)) { const a = ambil(po, 'overhead', 'overhead', 'Overhead produksi'); a.aktual += n; }
  });

  const hasil = new Map<string, BarisKomponen[]>();
  perPo.forEach((m, po) => {
    const packingBelum = (m.get('upah:packing')?.sisa ?? 0) > 0;
    const rows: BarisKomponen[] = [...m.entries()].map(([kunci, a]) => {
      let sisa = a.sisa;
      let tanda: TandaBaris = sisa > 0.5 ? 'berjalan' : 'final';
      const ket = [...a.ket];
      if (a.grup === 'aksesori' && a.qtyTunggu > 0) {
        // Bagian yang menunggu harga LOT: perkiraannya dihitung sebanding qty (bukan harga referensi)
        const dipakai = Math.max(0, a.perkiraan - a.sisa);
        sisa += a.qty > 0 ? dipakai * Math.min(1, a.qtyTunggu / a.qty) : 0;
        tanda = 'menunggu_harga';
        ket.push(`${a.qtyTunggu.toLocaleString('id-ID')} dari ${a.qty.toLocaleString('id-ID')} menunggu harga`);
      }
      if (a.grup === 'pembantu') {
        const j = kunci.slice('pembantu:'.length);
        const hemat = hematPembantu.get(`${po}|${j}`) ?? 0;
        if (hemat > 0.5) ket.push(`hemat saldo Rp ${Math.round(hemat).toLocaleString('id-ID')}`);
      }
      if (a.grup === 'lain' && a.aktual === 0) {
        sisa = a.perkiraan; tanda = 'belum_tercatat';
      }
      if (a.grup === 'overhead') {
        tanda = packingBelum ? 'berjalan' : 'sementara';
      }
      // Upah yang sudah dicatat: perkiraan memakai tarif yang benar-benar dibayar (keputusan user 18 Nov),
      // jadi perubahan tarif HPP sesudahnya tidak tampil sebagai hemat/boros.
      const perkiraan = a.perkiraan + a.beda;
      if (Math.abs(a.beda) > 0.5) ket.push('tarif = yang dibayar');
      return {
        grup: a.grup, nama: a.nama, keterangan: ket.length ? ket.join(' · ') : null,
        perkiraan, aktual: a.aktual, sisa, selisih: a.aktual + sisa - perkiraan,
        beda_tarif: 0, tanda,
      };
    });
    const urutTahap = (r: BarisKomponen) => URUT_TAHAP.findIndex(t => r.nama === labelUpah(t));
    rows.sort((x, y) => URUT_GRUP.indexOf(x.grup) - URUT_GRUP.indexOf(y.grup)
      || (x.grup === 'upah' ? urutTahap(x) - urutTahap(y) : 0)
      || y.perkiraan - x.perkiraan);
    hasil.set(po, rows);
  });
  return hasil;
}

/** Sisa perkiraan non-upah (upah tersisa sudah ada di upah_sisa Kinerja) */
export function sisaNonUpah(rows: BarisKomponen[]) {
  let bahan = 0, pembantu = 0;
  rows.forEach(r => {
    if (r.grup === 'aksesori' || r.grup === 'lain' || r.grup === 'bahan') bahan += r.sisa;
    else if (r.grup === 'pembantu' || r.grup === 'overhead') pembantu += r.sisa;
  });
  return { bahan, pembantu };
}

// ─── Kesimpulan margin per PO ────────────────────────────────────────────────

export interface BarisQty {
  po_item_id: string;
  artikel: string;
  warna: string;
  size: string;
  harga_jual: number;
  pesan: number;
  potong: number;
  /** potong − pesan */
  selisih: number;
  kirim: number;
  /** kurang = potong < pesan, lebih = potong > pesan, proses = masih ada bundle belum dipotong */
  tanda: 'pas' | 'kurang' | 'lebih' | 'proses';
}

export function susunQty(rows: any[]): BarisQty[] {
  const SIZE = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL', '3XL', '4XL', '5XL'];
  const rank = (s: string) => { const i = SIZE.indexOf(s.toUpperCase()); return i === -1 ? 99 : i; };
  return rows.map(r => {
    const pesan = Number(r.qty_pesan), potong = Number(r.pcs_potong);
    const tanda: BarisQty['tanda'] = Number(r.bundle_belum_potong) > 0 ? 'proses'
      : potong < pesan ? 'kurang' : potong > pesan ? 'lebih' : 'pas';
    return {
      po_item_id: String(r.po_item_id), artikel: String(r.artikel ?? '-'), warna: String(r.warna ?? '-'),
      size: String(r.size ?? '-'), harga_jual: Number(r.harga_jual ?? 0),
      pesan, potong, selisih: potong - pesan, kirim: Number(r.pcs_kirim), tanda,
    };
  }).sort((a, b) => a.artikel.localeCompare(b.artikel) || a.warna.localeCompare(b.warna) || rank(a.size) - rank(b.size));
}

export interface PenyebabSelisih {
  nama: string;
  /** + menurunkan margin (boros), − menaikkan margin (hemat) */
  nominal: number;
  jenis: 'komponen' | 'beda_tarif';
}

export interface KesimpulanPO {
  nilai_jual: number;
  margin_perkiraan: number;
  margin_aktual: number;
  margin_perkiraan_pct: number;
  margin_aktual_pct: number;
  /** margin aktual − margin perkiraan */
  selisih_margin: number;
  /** Bagian selisih biaya karena tarif HPP berubah (tidak dihitung hemat/boros) */
  beda_tarif: number;
  /** Selisih biaya di luar beda tarif (+ boros) */
  selisih_murni: number;
  penyebab: PenyebabSelisih[];
  peringatan: 'rugi' | 'turun' | null;
  /** Penurunan margin terhadap perkiraan (%) — hanya bila margin perkiraan > 0 */
  turun_pct: number;
  kurang_potong_pcs: number;
  kurang_potong_nilai: number;
  lebih_potong_pcs: number;
  sementara: boolean;
  kalimat: string[];
}

/** Batas penurunan margin aktual terhadap perkiraan yang memicu peringatan */
export const BATAS_TURUN_MARGIN = 0.2;
const AMBANG_PENYEBAB = 1_000;

const rp = (n: number) => 'Rp ' + Math.round(Math.abs(n)).toLocaleString('id-ID');

export function hitungKesimpulan(p: {
  nilai_jual: number; baris: BarisKomponen[]; qty: BarisQty[]; sementara: boolean;
}): KesimpulanPO {
  const jml = (f: (r: BarisKomponen) => number) => p.baris.reduce((s, r) => s + f(r), 0);
  const perkiraan = jml(r => r.perkiraan);
  const biaya = jml(r => r.aktual + r.sisa);
  const beda_tarif = jml(r => r.beda_tarif);
  const selisih_biaya = biaya - perkiraan;
  const selisih_murni = selisih_biaya - beda_tarif;
  const margin_perkiraan = p.nilai_jual - perkiraan;
  const margin_aktual = p.nilai_jual - biaya;
  const pct = (n: number) => (p.nilai_jual > 0 ? Math.round((n / p.nilai_jual) * 1000) / 10 : 0);

  const penyebab: PenyebabSelisih[] = p.baris
    .map(r => ({ nama: r.nama, nominal: r.selisih - r.beda_tarif, jenis: 'komponen' as const }))
    .filter(x => Math.abs(x.nominal) >= AMBANG_PENYEBAB);
  if (Math.abs(beda_tarif) >= AMBANG_PENYEBAB) penyebab.push({ nama: 'Beda tarif upah (HPP berubah)', nominal: beda_tarif, jenis: 'beda_tarif' });
  penyebab.sort((a, b) => Math.abs(b.nominal) - Math.abs(a.nominal));
  const top = penyebab.slice(0, 3);

  const turun = margin_perkiraan > 0 ? (margin_perkiraan - margin_aktual) / margin_perkiraan : 0;
  const peringatan: KesimpulanPO['peringatan'] = p.nilai_jual > 0 && margin_aktual < 0 ? 'rugi'
    : turun > BATAS_TURUN_MARGIN ? 'turun' : null;

  let kurang_potong_pcs = 0, kurang_potong_nilai = 0, lebih_potong_pcs = 0;
  p.qty.forEach(q => {
    if (q.tanda === 'kurang') { kurang_potong_pcs += -q.selisih; kurang_potong_nilai += -q.selisih * q.harga_jual; }
    if (q.tanda === 'lebih') lebih_potong_pcs += q.selisih;
  });

  const kalimat: string[] = [];
  if (p.nilai_jual > 0) {
    kalimat.push(`PO ini ${margin_aktual >= 0 ? 'untung' : 'rugi'} ${rp(margin_aktual)} (${pct(margin_aktual)}% dari nilai jual). `
      + `Menurut patokan HPP di sheet, untungnya seharusnya ${rp(margin_perkiraan)} (${pct(margin_perkiraan)}%).`);
    const sm = margin_aktual - margin_perkiraan;
    if (Math.abs(sm) >= AMBANG_PENYEBAB) {
      kalimat.push(sm > 0
        ? `Biaya produksi ${rp(sm)} lebih hemat dari patokan HPP, jadi untung bertambah ${rp(sm)} dari perkiraan.`
        : `Biaya produksi ${rp(sm)} lebih boros dari patokan HPP, jadi untung berkurang ${rp(sm)} dari perkiraan.`);
    } else {
      kalimat.push('Biaya produksi sesuai patokan HPP, untung sesuai perkiraan.');
    }
  } else {
    kalimat.push('Harga jual belum diset — untung/rugi belum bisa dihitung.');
  }
  if (top.length) {
    kalimat.push('Penyebab terbesar: ' + top.map(x => x.nominal > 0
      ? `${x.nama} lebih mahal ${rp(x.nominal)} dari HPP`
      : `${x.nama} lebih murah ${rp(x.nominal)} dari HPP`).join('; ') + '.');
  }
  if (peringatan === 'rugi') kalimat.push('⚠ PO ini rugi.');
  if (peringatan === 'turun') kalimat.push(`⚠ Margin turun ${Math.round(turun * 100)}% dari perkiraan (batas ${BATAS_TURUN_MARGIN * 100}%).`);
  if (kurang_potong_pcs > 0) kalimat.push(`Kurang potong ${kurang_potong_pcs.toLocaleString('id-ID')} pcs dari pesanan — potensi nilai jual ${rp(kurang_potong_nilai)} tidak tertagih.`);
  if (lebih_potong_pcs > 0) kalimat.push(`Lebih potong ${lebih_potong_pcs.toLocaleString('id-ID')} pcs dari pesanan.`);
  if (p.qty.some(q => q.tanda === 'proses')) kalimat.push('Sebagian barang belum dipotong — qty belum final.');
  if (p.sementara) kalimat.push('Angka sementara: masih ada biaya perkiraan / overhead bulan berjalan.');

  return {
    nilai_jual: p.nilai_jual, margin_perkiraan, margin_aktual,
    margin_perkiraan_pct: pct(margin_perkiraan), margin_aktual_pct: pct(margin_aktual),
    selisih_margin: margin_aktual - margin_perkiraan, beda_tarif, selisih_murni,
    penyebab: top, peringatan, turun_pct: Math.round(turun * 100),
    kurang_potong_pcs, kurang_potong_nilai, lebih_potong_pcs, sementara: p.sementara, kalimat,
  };
}
