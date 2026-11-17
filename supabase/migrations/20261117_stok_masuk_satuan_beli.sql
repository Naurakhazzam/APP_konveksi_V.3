-- Stok Masuk dengan satuan beli (17 Nov 2026).
-- Masalah: harga per lusin dibagi faktor lalu DIBULATKAN di form (40.000/12 → 3.333),
-- lalu kas keluar = 72 pcs × 3.333 = 239.976, bukan 240.000.
-- Perbaikan: bila p_qty_beli & p_harga_beli diisi, RPC mengonversi sendiri:
--   qty pakai   = qty_beli × faktor_konversi (stok tetap per satuan pakai, mis. pcs)
--   nominal     = qty_beli × harga_beli     (uang keluar persis sesuai nota)
--   harga_satuan LOT = nominal / qty pakai (2 desimal, untuk biaya pemakaian FIFO)
-- Panggilan lama (9 argumen, mis. setoran_modal_sisa_bahan) tetap berjalan seperti sebelumnya.

DROP FUNCTION IF EXISTS public.stok_masuk(uuid, numeric, numeric, date, text, uuid, text, uuid, text);

CREATE FUNCTION public.stok_masuk(
  p_inventory_item_id uuid, p_qty numeric, p_harga_satuan numeric, p_tanggal_masuk date,
  p_no_faktur text, p_kategori_trx_id uuid, p_keterangan text, p_user_id uuid, p_tenant_id text,
  p_qty_beli numeric DEFAULT NULL, p_harga_beli numeric DEFAULT NULL)
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
  v_qty        NUMERIC;
  v_harga      NUMERIC;
  v_nominal    NUMERIC;
  v_total_lot  NUMERIC;
  v_hutang     NUMERIC;
  v_lunas      NUMERIC;
  v_ket_qty    TEXT;
BEGIN
  SELECT id, nama, satuan, stok_aktual, satuan_beli, faktor_konversi INTO v_item
  FROM inventory_item
  WHERE id = p_inventory_item_id AND tenant_id = p_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'Item inventory tidak ditemukan'; END IF;

  IF p_qty_beli IS NOT NULL THEN
    IF v_item.satuan_beli IS NULL OR COALESCE(v_item.faktor_konversi, 0) <= 0 THEN
      RAISE EXCEPTION '% tidak punya konversi satuan beli', v_item.nama;
    END IF;
    IF p_qty_beli <= 0 THEN RAISE EXCEPTION 'Qty beli harus lebih dari 0'; END IF;
    IF COALESCE(p_harga_beli, -1) < 0 THEN RAISE EXCEPTION 'Harga beli tidak valid'; END IF;
    v_qty     := p_qty_beli * v_item.faktor_konversi;
    v_nominal := round(p_qty_beli * p_harga_beli, 2);
    v_harga   := round(v_nominal / v_qty, 2);
    v_ket_qty := replace(trim_scale(p_qty_beli)::text, '.', ',') || ' ' || v_item.satuan_beli
      || ' (' || replace(trim_scale(v_qty)::text, '.', ',') || ' ' || COALESCE(v_item.satuan, '') || ')'
      || ' @ Rp ' || replace(to_char(p_harga_beli, 'FM999G999G999G990'), ',', '.') || '/' || v_item.satuan_beli;
  ELSE
    v_qty     := p_qty;
    v_harga   := p_harga_satuan;
    v_nominal := p_qty * p_harga_satuan;
    v_ket_qty := replace(trim_scale(p_qty)::text, '.', ',') || ' ' || COALESCE(v_item.satuan, '');
  END IF;

  IF COALESCE(v_qty, 0) <= 0 THEN RAISE EXCEPTION 'Qty harus lebih dari 0'; END IF;

  -- Hutang stok = bahan yang sudah terpakai (dan dibebankan) tanpa LOT
  SELECT COALESCE(SUM(qty_sisa), 0) INTO v_total_lot
  FROM inventory_batch WHERE inventory_item_id = p_inventory_item_id AND tenant_id = p_tenant_id;
  v_hutang := GREATEST(v_total_lot - v_item.stok_aktual, 0);
  v_lunas  := LEAST(v_hutang, v_qty);

  INSERT INTO jurnal_entry (
    kategori_trx_id, jenis, nominal, tanggal,
    no_faktur, keterangan, qty, inventory_item_id,
    tag_po_ids, tenant_id, created_by
  ) VALUES (
    p_kategori_trx_id, 'pembelian_bahan', v_nominal, p_tanggal_masuk,
    p_no_faktur,
    COALESCE(p_keterangan, 'Stok masuk: ' || v_item.nama),
    v_qty, p_inventory_item_id,
    '[]'::JSONB, p_tenant_id, p_user_id
  ) RETURNING id INTO v_jurnal_id;

  INSERT INTO inventory_batch (
    inventory_item_id, qty_awal, qty_sisa,
    harga_satuan, tanggal_masuk, jurnal_entry_id, tenant_id
  ) VALUES (
    p_inventory_item_id, v_qty, v_qty - v_lunas,
    v_harga, p_tanggal_masuk, v_jurnal_id, p_tenant_id
  ) RETURNING id INTO v_batch_id;

  IF v_nominal > 0 THEN
    INSERT INTO buku_kas (
      tenant_id, tanggal, tipe, kategori, nominal, keterangan,
      no_referensi, qty, satuan, inventory_batch_id, created_by
    ) VALUES (
      p_tenant_id, p_tanggal_masuk, 'keluar', 'Pembelian Bahan', v_nominal,
      'Belanja ' || v_item.nama || ' ' || v_ket_qty
        || CASE WHEN NULLIF(trim(COALESCE(p_keterangan, '')), '') IS NOT NULL THEN ' — ' || trim(p_keterangan) ELSE '' END,
      p_no_faktur, v_qty, v_item.satuan, v_batch_id, p_user_id
    ) RETURNING id INTO v_kas_id;
  END IF;

  UPDATE inventory_item
  SET stok_aktual = stok_aktual + v_qty
  WHERE id = p_inventory_item_id;

  RETURN jsonb_build_object(
    'batch_id',  v_batch_id,
    'jurnal_id', v_jurnal_id,
    'buku_kas_id', v_kas_id,
    'stok_baru', v_item.stok_aktual + v_qty,
    'qty_lunasi_minus', v_lunas,
    'nominal', v_nominal
  );
END; $function$;

REVOKE ALL ON FUNCTION public.stok_masuk(uuid, numeric, numeric, date, text, uuid, text, uuid, text, numeric, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.stok_masuk(uuid, numeric, numeric, date, text, uuid, text, uuid, text, numeric, numeric) TO authenticated;

-- Perbaiki Stok Masuk Sleting Koil 17 Nov (6 lusin @ 40.000): kas & jurnal 239.976 → 240.000,
-- harga LOT 3.333 → 3.333,33. Pemakaian 30 pcs yang sudah terjadi dibiarkan (selisih Rp 10).
UPDATE inventory_batch b SET harga_satuan = 3333.33
FROM inventory_item i
WHERE i.id = b.inventory_item_id AND b.tenant_id = 'STX-001' AND i.nama = 'Sleting Koil'
  AND b.tanggal_masuk = '2026-11-17' AND b.qty_awal = 72 AND b.harga_satuan = 3333;
UPDATE jurnal_entry j SET nominal = 240000
FROM inventory_batch b JOIN inventory_item i ON i.id = b.inventory_item_id
WHERE b.jurnal_entry_id = j.id AND i.nama = 'Sleting Koil' AND b.tanggal_masuk = '2026-11-17'
  AND b.qty_awal = 72 AND j.nominal = 239976;
UPDATE buku_kas k SET nominal = 240000,
  keterangan = 'Belanja Sleting Koil 6 lusin (72 pcs) @ Rp 40.000/lusin'
FROM inventory_batch b JOIN inventory_item i ON i.id = b.inventory_item_id
WHERE k.inventory_batch_id = b.id AND i.nama = 'Sleting Koil' AND b.tanggal_masuk = '2026-11-17'
  AND b.qty_awal = 72 AND k.nominal = 239976;
