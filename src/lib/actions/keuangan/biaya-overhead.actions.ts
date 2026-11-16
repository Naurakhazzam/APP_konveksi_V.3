'use server';
/* eslint-disable @typescript-eslint/no-explicit-any */

import { createClient } from '@/lib/supabase/server';
import { getCurrentUserProfile } from '@/lib/auth/permissions';
import { revalidatePath } from 'next/cache';
import { PO_AWAL_PERIODE, TANGGAL_AWAL_PERIODE, batasAwalPeriode } from '@/lib/keuangan/periode-po';
import { getBukuKasEntries, getOverheadSub } from './buku-kas.actions';
import type { BukuKasEntry, OverheadSubOption } from './buku-kas.types';

const TENANT_ID = 'STX-001';

export interface OverheadSubRealisasi {
  sub_id: string | null;
  nama: string;
  realisasi: number;
}

export interface OverheadKomponen {
  komponen_id: string;
  nama: string;
  /** Tarif overhead HPP × pcs terkirim */
  patokan: number;
  /** Uang keluar dari Buku Kas (sub-kelompok yang tertaut komponen ini) */
  realisasi: number;
  subs: OverheadSubRealisasi[];
}

export interface OverheadTrenBulan {
  bulan: string;       // 'YYYY-MM'
  label: string;       // 'Nov 26'
  patokan: number;
  realisasi: number;
  pcs: number;
}

/** Biaya tetap berbasis kontrak, dialokasikan per hari */
export interface BiayaTetap {
  id: string;
  nama: string;
  overhead_sub_id: string;
  sub_nama: string;
  nominal: number;
  tanggal_mulai: string;
  tanggal_selesai: string;
  catatan: string | null;
  jumlah_hari: number;
  per_hari: number;
  /** Hari kontrak yang masuk rentang laporan & alokasinya */
  hari_dalam_rentang: number;
  alokasi_rentang: number;
}

export interface BiayaTetapInput {
  nama: string;
  overhead_sub_id: string;
  nominal: number;
  tanggal_mulai: string;
  tanggal_selesai: string;
  catatan?: string | null;
}

export interface BiayaOverheadData {
  dari: string;
  sampai: string;
  hanyaPeriodeBaru: boolean;
  pcsTerkirim: number;
  totalPatokan: number;
  totalRealisasiHpp: number;
  komponen: OverheadKomponen[];
  /** Overhead yang tidak ditanggung komponen HPP mana pun (termasuk tanpa sub-kelompok) */
  luarHpp: OverheadSubRealisasi[];
  /** Biaya Operasional & Lainnya — komponennya ditentukan user per kasus */
  lain: { kategori: string; nominal: number }[];
  tren: OverheadTrenBulan[];
  /** Transaksi Buku Kas pada rentang (overhead, operasional, lainnya) untuk rincian */
  transaksi: BukuKasEntry[];
  /** Entri overhead sejak awal periode baru (14 Nov 2026) yang belum punya sub-kelompok */
  tanpaSub: BukuKasEntry[];
  subList: OverheadSubOption[];
  biayaTetap: BiayaTetap[];
}

const HARI_MS = 86_400_000;
/** Selisih hari inklusif antara dua tanggal 'YYYY-MM-DD' (tanpa geser zona waktu) */
const hariInklusif = (a: string, b: string) =>
  Math.round((Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10)) -
              Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10))) / HARI_MS) + 1;

async function ambilBiayaTetap(dari: string, sampai: string): Promise<BiayaTetap[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('biaya_tetap')
    .select('id, nama, overhead_sub_id, nominal, tanggal_mulai, tanggal_selesai, catatan, overhead_sub:overhead_sub_id(nama)')
    .eq('tenant_id', TENANT_ID)
    .order('tanggal_mulai', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((b: any) => {
    const jumlah_hari = hariInklusif(b.tanggal_mulai, b.tanggal_selesai);
    const per_hari = Number(b.nominal) / jumlah_hari;
    const awal = b.tanggal_mulai > dari ? b.tanggal_mulai : dari;
    const akhir = b.tanggal_selesai < sampai ? b.tanggal_selesai : sampai;
    const hari_dalam_rentang = akhir >= awal ? hariInklusif(awal, akhir) : 0;
    const sub = Array.isArray(b.overhead_sub) ? b.overhead_sub[0] : b.overhead_sub;
    return {
      id: b.id, nama: b.nama, overhead_sub_id: b.overhead_sub_id, sub_nama: sub?.nama ?? '-',
      nominal: Number(b.nominal), tanggal_mulai: b.tanggal_mulai, tanggal_selesai: b.tanggal_selesai,
      catatan: b.catatan ?? null, jumlah_hari, per_hari,
      hari_dalam_rentang, alokasi_rentang: per_hari * hari_dalam_rentang,
    };
  });
}

/** Tambah (tanpa id) atau ubah biaya tetap — owner saja */
export async function simpanBiayaTetap(
  input: BiayaTetapInput, id?: string
): Promise<{ success: boolean; error?: string }> {
  const profile = await getCurrentUserProfile();
  if (!profile) return { success: false, error: 'Unauthorized.' };
  if (profile.role !== 'owner') return { success: false, error: 'Hanya owner yang dapat mengatur biaya tetap.' };
  const nama = input.nama?.trim();
  if (!nama) return { success: false, error: 'Nama tidak boleh kosong.' };
  if (!input.overhead_sub_id) return { success: false, error: 'Pilih sub-kelompok overhead.' };
  if (!input.nominal || input.nominal <= 0) return { success: false, error: 'Nilai kontrak harus lebih dari 0.' };
  if (!input.tanggal_mulai || !input.tanggal_selesai) return { success: false, error: 'Isi tanggal mulai dan selesai.' };
  if (input.tanggal_selesai < input.tanggal_mulai) return { success: false, error: 'Tanggal selesai tidak boleh sebelum tanggal mulai.' };

  const row = {
    nama, overhead_sub_id: input.overhead_sub_id, nominal: input.nominal,
    tanggal_mulai: input.tanggal_mulai, tanggal_selesai: input.tanggal_selesai,
    catatan: input.catatan?.trim() || null,
  };
  const supabase = await createClient();
  const { error } = id
    ? await supabase.from('biaya_tetap').update(row).eq('id', id).eq('tenant_id', TENANT_ID)
    : await supabase.from('biaya_tetap').insert({ ...row, tenant_id: TENANT_ID });
  if (error) return { success: false, error: error.message };
  revalidatePath('/app/keuangan/biaya-overhead');
  return { success: true };
}

export async function hapusBiayaTetap(id: string): Promise<{ success: boolean; error?: string }> {
  const profile = await getCurrentUserProfile();
  if (!profile) return { success: false, error: 'Unauthorized.' };
  if (profile.role !== 'owner') return { success: false, error: 'Hanya owner yang dapat menghapus.' };
  const supabase = await createClient();
  const { error } = await supabase.from('biaya_tetap').delete().eq('id', id).eq('tenant_id', TENANT_ID);
  if (error) return { success: false, error: error.message };
  revalidatePath('/app/keuangan/biaya-overhead');
  return { success: true };
}

type Baris = {
  bulan: string; jenis: 'realisasi' | 'lain' | 'patokan' | 'pcs';
  komponen_id: string | null; komponen_nama: string | null;
  sub_id: string | null; sub_nama: string | null;
  kategori: string | null; nominal: number | null; pcs: number | null;
};

const BULAN_PENDEK = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
const KATEGORI_TAMPIL = ['Biaya Overhead', 'Biaya Operasional', 'Lainnya'];

const iso = (y: number, m: number, d: number) =>
  `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

async function ambil(dari: string, sampai: string, poMulai: number | null): Promise<Baris[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('get_biaya_overhead', {
    p_tenant_id: TENANT_ID, p_dari: dari, p_sampai: sampai, p_po_mulai: poMulai,
  });
  if (error) throw new Error(error.message);
  return ((data ?? []) as any[]).map(r => ({
    ...r,
    nominal: r.nominal == null ? null : Number(r.nominal),
    pcs: r.pcs == null ? null : Number(r.pcs),
  }));
}

export async function getBiayaOverhead(opts: {
  dari: string; sampai: string; hanyaPeriodeBaru?: boolean;
}): Promise<BiayaOverheadData> {
  const { dari, sampai } = opts;
  const hanyaPeriodeBaru = opts.hanyaPeriodeBaru ?? true;
  const poMulai = hanyaPeriodeBaru ? PO_AWAL_PERIODE : null;
  // Periode baru: transaksi sebelum TANGGAL_AWAL_PERIODE tidak ditampilkan; sewa dihitung sejak awal bulan periode
  const dariKas = hanyaPeriodeBaru ? batasAwalPeriode(dari) : dari;
  const awalBulanPeriode = TANGGAL_AWAL_PERIODE.slice(0, 7) + '-01';
  const dariSewa = hanyaPeriodeBaru && dari < awalBulanPeriode ? awalBulanPeriode : dari;

  // Tren: 6 bulan kalender yang berakhir di bulan "sampai"
  const [ys, ms] = sampai.split('-').map(Number);
  const awalTren = new Date(ys, ms - 6, 1);
  const trenDari = iso(awalTren.getFullYear(), awalTren.getMonth() + 1, 1);
  const trenSampai = iso(ys, ms, new Date(ys, ms, 0).getDate());

  const supabase = await createClient();
  const [rows, rowsTren, transaksiSemua, subList, komponenRes, tanpaSubRes, biayaTetap] = await Promise.all([
    ambil(dari, sampai, poMulai),
    ambil(trenDari, trenSampai, poMulai),
    getBukuKasEntries({ dari: dariKas, sampai, tipe: 'keluar' }),
    getOverheadSub(),
    supabase.from('hpp_komponen').select('id, nama').eq('tenant_id', TENANT_ID).eq('kategori', 'overhead').order('nama'),
    supabase.from('buku_kas').select('id').eq('tenant_id', TENANT_ID)
      .eq('tipe', 'keluar').eq('kategori', 'Biaya Overhead').is('overhead_sub_id', null)
      .gte('tanggal', TANGGAL_AWAL_PERIODE),
    ambilBiayaTetap(dariSewa, sampai),
  ]);
  if (komponenRes.error) throw new Error(komponenRes.error.message);

  // ── Per komponen HPP ──
  const komponen = new Map<string, OverheadKomponen>();
  (komponenRes.data ?? []).forEach(k =>
    komponen.set(k.id, { komponen_id: k.id, nama: k.nama, patokan: 0, realisasi: 0, subs: [] }));
  const luarHpp = new Map<string, OverheadSubRealisasi>();
  const lain = new Map<string, number>();
  let pcsTerkirim = 0;

  rows.forEach(r => {
    const n = r.nominal ?? 0;
    if (r.jenis === 'pcs') { pcsTerkirim += r.pcs ?? 0; return; }
    if (r.jenis === 'lain') { lain.set(r.kategori ?? 'Lainnya', (lain.get(r.kategori ?? 'Lainnya') ?? 0) + n); return; }
    if (r.jenis === 'patokan' && r.komponen_id) {
      const k = komponen.get(r.komponen_id);
      if (k) k.patokan += n;
      return;
    }
    if (r.jenis === 'realisasi') {
      const k = r.komponen_id ? komponen.get(r.komponen_id) : undefined;
      const namaSub = r.sub_nama ?? 'Tanpa sub-kelompok';
      const tujuan = k ? k.subs : null;
      if (k && tujuan) {
        k.realisasi += n;
        const s = tujuan.find(x => x.sub_id === r.sub_id);
        if (s) s.realisasi += n; else tujuan.push({ sub_id: r.sub_id, nama: namaSub, realisasi: n });
      } else {
        const key = r.sub_id ?? '-';
        const s = luarHpp.get(key);
        if (s) s.realisasi += n; else luarHpp.set(key, { sub_id: r.sub_id, nama: namaSub, realisasi: n });
      }
    }
  });

  const daftarKomponen = [...komponen.values()]
    .map(k => ({ ...k, subs: k.subs.sort((a, b) => b.realisasi - a.realisasi) }))
    .sort((a, b) => b.patokan - a.patokan);

  // ── Tren 6 bulan ──
  const tren: OverheadTrenBulan[] = [];
  for (let i = 0; i < 6; i++) {
    const d = new Date(awalTren.getFullYear(), awalTren.getMonth() + i, 1);
    const bulan = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    tren.push({ bulan, label: `${BULAN_PENDEK[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`, patokan: 0, realisasi: 0, pcs: 0 });
  }
  rowsTren.forEach(r => {
    const t = tren.find(x => x.bulan === r.bulan);
    if (!t) return;
    if (r.jenis === 'patokan') t.patokan += r.nominal ?? 0;
    else if (r.jenis === 'realisasi') t.realisasi += r.nominal ?? 0;
    else if (r.jenis === 'pcs') t.pcs += r.pcs ?? 0;
  });

  // ── Transaksi & entri tanpa sub-kelompok ──
  const transaksi = transaksiSemua.filter(e => KATEGORI_TAMPIL.includes(e.kategori));
  let tanpaSub: BukuKasEntry[] = [];
  const idTanpaSub = (tanpaSubRes.data ?? []).map(r => r.id as string);
  if (idTanpaSub.length) {
    const semua = await getBukuKasEntries({ tipe: 'keluar' });
    const set = new Set(idTanpaSub);
    tanpaSub = semua.filter(e => set.has(e.id));
  }

  return {
    dari, sampai, hanyaPeriodeBaru, pcsTerkirim,
    totalPatokan: daftarKomponen.reduce((s, k) => s + k.patokan, 0),
    totalRealisasiHpp: daftarKomponen.reduce((s, k) => s + k.realisasi, 0),
    komponen: daftarKomponen,
    luarHpp: [...luarHpp.values()].sort((a, b) => b.realisasi - a.realisasi),
    lain: [...lain.entries()].map(([kategori, nominal]) => ({ kategori, nominal })).sort((a, b) => b.nominal - a.nominal),
    tren,
    transaksi,
    tanpaSub,
    subList,
    biayaTetap,
  };
}

/** Pasang sub-kelompok pada entri overhead lama (owner saja) */
export async function aturSubOverhead(
  bukuKasId: string, subId: string
): Promise<{ success: boolean; error?: string }> {
  const profile = await getCurrentUserProfile();
  if (!profile) return { success: false, error: 'Unauthorized.' };
  if (profile.role !== 'owner') return { success: false, error: 'Hanya owner yang dapat mengubah.' };

  const supabase = await createClient();
  const { error } = await supabase.rpc('atur_sub_overhead', {
    p_buku_kas_id: bukuKasId, p_sub_id: subId, p_tenant_id: TENANT_ID,
  });
  if (error) return { success: false, error: error.message };
  revalidatePath('/app/keuangan/biaya-overhead');
  revalidatePath('/app/keuangan/buku-kas');
  return { success: true };
}
