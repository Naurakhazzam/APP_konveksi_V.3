-- Dua catatan cutting kain November tercatat harga_pakai = 0 dan tanpa jurnal
-- direct_bahan (Drill Hitam 4 Nov, Toyobo brown 7 Nov — PO-0097). Isi dengan
-- harga_referensi sekarang dan tambahkan jurnal dengan format jurnal otomatis
-- cutting. Catatan Rp 0 Juli–Oktober sengaja TIDAK diubah (keputusan owner).
WITH target AS (
  SELECT p.id, p.qty_pakai, p.inventory_item_id, p.created_at, b.po_id, i.nama, i.harga_referensi, i.tenant_id
  FROM pemakaian_bahan p
  JOIN inventory_item i ON i.id = p.inventory_item_id
  JOIN bundle b ON b.id = p.bundle_id
  WHERE p.id IN ('48ab4959-a9e4-4edb-8a93-2eee67f874ca', '7db2a1df-1bcd-43f5-a726-9a6ab115582f')
    AND COALESCE(p.harga_pakai, 0) = 0
), upd AS (
  UPDATE pemakaian_bahan p SET harga_pakai = ROUND(t.qty_pakai * t.harga_referensi, 2)
  FROM target t WHERE p.id = t.id
  RETURNING p.id
)
INSERT INTO jurnal_entry (kategori_trx_id, jenis, nominal, tanggal, no_faktur, tag_po_ids, keterangan, qty, inventory_item_id, tenant_id, created_by)
SELECT '25cea549-dcec-4cdb-be88-94d3d45e317e', 'direct_bahan', ROUND(t.qty_pakai * t.harga_referensi, 2), t.created_at::date,
       'AUTO-BAHAN-' || to_char(t.created_at, 'YYYYMMDD'), jsonb_build_array(t.po_id), t.nama, t.qty_pakai, t.inventory_item_id, t.tenant_id,
       '71fb0890-5306-47be-a9c0-c5cce41cca95'
FROM target t;
