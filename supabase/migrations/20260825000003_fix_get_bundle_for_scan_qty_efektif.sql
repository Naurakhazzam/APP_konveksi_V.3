-- ================================================================
-- MIGRATION: get_bundle_for_scan pakai qty efektif, bukan rencana
--
-- BUG DITEMUKAN: get_bundle_for_scan (dipakai oleh alur scan barcode
-- satuan di ScanSimpleClient — dipakai di stasiun Lubang Kancing,
-- Buang Benang, QC, Steam, Packing saat scan langsung via barcode
-- scanner) mengembalikan qty_per_bundle MENTAH dari po_item, tidak
-- peduli qty sebenarnya bundle itu (qty_aktual cutting, qty_terima/
-- qty_selesai tahap sebelumnya). Nilai ini dipakai sebagai default
-- qty di form — kalau operator tidak sadar perlu koreksi manual,
-- qty yang salah (rencana awal, bukan qty sebenarnya) ikut tercatat
-- di database, termasuk untuk bundle hasil Split.
--
-- Contoh nyata: bundle hasil Split jadi 7+7 pcs, tapi begitu discan
-- di Lubang Kancing, form menampilkan default 14 pcs (rencana awal
-- sebelum di-split) — kalau operator tidak ubah manual, qty 14 ikut
-- tercatat, upah & pemakaian bahan pun terhitung dobel.
--
-- Fix: qty efektif diambil dari tahap PALING AKHIR yang sudah
-- tersentuh pada bundle itu sendiri (qty_selesai diutamakan dari
-- qty_terima; cutting pakai qty_aktual), baru fallback ke
-- qty_per_bundle rencana kalau belum ada tahap apapun tersentuh.
-- ================================================================

CREATE OR REPLACE FUNCTION get_bundle_for_scan(p_barcode text, p_tenant_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_result       JSONB;
  v_status_tahap JSONB;
  v_qty_rencana  INT;
  v_qty_efektif  INT;
  v_tahap        TEXT;
  v_tahap_order  TEXT[] := ARRAY['packing','steam','qc','buang_benang','lubang_kancing','jahit','cutting'];
  v_info         JSONB;
BEGIN
  SELECT b.status_tahap, pi.qty_per_bundle
  INTO v_status_tahap, v_qty_rencana
  FROM bundle b
  JOIN po_item pi ON pi.id = b.po_item_id
  WHERE b.barcode = p_barcode AND b.tenant_id = p_tenant_id
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  v_qty_efektif := NULL;
  FOREACH v_tahap IN ARRAY v_tahap_order
  LOOP
    v_info := v_status_tahap -> v_tahap;
    IF v_info IS NOT NULL THEN
      IF v_tahap = 'cutting' THEN
        IF (v_info ->> 'qty_aktual') IS NOT NULL THEN
          v_qty_efektif := (v_info ->> 'qty_aktual')::INT;
          EXIT;
        END IF;
      ELSE
        IF (v_info ->> 'qty_selesai') IS NOT NULL THEN
          v_qty_efektif := (v_info ->> 'qty_selesai')::INT;
          EXIT;
        ELSIF (v_info ->> 'qty_terima') IS NOT NULL THEN
          v_qty_efektif := (v_info ->> 'qty_terima')::INT;
          EXIT;
        END IF;
      END IF;
    END IF;
  END LOOP;

  IF v_qty_efektif IS NULL THEN
    v_qty_efektif := v_qty_rencana;
  END IF;

  SELECT to_jsonb(q) || jsonb_build_object('qty_per_bundle', v_qty_efektif) INTO v_result
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

  RETURN v_result;
END;
$function$;
