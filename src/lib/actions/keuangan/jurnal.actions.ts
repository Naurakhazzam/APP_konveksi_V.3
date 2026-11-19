'use server';
/* eslint-disable @typescript-eslint/no-explicit-any */

import { createClient } from '@/lib/supabase/server';
import { PO_AWAL_PERIODE, TANGGAL_AWAL_PERIODE } from '@/lib/keuangan/periode-po';
import { hitungKinerja } from '@/lib/keuangan/kinerja.server';

const TENANT_ID = 'STX-001';

/**
 * Jurnal Produksi = laporan otomatis (read-only), dirangkai RPC get_jurnal_produksi dari sumber asli:
 * pemakaian kain cutting, pemakaian aksesori, jatah HPP bahan pembantu (Saldo Bahan Pembantu),
 * Buku Kas (overhead, beban operasional, belanja pembantu & pembelian bahan sebagai informasi),
 * gaji_ledger (upah) dan alokasi harian biaya tetap (s/d hari ini).
 * Bahan pembantu & pemisahan beban operasional mengikuti mesin Kinerja Keuangan (kinerja.server.ts).
 * Tabel jurnal_entry lama tidak lagi ditulis maupun dibaca di sini.
 */
export type JenisJurnal =
  | 'kain' | 'aksesori' | 'pembantu' | 'upah' | 'overhead' | 'biaya_tetap' | 'lainnya'
  | 'pembelian' | 'belanja_pembantu';

export interface JurnalBaris {
  tanggal: string;
  jenis: JenisJurnal;
  kategori: string;
  keterangan: string;
  no_po: string | null;
  qty: number | null;
  satuan: string | null;
  nominal: number;
  waktu: string | null;
}

/**
 * Baris penghubung Jurnal → Laba Rugi (Kinerja Keuangan) untuk bulan-bulan penuh di rentang terpilih:
 * biaya produksi terjadi − HPP barang terkirim − overhead tanpa produksi ≈ perubahan barang dalam proses.
 */
export interface PenghubungJurnal {
  bulan: string[];
  /** Bulan berjalan ikut → angka Kinerja masih sementara */
  sementara: boolean;
  hppBahan: number;
  hppUpah: number;
  hppOverhead: number;
  hpp: number;
  overheadTanpaProduksi: number;
  bebanOperasional: number;
}

export interface JurnalProduksiData {
  dari: string;
  sampai: string;
  hanyaPeriodeBaru: boolean;
  baris: JurnalBaris[];
  /** null + alasan bila rentang bukan bulan penuh / mencakup PO lama */
  penghubung: PenghubungJurnal | null;
  alasanTanpaPenghubung: string | null;
}

const akhirBulanDari = (ym: string) =>
  `${ym}-${String(new Date(+ym.slice(0, 4), +ym.slice(5, 7), 0).getDate()).padStart(2, '0')}`;

/** Bulan-bulan penuh di [dari, sampai]; null bila rentang tidak tepat awal & akhir bulan */
function bulanPenuh(dari: string, sampai: string): string[] | null {
  if (dari.slice(8) !== '01' || sampai !== akhirBulanDari(sampai.slice(0, 7))) return null;
  const hasil: string[] = [];
  let y = +dari.slice(0, 4), m = +dari.slice(5, 7);
  for (;;) {
    const ym = `${y}-${String(m).padStart(2, '0')}`;
    if (ym > sampai.slice(0, 7)) break;
    hasil.push(ym);
    if (++m > 12) { m = 1; y++; }
  }
  return hasil;
}

async function hitungPenghubung(supabase: any, dari: string, sampai: string, hanyaPeriodeBaru: boolean)
  : Promise<{ penghubung: PenghubungJurnal | null; alasan: string | null }> {
  if (!hanyaPeriodeBaru) return { penghubung: null, alasan: 'Penghubung ke Laba Rugi hanya untuk periode baru (tanpa PO lama).' };
  const bulan = bulanPenuh(dari, sampai);
  if (!bulan) return { penghubung: null, alasan: 'Penghubung ke Laba Rugi hanya muncul bila rentang tanggal = bulan penuh (tanggal 1 s/d akhir bulan).' };
  const k = await hitungKinerja(supabase, 'semua');
  const pakai = k.lrPerBulan.filter(b => bulan.includes(b.bulan));
  if (!pakai.length || sampai < TANGGAL_AWAL_PERIODE) return { penghubung: null, alasan: 'Bulan ini di luar periode Kinerja Keuangan.' };
  const j = (f: (b: typeof pakai[number]) => number) => pakai.reduce((s, b) => s + f(b), 0);
  const hppBahan = j(b => b.bahan), hppUpah = j(b => b.upah), hppOverhead = j(b => b.overheadProduksi);
  return {
    penghubung: {
      bulan: pakai.map(b => b.bulan),
      sementara: pakai.some(b => b.bulan === k.bulanTersedia[k.bulanTersedia.length - 1]),
      hppBahan, hppUpah, hppOverhead, hpp: hppBahan + hppUpah + hppOverhead,
      overheadTanpaProduksi: j(b => b.overheadTanpaProduksi),
      bebanOperasional: j(b => b.bebanOperasional),
    },
    alasan: null,
  };
}

export async function getJurnalProduksi(opts: {
  dari: string; sampai: string; hanyaPeriodeBaru?: boolean;
}): Promise<JurnalProduksiData> {
  const hanyaPeriodeBaru = opts.hanyaPeriodeBaru ?? true;
  const supabase = await createClient();
  const [{ data, error }, ph] = await Promise.all([
    supabase.rpc('get_jurnal_produksi', {
      p_tenant_id: TENANT_ID,
      p_dari: opts.dari,
      p_sampai: opts.sampai,
      p_po_mulai: hanyaPeriodeBaru ? PO_AWAL_PERIODE : null,
    }),
    hitungPenghubung(supabase, opts.dari, opts.sampai, hanyaPeriodeBaru),
  ]);
  if (error) throw new Error(error.message);

  const baris: JurnalBaris[] = ((data ?? []) as any[]).map(r => ({
    tanggal: r.tanggal,
    jenis: r.jenis,
    kategori: r.kategori ?? '-',
    keterangan: r.keterangan ?? '',
    no_po: r.no_po ?? null,
    qty: r.qty == null ? null : Number(r.qty),
    satuan: r.satuan ?? null,
    nominal: Number(r.nominal ?? 0),
    waktu: r.waktu ?? null,
  }));
  baris.sort((a, b) =>
    b.tanggal.localeCompare(a.tanggal) || (b.waktu ?? '').localeCompare(a.waktu ?? ''));

  return {
    dari: opts.dari, sampai: opts.sampai, hanyaPeriodeBaru, baris,
    penghubung: ph.penghubung, alasanTanpaPenghubung: ph.alasan,
  };
}
