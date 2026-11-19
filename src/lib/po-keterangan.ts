/**
 * Keterangan PO selesai — dihitung dari view `v_po_ringkasan_kirim`.
 * PO otomatis 'selesai' saat semua bundle hidup sudah masuk Surat Jalan
 * (lihat migrasi 20261119_po_selesai_otomatis.sql), walau qty terkirim
 * bisa kurang dari order (bundle ditutup). Keterangan ini menjelaskannya.
 */
export interface RingkasanKirimPo {
  qty_order: number;
  qty_kirim: number;
  bundle_ditutup: number;
}

export function keteranganPoSelesai(r: RingkasanKirimPo | null | undefined): string | null {
  if (!r) return null;
  const parts: string[] = [];
  if (r.qty_kirim !== r.qty_order) {
    parts.push(`terkirim ${r.qty_kirim.toLocaleString('id-ID')} / ${r.qty_order.toLocaleString('id-ID')} pcs`);
  }
  if (r.bundle_ditutup > 0) {
    parts.push(`${r.bundle_ditutup} bundle ditutup`);
  }
  return parts.length > 0 ? parts.join(' · ') : null;
}
