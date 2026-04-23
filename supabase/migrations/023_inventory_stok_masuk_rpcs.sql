-- ============================================================
-- Migration 023: RPC stok_masuk
-- Atomic: insert batch + update stok_aktual + insert jurnal
-- ============================================================

CREATE OR REPLACE FUNCTION stok_masuk(
  p_inventory_item_id  UUID,
  p_qty                NUMERIC,
  p_harga_satuan       NUMERIC,
  p_tanggal_masuk      DATE,
  p_no_faktur          TEXT,
  p_kategori_trx_id    UUID,
  p_keterangan         TEXT,
  p_user_id            UUID,
  p_tenant_id          TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_item          RECORD;
  v_jurnal_id     UUID;
  v_batch_id      UUID;
  v_nominal       NUMERIC;
BEGIN
  -- 1. Lock & validasi item
  SELECT id, nama, stok_aktual
  INTO v_item
  FROM inventory_item
  WHERE id = p_inventory_item_id
    AND tenant_id = p_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Item inventory tidak ditemukan';
  END IF;

  v_nominal := p_qty * p_harga_satuan;

  -- 2. Insert jurnal_entry (direct_bahan)
  INSERT INTO jurnal_entry (
    kategori_trx_id, jenis, nominal, tanggal,
    no_faktur, keterangan, qty, inventory_item_id,
    tag_po_ids, tenant_id, created_by
  )
  VALUES (
    p_kategori_trx_id, 'direct_bahan', v_nominal, p_tanggal_masuk,
    p_no_faktur,
    COALESCE(p_keterangan, 'Stok masuk: ' || v_item.nama),
    p_qty, p_inventory_item_id,
    '[]'::JSONB, p_tenant_id, p_user_id
  )
  RETURNING id INTO v_jurnal_id;

  -- 3. Insert inventory_batch
  INSERT INTO inventory_batch (
    inventory_item_id, qty_awal, qty_sisa,
    harga_satuan, tanggal_masuk,
    jurnal_entry_id, tenant_id
  )
  VALUES (
    p_inventory_item_id, p_qty, p_qty,
    p_harga_satuan, p_tanggal_masuk,
    v_jurnal_id, p_tenant_id
  )
  RETURNING id INTO v_batch_id;

  -- 4. Update stok_aktual item
  UPDATE inventory_item
  SET stok_aktual = stok_aktual + p_qty
  WHERE id = p_inventory_item_id;

  RETURN jsonb_build_object(
    'batch_id',   v_batch_id,
    'jurnal_id',  v_jurnal_id,
    'stok_baru',  v_item.stok_aktual + p_qty
  );
END;
$$;

GRANT EXECUTE ON FUNCTION stok_masuk(UUID, NUMERIC, NUMERIC, DATE, TEXT, UUID, TEXT, UUID, TEXT)
  TO authenticated;


-- ============================================================
-- RPC: tambah_inventory_item
-- Buat item baru + optional stok awal
-- ============================================================
CREATE OR REPLACE FUNCTION tambah_inventory_item(
  p_nama          TEXT,
  p_satuan        TEXT,
  p_stok_minimum  NUMERIC,
  p_user_id       UUID,
  p_tenant_id     TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_item_id UUID;
BEGIN
  INSERT INTO inventory_item (nama, satuan, stok_minimum, tenant_id, created_by)
  VALUES (p_nama, p_satuan, p_stok_minimum, p_tenant_id, p_user_id)
  RETURNING id INTO v_item_id;

  RETURN jsonb_build_object('id', v_item_id);
END;
$$;

GRANT EXECUTE ON FUNCTION tambah_inventory_item(TEXT, TEXT, NUMERIC, UUID, TEXT)
  TO authenticated;
