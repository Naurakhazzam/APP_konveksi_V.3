-- =============================================================================
-- MIGRATION 032: RPC kalkulasi biaya upah aktual per PO
--
-- Masalah sebelumnya: biaya_upah dihitung dari jurnal_entry.tag_po_ids,
-- sehingga satu pembayaran yang men-tag 3 PO akan dihitung 3× (double-count).
--
-- Solusi: trace langsung dari gaji_ledger → bundle → po_item → po_id.
-- Setiap entry gaji_ledger sudah terikat ke bundle spesifik (sumber_id = bundle.id),
-- sehingga alokasi upah per PO akurat berdasarkan pekerjaan aktual.
-- =============================================================================


-- ════════════════════════════════════════════════════════════════
-- RPC 1: Total biaya upah per PO (dipakai di getLaporanPOList)
-- ════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION get_biaya_upah_per_po(p_tenant_id TEXT)
RETURNS TABLE (
  po_id       UUID,
  biaya_upah  NUMERIC
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT
    pi.po_id,
    SUM(
      CASE
        WHEN gl.tipe IN ('selesai', 'rework') THEN  gl.total
        WHEN gl.tipe = 'reject_potong'        THEN -gl.total
        ELSE 0
      END
    )::NUMERIC AS biaya_upah
  FROM gaji_ledger gl
  JOIN bundle  b  ON b.id  = gl.sumber_id::UUID  AND b.tenant_id = p_tenant_id
  JOIN po_item pi ON pi.id = b.po_item_id
  WHERE gl.tenant_id = p_tenant_id
    AND gl.tipe IN ('selesai', 'rework', 'reject_potong')
    AND gl.status != 'cancelled'
    -- Filter hanya sumber_id yang berformat UUID (exclude 'SYSTEM' dan entry non-bundle)
    AND gl.sumber_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  GROUP BY pi.po_id
$$;

GRANT EXECUTE ON FUNCTION get_biaya_upah_per_po(TEXT) TO authenticated;


-- ════════════════════════════════════════════════════════════════
-- RPC 2: Breakdown detail upah per karyawan untuk satu PO
--        (dipakai di getPOHPPDetail — aktual_breakdown)
-- ════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION get_biaya_upah_detail_po(p_po_id UUID, p_tenant_id TEXT)
RETURNS TABLE (
  karyawan_nama  TEXT,
  tanggal        DATE,
  keterangan     TEXT,
  qty_bundle     NUMERIC,
  total          NUMERIC
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT
    k.nama                                         AS karyawan_nama,
    gl.tanggal::DATE                               AS tanggal,
    gl.keterangan                                  AS keterangan,
    COALESCE(pi.qty_per_bundle, 0)::NUMERIC        AS qty_bundle,
    CASE
      WHEN gl.tipe IN ('selesai', 'rework') THEN  gl.total
      WHEN gl.tipe = 'reject_potong'        THEN -gl.total
      ELSE 0
    END                                            AS total
  FROM gaji_ledger gl
  JOIN karyawan k  ON k.id  = gl.karyawan_id       AND k.tenant_id  = p_tenant_id
  JOIN bundle   b  ON b.id  = gl.sumber_id::UUID   AND b.tenant_id  = p_tenant_id
  JOIN po_item  pi ON pi.id = b.po_item_id          AND pi.po_id     = p_po_id
  WHERE gl.tenant_id = p_tenant_id
    AND gl.tipe IN ('selesai', 'rework', 'reject_potong')
    AND gl.status != 'cancelled'
    AND gl.sumber_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ORDER BY gl.tanggal, k.nama
$$;

GRANT EXECUTE ON FUNCTION get_biaya_upah_detail_po(UUID, TEXT) TO authenticated;
