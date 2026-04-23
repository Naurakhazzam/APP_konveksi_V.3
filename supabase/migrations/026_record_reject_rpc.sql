-- Migration 026: RPC record_reject
-- Mencatat reject setelah scan selesai, dengan dampak ke gaji_ledger

CREATE OR REPLACE FUNCTION record_reject(
  p_gaji_ledger_id  UUID,
  p_qty_reject      INTEGER,
  p_tipe_reject     TEXT,   -- 'rework' | 'cacat_bahan' | 'permanen'
  p_alasan          TEXT,
  p_tenant_id       TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_upah_nominal    NUMERIC;
  v_karyawan_id     UUID;
  v_potongan        NUMERIC := 0;
  v_new_row_id      UUID;
BEGIN
  -- Ambil upah dan karyawan dari row yang ada
  SELECT total, karyawan_id
    INTO v_upah_nominal, v_karyawan_id
    FROM gaji_ledger
   WHERE id = p_gaji_ledger_id
     AND tenant_id = p_tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'gaji_ledger row tidak ditemukan: %', p_gaji_ledger_id;
  END IF;

  IF p_tipe_reject = 'rework' THEN
    -- Tahan upah: update status → escrow
    UPDATE gaji_ledger
       SET status = 'escrow',
           keterangan = keterangan || ' [REWORK: ' || p_alasan || ']'
     WHERE id = p_gaji_ledger_id;

  ELSIF p_tipe_reject = 'cacat_bahan' THEN
    -- Potong 50%: insert row potongan baru
    v_potongan := ROUND(v_upah_nominal * 0.5, 0);
    INSERT INTO gaji_ledger (
      tenant_id, karyawan_id, tanggal, tipe, status,
      keterangan, total, qty, upah_per_pcs
    )
    SELECT
      p_tenant_id,
      v_karyawan_id,
      CURRENT_DATE,
      'reject_potong',
      'belum_lunas',
      'Potongan cacat bahan 50% — ' || p_alasan || ' (ref: ' || p_gaji_ledger_id::TEXT || ')',
      v_potongan,
      p_qty_reject,
      ROUND(v_potongan / NULLIF(p_qty_reject, 0), 0)
    RETURNING id INTO v_new_row_id;

  ELSIF p_tipe_reject = 'permanen' THEN
    -- Potong 100%: insert row potongan penuh
    v_potongan := v_upah_nominal;
    INSERT INTO gaji_ledger (
      tenant_id, karyawan_id, tanggal, tipe, status,
      keterangan, total, qty, upah_per_pcs
    )
    SELECT
      p_tenant_id,
      v_karyawan_id,
      CURRENT_DATE,
      'reject_potong',
      'belum_lunas',
      'Potongan reject permanen 100% — ' || p_alasan || ' (ref: ' || p_gaji_ledger_id::TEXT || ')',
      v_potongan,
      p_qty_reject,
      ROUND(v_potongan / NULLIF(p_qty_reject, 0), 0)
    RETURNING id INTO v_new_row_id;

  ELSE
    RAISE EXCEPTION 'tipe_reject tidak valid: %', p_tipe_reject;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'tipe', p_tipe_reject,
    'potongan', v_potongan,
    'reject_row_id', v_new_row_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION record_reject(UUID, INTEGER, TEXT, TEXT, TEXT) TO authenticated;
