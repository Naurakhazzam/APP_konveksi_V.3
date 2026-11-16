'use server';
/* eslint-disable @typescript-eslint/no-explicit-any */

import { createClient } from '@/lib/supabase/server';
import { PO_AWAL_PERIODE } from '@/lib/keuangan/periode-po';

const TENANT_ID = 'STX-001';

/**
 * Jurnal Produksi = laporan otomatis (read-only), dirangkai RPC get_jurnal_produksi dari sumber asli:
 * pemakaian kain cutting, pemakaian aksesori, Buku Kas (bahan pembantu, overhead, lain-lain,
 * pembelian bahan), gaji_ledger (upah) dan alokasi harian biaya tetap.
 * Tabel jurnal_entry lama tidak lagi ditulis maupun dibaca di sini.
 */
export type JenisJurnal =
  | 'kain' | 'aksesori' | 'pembantu' | 'upah' | 'overhead' | 'biaya_tetap' | 'lainnya' | 'pembelian';

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

export interface JurnalProduksiData {
  dari: string;
  sampai: string;
  hanyaPeriodeBaru: boolean;
  baris: JurnalBaris[];
}

export async function getJurnalProduksi(opts: {
  dari: string; sampai: string; hanyaPeriodeBaru?: boolean;
}): Promise<JurnalProduksiData> {
  const hanyaPeriodeBaru = opts.hanyaPeriodeBaru ?? true;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('get_jurnal_produksi', {
    p_tenant_id: TENANT_ID,
    p_dari: opts.dari,
    p_sampai: opts.sampai,
    p_po_mulai: hanyaPeriodeBaru ? PO_AWAL_PERIODE : null,
  });
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

  return { dari: opts.dari, sampai: opts.sampai, hanyaPeriodeBaru, baris };
}
