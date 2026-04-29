-- ================================================================
-- MIGRATION 030: RPC kalkulasi biaya produksi dari tabel pemakaian
-- Laporan HPP aktual kini dinamis & retroaktif:
--   biaya_bahan_kain = pemakaian_bahan × inventory_batch.harga_satuan
--   biaya_aksesori   = pemakaian_aksesori × inventory_item.harga_referensi
-- Update harga_referensi kapan saja → laporan otomatis ikut berubah
-- ================================================================


-- ════════════════════════════════════════════════════════════════
-- RPC 1: Ringkasan biaya per PO (dipakai di getLaporanPOList)
-- ════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION get_biaya_pemakaian_per_po(p_tenant_id TEXT)
RETURNS TABLE (
  po_id            UUID,
  biaya_aksesori   NUMERIC,
  biaya_bahan_kain NUMERIC
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  WITH aks AS (
    SELECT
      pi.po_id,
      SUM(pa.qty_pakai * ii.harga_referensi) AS total
    FROM pemakaian_aksesori pa
    JOIN bundle       b  ON b.id  = pa.bundle_id           AND b.tenant_id  = p_tenant_id
    JOIN po_item      pi ON pi.id = b.po_item_id
    JOIN inventory_item ii ON ii.id = pa.inventory_item_id AND ii.tenant_id = p_tenant_id
    WHERE pa.tenant_id = p_tenant_id
    GROUP BY pi.po_id
  ),
  bhn AS (
    SELECT
      pi.po_id,
      SUM(pb.qty_pakai * ib.harga_satuan) AS total
    FROM pemakaian_bahan   pb
    JOIN inventory_batch   ib ON ib.id  = pb.inventory_batch_id
    JOIN po_item           pi ON pi.id  = pb.po_item_id
    WHERE pb.tenant_id = p_tenant_id
    GROUP BY pi.po_id
  ),
  all_po AS (
    SELECT po_id FROM aks
    UNION
    SELECT po_id FROM bhn
  )
  SELECT
    ap.po_id,
    COALESCE(aks.total, 0)::NUMERIC AS biaya_aksesori,
    COALESCE(bhn.total, 0)::NUMERIC AS biaya_bahan_kain
  FROM all_po ap
  LEFT JOIN aks ON aks.po_id = ap.po_id
  LEFT JOIN bhn ON bhn.po_id = ap.po_id;
$$;

GRANT EXECUTE ON FUNCTION get_biaya_pemakaian_per_po(TEXT) TO authenticated;


-- ════════════════════════════════════════════════════════════════
-- RPC 2: Breakdown detail per item untuk satu PO (dipakai di getPOHPPDetail)
-- ════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION get_biaya_pemakaian_detail_po(p_po_id UUID, p_tenant_id TEXT)
RETURNS TABLE (
  sumber       TEXT,
  item_nama    TEXT,
  tahap        TEXT,
  qty_pakai    NUMERIC,
  harga_satuan NUMERIC,
  subtotal     NUMERIC,
  tgl_pertama  DATE
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  -- Aksesori: dikelompokkan per item + tahap
  SELECT
    'aksesori'::TEXT                      AS sumber,
    ii.nama                               AS item_nama,
    pa.tahap::TEXT                        AS tahap,
    SUM(pa.qty_pakai)                     AS qty_pakai,
    ii.harga_referensi                    AS harga_satuan,
    SUM(pa.qty_pakai) * ii.harga_referensi AS subtotal,
    MIN(pa.created_at)::DATE              AS tgl_pertama
  FROM pemakaian_aksesori pa
  JOIN bundle        b  ON b.id  = pa.bundle_id            AND b.tenant_id  = p_tenant_id
  JOIN po_item       pi ON pi.id = b.po_item_id            AND pi.po_id     = p_po_id
  JOIN inventory_item ii ON ii.id = pa.inventory_item_id   AND ii.tenant_id = p_tenant_id
  WHERE pa.tenant_id = p_tenant_id
  GROUP BY ii.nama, pa.tahap, ii.harga_referensi

  UNION ALL

  -- Bahan kain: dikelompokkan per item + harga batch
  SELECT
    'bahan_kain'::TEXT                     AS sumber,
    ii.nama                                AS item_nama,
    'cutting'::TEXT                        AS tahap,
    SUM(pb.qty_pakai)                      AS qty_pakai,
    ib.harga_satuan                        AS harga_satuan,
    SUM(pb.qty_pakai) * ib.harga_satuan    AS subtotal,
    MIN(pb.created_at)::DATE               AS tgl_pertama
  FROM pemakaian_bahan    pb
  JOIN inventory_batch    ib ON ib.id  = pb.inventory_batch_id
  JOIN inventory_item     ii ON ii.id  = pb.inventory_item_id  AND ii.tenant_id = p_tenant_id
  JOIN po_item            pi ON pi.id  = pb.po_item_id         AND pi.po_id     = p_po_id
  WHERE pb.tenant_id = p_tenant_id
  GROUP BY ii.nama, ib.harga_satuan

  ORDER BY sumber, item_nama, tahap;
$$;

GRANT EXECUTE ON FUNCTION get_biaya_pemakaian_detail_po(UUID, TEXT) TO authenticated;
