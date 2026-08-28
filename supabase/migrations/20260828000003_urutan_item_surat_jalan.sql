-- ================================================================
-- MIGRATION: Item surat jalan mengikuti urutan pencentangan
--
-- Isi surat jalan tampil dengan urutan yang terasa acak, karena tidak
-- ada kolom urutan sama sekali. Satu-satunya penanda waktu adalah
-- created_at, dan itu tidak bisa dipakai: nilainya berasal dari now()
-- yang KONSTAN sepanjang satu transaksi, sehingga seluruh item dalam
-- satu surat jalan punya timestamp yang persis sama dan tidak ada yang
-- memecah kembar itu.
--
-- Fix: tambah kolom urutan, diisi finalize_surat_jalan dari posisi
-- bundle di p_bundles — yang urutannya sudah mengikuti urutan
-- pencentangan di layar Buat Surat Jalan.
--
-- Data lama diberi urutan yang stabil (berdasarkan barcode) supaya
-- tampilannya tidak berubah-ubah tiap kali dibuka.
-- ================================================================

ALTER TABLE surat_jalan_item ADD COLUMN IF NOT EXISTS urutan INT;

-- Urutan stabil untuk surat jalan yang sudah terlanjur terbit
WITH bernomor AS (
  SELECT sji.id,
         ROW_NUMBER() OVER (PARTITION BY sji.sj_id ORDER BY b.barcode) AS n
  FROM surat_jalan_item sji
  JOIN bundle b ON b.id = sji.bundle_id
  WHERE sji.urutan IS NULL
)
UPDATE surat_jalan_item sji
SET urutan = bernomor.n
FROM bernomor
WHERE bernomor.id = sji.id;

CREATE INDEX IF NOT EXISTS surat_jalan_item_urutan_idx
  ON surat_jalan_item (sj_id, urutan);


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
  v_row            RECORD;
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

  -- WITH ORDINALITY dipakai supaya posisi bundle di p_bundles (yaitu urutan
  -- pencentangan di layar) tersimpan apa adanya sebagai kolom urutan.
  FOR v_row IN
    SELECT value, ordinality FROM jsonb_array_elements(p_bundles) WITH ORDINALITY
  LOOP
    v_bundle       := v_row.value;
    v_bundle_id    := (v_bundle->>'bundle_id')::UUID;
    v_qty_kirim    := (v_bundle->>'qty_kirim')::INT;
    v_alasan_lebih := NULLIF(TRIM(v_bundle->>'alasan_lebih'), '');

    INSERT INTO surat_jalan_item (sj_id, bundle_id, qty_kirim, urutan, tenant_id)
    VALUES (v_sj_id, v_bundle_id, v_qty_kirim, v_row.ordinality::INT, p_tenant_id);

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

    IF v_sudah_kirim >= v_qty_jadi THEN
      UPDATE bundle SET surat_jalan_id = v_sj_id
      WHERE id = v_bundle_id AND surat_jalan_id IS NULL;
    END IF;

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
