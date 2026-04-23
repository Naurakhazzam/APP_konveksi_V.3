-- ============================================================
-- Migration 022: Update scan RPCs untuk QTY system + Aksesori
-- ============================================================

-- ============================================================
-- BAGIAN A: RPC scan_selesai (versi baru)
-- ============================================================
CREATE OR REPLACE FUNCTION scan_selesai(
  p_barcode           TEXT,
  p_tahap             tahap_produksi,
  p_karyawan_id       UUID,
  p_qty               INT,
  p_catatan           TEXT,
  p_alasan_qty_id     UUID,
  p_user_id           UUID,
  p_tenant_id         TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_bundle              RECORD;
  v_tahap_status        TEXT;
  v_qty_terima          INT;
  v_resolved_karyawan   UUID;
  v_scan_log_id         UUID;
  v_gaji_entry_id       UUID := NULL;
  v_upah                NUMERIC := 0;
  v_tahap_text          TEXT := p_tahap::TEXT;
  v_approval_request_id UUID := NULL;
  v_is_qty_lebih        BOOLEAN := false;
BEGIN
  -- 1. Lock bundle
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

  -- 3. Validasi status
  IF v_tahap_status IS NULL THEN
    RAISE EXCEPTION 'Bundle belum diterima di tahap ini: %', v_tahap_text;
  END IF;
  IF v_tahap_status = 'selesai' THEN
    RAISE EXCEPTION 'Bundle sudah selesai di tahap ini: %', v_tahap_text;
  END IF;

  -- 4. Validasi qty
  IF p_qty < v_qty_terima AND p_alasan_qty_id IS NULL THEN
    RAISE EXCEPTION 'Qty kurang dari yang diterima. Wajib pilih alasan.';
  END IF;

  IF p_qty > v_qty_terima THEN
    v_is_qty_lebih := true;
  END IF;

  -- 5. Tentukan karyawan
  IF p_tahap = 'cutting' OR p_tahap = 'jahit' THEN
    v_resolved_karyawan := p_karyawan_id;
  ELSE
    SELECT default_karyawan_borongan_id
    INTO v_resolved_karyawan
    FROM settings
    WHERE tenant_id = p_tenant_id
    LIMIT 1;
  END IF;

  -- 6. Insert scan_log
  INSERT INTO scan_log (
    bundle_id, tahap, tipe, qty, karyawan_id,
    catatan, alasan_qty_id, is_qty_lebih,
    user_id, tenant_id
  )
  VALUES (
    v_bundle.id, p_tahap, 'selesai', p_qty, v_resolved_karyawan,
    p_catatan, p_alasan_qty_id, v_is_qty_lebih,
    p_user_id, p_tenant_id
  )
  RETURNING id INTO v_scan_log_id;

  -- 7. Update bundle.status_tahap
  UPDATE bundle
  SET status_tahap = jsonb_set(
    status_tahap,
    ARRAY[v_tahap_text],
    jsonb_set(
      jsonb_set(
        jsonb_set(
          status_tahap -> v_tahap_text,
          '{status}',      '"selesai"'
        ),
        '{qty_selesai}', to_jsonb(p_qty)
      ),
      '{waktu_selesai}', to_jsonb(now())
    )
  )
  WHERE id = v_bundle.id;

  -- 8. Jika qty lebih: buat approval request
  IF v_is_qty_lebih THEN
    INSERT INTO qty_approval_request (
      scan_log_id, bundle_id, tahap,
      qty_diajukan, qty_default,
      tenant_id, created_by
    )
    VALUES (
      v_scan_log_id, v_bundle.id, p_tahap,
      p_qty, v_qty_terima,
      p_tenant_id, p_user_id
    )
    RETURNING id INTO v_approval_request_id;
  END IF;

  -- 9. Hitung upah dari hpp
  SELECT COALESCE(SUM(hi.qty * hi.harga_satuan * p_qty), 0)
  INTO v_upah
  FROM hpp_item hi
  JOIN hpp_komponen hk ON hk.id = hi.komponen_id
  WHERE hi.produk_id = v_bundle.produk_id
    AND hk.tahap_produksi = p_tahap
    AND hk.kategori = 'biaya_produksi';

  -- 10. Insert gaji_ledger jika ada upah
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
    'scan_log_id',          v_scan_log_id,
    'gaji_entry_id',        v_gaji_entry_id,
    'upah_nominal',         v_upah,
    'is_qty_lebih',         v_is_qty_lebih,
    'approval_request_id',  v_approval_request_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION scan_selesai(TEXT, tahap_produksi, UUID, INT, TEXT, UUID, UUID, TEXT)
  TO authenticated;


-- ============================================================
-- BAGIAN B: RPC resolve_qty_approval
-- ============================================================
CREATE OR REPLACE FUNCTION resolve_qty_approval(
  p_approval_id   UUID,
  p_action        TEXT,
  p_catatan       TEXT,
  p_user_id       UUID,
  p_tenant_id     TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_req           RECORD;
  v_bundle        RECORD;
  v_tahap_order   TEXT[] := ARRAY[
    'cutting','jahit','lubang_kancing','buang_benang','qc','steam','packing'
  ];
  v_start_idx     INT;
  v_i             INT;
  v_tahap         TEXT;
  v_stage_data    JSONB;
  v_new_qty       INT;
  v_status_tahap  JSONB;
BEGIN
  -- Validasi action
  IF p_action NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'Action tidak valid: %', p_action;
  END IF;

  -- Lock approval request
  SELECT * INTO v_req
  FROM qty_approval_request
  WHERE id = p_approval_id
    AND tenant_id = p_tenant_id
    AND status = 'pending'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Approval request tidak ditemukan atau sudah diproses';
  END IF;

  -- Tentukan qty baru setelah resolve
  v_new_qty := CASE
    WHEN p_action = 'approved' THEN v_req.qty_diajukan
    ELSE v_req.qty_default  -- rejected: revert ke qty_terima
  END;

  -- Lock bundle
  SELECT id, status_tahap INTO v_bundle
  FROM bundle
  WHERE id = v_req.bundle_id
    AND tenant_id = p_tenant_id
  FOR UPDATE;

  v_status_tahap := v_bundle.status_tahap;

  -- Cascade update: tahap saat ini + semua tahap sesudahnya yang sudah di-scan
  v_start_idx := array_position(v_tahap_order, v_req.tahap::TEXT);

  FOR v_i IN v_start_idx .. array_length(v_tahap_order, 1) LOOP
    v_tahap      := v_tahap_order[v_i];
    v_stage_data := v_status_tahap -> v_tahap;

    -- Skip jika tahap belum pernah di-scan
    CONTINUE WHEN v_stage_data IS NULL;

    -- Update qty_selesai di tahap asal (dan qty_terima di tahap sesudahnya)
    IF v_i = v_start_idx THEN
      -- Tahap ini: update qty_selesai
      v_status_tahap := jsonb_set(
        v_status_tahap,
        ARRAY[v_tahap, 'qty_selesai'],
        to_jsonb(v_new_qty)
      );
    ELSE
      -- Tahap berikutnya: update qty_terima (dan qty_selesai jika sudah selesai)
      v_status_tahap := jsonb_set(
        v_status_tahap,
        ARRAY[v_tahap, 'qty_terima'],
        to_jsonb(v_new_qty)
      );
      IF v_stage_data ->> 'status' = 'selesai' THEN
        v_status_tahap := jsonb_set(
          v_status_tahap,
          ARRAY[v_tahap, 'qty_selesai'],
          to_jsonb(v_new_qty)
        );
      END IF;
    END IF;
  END LOOP;

  -- Update bundle
  UPDATE bundle SET status_tahap = v_status_tahap WHERE id = v_bundle.id;

  -- Update approval request
  UPDATE qty_approval_request
  SET status       = p_action,
      catatan_owner = p_catatan,
      resolved_at  = now(),
      resolved_by  = p_user_id
  WHERE id = p_approval_id;

  RETURN jsonb_build_object('status', p_action, 'qty_final', v_new_qty);
END;
$$;

GRANT EXECUTE ON FUNCTION resolve_qty_approval(UUID, TEXT, TEXT, UUID, TEXT)
  TO authenticated;


-- ============================================================
-- BAGIAN C: Update scan_terima_generic — tambah auto-deduct aksesori
-- ============================================================
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
BEGIN
  -- 1. Tentukan tahap sebelumnya
  v_prev_tahap_text := CASE p_tahap
    WHEN 'jahit'          THEN 'cutting'
    WHEN 'lubang_kancing' THEN 'jahit'
    WHEN 'buang_benang'   THEN 'lubang_kancing'
    WHEN 'qc'             THEN 'buang_benang'
    WHEN 'steam'          THEN 'qc'
    WHEN 'packing'        THEN 'steam'
    ELSE NULL
  END;

  -- 2. Lock bundle + ambil model_id via relasi
  SELECT b.id, b.po_item_id, b.status_tahap,
         mp.id AS model_id
  INTO v_bundle
  FROM bundle b
  JOIN po_item pi  ON pi.id = b.po_item_id
  JOIN produk p    ON p.id  = pi.produk_id
  JOIN model_produk mp ON mp.id = p.model_id
  WHERE b.barcode = p_barcode
    AND b.tenant_id = p_tenant_id
  FOR UPDATE OF b;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Barcode tidak ditemukan: %', p_barcode;
  END IF;

  -- 3. Validasi: tahap sebelumnya harus sudah 'selesai'
  IF v_prev_tahap_text IS NOT NULL THEN
    v_prev_tahap_status := v_bundle.status_tahap -> v_prev_tahap_text ->> 'status';
    IF v_prev_tahap_status IS DISTINCT FROM 'selesai' THEN
      RAISE EXCEPTION 'Tahap % belum selesai. Bundle tidak bisa diterima di tahap %.',
        v_prev_tahap_text, v_tahap_text;
    END IF;
  END IF;

  -- 4. Cek tahap ini belum pernah di-scan
  v_tahap_status := v_bundle.status_tahap -> v_tahap_text ->> 'status';
  IF v_tahap_status IS NOT NULL THEN
    RAISE EXCEPTION 'Bundle sudah di-scan di tahap ini (status: %)', v_tahap_status;
  END IF;

  -- 5. Resolve karyawan
  IF v_resolved_karyawan IS NULL THEN
    SELECT default_karyawan_borongan_id
    INTO v_resolved_karyawan
    FROM settings
    WHERE tenant_id = p_tenant_id
    LIMIT 1;
  END IF;

  -- 6. Insert scan_log
  INSERT INTO scan_log (bundle_id, tahap, tipe, qty, karyawan_id, user_id, tenant_id)
  VALUES (v_bundle.id, p_tahap, 'terima', p_qty, v_resolved_karyawan, p_user_id, p_tenant_id)
  RETURNING id INTO v_scan_log_id;

  -- 7. Update bundle.status_tahap
  UPDATE bundle
  SET status_tahap = jsonb_set(
    status_tahap,
    ARRAY[v_tahap_text],
    jsonb_build_object(
      'status',        'terima',
      'qty_terima',    p_qty,
      'waktu_terima',  now(),
      'qty_selesai',   NULL,
      'waktu_selesai', NULL,
      'karyawan_id',   v_resolved_karyawan
    )
  )
  WHERE id = v_bundle.id;

  -- 8. Auto-deduct aksesori dari model_aksesori
  FOR v_aksesori IN
    SELECT ma.inventory_item_id, ma.qty_per_pcs
    FROM model_aksesori ma
    WHERE ma.model_id   = v_bundle.model_id
      AND ma.tahap_pakai = p_tahap
      AND ma.tenant_id  = p_tenant_id
  LOOP
    v_qty_deduct := v_aksesori.qty_per_pcs * p_qty;

    -- Deduct langsung dari stok_aktual (boleh minus)
    UPDATE inventory_item
    SET stok_aktual = stok_aktual - v_qty_deduct
    WHERE id = v_aksesori.inventory_item_id;

    -- Catat log pemakaian aksesori
    INSERT INTO pemakaian_aksesori (
      bundle_id, inventory_item_id, qty_pakai, tahap, tenant_id
    )
    VALUES (
      v_bundle.id, v_aksesori.inventory_item_id, v_qty_deduct, p_tahap, p_tenant_id
    )
    ON CONFLICT (bundle_id, inventory_item_id, tahap) DO NOTHING;
  END LOOP;

  RETURN jsonb_build_object('scan_log_id', v_scan_log_id);
END;
$$;

GRANT EXECUTE ON FUNCTION scan_terima_generic(TEXT, tahap_produksi, UUID, INT, UUID, TEXT)
  TO authenticated;


-- ============================================================
-- BAGIAN D: Update scan_cutting_terima — tambah auto-deduct aksesori
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
  v_aksesori       RECORD;
  v_qty_deduct     NUMERIC;
BEGIN
  -- 1. Lock bundle + ambil model_id
  SELECT b.id, b.po_item_id, b.status_tahap,
         mp.id AS model_id
  INTO v_bundle
  FROM bundle b
  JOIN po_item pi  ON pi.id = b.po_item_id
  JOIN produk p    ON p.id  = pi.produk_id
  JOIN model_produk mp ON mp.id = p.model_id
  WHERE b.barcode = p_barcode
    AND b.tenant_id = p_tenant_id
  FOR UPDATE OF b;

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

  -- 6. Auto-deduct aksesori cutting
  FOR v_aksesori IN
    SELECT ma.inventory_item_id, ma.qty_per_pcs
    FROM model_aksesori ma
    WHERE ma.model_id    = v_bundle.model_id
      AND ma.tahap_pakai = 'cutting'
      AND ma.tenant_id   = p_tenant_id
  LOOP
    v_qty_deduct := v_aksesori.qty_per_pcs * p_qty;
    UPDATE inventory_item
    SET stok_aktual = stok_aktual - v_qty_deduct
    WHERE id = v_aksesori.inventory_item_id;

    INSERT INTO pemakaian_aksesori (
      bundle_id, inventory_item_id, qty_pakai, tahap, tenant_id
    )
    VALUES (
      v_bundle.id, v_aksesori.inventory_item_id, v_qty_deduct, 'cutting', p_tenant_id
    )
    ON CONFLICT (bundle_id, inventory_item_id, tahap) DO NOTHING;
  END LOOP;

  RETURN jsonb_build_object(
    'scan_log_id',   v_scan_log_id,
    'stok_warnings', v_stok_warnings
  );
END;
$$;

GRANT EXECUTE ON FUNCTION scan_cutting_terima(TEXT, UUID, INT, JSONB, UUID, TEXT)
  TO authenticated;
