-- ================================================================
-- MIGRATION 029: Allow minus stok + Jurnal otomatis ter-tag PO
-- Jalankan 4 SQL ini BERURUTAN di Supabase → SQL Editor
-- ================================================================


-- ════════════════════════════════════════════════════════════════
-- SQL 1: Tambah kolom harga_referensi ke inventory_item
-- ════════════════════════════════════════════════════════════════

ALTER TABLE inventory_item
  ADD COLUMN IF NOT EXISTS harga_referensi NUMERIC(14,2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN inventory_item.harga_referensi IS
  'Harga satuan referensi (Rp). Dipakai sebagai fallback saat stok nol untuk mencatat biaya produksi ke jurnal.';


-- ════════════════════════════════════════════════════════════════
-- SQL 2: Ganti consume_fifo_atomic
-- Bahan baku: boleh minus + jurnal otomatis ter-tag ke PO
-- ════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION consume_fifo_atomic(
  p_inventory_item_id UUID,
  p_qty_needed        NUMERIC,
  p_po_item_id        UUID,
  p_bundle_id         UUID,
  p_rate_per_pcs      NUMERIC,
  p_user_id           UUID,
  p_tenant_id         TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_item              RECORD;
  v_batch             RECORD;
  v_sisa_kebutuhan    NUMERIC := p_qty_needed;
  v_total_consumed    NUMERIC := 0;
  v_first_batch_id    UUID    := NULL;
  v_ambil             NUMERIC;
  v_po_id             UUID;
  v_kategori_id       UUID;
  v_nominal           NUMERIC;
BEGIN
  SELECT id, nama, stok_aktual, harga_referensi
  INTO v_item
  FROM inventory_item
  WHERE id = p_inventory_item_id AND tenant_id = p_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'status', 'error', 'item_nama', 'Item tidak ditemukan',
      'qty_consumed', 0, 'qty_kurang', p_qty_needed, 'sisa_stok', 0
    );
  END IF;

  SELECT po_id INTO v_po_id FROM po_item WHERE id = p_po_item_id;

  SELECT id INTO v_kategori_id
  FROM kategori_trx
  WHERE jenis = 'direct_bahan' AND aktif = TRUE AND tenant_id = p_tenant_id
  LIMIT 1;

  -- FASE 1: Consume FIFO batch yang tersedia
  FOR v_batch IN
    SELECT id, qty_sisa, harga_satuan
    FROM inventory_batch
    WHERE inventory_item_id = p_inventory_item_id
      AND tenant_id = p_tenant_id AND qty_sisa > 0
    ORDER BY tanggal_masuk ASC
    FOR UPDATE
  LOOP
    EXIT WHEN v_sisa_kebutuhan <= 0;
    v_ambil := LEAST(v_batch.qty_sisa, v_sisa_kebutuhan);

    UPDATE inventory_batch SET qty_sisa = qty_sisa - v_ambil WHERE id = v_batch.id;
    v_total_consumed := v_total_consumed + v_ambil;
    v_sisa_kebutuhan := v_sisa_kebutuhan - v_ambil;
    IF v_first_batch_id IS NULL THEN v_first_batch_id := v_batch.id; END IF;

    v_nominal := v_ambil * v_batch.harga_satuan;
    IF v_kategori_id IS NOT NULL AND v_po_id IS NOT NULL AND v_nominal > 0 THEN
      INSERT INTO jurnal_entry (
        kategori_trx_id, jenis, nominal, tanggal, no_faktur,
        keterangan, qty, inventory_item_id, tag_po_ids, tenant_id, created_by
      ) VALUES (
        v_kategori_id, 'direct_bahan', v_nominal, CURRENT_DATE,
        'AUTO-BAHAN-' || to_char(CURRENT_DATE, 'YYYYMMDD'),
        'Pemakaian bahan: ' || v_item.nama,
        v_ambil, p_inventory_item_id,
        jsonb_build_array(v_po_id::TEXT), p_tenant_id, p_user_id
      );
    END IF;
  END LOOP;

  IF v_total_consumed > 0 THEN
    INSERT INTO pemakaian_bahan (
      bundle_id, po_item_id, inventory_item_id,
      qty_pakai, inventory_batch_id, rate_per_pcs, tenant_id
    ) VALUES (
      p_bundle_id, p_po_item_id, p_inventory_item_id,
      v_total_consumed, v_first_batch_id, p_rate_per_pcs, p_tenant_id
    ) ON CONFLICT DO NOTHING;
    UPDATE inventory_item SET stok_aktual = stok_aktual - v_total_consumed WHERE id = p_inventory_item_id;
  END IF;

  -- FASE 2: Stok kurang → deduct tetap jalan (boleh minus) + jurnal harga_referensi
  IF v_sisa_kebutuhan > 0 THEN
    UPDATE inventory_item SET stok_aktual = stok_aktual - v_sisa_kebutuhan WHERE id = p_inventory_item_id;

    v_nominal := v_sisa_kebutuhan * v_item.harga_referensi;
    IF v_kategori_id IS NOT NULL AND v_po_id IS NOT NULL AND v_nominal > 0 THEN
      INSERT INTO jurnal_entry (
        kategori_trx_id, jenis, nominal, tanggal, no_faktur,
        keterangan, qty, inventory_item_id, tag_po_ids, tenant_id, created_by
      ) VALUES (
        v_kategori_id, 'direct_bahan', v_nominal, CURRENT_DATE,
        'AUTO-BAHAN-' || to_char(CURRENT_DATE, 'YYYYMMDD'),
        'Pemakaian bahan (stok kurang): ' || v_item.nama,
        v_sisa_kebutuhan, p_inventory_item_id,
        jsonb_build_array(v_po_id::TEXT), p_tenant_id, p_user_id
      );
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'status',       CASE WHEN v_sisa_kebutuhan > 0 THEN 'stok_kurang' ELSE 'ok' END,
    'qty_consumed', p_qty_needed - v_sisa_kebutuhan,
    'qty_kurang',   v_sisa_kebutuhan,
    'sisa_stok',    v_item.stok_aktual - p_qty_needed,
    'item_nama',    v_item.nama
  );
END;
$$;


-- ════════════════════════════════════════════════════════════════
-- SQL 3: Ganti scan_terima_generic
-- Aksesori jahit/obras/dll: otomatis buat jurnal ter-tag ke PO
-- ════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION scan_terima_generic(
  p_barcode      TEXT,
  p_tahap        tahap_produksi,
  p_karyawan_id  UUID,
  p_qty          INT,
  p_user_id      UUID,
  p_tenant_id    TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_bundle            RECORD;
  v_tahap_status      TEXT;
  v_prev_tahap_status TEXT;
  v_scan_log_id       UUID;
  v_tahap_text        TEXT := p_tahap::TEXT;
  v_prev_tahap_text   TEXT;
  v_resolved_karyawan UUID := p_karyawan_id;
  v_aksesori          RECORD;
  v_qty_deduct        NUMERIC;
  v_po_id             UUID;
  v_kategori_id       UUID;
  v_nominal           NUMERIC;
BEGIN
  v_prev_tahap_text := CASE p_tahap
    WHEN 'jahit'          THEN 'cutting'
    WHEN 'lubang_kancing' THEN 'jahit'
    WHEN 'buang_benang'   THEN 'lubang_kancing'
    WHEN 'qc'             THEN 'buang_benang'
    WHEN 'steam'          THEN 'qc'
    WHEN 'packing'        THEN 'steam'
    ELSE NULL
  END;

  SELECT b.id, b.po_item_id, b.status_tahap,
         mp.id AS model_id, pi.po_id AS po_id
  INTO v_bundle
  FROM bundle b
  JOIN po_item pi      ON pi.id = b.po_item_id
  JOIN produk p        ON p.id  = pi.produk_id
  JOIN model_produk mp ON mp.id = p.model_id
  WHERE b.barcode = p_barcode AND b.tenant_id = p_tenant_id
  FOR UPDATE OF b;

  IF NOT FOUND THEN RAISE EXCEPTION 'Barcode tidak ditemukan: %', p_barcode; END IF;

  v_po_id := v_bundle.po_id;

  IF v_prev_tahap_text IS NOT NULL THEN
    v_prev_tahap_status := v_bundle.status_tahap -> v_prev_tahap_text ->> 'status';
    IF v_prev_tahap_status IS DISTINCT FROM 'selesai' THEN
      RAISE EXCEPTION 'Tahap % belum selesai.', v_prev_tahap_text;
    END IF;
  END IF;

  v_tahap_status := v_bundle.status_tahap -> v_tahap_text ->> 'status';
  IF v_tahap_status IS NOT NULL THEN
    RAISE EXCEPTION 'Bundle sudah di-scan di tahap ini (status: %)', v_tahap_status;
  END IF;

  IF v_resolved_karyawan IS NULL THEN
    SELECT default_karyawan_borongan_id INTO v_resolved_karyawan
    FROM settings WHERE tenant_id = p_tenant_id LIMIT 1;
  END IF;

  INSERT INTO scan_log (bundle_id, tahap, tipe, qty, karyawan_id, user_id, tenant_id)
  VALUES (v_bundle.id, p_tahap, 'terima', p_qty, v_resolved_karyawan, p_user_id, p_tenant_id)
  RETURNING id INTO v_scan_log_id;

  UPDATE bundle
  SET status_tahap = jsonb_set(status_tahap, ARRAY[v_tahap_text], jsonb_build_object(
    'status', 'terima', 'qty_terima', p_qty, 'waktu_terima', now(),
    'qty_selesai', NULL, 'waktu_selesai', NULL, 'karyawan_id', v_resolved_karyawan
  )) WHERE id = v_bundle.id;

  SELECT id INTO v_kategori_id
  FROM kategori_trx
  WHERE jenis = 'direct_bahan' AND aktif = TRUE AND tenant_id = p_tenant_id
  LIMIT 1;

  FOR v_aksesori IN
    SELECT ma.inventory_item_id, ma.qty_per_pcs,
           ii.harga_referensi, ii.nama AS item_nama
    FROM model_aksesori ma
    JOIN inventory_item ii ON ii.id = ma.inventory_item_id
    WHERE ma.model_id = v_bundle.model_id AND ma.tahap_pakai = p_tahap AND ma.tenant_id = p_tenant_id
  LOOP
    v_qty_deduct := v_aksesori.qty_per_pcs * p_qty;

    UPDATE inventory_item SET stok_aktual = stok_aktual - v_qty_deduct WHERE id = v_aksesori.inventory_item_id;

    INSERT INTO pemakaian_aksesori (bundle_id, inventory_item_id, qty_pakai, tahap, tenant_id)
    VALUES (v_bundle.id, v_aksesori.inventory_item_id, v_qty_deduct, p_tahap, p_tenant_id)
    ON CONFLICT (bundle_id, inventory_item_id, tahap) DO NOTHING;

    v_nominal := v_qty_deduct * v_aksesori.harga_referensi;
    IF v_kategori_id IS NOT NULL AND v_po_id IS NOT NULL AND v_nominal > 0 THEN
      INSERT INTO jurnal_entry (
        kategori_trx_id, jenis, nominal, tanggal, no_faktur,
        keterangan, qty, inventory_item_id, tag_po_ids, tenant_id, created_by
      ) VALUES (
        v_kategori_id, 'direct_bahan', v_nominal, CURRENT_DATE,
        'AUTO-AKS-' || to_char(CURRENT_DATE, 'YYYYMMDD'),
        'Pemakaian aksesori ' || v_tahap_text || ': ' || v_aksesori.item_nama,
        v_qty_deduct, v_aksesori.inventory_item_id,
        jsonb_build_array(v_po_id::TEXT), p_tenant_id, p_user_id
      );
    END IF;
  END LOOP;

  RETURN jsonb_build_object('scan_log_id', v_scan_log_id);
END;
$$;

GRANT EXECUTE ON FUNCTION scan_terima_generic(TEXT, tahap_produksi, UUID, INT, UUID, TEXT)
  TO authenticated;


-- ════════════════════════════════════════════════════════════════
-- SQL 4: Ganti scan_cutting_terima
-- Aksesori cutting: otomatis buat jurnal ter-tag ke PO
-- ════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION scan_cutting_terima(
  p_barcode      TEXT,
  p_karyawan_id  UUID,
  p_qty          INT,
  p_pemakaian    JSONB,
  p_user_id      UUID,
  p_tenant_id    TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_bundle         RECORD;
  v_cutting_status TEXT;
  v_scan_log_id    UUID;
  v_pem_item       JSONB;
  v_consume_result JSONB;
  v_stok_warnings  JSONB := '[]'::JSONB;
  v_pem_config     RECORD;
  v_qty_pakai      NUMERIC;
  v_aksesori       RECORD;
  v_qty_deduct     NUMERIC;
  v_po_id          UUID;
  v_kategori_id    UUID;
  v_nominal        NUMERIC;
BEGIN
  SELECT b.id, b.po_item_id, b.status_tahap,
         mp.id AS model_id, pi.po_id AS po_id
  INTO v_bundle
  FROM bundle b
  JOIN po_item pi      ON pi.id = b.po_item_id
  JOIN produk p        ON p.id  = pi.produk_id
  JOIN model_produk mp ON mp.id = p.model_id
  WHERE b.barcode = p_barcode AND b.tenant_id = p_tenant_id
  FOR UPDATE OF b;

  IF NOT FOUND THEN RAISE EXCEPTION 'Barcode tidak ditemukan: %', p_barcode; END IF;

  v_po_id := v_bundle.po_id;

  v_cutting_status := v_bundle.status_tahap -> 'cutting' ->> 'status';
  IF v_cutting_status = 'terima' OR v_cutting_status = 'selesai' THEN
    RAISE EXCEPTION 'Bundle sudah di-scan di tahap cutting (status: %)', v_cutting_status;
  END IF;

  -- Consume bahan baku
  IF jsonb_array_length(p_pemakaian) > 0 THEN
    FOR v_pem_item IN SELECT * FROM jsonb_array_elements(p_pemakaian)
    LOOP
      v_consume_result := consume_fifo_atomic(
        (v_pem_item ->> 'inventory_item_id')::UUID,
        ((v_pem_item ->> 'rate_per_pcs')::NUMERIC * p_qty),
        v_bundle.po_item_id, v_bundle.id,
        (v_pem_item ->> 'rate_per_pcs')::NUMERIC,
        p_user_id, p_tenant_id
      );
      IF v_consume_result ->> 'status' = 'stok_kurang' THEN
        v_stok_warnings := v_stok_warnings || jsonb_build_object(
          'item_nama', v_consume_result ->> 'item_nama',
          'qty_kurang', v_consume_result -> 'qty_kurang',
          'sisa_stok',  v_consume_result -> 'sisa_stok'
        );
      END IF;
    END LOOP;
  ELSE
    FOR v_pem_config IN
      SELECT DISTINCT inventory_item_id, rate_per_pcs FROM pemakaian_bahan
      WHERE po_item_id = v_bundle.po_item_id AND tenant_id = p_tenant_id
    LOOP
      v_consume_result := consume_fifo_atomic(
        v_pem_config.inventory_item_id,
        v_pem_config.rate_per_pcs * p_qty,
        v_bundle.po_item_id, v_bundle.id,
        v_pem_config.rate_per_pcs, p_user_id, p_tenant_id
      );
      IF v_consume_result ->> 'status' = 'stok_kurang' THEN
        v_stok_warnings := v_stok_warnings || jsonb_build_object(
          'item_nama', v_consume_result ->> 'item_nama',
          'qty_kurang', v_consume_result -> 'qty_kurang',
          'sisa_stok',  v_consume_result -> 'sisa_stok'
        );
      END IF;
    END LOOP;
  END IF;

  INSERT INTO scan_log (bundle_id, tahap, tipe, qty, karyawan_id, user_id, tenant_id)
  VALUES (v_bundle.id, 'cutting', 'terima', p_qty, p_karyawan_id, p_user_id, p_tenant_id)
  RETURNING id INTO v_scan_log_id;

  UPDATE bundle
  SET status_tahap = jsonb_set(status_tahap, '{cutting}', jsonb_build_object(
    'status', 'terima', 'qty_terima', p_qty, 'waktu_terima', now(),
    'qty_selesai', NULL, 'waktu_selesai', NULL, 'karyawan_id', p_karyawan_id
  )) WHERE id = v_bundle.id;

  SELECT id INTO v_kategori_id
  FROM kategori_trx
  WHERE jenis = 'direct_bahan' AND aktif = TRUE AND tenant_id = p_tenant_id
  LIMIT 1;

  FOR v_aksesori IN
    SELECT ma.inventory_item_id, ma.qty_per_pcs,
           ii.harga_referensi, ii.nama AS item_nama
    FROM model_aksesori ma
    JOIN inventory_item ii ON ii.id = ma.inventory_item_id
    WHERE ma.model_id = v_bundle.model_id AND ma.tahap_pakai = 'cutting' AND ma.tenant_id = p_tenant_id
  LOOP
    v_qty_deduct := v_aksesori.qty_per_pcs * p_qty;

    UPDATE inventory_item SET stok_aktual = stok_aktual - v_qty_deduct WHERE id = v_aksesori.inventory_item_id;

    INSERT INTO pemakaian_aksesori (bundle_id, inventory_item_id, qty_pakai, tahap, tenant_id)
    VALUES (v_bundle.id, v_aksesori.inventory_item_id, v_qty_deduct, 'cutting', p_tenant_id)
    ON CONFLICT (bundle_id, inventory_item_id, tahap) DO NOTHING;

    v_nominal := v_qty_deduct * v_aksesori.harga_referensi;
    IF v_kategori_id IS NOT NULL AND v_po_id IS NOT NULL AND v_nominal > 0 THEN
      INSERT INTO jurnal_entry (
        kategori_trx_id, jenis, nominal, tanggal, no_faktur,
        keterangan, qty, inventory_item_id, tag_po_ids, tenant_id, created_by
      ) VALUES (
        v_kategori_id, 'direct_bahan', v_nominal, CURRENT_DATE,
        'AUTO-AKS-' || to_char(CURRENT_DATE, 'YYYYMMDD'),
        'Pemakaian aksesori cutting: ' || v_aksesori.item_nama,
        v_qty_deduct, v_aksesori.inventory_item_id,
        jsonb_build_array(v_po_id::TEXT), p_tenant_id, p_user_id
      );
    END IF;
  END LOOP;

  RETURN jsonb_build_object('scan_log_id', v_scan_log_id, 'stok_warnings', v_stok_warnings);
END;
$$;

GRANT EXECUTE ON FUNCTION scan_cutting_terima(TEXT, UUID, INT, JSONB, UUID, TEXT)
  TO authenticated;


-- ════════════════════════════════════════════════════════════════
-- VERIFIKASI (jalankan setelah semua SQL di atas sukses)
-- ════════════════════════════════════════════════════════════════
-- SELECT column_name FROM information_schema.columns
-- WHERE table_name = 'inventory_item' AND column_name = 'harga_referensi';
-- Expected: 1 row

-- SELECT COUNT(*) FROM kategori_trx WHERE jenis = 'direct_bahan' AND aktif = TRUE;
-- Expected: >= 1 (jika 0, jurnal tidak akan dibuat — perlu tambah kategori dulu)
