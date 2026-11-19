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
  /** Rincian HPP vs aktual (baris bisa di-klik); upah & biaya lain tidak punya rincian */
  rincian?: RincianKomponen;
}

export interface BarisRincian {
  nama: string;
  /** Patokan HPP (null = tidak bisa dipisah per baris) */
  perkiraan: number | null;
  aktual: number;
  catatan: string | null;
  /** Asal biaya aktual (mis. sub-kelompok Buku Kas) */
  anak?: { nama: string; nominal: number }[];
}

export interface RincianKomponen {
  /** Kalimat penjelasan kenapa hemat / boros */
  kalimat: string[];
  baris: BarisRincian[];
}

/** Overhead aktual satu PO per asal biaya (sub-kelompok Buku Kas / kontrak) → jenis HPP */
export interface OverheadRinci {
  kunci: string;
  label: string;
  /** hpp_komponen overhead (Listrik / Makan / Operasional / Sewa Rumah) */
  jenis_id: string;
  jenis: string;
  nominal: number;
  langsung: boolean;
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
  /** po → overhead aktual per asal biaya (jumlahnya = overhead) */
  overheadRinci?: Map<string, OverheadRinci[]>;
  /** get_laporan_po_kain: per PO × bahan, patokan vs terpakai */
  kain?: any[];
}

const rpR = (n: number) => 'Rp ' + Math.round(Math.abs(n)).toLocaleString('id-ID');
const angka = (n: number, d = 2) => n.toLocaleString('id-ID', { maximumFractionDigits: d });
const hb = (n: number) => (n > 0 ? 'boros' : 'hemat');
/** Batas selisih yang disebut di kalimat penjelasan */
const AMBANG_RINCI = 500;

export function susunKomponen(s: SumberKomponen): Map<string, BarisKomponen[]> {
  type Acc = { grup: GrupKomponen; nama: string; ket: Set<string>; perkiraan: number; aktual: number; sisa: number;
               qty: number; qtyTunggu: number; beda: number; qtyHpp: number;
               item: Map<string, { qty: number; tunggu: number; nominal: number }>;
               ohJenis: Map<string, { nama: string; perkiraan: number }> };
  const perPo = new Map<string, Map<string, Acc>>();
  const ambil = (po: string, kunci: string, grup: GrupKomponen, nama: string): Acc => {
    const m = perPo.get(po) ?? new Map<string, Acc>();
    perPo.set(po, m);
    let a = m.get(kunci);
    if (!a) {
      a = { grup, nama, ket: new Set(), perkiraan: 0, aktual: 0, sisa: 0, qty: 0, qtyTunggu: 0, beda: 0, qtyHpp: 0,
            item: new Map(), ohJenis: new Map() };
      m.set(kunci, a);
    }
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
      const j = String(r.komponen_id);
      const cur = a.ohJenis.get(j) ?? { nama, perkiraan: 0 };
      cur.perkiraan += perk; a.ohJenis.set(j, cur);
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
    a.perkiraan += perk; a.sisa += sisa; a.qtyHpp += Number(r.qty_hpp ?? 0);
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
      const it = a.item.get(String(r.kunci)) ?? { qty: 0, tunggu: 0, nominal: 0 };
      it.qty += Number(r.qty); it.tunggu += Number(r.qty_tunggu); it.nominal += n;
      a.item.set(String(r.kunci), it);
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
  const pembantuRinci = new Map<string, { pcs: number; jatah: number; pakai: number; lama: number }>();
  s.pembantu.forEach(r => {
    const po = String(r.po_id), j = String(r.jenis_id);
    const a = ambil(po, `pembantu:${j}`, 'pembantu', s.namaJenis.get(j) ?? 'Bahan pembantu');
    a.aktual += Number(r.pakai ?? 0);
    hematPembantu.set(`${po}|${j}`, (hematPembantu.get(`${po}|${j}`) ?? 0) + Number(r.hemat ?? 0));
    const cur = pembantuRinci.get(`${po}|${j}`) ?? { pcs: 0, jatah: 0, pakai: 0, lama: 0 };
    cur.pcs += Number(r.pcs ?? 0); cur.jatah += Number(r.jatah ?? 0);
    cur.pakai += Number(r.pakai ?? 0); cur.lama += Number(r.pakai_lama ?? 0);
    pembantuRinci.set(`${po}|${j}`, cur);
  });
  const kainPo = new Map<string, any[]>();
  (s.kain ?? []).forEach(r => kainPo.set(String(r.po_id), [...(kainPo.get(String(r.po_id)) ?? []), r]));

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
      const selisih = a.aktual + sisa - perkiraan;
      let rincian: RincianKomponen | undefined;
      if (a.grup === 'overhead') rincian = rinciOverhead(a, s.overheadRinci?.get(po) ?? [], packingBelum);
      else if (a.grup === 'bahan') rincian = rinciKain(kainPo.get(po) ?? [], selisih);
      else if (a.grup === 'aksesori') rincian = rinciAksesori(a, sisa);
      else if (a.grup === 'pembantu') {
        const j = kunci.slice('pembantu:'.length);
        rincian = rinciPembantu(a, pembantuRinci.get(`${po}|${j}`), hematPembantu.get(`${po}|${j}`) ?? 0, sisa);
      }
      return {
        grup: a.grup, nama: a.nama, keterangan: ket.length ? ket.join(' · ') : null,
        perkiraan, aktual: a.aktual, sisa, selisih,
        beda_tarif: 0, tanda, ...(rincian ? { rincian } : {}),
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

// ─── Rincian per komponen ────────────────────────────────────────────────────

type AccRinci = {
  nama: string; perkiraan: number; aktual: number; sisa: number; qty: number; qtyTunggu: number; qtyHpp: number;
  item: Map<string, { qty: number; tunggu: number; nominal: number }>;
  ohJenis: Map<string, { nama: string; perkiraan: number }>;
};

/** Overhead: patokan HPP vs bagian PO per jenis (Listrik / Makan / Operasional / Sewa Rumah) */
function rinciOverhead(a: AccRinci, rinci: OverheadRinci[], berjalan: boolean): RincianKomponen {
  const jenis = new Map<string, { nama: string; perkiraan: number; aktual: number; anak: Map<string, number> }>();
  a.ohJenis.forEach((v, id) => jenis.set(id, { nama: v.nama, perkiraan: v.perkiraan, aktual: 0, anak: new Map() }));
  rinci.forEach(r => {
    const cur = jenis.get(r.jenis_id) ?? { nama: r.jenis, perkiraan: 0, aktual: 0, anak: new Map<string, number>() };
    cur.aktual += r.nominal;
    const label = r.langsung ? `${r.label} (khusus PO ini)` : r.label;
    cur.anak.set(label, (cur.anak.get(label) ?? 0) + r.nominal);
    jenis.set(r.jenis_id, cur);
  });
  const baris: BarisRincian[] = [...jenis.values()].map(j => {
    const sel = j.aktual - j.perkiraan;
    const catatan = j.aktual < 1 && j.perkiraan > 0
      ? `Belum ada biaya ${j.nama} tercatat selama PO ini dikerjakan (mis. tagihan belum dibayar / belum diinput)`
      : j.perkiraan <= 0 ? `Tidak ada patokan ${j.nama} di HPP sheet`
      : Math.abs(sel) >= AMBANG_RINCI ? `${hb(sel)} ${rpR(sel)}` : 'sesuai patokan';
    const anak = [...j.anak.entries()].filter(([, n]) => Math.abs(n) >= 1)
      .map(([nama, nominal]) => ({ nama, nominal })).sort((x, y) => y.nominal - x.nominal);
    return { nama: j.nama, perkiraan: j.perkiraan, aktual: j.aktual, catatan, anak };
  }).sort((x, y) => (y.perkiraan ?? 0) - (x.perkiraan ?? 0));

  const kalimat = ['Biaya overhead (makan, listrik, operasional, sewa) dibagi tiap hari ke semua barang yang sedang '
    + 'dikerjakan (selesai cutting s/d selesai packing). Di bawah: patokan HPP vs bagian PO ini per jenis biaya.'];
  const beda = (b: BarisRincian) => b.aktual - (b.perkiraan ?? 0);
  baris.filter(b => Math.abs(beda(b)) >= AMBANG_RINCI)
    .sort((x, y) => Math.abs(beda(y)) - Math.abs(beda(x)))
    .slice(0, 3).forEach(b => {
      const sel = beda(b);
      const asal = b.anak?.[0];
      kalimat.push(`${b.nama}: patokan ${rpR(b.perkiraan ?? 0)}, bagian PO ini ${rpR(b.aktual)} → ${hb(sel)} ${rpR(sel)}`
        + (b.aktual < 1 ? ' (belum ada biaya tercatat).'
          : sel < 0 && b.aktual < 0.3 * (b.perkiraan ?? 0) ? ' (jauh di bawah patokan — mungkin tagihan/pembayaran belum diinput).'
          : sel > 0 && asal && (b.anak?.length ?? 0) > 1 ? ` (terbesar dari ${asal.nama} ${rpR(asal.nominal)}).` : '.'));
    });
  kalimat.push(berjalan
    ? 'PO masih dikerjakan — bagian overhead masih bertambah sampai packing selesai.'
    : 'Angka bulan berjalan masih sementara sampai bulan tutup.');
  return { kalimat, baris };
}

/** Kain: per bahan × warna — pemakaian vs patokan & harga beli vs harga HPP */
function rinciKain(rows: any[], selisih: number): RincianKomponen {
  let efekPakai = 0, efekHarga = 0, lebih = 0;
  const satuan = new Set<string>();
  const baris: BarisRincian[] = rows.map(r => {
    const qp = Number(r.qty_patokan), qa = Number(r.qty_pakai), nh = Number(r.nilai_hpp), na = Number(r.nilai_aktual);
    const pcs = Number(r.pcs);
    if (!r.bahan) {
      return { nama: 'Belum tercatat pemakaiannya', perkiraan: nh, aktual: na,
        catatan: `${angka(pcs, 0)} pcs sudah dipotong tanpa catatan pemakaian bahan` };
    }
    const sat = String(r.satuan ?? '');
    satuan.add(sat);
    const hh = qp > 0 ? nh / qp : 0, ha = qa > 0 ? na / qa : 0;
    const bag: string[] = [`${angka(pcs, 0)} pcs`];
    if (qp > 0) {
      const d = qa - qp;
      bag.push(`patokan ${angka(qp)} ${sat} → terpakai ${angka(qa)} ${sat}`
        + (Math.abs(d) >= 0.005 ? ` (${d > 0 ? 'boros' : 'irit'} ${angka(Math.abs(d))} ${sat})` : ' (pas)'));
      bag.push(`harga HPP ${rpR(hh)}/${sat} vs harga beli ${rpR(ha)}/${sat}`);
      efekPakai += d * hh; efekHarga += qa * (ha - hh); lebih += d;
    } else {
      bag.push(`terpakai ${angka(qa)} ${sat} · patokan pemakaian belum ada`);
    }
    return { nama: String(r.bahan), perkiraan: nh, aktual: na, catatan: bag.join(' · ') };
  }).sort((x, y) => (y.perkiraan ?? 0) - (x.perkiraan ?? 0));

  const sat = satuan.size === 1 ? [...satuan][0] : 'satuan';
  const kalimat = [Math.abs(selisih) < AMBANG_RINCI ? 'Biaya kain sesuai patokan HPP.'
    : `Kain ${hb(selisih)} ${rpR(selisih)} dibanding patokan HPP.`];
  if (Math.abs(efekPakai) >= AMBANG_RINCI)
    kalimat.push(`Pemakaian ${efekPakai > 0 ? 'lebih boros' : 'lebih irit'} ${angka(Math.abs(lebih))} ${sat} dari patokan → ${hb(efekPakai)} ${rpR(efekPakai)}.`);
  if (Math.abs(efekHarga) >= AMBANG_RINCI)
    kalimat.push(`Harga beli kain ${efekHarga > 0 ? 'lebih mahal' : 'lebih murah'} dari harga di HPP → ${hb(efekHarga)} ${rpR(efekHarga)}.`);
  return { kalimat, baris };
}

/** Aksesori: qty HPP vs qty terpakai & harga beli vs harga HPP */
function rinciAksesori(a: AccRinci, sisa: number): RincianKomponen {
  const tercatat = a.perkiraan > 0 ? Math.max(0, (a.perkiraan - a.sisa) / a.perkiraan) : 0;
  const qtyHppCatat = a.qtyHpp * tercatat;
  const hh = a.qtyHpp > 0 ? a.perkiraan / a.qtyHpp : 0;
  const qtyHarga = a.qty - a.qtyTunggu;
  const ha = qtyHarga > 0 ? a.aktual / qtyHarga : 0;
  const efekQty = (a.qty - qtyHppCatat) * hh;
  const efekHarga = qtyHarga > 0 ? qtyHarga * (ha - hh) : 0;
  const sel = a.aktual + sisa - a.perkiraan;

  const baris: BarisRincian[] = [...a.item.entries()].map(([nama, it]) => ({
    nama, perkiraan: a.item.size === 1 ? a.perkiraan - a.sisa : null, aktual: it.nominal,
    catatan: `terpakai ${angka(it.qty)}`
      + (it.qty - it.tunggu > 0 ? ` × rata-rata ${rpR(it.nominal / (it.qty - it.tunggu))}` : '')
      + (it.tunggu > 0 ? ` · ${angka(it.tunggu)} menunggu harga` : ''),
  }));
  if (a.sisa > 0.5) baris.push({ nama: 'Pcs belum dipasang', perkiraan: a.sisa, aktual: 0, catatan: 'masih perkiraan (sisa)' });

  const kalimat: string[] = [];
  if (a.qtyHpp > 0) kalimat.push(`Patokan HPP: ${angka(a.qtyHpp)} × ${rpR(hh)} = ${rpR(a.perkiraan)}.`
    + (a.qty > 0 ? ` Tercatat terpakai ${angka(a.qty)} (patokan untuk pcs yang sudah dipasang ${angka(qtyHppCatat)}).` : ''));
  if (Math.abs(sel) < AMBANG_RINCI) kalimat.push(`${a.nama} sesuai patokan HPP.`);
  else {
    if (Math.abs(efekQty) >= AMBANG_RINCI) kalimat.push(`Jumlah terpakai ${efekQty > 0 ? 'lebih banyak' : 'lebih sedikit'} dari patokan → ${hb(efekQty)} ${rpR(efekQty)}.`);
    if (Math.abs(efekHarga) >= AMBANG_RINCI) kalimat.push(`Harga beli ${efekHarga > 0 ? 'lebih mahal' : 'lebih murah'} (rata-rata ${rpR(ha)} vs HPP ${rpR(hh)}) → ${hb(efekHarga)} ${rpR(efekHarga)}.`);
  }
  if (a.qtyTunggu > 0) kalimat.push(`${angka(a.qtyTunggu)} masih menunggu harga (stok belum masuk) — dihitung perkiraan dulu.`);
  return { kalimat, baris };
}

/** Bahan pembantu: jatah HPP (pcs selesai jahit) vs terpakai dari saldo */
function rinciPembantu(a: AccRinci, p: { pcs: number; jatah: number; pakai: number; lama: number } | undefined,
                       hemat: number, sisa: number): RincianKomponen {
  const baris: BarisRincian[] = [];
  if (p) {
    const anak = [
      { nama: 'Dari barang lama (setoran modal)', nominal: p.lama },
      { nama: 'Dari belanja', nominal: p.pakai - p.lama },
    ].filter(x => Math.abs(x.nominal) >= 1);
    baris.push({ nama: `Sudah dijahit (${angka(p.pcs, 0)} pcs)`, perkiraan: p.jatah, aktual: p.pakai,
      catatan: hemat > 0.5 ? `saldo di rak tidak cukup → hemat ${rpR(hemat)}` : 'diambil penuh dari saldo', anak });
  }
  if (sisa > 0.5) baris.push({ nama: 'Belum dijahit', perkiraan: sisa, aktual: 0, catatan: 'masih perkiraan (sisa)' });
  const kalimat = [`Biaya ${a.nama} = jatah HPP per pcs yang selesai jahit, diambil dari Saldo Bahan Pembantu.`];
  if (hemat > 0.5) kalimat.push(`Saldo ${a.nama} kurang saat dipakai, jadi ${rpR(hemat)} tidak menjadi biaya (penghematan).`);
  else if (p) kalimat.push('Semua jatah tertutup saldo — biaya sama dengan patokan HPP.');
  return { kalimat, baris };
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
      + `Menurut patokan HPP di sheet, seharusnya ${margin_perkiraan >= 0 ? 'untung' : 'rugi'} ${rp(margin_perkiraan)} (${pct(margin_perkiraan)}%)`
      + (margin_perkiraan < 0 ? ' — harga jual di bawah HPP.' : '.'));
    const sm = margin_aktual - margin_perkiraan;
    if (Math.abs(sm) >= AMBANG_PENYEBAB) {
      // Akibat pada untung/rugi bergantung tanda margin sebelum & sesudah (harga jual bisa di bawah HPP)
      const akibat = sm > 0
        ? (margin_perkiraan >= 0 ? `untung bertambah ${rp(sm)}`
          : margin_aktual < 0 ? `rugi berkurang ${rp(sm)}`
          : 'yang seharusnya rugi berbalik jadi untung')
        : (margin_aktual >= 0 ? `untung berkurang ${rp(sm)}`
          : margin_perkiraan < 0 ? `rugi bertambah ${rp(sm)}`
          : 'yang seharusnya untung berbalik jadi rugi');
      kalimat.push(`Biaya produksi ${rp(sm)} lebih ${sm > 0 ? 'hemat' : 'boros'} dari patokan HPP, jadi ${akibat} dibanding perkiraan.`);
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
