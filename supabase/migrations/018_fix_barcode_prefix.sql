-- =============================================================================
-- MIGRATION: 018_fix_barcode_prefix.sql
-- Tujuan: Fix bug double prefix "PO-PO" di generate_bundle_barcode().
-- Dibuat: 22 April 2026
-- Konteks: Fungsi lama menggunakan 'PO-' || p_no_po, padahal p_no_po sudah
--          mengandung 'PO-' (contoh: 'PO-0019'). Hasilnya barcode jadi
--          'PO-PO-0019-00212-bdl001'. Fix: hapus prefix 'PO-' yang hardcoded.
--
-- Format barcode setelah fix:
--   {no_po}-{5digit global}-bdl{3digit dalam PO}
--   Contoh: PO-0019-00212-bdl001
-- =============================================================================

CREATE OR REPLACE FUNCTION generate_bundle_barcode(
  p_no_po     TEXT,
  p_tenant_id TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_sequence  INT;
  v_no_urut   INT;
  v_barcode   TEXT;
BEGIN
  -- 1. Increment global sequence dengan row lock (atomic)
  UPDATE bundle_sequence
  SET    last_sequence = last_sequence + 1
  WHERE  tenant_id = p_tenant_id
  RETURNING last_sequence INTO v_sequence;

  IF v_sequence IS NULL THEN
    RAISE EXCEPTION 'bundle_sequence tidak ditemukan untuk tenant %', p_tenant_id;
  END IF;

  -- 2. Hitung no_urut bundle dalam PO ini (berapa bundle sudah ada di PO ini)
  SELECT COUNT(*) + 1
  INTO   v_no_urut
  FROM   bundle b
  JOIN   po p ON p.id = b.po_id
  WHERE  p.no_po     = p_no_po
    AND  b.tenant_id = p_tenant_id;

  -- 3. Bentuk barcode: {no_po}-{00001}-bdl{001}
  --    CATATAN: p_no_po sudah mengandung 'PO-' — tidak perlu prefix tambahan.
  v_barcode := p_no_po
    || '-'
    || lpad(v_sequence::TEXT, 5, '0')
    || '-bdl'
    || lpad(v_no_urut::TEXT, 3, '0');

  RETURN v_barcode;
END;
$$;

GRANT EXECUTE ON FUNCTION generate_bundle_barcode(TEXT, TEXT) TO authenticated;
