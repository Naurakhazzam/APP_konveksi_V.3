-- Stok Masuk otomatis mencatat uang keluar ke Buku Kas (15 Nov 2026)
-- Sebelumnya belanja bahan hanya masuk stok + jurnal_entry 'pembelian_bahan',
-- sedangkan Laporan L/R membaca uang keluar dari buku_kas → belanja tidak
-- pernah muncul kecuali diinput dua kali. Kini satu kali Stok Masuk = stok +
-- LOT + jurnal + Buku Kas (keluar, 'Pembelian Bahan'), tertaut ke LOT.

ALTER TABLE buku_kas ADD COLUMN IF NOT EXISTS inventory_batch_id uuid
  REFERENCES inventory_batch(id) ON DELETE CASCADE;

CREATE OR REPLACE FUNCTION public.stok_masuk(p_inventory_item_id uuid, p_qty numeric, p_harga_satuan numeric, p_tanggal_masuk date, p_no_faktur text, p_kategori_trx_id uuid, p_keterangan text, p_user_id uuid, p_tenant_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_item       RECORD;
  v_jurnal_id  UUID;
  v_batch_id   UUID;
  v_kas_id     UUID;
  v_nominal    NUMERIC;
BEGIN
  SELECT id, nama, satuan, stok_aktual INTO v_item
  FROM inventory_item
  WHERE id = p_inventory_item_id AND tenant_id = p_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'Item inventory tidak ditemukan'; END IF;
  IF COALESCE(p_qty, 0) <= 0 THEN RAISE EXCEPTION 'Qty harus lebih dari 0'; END IF;

  v_nominal := p_qty * p_harga_satuan;

  INSERT INTO jurnal_entry (
    kategori_trx_id, jenis, nominal, tanggal,
    no_faktur, keterangan, qty, inventory_item_id,
    tag_po_ids, tenant_id, created_by
  ) VALUES (
    p_kategori_trx_id, 'pembelian_bahan', v_nominal, p_tanggal_masuk,
    p_no_faktur,
    COALESCE(p_keterangan, 'Stok masuk: ' || v_item.nama),
    p_qty, p_inventory_item_id,
    '[]'::JSONB, p_tenant_id, p_user_id
  ) RETURNING id INTO v_jurnal_id;

  INSERT INTO inventory_batch (
    inventory_item_id, qty_awal, qty_sisa,
    harga_satuan, tanggal_masuk, jurnal_entry_id, tenant_id
  ) VALUES (
    p_inventory_item_id, p_qty, p_qty,
    p_harga_satuan, p_tanggal_masuk, v_jurnal_id, p_tenant_id
  ) RETURNING id INTO v_batch_id;

  -- Uang keluar → Buku Kas (dibaca Laporan L/R)
  IF v_nominal > 0 THEN
    INSERT INTO buku_kas (
      tenant_id, tanggal, tipe, kategori, nominal, keterangan,
      no_referensi, qty, satuan, inventory_batch_id, created_by
    ) VALUES (
      p_tenant_id, p_tanggal_masuk, 'keluar', 'Pembelian Bahan', v_nominal,
      'Belanja ' || v_item.nama || ' ' || trim(to_char(p_qty, 'FM999999990.###')) || ' ' || COALESCE(v_item.satuan, '')
        || CASE WHEN NULLIF(trim(COALESCE(p_keterangan, '')), '') IS NOT NULL THEN ' — ' || trim(p_keterangan) ELSE '' END,
      p_no_faktur, p_qty, v_item.satuan, v_batch_id, p_user_id
    ) RETURNING id INTO v_kas_id;
  END IF;

  UPDATE inventory_item
  SET stok_aktual = stok_aktual + p_qty
  WHERE id = p_inventory_item_id;

  RETURN jsonb_build_object(
    'batch_id',  v_batch_id,
    'jurnal_id', v_jurnal_id,
    'buku_kas_id', v_kas_id,
    'stok_baru', v_item.stok_aktual + p_qty
  );
END; $function$;
