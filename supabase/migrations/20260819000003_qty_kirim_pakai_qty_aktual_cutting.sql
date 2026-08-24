-- ================================================================
-- MIGRATION: finalize_surat_jalan pakai qty_aktual cutting sebagai baseline
--
-- Latar belakang: hasil cutting aktual (bundle.status_tahap.cutting.qty_aktual)
-- sekarang jadi acuan qty di semua tahap produksi setelahnya (lihat migration
-- terpisah di sisi TypeScript untuk Jahit/QC/Steam/Packing/dst). Supaya
-- konsisten, baseline "qty rencana" yang dipakai finalize_surat_jalan untuk
-- menentukan perlu-approval-atau-tidak juga harus ikut qty_aktual cutting
-- (kalau ada), bukan qty_per_bundle mentah dari po_item.
--
-- Tanpa ini, mengirim persis sejumlah hasil cutting aktual (misal 12 pcs,
-- padahal rencana awal 10) akan selalu dianggap "qty lebih" dan minta
-- approval PIN Owner terus-menerus — padahal itu bukan penyimpangan, itu
-- memang qty yang benar untuk bundle itu. Approval PIN Owner sekarang hanya
-- diminta kalau qty_kirim melebihi bahkan qty_aktual cutting itu sendiri.
-- ================================================================

CREATE OR REPLACE FUNCTION finalize_surat_jalan(
  p_klien_id    UUID,
  p_tanggal     DATE,
  p_catatan     TEXT,
  p_bundles     JSONB,
  p_tenant_id   TEXT DEFAULT 'STX-001'::TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tahun          INT;
  v_seq            INT;
  v_nomor_sj       TEXT;
  v_sj_id          UUID;
  v_bundle         JSONB;
  v_bundle_id      UUID;
  v_qty_kirim      INT;
  v_qty_rencana    INT;  -- baseline: qty_aktual cutting kalau ada, else qty_per_bundle po_item
  v_alasan_lebih   TEXT;
BEGIN
  -- Validasi: array bundles tidak boleh kosong
  IF jsonb_array_length(p_bundles) = 0 THEN
    RAISE EXCEPTION 'Tidak ada bundle yang dipilih';
  END IF;

  -- Validasi per-bundle: belum di SJ lain, packing selesai, dan kalau
  -- qty_kirim melebihi qty rencana (qty_aktual cutting kalau ada) maka
  -- alasan_lebih wajib diisi.
  FOR v_bundle IN SELECT * FROM jsonb_array_elements(p_bundles) LOOP
    v_bundle_id    := (v_bundle->>'bundle_id')::UUID;
    v_qty_kirim    := (v_bundle->>'qty_kirim')::INT;
    v_alasan_lebih := NULLIF(TRIM(v_bundle->>'alasan_lebih'), '');

    IF EXISTS (
      SELECT 1 FROM surat_jalan_item WHERE bundle_id = v_bundle_id
    ) THEN
      RAISE EXCEPTION 'Bundle % sudah masuk Surat Jalan lain', v_bundle_id;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM bundle
      WHERE id = v_bundle_id
        AND (status_tahap->'packing'->>'status') = 'selesai'
        AND tenant_id = p_tenant_id
    ) THEN
      RAISE EXCEPTION 'Bundle % belum selesai tahap Packing', v_bundle_id;
    END IF;

    SELECT COALESCE(
      (b.status_tahap->'cutting'->>'qty_aktual')::INT,
      pi.qty_per_bundle
    ) INTO v_qty_rencana
    FROM bundle b
    JOIN po_item pi ON pi.id = b.po_item_id
    WHERE b.id = v_bundle_id;

    IF v_qty_rencana IS NOT NULL AND v_qty_kirim > v_qty_rencana AND v_alasan_lebih IS NULL THEN
      RAISE EXCEPTION 'Qty kirim bundle % (%) melebihi qty rencana (%) — alasan wajib diisi', v_bundle_id, v_qty_kirim, v_qty_rencana;
    END IF;
  END LOOP;

  -- 1. Increment sequence nomor SJ untuk tahun ini
  v_tahun := EXTRACT(YEAR FROM p_tanggal)::INT;

  INSERT INTO sj_sequence (tahun, tenant_id, last_sequence)
  VALUES (v_tahun, p_tenant_id, 1)
  ON CONFLICT (tahun, tenant_id)
  DO UPDATE SET last_sequence = sj_sequence.last_sequence + 1
  RETURNING last_sequence INTO v_seq;

  -- 2. Generate format nomor SJ: SJ/YYYY/XXXXX
  v_nomor_sj := 'SJ/' || v_tahun || '/' || LPAD(v_seq::TEXT, 5, '0');

  -- 3. Insert header surat_jalan
  INSERT INTO surat_jalan (nomor_sj, klien_id, tanggal, status, catatan, tenant_id, created_by)
  VALUES (v_nomor_sj, p_klien_id, p_tanggal, 'final', p_catatan, p_tenant_id, auth.uid())
  RETURNING id INTO v_sj_id;

  -- 4. Insert setiap item + update bundle.surat_jalan_id + approval kalau lebih
  FOR v_bundle IN SELECT * FROM jsonb_array_elements(p_bundles) LOOP
    v_bundle_id    := (v_bundle->>'bundle_id')::UUID;
    v_qty_kirim    := (v_bundle->>'qty_kirim')::INT;
    v_alasan_lebih := NULLIF(TRIM(v_bundle->>'alasan_lebih'), '');

    INSERT INTO surat_jalan_item (sj_id, bundle_id, qty_kirim, tenant_id)
    VALUES (v_sj_id, v_bundle_id, v_qty_kirim, p_tenant_id);

    UPDATE bundle
    SET surat_jalan_id = v_sj_id
    WHERE id = v_bundle_id
      AND surat_jalan_id IS NULL;

    SELECT COALESCE(
      (b.status_tahap->'cutting'->>'qty_aktual')::INT,
      pi.qty_per_bundle
    ) INTO v_qty_rencana
    FROM bundle b
    JOIN po_item pi ON pi.id = b.po_item_id
    WHERE b.id = v_bundle_id;

    IF v_qty_rencana IS NOT NULL AND v_qty_kirim > v_qty_rencana THEN
      INSERT INTO qty_approval_request (
        bundle_id, tahap, qty_diajukan, qty_default,
        status, sumber, catatan_pengajuan, tenant_id, created_by
      ) VALUES (
        v_bundle_id, 'pengiriman', v_qty_kirim - v_qty_rencana, v_qty_rencana,
        'pending', 'buat_surat_jalan', v_alasan_lebih, p_tenant_id, auth.uid()
      );
    END IF;
  END LOOP;

  -- 5. Catat audit_log
  INSERT INTO audit_log (
    user_id, modul, aksi, target, metadata, tenant_id
  )
  VALUES (
    auth.uid(),
    'pengiriman',
    'Buat Surat Jalan',
    v_sj_id::TEXT,
    jsonb_build_object(
      'nomor_sj',       v_nomor_sj,
      'klien_id',       p_klien_id,
      'jumlah_bundle',  jsonb_array_length(p_bundles)
    ),
    p_tenant_id
  );

  RETURN v_nomor_sj;

EXCEPTION
  WHEN OTHERS THEN
    RAISE;

END;
$$;

GRANT EXECUTE ON FUNCTION finalize_surat_jalan(UUID, DATE, TEXT, JSONB, TEXT)
  TO authenticated;
