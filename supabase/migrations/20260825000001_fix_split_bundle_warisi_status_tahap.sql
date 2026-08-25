-- ================================================================
-- MIGRATION: Fix scan_split_bundle — bundle hasil split mewarisi
-- status_tahap tahap-tahap sebelumnya dari bundle induk
--
-- Bug: bundle baru hasil split (misal split di tahap jahit) dibuat
-- dengan status_tahap HANYA berisi key tahap yang di-split (mis. hanya
-- {jahit: {...}}), tanpa key 'cutting' dsb dari induknya. Akibatnya:
-- - getAntrianJahit() mensyaratkan status_tahap.cutting.status='selesai'
--   sebelum bundle boleh muncul di antrian/daftar jahit — bundle hasil
--   split gagal syarat ini dan JADI TIDAK TAMPIL SAMA SEKALI di daftar
--   "Sedang Proses", padahal sudah ditugaskan ke seorang penjahit.
--
-- Fix: bundle baru mewarisi seluruh status_tahap induk (semua tahap
-- sebelum tahap yang di-split), lalu key tahap yang di-split diganti
-- dengan data terima yang baru (bukan disalin dari induk, karena itu
-- justru bagian yang sedang "dipecah").
-- ================================================================

CREATE OR REPLACE FUNCTION scan_split_bundle(
  p_barcode           TEXT,
  p_tahap             tahap_produksi,
  p_qty_selesai       INT,
  p_karyawan_id_asli  UUID,
  p_karyawan_id_sisa  UUID,
  p_user_id           UUID,
  p_tenant_id         TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_bundle              RECORD;
  v_qty_terima          INT;
  v_qty_sisa            INT;
  v_new_barcode         TEXT;
  v_new_bundle_id       UUID;
  v_scan_log_selesai_id UUID;
  v_scan_log_terima_id  UUID;
  v_rate                NUMERIC;
  v_upah                NUMERIC := 0;
  v_gaji_entry_id       UUID    := NULL;
  v_split_count         INT;
  v_new_no_urut         INT;
  v_tahap_text          TEXT    := p_tahap::TEXT;
  v_child_status_tahap  JSONB;
BEGIN
  -- Kunci dan ambil data bundle asli
  SELECT b.id, b.po_id, b.po_item_id, b.status_tahap, b.barcode,
         b.no_urut, b.no_urut_po, pi.produk_id
  INTO v_bundle
  FROM bundle b
  JOIN po_item pi ON pi.id = b.po_item_id
  WHERE b.barcode = p_barcode
    AND b.tenant_id = p_tenant_id
  FOR UPDATE OF b;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Barcode tidak ditemukan: %', p_barcode;
  END IF;

  IF (v_bundle.status_tahap -> v_tahap_text ->> 'status') IS DISTINCT FROM 'terima' THEN
    RAISE EXCEPTION 'Bundle tidak dalam status terima di tahap %', v_tahap_text;
  END IF;

  v_qty_terima := (v_bundle.status_tahap -> v_tahap_text ->> 'qty_terima')::INT;

  IF p_qty_selesai <= 0 OR p_qty_selesai >= v_qty_terima THEN
    RAISE EXCEPTION 'Qty selesai harus antara 1 dan %', v_qty_terima - 1;
  END IF;

  v_qty_sisa := v_qty_terima - p_qty_selesai;

  -- Hitung suffix split: cek sudah berapa bundle hasil split dari barcode ini
  SELECT COUNT(*) INTO v_split_count
  FROM bundle
  WHERE barcode LIKE p_barcode || 's%'
    AND tenant_id = p_tenant_id;

  v_new_barcode := p_barcode || 's' || (v_split_count + 1)::TEXT;

  -- no_urut baru: ambil max dari PO ini + 1
  SELECT COALESCE(MAX(no_urut), 0) + 1 INTO v_new_no_urut
  FROM bundle
  WHERE po_id = v_bundle.po_id AND tenant_id = p_tenant_id;

  -- 1. Selesaikan bundle asli dengan qty_selesai
  INSERT INTO scan_log (bundle_id, tahap, tipe, qty, karyawan_id, user_id, tenant_id)
  VALUES (v_bundle.id, p_tahap, 'selesai'::scan_tipe, p_qty_selesai, p_karyawan_id_asli, p_user_id, p_tenant_id)
  RETURNING id INTO v_scan_log_selesai_id;

  UPDATE bundle
  SET status_tahap = jsonb_set(
    status_tahap,
    ARRAY[v_tahap_text],
    jsonb_set(
      jsonb_set(
        jsonb_set(status_tahap -> v_tahap_text,
          '{status}',       '"selesai"'),
        '{qty_selesai}',    to_jsonb(p_qty_selesai)),
      '{waktu_selesai}',  to_jsonb(now())
    )
  )
  WHERE id = v_bundle.id;

  -- 2. Hitung dan insert gaji untuk bundle asli
  SELECT hi.harga_satuan INTO v_rate
  FROM hpp_item hi
  JOIN hpp_komponen hk ON hi.komponen_id = hk.id
  WHERE hi.produk_id   = v_bundle.produk_id
    AND hk.tahap_produksi = p_tahap
    AND hi.tenant_id   = p_tenant_id;

  IF v_rate IS NOT NULL AND v_rate > 0 AND p_karyawan_id_asli IS NOT NULL THEN
    v_upah := v_rate * p_qty_selesai;
    INSERT INTO gaji_ledger (
      karyawan_id, tipe, total, tanggal,
      sumber_id, keterangan, status, tenant_id, created_by
    )
    VALUES (
      p_karyawan_id_asli, 'selesai'::gaji_ledger_tipe, v_upah, CURRENT_DATE,
      v_bundle.id::text,
      'Upah ' || v_tahap_text || ' - ' || p_barcode,
      'belum_lunas'::gaji_status, p_tenant_id, p_user_id
    )
    RETURNING id INTO v_gaji_entry_id;
  END IF;

  -- 3. Buat bundle baru untuk sisa pcs — mewarisi status_tahap tahap-tahap
  --    sebelumnya dari induk (cutting, dst), lalu ganti key tahap yang
  --    di-split dengan data terima yang baru (bukan salinan dari induk).
  v_child_status_tahap := (v_bundle.status_tahap - v_tahap_text) || jsonb_build_object(
    v_tahap_text, jsonb_build_object(
      'status',       'terima',
      'karyawan_id',  p_karyawan_id_sisa::text,
      'qty_terima',   v_qty_sisa,
      'waktu_terima', now()::text
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

  -- 4. Insert scan_log terima untuk bundle baru
  INSERT INTO scan_log (bundle_id, tahap, tipe, qty, karyawan_id, user_id, tenant_id)
  VALUES (v_new_bundle_id, p_tahap, 'terima'::scan_tipe, v_qty_sisa, p_karyawan_id_sisa, p_user_id, p_tenant_id)
  RETURNING id INTO v_scan_log_terima_id;

  RETURN jsonb_build_object(
    'original_scan_log_id', v_scan_log_selesai_id,
    'new_bundle_id',        v_new_bundle_id,
    'new_bundle_barcode',   v_new_barcode,
    'new_bundle_qty',       v_qty_sisa,
    'scan_log_terima_id',   v_scan_log_terima_id,
    'gaji_entry_id',        v_gaji_entry_id,
    'upah_nominal',         v_upah
  );
END;
$function$;
