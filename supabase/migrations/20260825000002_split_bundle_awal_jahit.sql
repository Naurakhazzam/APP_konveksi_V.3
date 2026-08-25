-- ================================================================
-- MIGRATION: split_bundle_awal_jahit — Split SEBELUM serah terima
--
-- Beda dengan scan_split_bundle (yang men-split bundle yang SUDAH
-- diserahterimakan/sedang dikerjakan): fungsi ini dipakai di tab
-- "Antrian" Jahit, untuk bundle yang BELUM diserahterimakan sama
-- sekali. Contoh: bundle hasil cutting 10 pcs, tapi cuma mau
-- ditugaskan 3 pcs ke seorang penjahit sekarang — sisanya (7 pcs)
-- tetap di Antrian, belum ditugaskan siapapun.
--
-- Meniru persis logika scan_jahit_terima (konsumsi aksesori FIFO via
-- consume_fifo_atomic, format status_tahap.jahit) supaya konsisten
-- dengan serah terima normal — bedanya di sini yang diserahterimakan
-- adalah BUNDLE BARU (hasil split), bukan bundle yang sudah ada.
-- ================================================================

CREATE OR REPLACE FUNCTION split_bundle_awal_jahit(
  p_barcode      TEXT,
  p_qty_assign   NUMERIC,
  p_karyawan_id  UUID,
  p_user_id      UUID,
  p_tenant_id    TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_bundle               RECORD;
  v_qty_total             NUMERIC;
  v_qty_sisa              NUMERIC;
  v_split_count           INT;
  v_new_barcode           TEXT;
  v_new_no_urut           INT;
  v_new_bundle_id         UUID;
  v_child_status_tahap    JSONB;
  v_scan_log_id           UUID;
  v_stok_warnings         JSONB := '[]'::JSONB;
  v_consume_result        JSONB;
  v_aksesori              RECORD;
  v_warna_id              UUID;
  v_qty_pakai             NUMERIC;
  v_kategori_aksesori_id  UUID;
BEGIN
  SELECT id INTO v_kategori_aksesori_id
  FROM kategori_trx
  WHERE nama = 'Pembelian Aksesori'
    AND jenis = 'direct_bahan'
    AND aktif = TRUE
    AND tenant_id = p_tenant_id
  LIMIT 1;

  SELECT b.id, b.po_id, b.po_item_id, b.status_tahap, b.barcode,
         b.no_urut_po, pi.warna, pi.qty_per_bundle, produk.model_id
  INTO v_bundle
  FROM bundle b
  JOIN po_item pi  ON pi.id = b.po_item_id
  JOIN produk      ON produk.id = pi.produk_id
  WHERE b.barcode   = p_barcode
    AND b.tenant_id = p_tenant_id
  FOR UPDATE OF b;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Barcode tidak ditemukan: %', p_barcode;
  END IF;

  IF (v_bundle.status_tahap -> 'cutting' ->> 'status') IS DISTINCT FROM 'selesai' THEN
    RAISE EXCEPTION 'Bundle belum selesai tahap Cutting';
  END IF;

  IF (v_bundle.status_tahap -> 'jahit' ->> 'status') IS NOT NULL THEN
    RAISE EXCEPTION 'Bundle sudah diserahterimakan di tahap Jahit — gunakan fitur Split biasa untuk membagi pekerjaan yang sedang berjalan';
  END IF;

  v_qty_total := COALESCE(
    (v_bundle.status_tahap -> 'cutting' ->> 'qty_aktual')::NUMERIC,
    v_bundle.qty_per_bundle
  );

  IF p_qty_assign IS NULL OR p_qty_assign <= 0 OR p_qty_assign >= v_qty_total THEN
    RAISE EXCEPTION 'Qty yang ditugaskan harus antara 1 dan % (kalau mau semua, pakai Serah Terima biasa)', v_qty_total - 1;
  END IF;

  v_qty_sisa := v_qty_total - p_qty_assign;

  -- Barcode baru untuk porsi yang ditugaskan sekarang — akhiran 'h' (handover
  -- split) supaya tidak tertukar dengan akhiran 's' dari Split biasa.
  SELECT COUNT(*) INTO v_split_count
  FROM bundle
  WHERE barcode LIKE p_barcode || 'h%'
    AND tenant_id = p_tenant_id;

  v_new_barcode := p_barcode || 'h' || (v_split_count + 1)::TEXT;

  SELECT COALESCE(MAX(no_urut), 0) + 1 INTO v_new_no_urut
  FROM bundle
  WHERE po_id = v_bundle.po_id AND tenant_id = p_tenant_id;

  -- Bundle baru mewarisi status_tahap induk (cutting, dll — belum ada jahit),
  -- TAPI qty_aktual cutting-nya disesuaikan jadi porsi yang di-split saja
  -- (bukan angka penuh induknya) — supaya Total QTY di Antrian Cutting tidak
  -- dobel-hitung antara induk (sisa) dan bundle baru ini (porsi ditugaskan).
  v_child_status_tahap := jsonb_set(
    v_bundle.status_tahap,
    '{cutting,qty_aktual}',
    to_jsonb(p_qty_assign)
  ) || jsonb_build_object(
    'jahit', jsonb_build_object(
      'status',        'terima',
      'qty_terima',    p_qty_assign,
      'waktu_terima',  now(),
      'qty_selesai',   NULL,
      'waktu_selesai', NULL,
      'karyawan_id',   p_karyawan_id
    )
  );

  INSERT INTO bundle (
    barcode, po_id, po_item_id, no_urut, no_urut_po,
    parent_bundle_id, status_tahap, tenant_id, created_by
  )
  VALUES (
    v_new_barcode,
    v_bundle.po_id,
    v_bundle.po_item_id,
    v_new_no_urut,
    v_bundle.no_urut_po,
    v_bundle.id,
    v_child_status_tahap,
    p_tenant_id,
    p_user_id
  )
  RETURNING id INTO v_new_bundle_id;

  -- Konsumsi aksesori tahap jahit (FIFO) untuk qty yang ditugaskan —
  -- persis seperti scan_jahit_terima, tapi ditag ke bundle baru.
  SELECT id INTO v_warna_id
  FROM warna
  WHERE LOWER(nama) = LOWER(v_bundle.warna)
    AND tenant_id = p_tenant_id
  LIMIT 1;

  FOR v_aksesori IN
    SELECT inventory_item_id, qty_per_pcs
    FROM model_aksesori
    WHERE model_id    = v_bundle.model_id
      AND tenant_id   = p_tenant_id
      AND tahap_pakai = 'jahit'
      AND (warna_id IS NULL OR warna_id = v_warna_id)
  LOOP
    v_qty_pakai := v_aksesori.qty_per_pcs * p_qty_assign;
    v_consume_result := consume_fifo_atomic(
      v_aksesori.inventory_item_id,
      v_qty_pakai,
      v_bundle.po_item_id,
      v_new_bundle_id,
      v_aksesori.qty_per_pcs,
      p_user_id,
      p_tenant_id,
      v_kategori_aksesori_id,
      'jahit'
    );
    IF v_consume_result ->> 'status' = 'stok_kurang' THEN
      v_stok_warnings := v_stok_warnings || jsonb_build_object(
        'item_nama',  v_consume_result ->> 'item_nama',
        'qty_kurang', v_consume_result -> 'qty_kurang',
        'sisa_stok',  v_consume_result -> 'sisa_stok'
      );
    END IF;
  END LOOP;

  IF v_warna_id IS NOT NULL THEN
    FOR v_aksesori IN
      SELECT inventory_item_id, qty_per_pcs
      FROM warna_aksesori
      WHERE warna_id    = v_warna_id
        AND tenant_id   = p_tenant_id
        AND tahap_pakai = 'jahit'
    LOOP
      v_qty_pakai := v_aksesori.qty_per_pcs * p_qty_assign;
      v_consume_result := consume_fifo_atomic(
        v_aksesori.inventory_item_id,
        v_qty_pakai,
        v_bundle.po_item_id,
        v_new_bundle_id,
        v_aksesori.qty_per_pcs,
        p_user_id,
        p_tenant_id,
        v_kategori_aksesori_id,
        'jahit'
      );
      IF v_consume_result ->> 'status' = 'stok_kurang' THEN
        v_stok_warnings := v_stok_warnings || jsonb_build_object(
          'item_nama',  v_consume_result ->> 'item_nama',
          'qty_kurang', v_consume_result -> 'qty_kurang',
          'sisa_stok',  v_consume_result -> 'sisa_stok'
        );
      END IF;
    END LOOP;
  END IF;

  INSERT INTO scan_log (bundle_id, tahap, tipe, qty, karyawan_id, user_id, tenant_id)
  VALUES (v_new_bundle_id, 'jahit'::tahap_produksi, 'terima'::scan_tipe, p_qty_assign, p_karyawan_id, p_user_id, p_tenant_id)
  RETURNING id INTO v_scan_log_id;

  -- Bundle induk tinggal sisa qty-nya, tetap "belum diserahterimakan"
  -- (tidak ada key jahit) — otomatis tetap/kembali muncul di Antrian.
  UPDATE bundle
  SET status_tahap = jsonb_set(
    status_tahap,
    '{cutting,qty_aktual}',
    to_jsonb(v_qty_sisa)
  )
  WHERE id = v_bundle.id;

  RETURN jsonb_build_object(
    'scan_log_id',        v_scan_log_id,
    'new_bundle_id',      v_new_bundle_id,
    'new_bundle_barcode', v_new_barcode,
    'new_bundle_qty',     p_qty_assign,
    'parent_bundle_id',   v_bundle.id,
    'parent_sisa_qty',    v_qty_sisa,
    'stok_warnings',      v_stok_warnings
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION split_bundle_awal_jahit(TEXT, NUMERIC, UUID, UUID, TEXT)
  TO authenticated;
