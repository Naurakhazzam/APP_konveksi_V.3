-- ============================================================
-- Migration 020: scan_terima_generic (v2 — with prev stage check)
-- ============================================================

CREATE OR REPLACE FUNCTION scan_terima_generic(
  p_barcode      TEXT,
  p_tahap        tahap_produksi,
  p_karyawan_id  UUID,       -- nullable: NULL = pakai default borongan
  p_qty          INT,
  p_user_id      UUID,
  p_tenant_id    TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_bundle           RECORD;
  v_tahap_status     TEXT;
  v_prev_tahap_status TEXT;
  v_scan_log_id      UUID;
  v_tahap_text       TEXT := p_tahap::TEXT;
  v_prev_tahap_text  TEXT;
  v_resolved_karyawan UUID := p_karyawan_id;
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

  -- 2. Lock bundle
  SELECT id, po_item_id, status_tahap
  INTO v_bundle
  FROM bundle
  WHERE barcode = p_barcode
    AND tenant_id = p_tenant_id
  FOR UPDATE;

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

  -- 5. Resolve karyawan: jika NULL, pakai default borongan dari settings
  IF v_resolved_karyawan IS NULL THEN
    SELECT default_karyawan_borongan_id
    INTO v_resolved_karyawan
    FROM settings
    WHERE tenant_id = p_tenant_id
    LIMIT 1;
  END IF;

  -- 6. Insert scan_log
  INSERT INTO scan_log (
    bundle_id, tahap, tipe, qty,
    karyawan_id, user_id, tenant_id
  )
  VALUES (
    v_bundle.id, p_tahap, 'terima', p_qty,
    v_resolved_karyawan, p_user_id, p_tenant_id
  )
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

  RETURN jsonb_build_object('scan_log_id', v_scan_log_id);
END;
$$;

GRANT EXECUTE ON FUNCTION scan_terima_generic(TEXT, tahap_produksi, UUID, INT, UUID, TEXT)
  TO authenticated;
