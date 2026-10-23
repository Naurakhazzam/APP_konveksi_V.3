-- =============================================================================
-- MIGRATION: 20261023000001_tambah_item_po_existing_rpc.sql
-- Tujuan : RPC add_items_to_po — menambah artikel (po_item + bundle) ke PO
--          yang SUDAH ADA, sebagai ganti menolak nomor PO duplikat.
-- Dibuat : 23 Oktober 2026
--
-- Konteks: Saat admin menginput nomor PO yang sudah ada, sistem lama menolak
--          ('Nomor PO ... sudah digunakan.'). Fungsi ini memungkinkan artikel
--          baru ditambahkan ke PO existing (hanya berstatus 'aktif').
--
-- Mengikuti pola create_po_with_bundles versi terkini:
--   - no_urut_global artikel dari po_item_sequence (atomic, row-lock)
--   - barcode via generate_bundle_barcode(no_po, no_urut_global, i) [3-arg]
--   - no_urut_po dilanjutkan dari MAX(no_urut_po) PO tsb (tidak reset ke 0)
--   - audit_log aksi 'Tambah Item PO'
-- Barcode tetap unik karena dibentuk dari no_urut_global (unik seluruh sistem),
-- bukan dari nomor PO — sehingga aman ditambahkan ke PO yang sama.
-- =============================================================================

CREATE OR REPLACE FUNCTION add_items_to_po(
  p_no_po     TEXT,
  p_tenant_id TEXT,
  p_user_id   UUID,
  p_items     JSONB
  -- Format p_items: [{ "produk_id":"uuid","warna":"text","size":"text",
  --                     "qty_order":12,"qty_per_bundle":12 }, ...]
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_po_id           UUID;
  v_po_status       TEXT;
  v_po_item_id      UUID;
  v_barcode         TEXT;
  v_item            JSONB;
  v_bundle_count    INT;
  v_no_urut_global  INT;   -- nomor urut artikel (dari po_item_sequence)
  v_global_po_urut  INT;   -- no_urut_po: dilanjutkan dari bundle yang sudah ada
  v_produk_id       UUID;
  v_qty_order       INT;
  v_qty_per_bundle  INT;
  v_warna           TEXT;
  v_size            TEXT;
  i                 INT;
  v_item_count      INT := 0;
  v_bundle_total    INT := 0;
BEGIN

  -- PO harus ada
  SELECT id, status INTO v_po_id, v_po_status
  FROM po
  WHERE no_po = p_no_po AND tenant_id = p_tenant_id;

  IF v_po_id IS NULL THEN
    RAISE EXCEPTION 'PO % tidak ditemukan.', p_no_po;
  END IF;

  -- Hanya PO aktif yang boleh ditambah artikel
  IF v_po_status <> 'aktif' THEN
    RAISE EXCEPTION 'PO % berstatus "%" — hanya PO aktif yang bisa ditambah artikel.',
      p_no_po, v_po_status;
  END IF;

  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Minimal 1 artikel untuk ditambahkan.';
  END IF;

  -- Lanjutkan penomoran bundle dalam PO dari yang sudah ada
  SELECT COALESCE(MAX(no_urut_po), 0) INTO v_global_po_urut
  FROM bundle
  WHERE po_id = v_po_id;

  -- Loop per artikel baru
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_produk_id      := (v_item->>'produk_id')::UUID;
    v_qty_order      := (v_item->>'qty_order')::INT;
    v_qty_per_bundle := (v_item->>'qty_per_bundle')::INT;
    v_warna          := v_item->>'warna';
    v_size           := v_item->>'size';

    IF v_produk_id IS NULL THEN
      RAISE EXCEPTION 'produk_id tidak boleh null.';
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM produk WHERE id = v_produk_id AND tenant_id = p_tenant_id
    ) THEN
      RAISE EXCEPTION 'produk_id % tidak ditemukan.', v_produk_id;
    END IF;

    IF v_qty_per_bundle < 1 THEN
      RAISE EXCEPTION 'qty_per_bundle harus minimal 1.';
    END IF;

    IF v_qty_order < 1 THEN
      RAISE EXCEPTION 'qty_order harus minimal 1.';
    END IF;

    -- Nomor urut global artikel (atomic)
    UPDATE po_item_sequence
    SET    last_sequence = last_sequence + 1
    WHERE  tenant_id = p_tenant_id
    RETURNING last_sequence INTO v_no_urut_global;

    IF v_no_urut_global IS NULL THEN
      RAISE EXCEPTION 'po_item_sequence tidak ditemukan untuk tenant %', p_tenant_id;
    END IF;

    INSERT INTO po_item (
      po_id, produk_id, warna, size,
      qty_order, qty_per_bundle, no_urut_global, tenant_id
    )
    VALUES (
      v_po_id, v_produk_id, v_warna, v_size,
      v_qty_order, v_qty_per_bundle, v_no_urut_global, p_tenant_id
    )
    RETURNING id INTO v_po_item_id;

    v_bundle_count := CEIL(v_qty_order::NUMERIC / v_qty_per_bundle::NUMERIC)::INT;

    FOR i IN 1..v_bundle_count
    LOOP
      v_global_po_urut := v_global_po_urut + 1;
      v_barcode := generate_bundle_barcode(p_no_po, v_no_urut_global, i);

      INSERT INTO bundle (
        barcode, po_id, po_item_id,
        no_urut, no_urut_po,
        status_tahap, tenant_id, created_by
      )
      VALUES (
        v_barcode, v_po_id, v_po_item_id,
        i, v_global_po_urut,
        '{}'::jsonb, p_tenant_id, p_user_id
      );

      v_bundle_total := v_bundle_total + 1;
    END LOOP;

    v_item_count := v_item_count + 1;
  END LOOP;

  INSERT INTO audit_log (
    user_id, modul, aksi, target, metadata, tenant_id
  )
  VALUES (
    p_user_id, 'produksi', 'Tambah Item PO', p_no_po,
    jsonb_build_object(
      'po_id',         v_po_id,
      'jumlah_item',   v_item_count,
      'jumlah_bundle', v_bundle_total
    ),
    p_tenant_id
  );

  RETURN p_no_po;

EXCEPTION
  WHEN OTHERS THEN RAISE;
END;
$$;

GRANT EXECUTE ON FUNCTION add_items_to_po(TEXT, TEXT, UUID, JSONB) TO authenticated;
