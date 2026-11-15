-- Modal aksesori (termasuk puring) per bundle mengikuti FIFO (15 Nov 2026)
-- - pemakaian_aksesori.harga_pakai = modal FIFO saat dipakai (NULL = data lama → harga_referensi)
-- - consume_fifo_atomic (jalur jahit) mencatat harga_pakai; urutan LOT tanggal_masuk lalu created_at
-- - _pakai_aksesori_tahap (koreksi qty) kini juga FIFO
-- - _kembalikan_aksesori_tahap mengembalikan stok ke LOT (bukan hanya stok_aktual) & membalik jurnal FIFO
-- - _sesuaikan_aksesori_jahit (kurangi) ikut mengurangi harga_pakai proporsional
-- - Laporan biaya per PO memakai harga_pakai

ALTER TABLE pemakaian_aksesori ADD COLUMN IF NOT EXISTS harga_pakai numeric;

-- ─── consume_fifo_atomic (versi 9 argumen, dipakai jalur jahit) ───
CREATE OR REPLACE FUNCTION public.consume_fifo_atomic(p_inventory_item_id uuid, p_qty_needed numeric, p_po_item_id uuid, p_bundle_id uuid, p_rate_per_pcs numeric, p_user_id uuid, p_tenant_id text, p_kategori_trx_id uuid DEFAULT NULL::uuid, p_tahap text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  v_total_nominal     NUMERIC := 0;
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

  IF p_kategori_trx_id IS NOT NULL THEN
    v_kategori_id := p_kategori_trx_id;
  ELSE
    SELECT id INTO v_kategori_id
    FROM kategori_trx
    WHERE jenis = 'direct_bahan' AND aktif = TRUE AND tenant_id = p_tenant_id
    LIMIT 1;
  END IF;

  FOR v_batch IN
    SELECT id, qty_sisa, harga_satuan
    FROM inventory_batch
    WHERE inventory_item_id = p_inventory_item_id
      AND tenant_id = p_tenant_id AND qty_sisa > 0
    ORDER BY tanggal_masuk ASC, created_at ASC
    FOR UPDATE
  LOOP
    EXIT WHEN v_sisa_kebutuhan <= 0;
    v_ambil := LEAST(v_batch.qty_sisa, v_sisa_kebutuhan);
    UPDATE inventory_batch SET qty_sisa = qty_sisa - v_ambil WHERE id = v_batch.id;
    v_total_consumed := v_total_consumed + v_ambil;
    v_sisa_kebutuhan := v_sisa_kebutuhan - v_ambil;
    IF v_first_batch_id IS NULL THEN v_first_batch_id := v_batch.id; END IF;

    v_nominal := v_ambil * v_batch.harga_satuan;
    v_total_nominal := v_total_nominal + COALESCE(v_nominal, 0);
    IF v_kategori_id IS NOT NULL AND v_po_id IS NOT NULL AND v_nominal > 0 THEN
      INSERT INTO jurnal_entry (
        kategori_trx_id, jenis, nominal, tanggal, no_faktur,
        keterangan, qty, inventory_item_id, tag_po_ids, tenant_id, created_by
      ) VALUES (
        v_kategori_id, 'direct_bahan', v_nominal, CURRENT_DATE,
        'AUTO-BAHAN-' || to_char(CURRENT_DATE, 'YYYYMMDD'),
        v_item.nama,
        v_ambil, p_inventory_item_id,
        jsonb_build_array(v_po_id::TEXT), p_tenant_id, p_user_id
      );
    END IF;
  END LOOP;

  IF v_sisa_kebutuhan > 0 THEN
    v_nominal := v_sisa_kebutuhan * v_item.harga_referensi;
    v_total_nominal := v_total_nominal + COALESCE(v_nominal, 0);
    IF v_kategori_id IS NOT NULL AND v_po_id IS NOT NULL AND v_nominal > 0 THEN
      INSERT INTO jurnal_entry (
        kategori_trx_id, jenis, nominal, tanggal, no_faktur,
        keterangan, qty, inventory_item_id, tag_po_ids, tenant_id, created_by
      ) VALUES (
        v_kategori_id, 'direct_bahan', v_nominal, CURRENT_DATE,
        'AUTO-BAHAN-' || to_char(CURRENT_DATE, 'YYYYMMDD'),
        v_item.nama,
        v_sisa_kebutuhan, p_inventory_item_id,
        jsonb_build_array(v_po_id::TEXT), p_tenant_id, p_user_id
      );
    END IF;
  END IF;

  IF p_qty_needed > 0 THEN
    UPDATE inventory_item SET stok_aktual = stok_aktual - p_qty_needed WHERE id = p_inventory_item_id;

    IF p_tahap IS NOT NULL AND p_tahap <> 'cutting' THEN
      -- Satu baris per bundle × item × tahap. Bila baris sudah ada, qty diurus
      -- pemanggil (seperti sebelumnya); modal FIFO ditambahkan di sini.
      INSERT INTO pemakaian_aksesori (bundle_id, inventory_item_id, qty_pakai, tahap, tenant_id, harga_pakai)
      VALUES (p_bundle_id, p_inventory_item_id, p_qty_needed, p_tahap::tahap_produksi, p_tenant_id, ROUND(v_total_nominal, 2))
      ON CONFLICT (bundle_id, inventory_item_id, tahap)
      DO UPDATE SET harga_pakai = COALESCE(pemakaian_aksesori.harga_pakai,
                                           pemakaian_aksesori.qty_pakai * v_item.harga_referensi)
                                  + EXCLUDED.harga_pakai;
    ELSIF v_total_consumed > 0 THEN
      INSERT INTO pemakaian_bahan (
        bundle_id, po_item_id, inventory_item_id,
        qty_pakai, inventory_batch_id, rate_per_pcs, tenant_id
      ) VALUES (
        p_bundle_id, p_po_item_id, p_inventory_item_id,
        v_total_consumed, v_first_batch_id, p_rate_per_pcs, p_tenant_id
      ) ON CONFLICT DO NOTHING;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'status',       CASE WHEN v_sisa_kebutuhan > 0 THEN 'stok_kurang' ELSE 'ok' END,
    'qty_consumed', p_qty_needed - v_sisa_kebutuhan,
    'qty_kurang',   v_sisa_kebutuhan,
    'sisa_stok',    v_item.stok_aktual - p_qty_needed,
    'item_nama',    v_item.nama,
    'nominal',      ROUND(v_total_nominal, 2)
  );
END;
$function$;

-- ─── _pakai_aksesori_tahap (dipakai koreksi qty): kini FIFO ───
CREATE OR REPLACE FUNCTION public._pakai_aksesori_tahap(p_bundle_id uuid, p_tahap text, p_qty numeric, p_user_id uuid, p_tenant_id text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_bundle      RECORD;
  v_aksesori    RECORD;
  v_qty_deduct  NUMERIC;
  v_kategori_id UUID;
  v_nominal     NUMERIC;
  v_sisa        NUMERIC;
  v_ambil       NUMERIC;
  v_batch       RECORD;
BEGIN
  IF COALESCE(p_qty, 0) <= 0 THEN RETURN; END IF;

  SELECT b.id, mp.id AS model_id, pi.po_id
  INTO v_bundle
  FROM bundle b
  JOIN po_item pi      ON pi.id = b.po_item_id
  JOIN produk p        ON p.id  = pi.produk_id
  JOIN model_produk mp ON mp.id = p.model_id
  WHERE b.id = p_bundle_id AND b.tenant_id = p_tenant_id;

  IF NOT FOUND THEN RETURN; END IF;

  SELECT id INTO v_kategori_id
  FROM kategori_trx
  WHERE jenis = 'direct_bahan' AND aktif = TRUE AND tenant_id = p_tenant_id
  LIMIT 1;

  FOR v_aksesori IN
    SELECT ma.inventory_item_id, ma.qty_per_pcs, ii.harga_referensi, ii.nama AS item_nama
    FROM model_aksesori ma
    JOIN inventory_item ii ON ii.id = ma.inventory_item_id
    WHERE ma.model_id = v_bundle.model_id AND ma.tahap_pakai::text = p_tahap
      AND ma.tenant_id = p_tenant_id
  LOOP
    v_qty_deduct := v_aksesori.qty_per_pcs * p_qty;
    v_sisa := v_qty_deduct; v_nominal := 0;

    FOR v_batch IN
      SELECT id, qty_sisa, harga_satuan FROM inventory_batch
      WHERE inventory_item_id = v_aksesori.inventory_item_id AND tenant_id = p_tenant_id AND qty_sisa > 0
      ORDER BY tanggal_masuk ASC, created_at ASC FOR UPDATE
    LOOP
      EXIT WHEN v_sisa <= 0;
      v_ambil := LEAST(v_batch.qty_sisa, v_sisa);
      UPDATE inventory_batch SET qty_sisa = qty_sisa - v_ambil WHERE id = v_batch.id;
      v_nominal := v_nominal + v_ambil * COALESCE(v_batch.harga_satuan, 0);
      v_sisa := v_sisa - v_ambil;
    END LOOP;
    IF v_sisa > 0 THEN v_nominal := v_nominal + v_sisa * COALESCE(v_aksesori.harga_referensi, 0); END IF;

    UPDATE inventory_item SET stok_aktual = stok_aktual - v_qty_deduct
    WHERE id = v_aksesori.inventory_item_id;

    INSERT INTO pemakaian_aksesori (bundle_id, inventory_item_id, qty_pakai, tahap, tenant_id, harga_pakai)
    VALUES (p_bundle_id, v_aksesori.inventory_item_id, v_qty_deduct, p_tahap::tahap_produksi, p_tenant_id, ROUND(v_nominal, 2))
    ON CONFLICT (bundle_id, inventory_item_id, tahap)
    DO UPDATE SET qty_pakai = pemakaian_aksesori.qty_pakai + EXCLUDED.qty_pakai,
                  harga_pakai = COALESCE(pemakaian_aksesori.harga_pakai,
                                         pemakaian_aksesori.qty_pakai * v_aksesori.harga_referensi)
                                + EXCLUDED.harga_pakai;

    IF v_kategori_id IS NOT NULL AND v_bundle.po_id IS NOT NULL AND v_nominal > 0 THEN
      INSERT INTO jurnal_entry (
        kategori_trx_id, jenis, nominal, tanggal, no_faktur,
        keterangan, qty, inventory_item_id, tag_po_ids, tenant_id, created_by
      ) VALUES (
        v_kategori_id, 'direct_bahan', ROUND(v_nominal, 2), CURRENT_DATE,
        'AUTO-AKS-' || to_char(CURRENT_DATE, 'YYYYMMDD'),
        'Pemakaian aksesori ' || p_tahap || ': ' || v_aksesori.item_nama,
        v_qty_deduct, v_aksesori.inventory_item_id,
        jsonb_build_array(v_bundle.po_id::TEXT), p_tenant_id, p_user_id
      );
    END IF;
  END LOOP;
END;
$function$;

-- ─── _kembalikan_aksesori_tahap: stok kembali ke LOT & jurnal FIFO ikut dibalik ───
CREATE OR REPLACE FUNCTION public._kembalikan_aksesori_tahap(p_bundle_id uuid, p_po_id uuid, p_tahap text, p_tenant_id text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_pakai  RECORD;
  v_jurnal RECORD;
  v_sisa   NUMERIC;
  v_ambil  NUMERIC;
BEGIN
  FOR v_pakai IN
    SELECT pa.id, pa.inventory_item_id, pa.qty_pakai, ii.nama AS item_nama
    FROM pemakaian_aksesori pa
    JOIN inventory_item ii ON ii.id = pa.inventory_item_id
    WHERE pa.bundle_id = p_bundle_id AND pa.tahap::text = p_tahap
    FOR UPDATE OF pa
  LOOP
    IF COALESCE(v_pakai.qty_pakai, 0) > 0 THEN
      PERFORM _kembalikan_stok_bahan(v_pakai.inventory_item_id, v_pakai.qty_pakai, p_tenant_id);

      v_sisa := v_pakai.qty_pakai;
      FOR v_jurnal IN
        SELECT id, qty, nominal
        FROM jurnal_entry
        WHERE tenant_id = p_tenant_id AND jenis = 'direct_bahan'
          AND inventory_item_id = v_pakai.inventory_item_id
          AND tag_po_ids @> jsonb_build_array(p_po_id::text)
          AND (keterangan LIKE ('Pemakaian aksesori ' || p_tahap || ':%') OR keterangan = v_pakai.item_nama)
          AND qty > 0
        ORDER BY created_at DESC
        FOR UPDATE
      LOOP
        EXIT WHEN v_sisa <= 0;
        v_ambil := LEAST(v_jurnal.qty, v_sisa);
        IF v_ambil >= v_jurnal.qty THEN
          DELETE FROM jurnal_entry WHERE id = v_jurnal.id;
        ELSE
          UPDATE jurnal_entry
          SET qty     = qty - v_ambil,
              nominal = GREATEST(round(nominal - nominal * v_ambil / v_jurnal.qty, 2), 0)
          WHERE id = v_jurnal.id;
        END IF;
        v_sisa := v_sisa - v_ambil;
      END LOOP;
    END IF;

    DELETE FROM pemakaian_aksesori WHERE id = v_pakai.id;
  END LOOP;
END;
$function$;

-- ─── Laporan biaya per PO: modal aksesori dari harga_pakai (FIFO) ───
CREATE OR REPLACE FUNCTION public.get_biaya_pemakaian_per_po(p_tenant_id text)
 RETURNS TABLE(po_id uuid, biaya_aksesori numeric, biaya_bahan_kain numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
  WITH aks AS (
    SELECT
      pi.po_id,
      SUM(COALESCE(pa.harga_pakai, pa.qty_pakai * ii.harga_referensi)) AS total
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
$function$;

CREATE OR REPLACE FUNCTION public.get_biaya_pemakaian_detail_po(p_po_id uuid, p_tenant_id text)
 RETURNS TABLE(sumber text, item_nama text, tahap text, qty_pakai numeric, harga_satuan numeric, subtotal numeric, tgl_pertama date)
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
  -- Aksesori: modal FIFO per bundle (harga_pakai); data lama → harga_referensi
  SELECT
    'aksesori'::TEXT                        AS sumber,
    ii.nama                                 AS item_nama,
    pa.tahap::TEXT                          AS tahap,
    SUM(pa.qty_pakai)                       AS qty_pakai,
    CASE WHEN SUM(pa.qty_pakai) > 0
         THEN ROUND(SUM(COALESCE(pa.harga_pakai, pa.qty_pakai * ii.harga_referensi)) / SUM(pa.qty_pakai), 2)
         ELSE ii.harga_referensi END        AS harga_satuan,
    SUM(COALESCE(pa.harga_pakai, pa.qty_pakai * ii.harga_referensi)) AS subtotal,
    MIN(pa.created_at)::DATE                AS tgl_pertama
  FROM pemakaian_aksesori pa
  JOIN bundle         b  ON b.id  = pa.bundle_id           AND b.tenant_id  = p_tenant_id
  JOIN po_item        pi ON pi.id = b.po_item_id           AND pi.po_id     = p_po_id
  JOIN inventory_item ii ON ii.id = pa.inventory_item_id  AND ii.tenant_id = p_tenant_id
  WHERE pa.tenant_id = p_tenant_id
  GROUP BY ii.nama, pa.tahap, ii.harga_referensi

  UNION ALL

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
$function$;

-- ─── Patch kecil pada fungsi yang ada (tanpa menulis ulang seluruhnya) ───
DO $$
DECLARE v_def text; v_new text;
BEGIN
  -- _sesuaikan_aksesori_jahit: saat qty jahit dikurangi, modal ikut berkurang proporsional
  SELECT pg_get_functiondef('public._sesuaikan_aksesori_jahit(uuid,numeric,uuid,text)'::regprocedure) INTO v_def;
  v_new := replace(v_def,
    'SET qty_pakai = GREATEST(qty_pakai - v_jumlah, 0)',
    'SET harga_pakai = CASE WHEN harga_pakai IS NOT NULL AND qty_pakai > 0 THEN ROUND(harga_pakai * GREATEST(qty_pakai - v_jumlah, 0) / qty_pakai, 2) ELSE harga_pakai END, qty_pakai = GREATEST(qty_pakai - v_jumlah, 0)');
  IF v_new = v_def THEN RAISE EXCEPTION 'Patch _sesuaikan_aksesori_jahit tidak menemukan targetnya'; END IF;
  EXECUTE v_new;

  -- _ambil_stok_bahan_fifo: LOT di hari yang sama diurutkan menurut jam masuk
  SELECT pg_get_functiondef('public._ambil_stok_bahan_fifo(uuid,numeric,text)'::regprocedure) INTO v_def;
  v_new := replace(v_def, 'ORDER BY tanggal_masuk ASC', 'ORDER BY tanggal_masuk ASC, created_at ASC');
  IF v_new = v_def THEN RAISE EXCEPTION 'Patch _ambil_stok_bahan_fifo tidak menemukan targetnya'; END IF;
  EXECUTE v_new;
END $$;
