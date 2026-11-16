'use server';
/* eslint-disable @typescript-eslint/no-explicit-any */

import { createClient } from '@/lib/supabase/server';
import { PO_AWAL_PERIODE } from '@/lib/keuangan/periode-po';
import { hitungKinerja, type KinerjaData } from '@/lib/keuangan/kinerja.server';

const TENANT_ID = 'STX-001';

/**
 * Kinerja Keuangan (laba rugi akrual, posisi, arus kas, laba per PO).
 * @param periode 'semua' (sejak awal periode) atau 'YYYY-MM'
 */
export async function getKinerjaKeuangan(periode = 'semua'): Promise<KinerjaData> {
  const supabase = await createClient();
  return hitungKinerja(supabase, periode);
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
