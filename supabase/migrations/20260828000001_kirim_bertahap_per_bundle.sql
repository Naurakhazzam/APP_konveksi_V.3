-- ================================================================
-- MIGRATION: Kirim bertahap — sisa bundle tidak lagi hangus
--
-- BUG: pengiriman dicatat PER BUNDLE, bukan per pcs. Begitu bundle
-- masuk satu surat jalan — berapa pun qty_kirim-nya — seluruh bundle
-- dianggap terkirim:
--
--   1. finalize_surat_jalan mengisi bundle.surat_jalan_id tanpa peduli
--      qty_kirim < qty yang jadi;
--   2. getBundlesReadyToShip menyaring surat_jalan_id IS NULL, jadi
--      bundle langsung lenyap dari daftar barang belum terkirim;
--   3. dua tembok menghalangi pengiriman susulan:
--        - RPC: RAISE 'Bundle % sudah masuk Surat Jalan lain'
--        - DB : UNIQUE (bundle_id) di surat_jalan_item
--
-- Akibatnya kirim 7 dari 14 pcs = 7 pcs sisanya hangus permanen,
-- padahal barangnya nyata ada, upahnya sudah dibayar, bahannya sudah
-- terpakai. Nyata terjadi pada 8 bundle / 34 pcs:
--   PO-0081 Dark Grey M   14 jadi,  7 kirim -> 7 hangus (SJ/2026/00072)
--   PO-0077 Navy XL       16 jadi,  8 kirim -> 8 hangus
--   PO-0078 White XXXL    10 jadi,  4 kirim -> 6 hangus
--   PO-0078 Brown XXXL    10 jadi,  5 kirim -> 5 hangus
--   PO-0080 Black XXXL    12 jadi,  9 kirim -> 3 hangus
--   PO-0078 White L        8 jadi,  6 kirim -> 2 hangus
--   PO-0080 Black XL      12 jadi, 10 kirim -> 2 hangus
--   PO-0078 White M        5 jadi,  4 kirim -> 1 hangus
--
-- Fix: satu bundle boleh masuk BEBERAPA surat jalan. Sisa dihitung dari
-- total qty_kirim yang sudah tercatat, dan bundle baru dicap terkirim
-- (surat_jalan_id) setelah seluruh qty-nya benar-benar terkirim.
-- ================================================================

-- ── 1. Satu bundle boleh masuk beberapa surat jalan ──────────────
-- Yang tetap dilarang: bundle yang sama muncul dua kali di SATU surat
-- jalan (itu pasti salah input, bukan kiriman bertahap).
ALTER TABLE surat_jalan_item DROP CONSTRAINT IF EXISTS surat_jalan_item_bundle_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS surat_jalan_item_unik_per_sj
  ON surat_jalan_item (sj_id, bundle_id);


-- ── 2. finalize_surat_jalan: hitung sisa, bukan tolak mentah ─────
CREATE OR REPLACE FUNCTION public.finalize_surat_jalan(
  p_klien_id uuid, p_tanggal date, p_catatan text,
  p_bundles jsonb, p_tenant_id text DEFAULT 'STX-001'::text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tahun          INT;
  v_seq            INT;
  v_nomor_sj       TEXT;
  v_sj_id          UUID;
  v_bundle         JSONB;
  v_bundle_id      UUID;
  v_qty_kirim      INT;
  v_qty_jadi       INT;
  v_sudah_kirim    INT;
  v_sisa           INT;
  v_barcode        TEXT;
  v_alasan_lebih   TEXT;
BEGIN
  IF jsonb_array_length(p_bundles) = 0 THEN
    RAISE EXCEPTION 'Tidak ada bundle yang dipilih';
  END IF;

  -- ── Validasi ──
  FOR v_bundle IN SELECT * FROM jsonb_array_elements(p_bundles) LOOP
    v_bundle_id    := (v_bundle->>'bundle_id')::UUID;
    v_qty_kirim    := (v_bundle->>'qty_kirim')::INT;
    v_alasan_lebih := NULLIF(TRIM(v_bundle->>'alasan_lebih'), '');

    IF NOT EXISTS (
      SELECT 1 FROM bundle
      WHERE id = v_bundle_id
        AND (status_tahap->'packing'->>'status') = 'selesai'
        AND tenant_id = p_tenant_id
    ) THEN
      RAISE EXCEPTION 'Bundle % belum selesai tahap Packing', v_bundle_id;
    END IF;

    -- Qty yang benar-benar jadi: qty_selesai packing paling otoritatif,
    -- lalu qty_aktual cutting, terakhir rencana.
    SELECT b.barcode,
           COALESCE(
             (b.status_tahap->'packing'->>'qty_selesai')::INT,
             (b.status_tahap->'cutting'->>'qty_aktual')::INT,
             pi.qty_per_bundle
           )
    INTO v_barcode, v_qty_jadi
    FROM bundle b
    JOIN po_item pi ON pi.id = b.po_item_id
    WHERE b.id = v_bundle_id;

    SELECT COALESCE(SUM(qty_kirim), 0) INTO v_sudah_kirim
    FROM surat_jalan_item WHERE bundle_id = v_bundle_id;

    v_sisa := v_qty_jadi - v_sudah_kirim;

    IF v_sisa <= 0 THEN
      RAISE EXCEPTION 'Bundle % sudah terkirim seluruhnya (% pcs)', v_barcode, v_sudah_kirim;
    END IF;

    IF v_qty_kirim > v_sisa AND v_alasan_lebih IS NULL THEN
      RAISE EXCEPTION 'Qty kirim bundle % (%) melebihi sisa yang belum terkirim (% dari % pcs) — alasan wajib diisi',
        v_barcode, v_qty_kirim, v_sisa, v_qty_jadi;
    END IF;
  END LOOP;

  v_tahun := EXTRACT(YEAR FROM p_tanggal)::INT;

  INSERT INTO sj_sequence (tahun, tenant_id, last_sequence)
  VALUES (v_tahun, p_tenant_id, 1)
  ON CONFLICT (tahun, tenant_id)
  DO UPDATE SET last_sequence = sj_sequence.last_sequence + 1
  RETURNING last_sequence INTO v_seq;

  v_nomor_sj := 'SJ/' || v_tahun || '/' || LPAD(v_seq::TEXT, 5, '0');

  INSERT INTO surat_jalan (nomor_sj, klien_id, tanggal, status, catatan, tenant_id, created_by)
  VALUES (v_nomor_sj, p_klien_id, p_tanggal, 'final', p_catatan, p_tenant_id, auth.uid())
  RETURNING id INTO v_sj_id;

  -- ── Eksekusi ──
  FOR v_bundle IN SELECT * FROM jsonb_array_elements(p_bundles) LOOP
    v_bundle_id    := (v_bundle->>'bundle_id')::UUID;
    v_qty_kirim    := (v_bundle->>'qty_kirim')::INT;
    v_alasan_lebih := NULLIF(TRIM(v_bundle->>'alasan_lebih'), '');

    INSERT INTO surat_jalan_item (sj_id, bundle_id, qty_kirim, tenant_id)
    VALUES (v_sj_id, v_bundle_id, v_qty_kirim, p_tenant_id);

    SELECT COALESCE(
             (b.status_tahap->'packing'->>'qty_selesai')::INT,
             (b.status_tahap->'cutting'->>'qty_aktual')::INT,
             pi.qty_per_bundle
           )
    INTO v_qty_jadi
    FROM bundle b
    JOIN po_item pi ON pi.id = b.po_item_id
    WHERE b.id = v_bundle_id;

    SELECT COALESCE(SUM(qty_kirim), 0) INTO v_sudah_kirim
    FROM surat_jalan_item WHERE bundle_id = v_bundle_id;

    -- Baru dicap terkirim kalau SELURUH qty-nya sudah terkirim. Selama
    -- masih ada sisa, bundle tetap muncul di daftar barang belum terkirim.
    IF v_sudah_kirim >= v_qty_jadi THEN
      UPDATE bundle SET surat_jalan_id = v_sj_id
      WHERE id = v_bundle_id AND surat_jalan_id IS NULL;
    END IF;

    -- Kelebihan dari sisa tetap butuh persetujuan Owner
    IF v_sudah_kirim > v_qty_jadi THEN
      INSERT INTO qty_approval_request (
        bundle_id, tahap, qty_diajukan, qty_default,
        status, sumber, catatan_pengajuan, tenant_id, created_by
      ) VALUES (
        v_bundle_id, 'pengiriman', v_sudah_kirim - v_qty_jadi, v_qty_jadi,
        'pending', 'buat_surat_jalan', v_alasan_lebih, p_tenant_id, auth.uid()
      );
    END IF;
  END LOOP;

  INSERT INTO audit_log (user_id, modul, aksi, target, metadata, tenant_id)
  VALUES (
    auth.uid(), 'pengiriman', 'Buat Surat Jalan', v_sj_id::TEXT,
    jsonb_build_object(
      'nomor_sj', v_nomor_sj,
      'klien_id', p_klien_id,
      'jumlah_bundle', jsonb_array_length(p_bundles)
    ),
    p_tenant_id
  );

  RETURN v_nomor_sj;
END;
$function$;


-- ── 3. Buka kunci 8 bundle yang sisanya terlanjur hangus ─────────
-- Surat jalan & invoice yang sudah terbit TIDAK disentuh — hanya cap
-- "sudah terkirim" di bundle yang dilepas, supaya sisanya muncul lagi
-- di daftar barang belum terkirim.
UPDATE bundle b
SET surat_jalan_id = NULL
FROM po_item pi
WHERE pi.id = b.po_item_id
  AND b.tenant_id = 'STX-001'
  AND b.surat_jalan_id IS NOT NULL
  AND COALESCE((
        SELECT SUM(sji.qty_kirim) FROM surat_jalan_item sji WHERE sji.bundle_id = b.id
      ), 0) < COALESCE(
        (b.status_tahap->'packing'->>'qty_selesai')::INT,
        (b.status_tahap->'cutting'->>'qty_aktual')::INT,
        pi.qty_per_bundle
      );
