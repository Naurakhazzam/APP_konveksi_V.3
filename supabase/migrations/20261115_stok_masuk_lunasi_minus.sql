-- Stok Masuk melunasi stok minus lebih dulu (15 Nov 2026).
-- Masalah: bahan terpakai saat stok belum diinput -> stok_aktual minus, LOT kosong,
-- biaya dibebankan dgn harga_referensi. Stok Masuk berikutnya membuat LOT penuh,
-- sehingga qty yang sudah dibebankan dibebankan lagi (biaya ganda) & LOT > stok_aktual.
-- Perbaikan: qty_sisa LOT baru = qty masuk - hutang (selisih stok_aktual di bawah total LOT).
-- qty_awal LOT, jurnal & Buku Kas tetap penuh sesuai pembelian.

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
  v_total_lot  NUMERIC;
  v_hutang     NUMERIC;
  v_lunas      NUMERIC;
BEGIN
  SELECT id, nama, satuan, stok_aktual INTO v_item
  FROM inventory_item
  WHERE id = p_inventory_item_id AND tenant_id = p_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'Item inventory tidak ditemukan'; END IF;
  IF COALESCE(p_qty, 0) <= 0 THEN RAISE EXCEPTION 'Qty harus lebih dari 0'; END IF;

  v_nominal := p_qty * p_harga_satuan;

  -- Hutang stok = bahan yang sudah terpakai (dan dibebankan) tanpa LOT
  SELECT COALESCE(SUM(qty_sisa), 0) INTO v_total_lot
  FROM inventory_batch WHERE inventory_item_id = p_inventory_item_id AND tenant_id = p_tenant_id;
  v_hutang := GREATEST(v_total_lot - v_item.stok_aktual, 0);
  v_lunas  := LEAST(v_hutang, p_qty);

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
    p_inventory_item_id, p_qty, p_qty - v_lunas,
    p_harga_satuan, p_tanggal_masuk, v_jurnal_id, p_tenant_id
  ) RETURNING id INTO v_batch_id;

  IF v_nominal > 0 THEN
    INSERT INTO buku_kas (
      tenant_id, tanggal, tipe, kategori, nominal, keterangan,
      no_referensi, qty, satuan, inventory_batch_id, created_by
    ) VALUES (
      p_tenant_id, p_tanggal_masuk, 'keluar', 'Pembelian Bahan', v_nominal,
      'Belanja ' || v_item.nama || ' ' || replace(trim_scale(p_qty)::text, '.', ',') || ' ' || COALESCE(v_item.satuan, '')
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
    'stok_baru', v_item.stok_aktual + p_qty,
    'qty_lunasi_minus', v_lunas
  );
END; $function$;

-- Batal / koreksi turun jahit: LOT diisi kembali hanya sebatas stok_aktual di atas total LOT,
-- sama seperti _kembalikan_stok_bahan (bagian yang dipakai saat stok minus tidak punya LOT).
DO $$
DECLARE d text; v_old text; v_new text;
BEGIN
  d := pg_get_functiondef('public._sesuaikan_aksesori_jahit'::regproc);
  v_old := E'      v_sisa := v_jumlah;\n      FOR v_batch IN';
  v_new := E'      -- isi kembali LOT hanya sebatas stok_aktual di atas total LOT (bagian yang dulu dipakai saat minus tidak punya LOT)\n      v_sisa := LEAST(v_jumlah, GREATEST(0,\n        (SELECT stok_aktual FROM inventory_item WHERE id = v_aksesori.inventory_item_id)\n        - COALESCE((SELECT SUM(qty_sisa) FROM inventory_batch\n                    WHERE inventory_item_id = v_aksesori.inventory_item_id AND tenant_id = p_tenant_id), 0)));\n      FOR v_batch IN';
  IF position('isi kembali LOT hanya sebatas' in d) > 0 THEN RETURN; END IF;
  IF (length(d) - length(replace(d, v_old, ''))) / length(v_old) <> 1 THEN
    RAISE EXCEPTION 'pola tidak ditemukan tepat satu kali';
  END IF;
  EXECUTE replace(d, v_old, v_new);
END $$;
