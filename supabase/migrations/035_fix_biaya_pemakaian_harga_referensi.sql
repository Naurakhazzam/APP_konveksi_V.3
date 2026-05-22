-- ================================================================
-- MIGRATION 035: Fix biaya pemakaian bahan — fallback ke harga_referensi
--
-- Masalah: get_biaya_pemakaian_per_po dan get_biaya_pemakaian_detail_po
-- hanya menghitung dari inventory_batch.harga_satuan (INNER JOIN).
-- Jika tidak ada batch (inventory_batch_id IS NULL), hasilnya 0.
--
-- Fix: Gunakan COALESCE(ib.harga_satuan, ii.harga_referensi, 0) sebagai
-- harga fallback ketika tidak ada batch pembelian — LEFT JOIN ke batch.
-- ================================================================


-- ════════════════════════════════════════════════════════════════
-- RPC 1: Ringkasan biaya per PO — dengan fallback harga_referensi
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
    JOIN bundle        b  ON b.id  = pa.bundle_id           AND b.tenant_id  = p_tenant_id
    JOIN po_item       pi ON pi.id = b.po_item_id
    JOIN inventory_item ii ON ii.id = pa.inventory_item_id  AND ii.tenant_id = p_tenant_id
    WHERE pa.tenant_id = p_tenant_id
    GROUP BY pi.po_id
  ),
  bhn AS (
    SELECT
      pi.po_id,
      -- Prioritas: harga dari batch (FIFO aktual)
      -- Fallback: harga_referensi dari inventory_item jika tidak ada batch
      SUM(
        pb.qty_pakai * COALESCE(ib.harga_satuan, ii.harga_referensi, 0)
      ) AS total
    FROM pemakaian_bahan   pb
    LEFT JOIN inventory_batch   ib ON ib.id  = pb.inventory_batch_id
    JOIN      inventory_item    ii ON ii.id  = pb.inventory_item_id AND ii.tenant_id = p_tenant_id
    JOIN      po_item           pi ON pi.id  = pb.po_item_id
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
-- RPC 2: Breakdown detail per item untuk satu PO — dengan fallback
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
  -- Aksesori: harga dari harga_referensi (sudah benar)
  SELECT
    'aksesori'::TEXT                        AS sumber,
    ii.nama                                 AS item_nama,
    pa.tahap::TEXT                          AS tahap,
    SUM(pa.qty_pakai)                       AS qty_pakai,
    ii.harga_referensi                      AS harga_satuan,
    SUM(pa.qty_pakai) * ii.harga_referensi  AS subtotal,
    MIN(pa.created_at)::DATE                AS tgl_pertama
  FROM pemakaian_aksesori pa
  JOIN bundle         b  ON b.id  = pa.bundle_id           AND b.tenant_id  = p_tenant_id
  JOIN po_item        pi ON pi.id = b.po_item_id           AND pi.po_id     = p_po_id
  JOIN inventory_item ii ON ii.id = pa.inventory_item_id  AND ii.tenant_id = p_tenant_id
  WHERE pa.tenant_id = p_tenant_id
  GROUP BY ii.nama, pa.tahap, ii.harga_referensi

  UNION ALL

  -- Bahan kain: fallback ke harga_referensi jika tidak ada batch
  SELECT
    'bahan_kain'::TEXT                                                        AS sumber,
    ii.nama                                                                   AS item_nama,
    'cutting'::TEXT                                                           AS tahap,
    SUM(pb.qty_pakai)                                                         AS qty_pakai,
    COALESCE(ib.harga_satuan, ii.harga_referensi, 0)                         AS harga_satuan,
    SUM(pb.qty_pakai) * COALESCE(ib.harga_satuan, ii.harga_referensi, 0)     AS subtotal,
    MIN(pb.created_at)::DATE                                                  AS tgl_pertama
  FROM pemakaian_bahan  pb
  LEFT JOIN inventory_batch   ib ON ib.id  = pb.inventory_batch_id
  JOIN      inventory_item    ii ON ii.id  = pb.inventory_item_id AND ii.tenant_id = p_tenant_id
  JOIN      po_item           pi ON pi.id  = pb.po_item_id        AND pi.po_id     = p_po_id
  WHERE pb.tenant_id = p_tenant_id
  GROUP BY ii.nama, COALESCE(ib.harga_satuan, ii.harga_referensi, 0)

  ORDER BY sumber, item_nama, tahap;
$$;

GRANT EXECUTE ON FUNCTION get_biaya_pemakaian_detail_po(UUID, TEXT) TO authenticated;
