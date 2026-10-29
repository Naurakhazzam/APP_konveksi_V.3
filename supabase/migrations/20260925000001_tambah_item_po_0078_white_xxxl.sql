-- ================================================================
-- MIGRATION: Tambahan item PO-0078 — Khalid White XXXL, 6 pcs, 1 bundle
--
-- Permintaan tambahan untuk PO-0078 yang sudah berjalan (item White
-- XXXL 10 pcs sebelumnya sudah selesai). Dibuat sebagai po_item baru
-- (bukan menambah bundle di item lama) karena qty per bundle dihitung
-- dari po_item.qty_per_bundle (item lama = 10, sedangkan tambahan = 6).
--
-- Posisi: belum cutting (status_tahap = '{}').
-- Mengikuti pola create_po_with_bundles: nomor urut artikel dari
-- po_item_sequence, barcode via generate_bundle_barcode, audit_log.
-- ================================================================

DO $$
DECLARE
  v_po_id      UUID := '5558fe34-668b-45cf-bb3d-05e0503801ed';
  v_produk_id  UUID := 'e49b1d98-f3d9-4030-a715-bf0ff36aebe9'; -- Khalid White XXXL
  v_tenant     TEXT := 'STX-001';
  v_user       UUID := '71fb0890-5306-47be-a9c0-c5cce41cca95';
  v_seq        INT;
  v_item_id    UUID;
  v_urut_po    INT;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM po WHERE id = v_po_id AND no_po = 'PO-0078' AND tenant_id = v_tenant
  ) THEN
    RAISE EXCEPTION 'PO-0078 tidak ditemukan';
  END IF;

  UPDATE po_item_sequence
  SET    last_sequence = last_sequence + 1
  WHERE  tenant_id = v_tenant
  RETURNING last_sequence INTO v_seq;

  INSERT INTO po_item (po_id, produk_id, warna, size, qty_order, qty_per_bundle, no_urut_global, tenant_id)
  VALUES (v_po_id, v_produk_id, 'White', 'XXXL', 6, 6, v_seq, v_tenant)
  RETURNING id INTO v_item_id;

  SELECT COALESCE(MAX(no_urut_po), 0) + 1 INTO v_urut_po FROM bundle WHERE po_id = v_po_id;

  INSERT INTO bundle (barcode, po_id, po_item_id, no_urut, no_urut_po, status_tahap, tenant_id, created_by)
  VALUES (generate_bundle_barcode('PO-0078', v_seq, 1), v_po_id, v_item_id, 1, v_urut_po, '{}'::jsonb, v_tenant, v_user);

  INSERT INTO audit_log (user_id, modul, aksi, target, metadata, tenant_id)
  VALUES (v_user, 'produksi', 'Tambah Item PO', 'PO-0078',
          jsonb_build_object('po_id', v_po_id, 'po_item_id', v_item_id,
                             'warna', 'White', 'size', 'XXXL', 'qty_order', 6, 'jumlah_bundle', 1),
          v_tenant);
END $$;
