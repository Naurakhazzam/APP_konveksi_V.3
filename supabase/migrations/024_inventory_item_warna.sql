-- Tambah kolom warna_id ke inventory_item (nullable)
ALTER TABLE inventory_item 
ADD COLUMN IF NOT EXISTS warna_id UUID REFERENCES warna(id) ON DELETE SET NULL;

-- Update RPC tambah_inventory_item untuk terima parameter warna_id
CREATE OR REPLACE FUNCTION tambah_inventory_item(
  p_nama         TEXT,
  p_satuan       TEXT,
  p_stok_minimum NUMERIC,
  p_user_id      UUID,
  p_tenant_id    TEXT,
  p_warna_id     UUID DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_item_id UUID;
BEGIN
  INSERT INTO inventory_item (nama, satuan, stok_minimum, warna_id, tenant_id, created_by)
  VALUES (p_nama, p_satuan, p_stok_minimum, p_warna_id, p_tenant_id, p_user_id)
  RETURNING id INTO v_item_id;

  RETURN json_build_object('id', v_item_id);
END;
$$;
