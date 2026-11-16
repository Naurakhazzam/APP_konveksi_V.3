'use server';
/* eslint-disable @typescript-eslint/no-explicit-any */

import { createClient } from '@/lib/supabase/server';
import { PO_AWAL_PERIODE, TANGGAL_AWAL_PERIODE } from '@/lib/keuangan/periode-po';
import { KATEGORI_SETORAN_MODAL } from './buku-kas.types';
import { bulanBerjalan } from '@/lib/bulan-berjalan';

const TENANT_ID = 'STX-001';

/** Kategori Buku Kas keluar yang dibagi rata per pcs ke tiap PO (bukan kain & bukan upah borongan) */
const KATEGORI_DIBAGI = ['Biaya Overhead', 'Bahan Pembantu', 'Biaya Operasional', 'Biaya Peralatan', 'Lainnya'];

export interface ProyeksiPO {
  po_id: string;
  no_po: string;
  klien: string;
  pcs: number;
  nilai_jual: number;
  kain: number;
  aksesori: number;
  upah_lunas: number;
  upah_belum_lunas: number;
  upah_sisa: number;
  /** Bagian overhead + bahan pembantu + lainnya (uang Buku Kas) menurut porsi pcs */
  alokasi: number;
  surplus: number;
}

export interface ProyeksiSurplusData {
  sejak: string;
  /** Uang masuk Buku Kas per kategori, tanpa setoran modal */
  masuk: { kategori: string; nominal: number }[];
  setoranModal: number;
  keluar: { kategori: string; nominal: number }[];
  /** Alokasi harian biaya tetap (kontrak) dari awal bulan periode s/d akhir bulan berjalan */
  biayaTetap: { nama: string; hari: number; perHari: number; nominal: number }[];
  totalBiayaTetap: number;
  biayaTetapDari: string;
  biayaTetapSampai: string;
  totalNilaiJual: number;
  upahBelumLunas: number;
  upahSisa: number;
  /** Bahan utama yang sudah dibeli tapi belum terpakai (LOT qty_sisa × harga) */
  stokTersisa: number;
  stokTersisaRinci: { nama: string; qty: number; satuan: string; nilai: number }[];
  po: ProyeksiPO[];
}

/** Selisih hari inklusif antara dua tanggal 'YYYY-MM-DD' */
const hariInklusif = (a: string, b: string) =>
  Math.round((Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10)) -
              Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10))) / 86_400_000) + 1;

const kelompok = (rows: any[]) => {
  const m = new Map<string, number>();
  rows.forEach(r => m.set(r.kategori ?? 'Lainnya', (m.get(r.kategori ?? 'Lainnya') ?? 0) + Number(r.nominal ?? 0)));
  return [...m.entries()].map(([kategori, nominal]) => ({ kategori, nominal })).sort((a, b) => b.nominal - a.nominal);
};

export async function getProyeksiSurplus(): Promise<ProyeksiSurplusData> {
  const supabase = await createClient();

  const [poRes, kasRes, lotRes] = await Promise.all([
    supabase.rpc('get_proyeksi_surplus_po', { p_tenant_id: TENANT_ID, p_po_mulai: PO_AWAL_PERIODE }),
    supabase.from('buku_kas').select('tipe, kategori, nominal, overhead_sub_id')
      .eq('tenant_id', TENANT_ID).gte('tanggal', TANGGAL_AWAL_PERIODE),
    supabase.from('inventory_batch')
      .select('qty_sisa, harga_satuan, item:inventory_item_id(nama, satuan, jenis)')
      .eq('tenant_id', TENANT_ID).gt('qty_sisa', 0),
  ]);
  if (poRes.error) throw new Error(poRes.error.message);
  if (kasRes.error) throw new Error(kasRes.error.message);
  if (lotRes.error) throw new Error(lotRes.error.message);

  // Biaya tetap (kontrak). Pembayaran Buku Kas untuk sub-kelompok yang punya kontrak diganti alokasi
  // hariannya (sama seperti menu Biaya Overhead), supaya tidak terhitung dua kali.
  const { data: btData, error: btErr } = await supabase
    .from('biaya_tetap').select('nama, nominal, tanggal_mulai, tanggal_selesai, overhead_sub_id').eq('tenant_id', TENANT_ID);
  if (btErr) throw new Error(btErr.message);
  const subKontrak = new Set(((btData ?? []) as any[]).map(b => String(b.overhead_sub_id)));

  const kas = ((kasRes.data ?? []) as any[]).filter(k =>
    !(k.kategori === 'Biaya Overhead' && k.overhead_sub_id && subKontrak.has(String(k.overhead_sub_id))));
  const masukSemua = kas.filter(k => k.tipe === 'masuk');
  const setoranModal = masukSemua.filter(k => k.kategori === KATEGORI_SETORAN_MODAL)
    .reduce((s, k) => s + Number(k.nominal), 0);
  const masuk = kelompok(masukSemua.filter(k => k.kategori !== KATEGORI_SETORAN_MODAL));
  const keluar = kelompok(kas.filter(k => k.tipe === 'keluar'));

  // Alokasi harian biaya tetap dari awal bulan periode sampai akhir bulan berjalan
  const { bulan, tahun } = bulanBerjalan();
  const sewaDari = `${TANGGAL_AWAL_PERIODE.slice(0, 7)}-01`;
  const sewaSampai = `${tahun}-${bulan}-${String(new Date(Number(tahun), Number(bulan), 0).getDate()).padStart(2, '0')}`;
  const biayaTetap = ((btData ?? []) as any[]).map(b => {
    const perHari = Number(b.nominal) / hariInklusif(b.tanggal_mulai, b.tanggal_selesai);
    const awal = b.tanggal_mulai > sewaDari ? b.tanggal_mulai : sewaDari;
    const akhir = b.tanggal_selesai < sewaSampai ? b.tanggal_selesai : sewaSampai;
    const hari = akhir >= awal ? hariInklusif(awal, akhir) : 0;
    return { nama: b.nama as string, hari, perHari, nominal: perHari * hari };
  }).filter(b => b.hari > 0);
  const totalBiayaTetap = biayaTetap.reduce((s, b) => s + b.nominal, 0);

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
    kain: Number(r.biaya_kain), aksesori: Number(r.biaya_aksesori),
    upah_lunas: Number(r.upah_lunas), upah_belum_lunas: Number(r.upah_belum_lunas),
    upah_sisa: Number(r.upah_sisa),
  }));
  const totalPcs = raw.reduce((s, r) => s + r.pcs, 0);
  const po: ProyeksiPO[] = raw.map(r => {
    const alokasi = totalPcs > 0 ? poolDibagi * r.pcs / totalPcs : 0;
    return {
      ...r, alokasi,
      surplus: r.nilai_jual - r.kain - r.aksesori - r.upah_lunas - r.upah_belum_lunas - r.upah_sisa - alokasi,
    };
  });

  return {
    sejak: TANGGAL_AWAL_PERIODE,
    masuk, setoranModal, keluar,
    biayaTetap, totalBiayaTetap, biayaTetapDari: sewaDari, biayaTetapSampai: sewaSampai,
    totalNilaiJual: po.reduce((s, p) => s + p.nilai_jual, 0),
    upahBelumLunas: po.reduce((s, p) => s + p.upah_belum_lunas, 0),
    upahSisa: po.reduce((s, p) => s + p.upah_sisa, 0),
    stokTersisa: stokTersisaRinci.reduce((s, x) => s + x.nilai, 0),
    stokTersisaRinci,
    po,
  };
}
