-- ============================================================
-- Migration 014: Scan Station RPCs
-- Fungsi-fungsi untuk alur scan produksi di Stitchlyx V3
-- ============================================================

-- ============================================================
-- RPC 1: consume_fifo_atomic
-- Konsumsi bahan baku dari inventory menggunakan FIFO per batch
-- ============================================================
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
BEGIN
  -- Lock inventory_item anti race condition
  SELECT id, nama, stok_aktual
  INTO v_item
  FROM inventory_item
  WHERE id = p_inventory_item_id
    AND tenant_id = p_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'status',       'stok_kurang',
      'qty_consumed', 0,
      'qty_kurang',   p_qty_needed,
      'sisa_stok',    0,
      'item_nama',    'Item tidak ditemukan'
    );
  END IF;

  -- Loop batch FIFO
  FOR v_batch IN
    SELECT id, qty_sisa
    FROM inventory_batch
    WHERE inventory_item_id = p_inventory_item_id
      AND tenant_id = p_tenant_id
      AND qty_sisa > 0
    ORDER BY tanggal_masuk ASC
    FOR UPDATE
  LOOP
    EXIT WHEN v_sisa_kebutuhan <= 0;

    v_ambil := LEAST(v_batch.qty_sisa, v_sisa_kebutuhan);

    UPDATE inventory_batch
    SET qty_sisa = qty_sisa - v_ambil
    WHERE id = v_batch.id;

    v_total_consumed  := v_total_consumed + v_ambil;
    v_sisa_kebutuhan  := v_sisa_kebutuhan - v_ambil;

    IF v_first_batch_id IS NULL THEN
      v_first_batch_id := v_batch.id;
    END IF;
  END LOOP;

  -- Simpan pemakaian jika ada yang terpakai
  IF v_total_consumed > 0 THEN
    INSERT INTO pemakaian_bahan (
      bundle_id, po_item_id, inventory_item_id,
      qty_pakai, inventory_batch_id, rate_per_pcs
    )
    VALUES (
      p_bundle_id, p_po_item_id, p_inventory_item_id,
      v_total_consumed, v_first_batch_id, p_rate_per_pcs
    )
    ON CONFLICT DO NOTHING;

    UPDATE inventory_item
    SET stok_aktual = stok_aktual - v_total_consumed
    WHERE id = p_inventory_item_id;
  END IF;

  -- Return hasil tanpa RAISE EXCEPTION jika stok kurang
  IF v_sisa_kebutuhan > 0 THEN
    RETURN jsonb_build_object(
      'status',       'stok_kurang',
      'qty_consumed', v_total_consumed,
      'qty_kurang',   v_sisa_kebutuhan,
      'sisa_stok',    GREATEST(0, v_item.stok_aktual - v_total_consumed),
      'item_nama',    v_item.nama
    );
  END IF;

  RETURN jsonb_build_object(
    'status',       'ok',
    'qty_consumed', v_total_consumed,
    'qty_kurang',   0,
    'sisa_stok',    v_item.stok_aktual - v_total_consumed,
    'item_nama',    v_item.nama
  );
END;
$$;

GRANT EXECUTE ON FUNCTION consume_fifo_atomic(UUID, NUMERIC, UUID, UUID, NUMERIC, UUID, TEXT)
  TO authenticated;


-- ============================================================
-- RPC 2: scan_cutting_terima
-- Scan penerimaan bundle di tahap cutting
-- ============================================================
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
BEGIN
  -- 1. Lock bundle
  SELECT id, po_item_id, status_tahap
  INTO v_bundle
  FROM bundle
  WHERE barcode = p_barcode
    AND tenant_id = p_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Barcode tidak ditemukan: %', p_barcode;
  END IF;

  -- 2. Cek status cutting
  v_cutting_status := v_bundle.status_tahap -> 'cutting' ->> 'status';

  IF v_cutting_status = 'terima' OR v_cutting_status = 'selesai' THEN
    RAISE EXCEPTION 'Bundle sudah di-scan di tahap cutting (status: %)', v_cutting_status;
  END IF;

  -- 3. Consume bahan baku
  IF jsonb_array_length(p_pemakaian) > 0 THEN
    -- Dari input explicit
    FOR v_pem_item IN SELECT * FROM jsonb_array_elements(p_pemakaian)
    LOOP
      v_consume_result := consume_fifo_atomic(
        (v_pem_item ->> 'inventory_item_id')::UUID,
        ((v_pem_item ->> 'rate_per_pcs')::NUMERIC * p_qty),
        v_bundle.po_item_id,
        v_bundle.id,
        (v_pem_item ->> 'rate_per_pcs')::NUMERIC,
        p_user_id,
        p_tenant_id
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
    -- Dari config existing di pemakaian_bahan
    FOR v_pem_config IN
      SELECT DISTINCT inventory_item_id, rate_per_pcs
      FROM pemakaian_bahan
      WHERE po_item_id = v_bundle.po_item_id
        AND tenant_id = p_tenant_id
    LOOP
      v_qty_pakai := v_pem_config.rate_per_pcs * p_qty;
      v_consume_result := consume_fifo_atomic(
        v_pem_config.inventory_item_id,
        v_qty_pakai,
        v_bundle.po_item_id,
        v_bundle.id,
        v_pem_config.rate_per_pcs,
        p_user_id,
        p_tenant_id
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

  -- 4. Insert scan_log
  INSERT INTO scan_log (bundle_id, tahap, tipe, qty, karyawan_id, user_id, tenant_id)
  VALUES (v_bundle.id, 'cutting', 'terima', p_qty, p_karyawan_id, p_user_id, p_tenant_id)
  RETURNING id INTO v_scan_log_id;

  -- 5. Update bundle.status_tahap
  UPDATE bundle
  SET status_tahap = jsonb_set(
    status_tahap,
    '{cutting}',
    jsonb_build_object(
      'status',        'terima',
      'qty_terima',    p_qty,
      'waktu_terima',  now(),
      'qty_selesai',   NULL,
      'waktu_selesai', NULL,
      'karyawan_id',   p_karyawan_id
    )
  )
  WHERE id = v_bundle.id;

  RETURN jsonb_build_object(
    'scan_log_id',    v_scan_log_id,
    'stok_warnings',  v_stok_warnings
  );
END;
$$;

GRANT EXECUTE ON FUNCTION scan_cutting_terima(TEXT, UUID, INT, JSONB, UUID, TEXT)
  TO authenticated;


-- ============================================================
-- RPC 3: scan_selesai
-- Scan penyelesaian bundle pada semua tahap produksi
-- ============================================================
CREATE OR REPLACE FUNCTION scan_selesai(
  p_barcode      TEXT,
  p_tahap        tahap_produksi,
  p_karyawan_id  UUID,
  p_qty          INT,
  p_catatan      TEXT,
  p_user_id      UUID,
  p_tenant_id    TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_bundle             RECORD;
  v_tahap_status       TEXT;
  v_qty_terima         INT;
  v_resolved_karyawan  UUID;
  v_scan_log_id        UUID;
  v_gaji_entry_id      UUID := NULL;
  v_upah               NUMERIC := 0;
  v_tahap_text         TEXT := p_tahap::TEXT;
BEGIN
  -- 1. Lock bundle + ambil produk_id via po_item
  SELECT b.id, b.po_item_id, b.status_tahap, b.barcode,
         pi.produk_id
  INTO v_bundle
  FROM bundle b
  JOIN po_item pi ON pi.id = b.po_item_id
  WHERE b.barcode = p_barcode
    AND b.tenant_id = p_tenant_id
  FOR UPDATE OF b;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Barcode tidak ditemukan: %', p_barcode;
  END IF;

  -- 2. Ambil status dan qty_terima dari JSONB
  v_tahap_status := v_bundle.status_tahap -> v_tahap_text ->> 'status';
  v_qty_terima   := (v_bundle.status_tahap -> v_tahap_text ->> 'qty_terima')::INT;

  -- 3a. Validasi status
  IF v_tahap_status IS NULL THEN
    RAISE EXCEPTION 'Bundle belum diterima di tahap ini: %', v_tahap_text;
  END IF;

  IF v_tahap_status = 'selesai' THEN
    RAISE EXCEPTION 'Bundle sudah selesai di tahap ini: %', v_tahap_text;
  END IF;

  -- 3b. Validasi qty
  IF p_qty > v_qty_terima THEN
    RAISE EXCEPTION 'QTY melebihi yang diterima (diterima: %, input: %)', v_qty_terima, p_qty;
  END IF;

  -- 4. Tentukan karyawan
  IF p_tahap = 'cutting' OR p_tahap = 'jahit' THEN
    v_resolved_karyawan := p_karyawan_id;
  ELSE
    SELECT default_karyawan_borongan_id
    INTO v_resolved_karyawan
    FROM settings
    WHERE tenant_id = p_tenant_id
    LIMIT 1;
  END IF;

  -- 5. Insert scan_log
  INSERT INTO scan_log (bundle_id, tahap, tipe, qty, karyawan_id, catatan, user_id, tenant_id)
  VALUES (v_bundle.id, p_tahap, 'selesai', p_qty, v_resolved_karyawan, p_catatan, p_user_id, p_tenant_id)
  RETURNING id INTO v_scan_log_id;

  -- 6. Update bundle.status_tahap
  UPDATE bundle
  SET status_tahap = jsonb_set(
    status_tahap,
    ARRAY[v_tahap_text],
    jsonb_set(
      jsonb_set(
        jsonb_set(
          status_tahap -> v_tahap_text,
          '{status}',        '"selesai"'
        ),
        '{qty_selesai}',   to_jsonb(p_qty)
      ),
      '{waktu_selesai}',   to_jsonb(now())
    )
  )
  WHERE id = v_bundle.id;

  -- 7. Hitung upah dari hpp
  SELECT COALESCE(SUM(hi.qty * hi.harga_satuan * p_qty), 0)
  INTO v_upah
  FROM hpp_item hi
  JOIN hpp_komponen hk ON hk.id = hi.komponen_id
  WHERE hi.produk_id = v_bundle.produk_id
    AND hk.tahap_produksi = p_tahap
    AND hk.kategori = 'biaya_produksi';

  -- 8. Insert gaji_ledger jika ada upah
  IF v_upah > 0 THEN
    INSERT INTO gaji_ledger (
      karyawan_id, tipe, total, tanggal, sumber_id,
      keterangan, tenant_id, created_by
    )
    VALUES (
      v_resolved_karyawan, 'selesai', v_upah, CURRENT_DATE,
      v_scan_log_id::TEXT,
      v_tahap_text || ' - bundle ' || p_barcode,
      p_tenant_id, p_user_id
    )
    RETURNING id INTO v_gaji_entry_id;
  END IF;

  RETURN jsonb_build_object(
    'scan_log_id',    v_scan_log_id,
    'gaji_entry_id',  v_gaji_entry_id,
    'upah_nominal',   v_upah
  );
END;
$$;

GRANT EXECUTE ON FUNCTION scan_selesai(TEXT, tahap_produksi, UUID, INT, TEXT, UUID, TEXT)
  TO authenticated;


-- ============================================================
-- RPC 4: get_bundle_for_scan
-- Ambil detail bundle untuk tampilan UI scan station
-- ============================================================
CREATE OR REPLACE FUNCTION get_bundle_for_scan(
  p_barcode    TEXT,
  p_tenant_id  TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_result JSONB;
BEGIN
  SELECT to_jsonb(q) INTO v_result
  FROM (
    SELECT
      b.id,
      b.barcode,
      b.po_id,
      b.po_item_id,
      b.status_tahap,
      b.no_urut,
      po.no_po,
      k.nama                              AS klien_nama,
      pi.warna,
      pi.size,
      pi.qty_order,
      pi.qty_per_bundle,
      mp.nama                             AS model_nama,
      EXISTS (
        SELECT 1 FROM pemakaian_bahan pb
        WHERE pb.po_item_id = b.po_item_id
          AND pb.tenant_id = p_tenant_id
      )                                   AS has_pemakaian_config
    FROM bundle b
    JOIN po          ON po.id = b.po_id
    JOIN klien k     ON k.id  = po.klien_id
    JOIN po_item pi  ON pi.id = b.po_item_id
    LEFT JOIN produk        ON produk.id      = pi.produk_id
    LEFT JOIN model_produk mp ON mp.id        = produk.model_id
    WHERE b.barcode    = p_barcode
      AND b.tenant_id  = p_tenant_id
    LIMIT 1
  ) q;

  -- Return NULL bukan exception jika tidak ada
  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION get_bundle_for_scan(TEXT, TEXT)
  TO authenticated;
