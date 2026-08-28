-- ================================================================
-- MIGRATION: Edit surat jalan tidak lagi menunggu pemegang PIN
--
-- Sebelumnya edit qty butuh PIN Owner di muka. Akibatnya pengiriman
-- berhenti menunggu orang yang memegang PIN — padahal koreksinya sering
-- sekadar salah ketik dan barangnya sudah siap berangkat.
--
-- Diubah mengikuti pola yang sudah dipakai untuk qty-lebih saat Buat
-- Surat Jalan: perubahan LANGSUNG BERLAKU supaya pengiriman jalan terus,
-- lalu tercatat sebagai pengajuan di halaman Validasi untuk dikonfirmasi
-- Owner belakangan. Alasan wajib diisi — itu yang dibaca Owner saat
-- memutuskan.
--
-- CATATAN PENTING soal "Tolak": barang sudah terlanjur dikirim dengan
-- qty yang baru, jadi penolakan TIDAK mengembalikan angka. Sama seperti
-- approval qty-lebih yang sudah ada, keputusan Owner berfungsi sebagai
-- catatan pemeriksaan — bukan pembatalan. Kalau angkanya memang harus
-- dikembalikan, itu dilakukan lewat edit lagi.
--
-- Ditambah kolom surat_jalan_id di qty_approval_request supaya Owner
-- tahu pengajuan ini berasal dari surat jalan yang mana, dan bisa
-- langsung membukanya.
-- ================================================================

ALTER TABLE qty_approval_request
  ADD COLUMN IF NOT EXISTS surat_jalan_id UUID REFERENCES surat_jalan(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS qty_approval_request_sj_idx
  ON qty_approval_request (surat_jalan_id);


-- ── Owner boleh memutuskan pengajuan dari edit surat jalan juga ──
CREATE OR REPLACE FUNCTION public.resolve_qty_lebih_kirim(
  p_approval_id uuid, p_status text, p_catatan text, p_user_id uuid, p_tenant_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_req RECORD;
BEGIN
  IF p_status NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'Status tidak valid: %', p_status;
  END IF;

  SELECT * INTO v_req
  FROM qty_approval_request
  WHERE id = p_approval_id
    AND tenant_id = p_tenant_id
    AND sumber IN ('buat_surat_jalan', 'edit_surat_jalan')
    AND status = 'pending';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Approval request tidak ditemukan atau sudah diproses';
  END IF;

  UPDATE qty_approval_request
  SET status        = p_status,
      catatan_owner = p_catatan,
      resolved_by   = p_user_id,
      resolved_at   = now()
  WHERE id = p_approval_id;

  RETURN jsonb_build_object('success', true, 'status', p_status);
END;
$function$;


-- ── edit_surat_jalan: catat pengajuan, tidak lagi menahan proses ──
CREATE OR REPLACE FUNCTION public.edit_surat_jalan(
  p_sj_id uuid, p_items jsonb, p_alasan text, p_user_id uuid, p_tenant_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_sj             RECORD;
  v_item           JSONB;
  v_item_id        UUID;
  v_qty_baru       INT;
  v_qty_lama       INT;
  v_bundle_id      UUID;
  v_qty_jadi       INT;
  v_lain           INT;
  v_barcode        TEXT;
  v_invoice_id     UUID;
  v_total_bayar    NUMERIC;
  v_jml_bayar      INT;
  v_jml_divalidasi INT;
  v_jml_reject     INT;
  v_sisa_item      INT;
  v_total_baru     NUMERIC;
  v_diubah         INT := 0;
  v_dihapus        INT := 0;
  v_bundles        UUID[] := ARRAY[]::UUID[];
  v_cap_sj         UUID;
  v_total_kirim    INT;
BEGIN
  IF p_alasan IS NULL OR TRIM(p_alasan) = '' THEN
    RAISE EXCEPTION 'Alasan perubahan wajib diisi';
  END IF;

  SELECT id, nomor_sj INTO v_sj
  FROM surat_jalan
  WHERE id = p_sj_id AND tenant_id = p_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Surat jalan tidak ditemukan';
  END IF;

  SELECT COUNT(*) FILTER (WHERE qty_diterima IS NOT NULL)
  INTO v_jml_divalidasi
  FROM surat_jalan_item WHERE sj_id = p_sj_id;

  IF v_jml_divalidasi > 0 THEN
    RAISE EXCEPTION 'Surat jalan % sudah divalidasi klien — tidak bisa diedit', v_sj.nomor_sj;
  END IF;

  SELECT COUNT(*) INTO v_jml_reject FROM reject_log WHERE surat_jalan_id = p_sj_id;
  IF v_jml_reject > 0 THEN
    RAISE EXCEPTION 'Surat jalan % punya catatan reject — tidak bisa diedit', v_sj.nomor_sj;
  END IF;

  SELECT i.id, COALESCE(i.total_bayar, 0) INTO v_invoice_id, v_total_bayar
  FROM invoice i WHERE i.surat_jalan_id = p_sj_id AND i.tenant_id = p_tenant_id LIMIT 1;

  IF v_invoice_id IS NOT NULL THEN
    SELECT COUNT(*) INTO v_jml_bayar FROM invoice_pembayaran WHERE invoice_id = v_invoice_id;
    IF v_jml_bayar > 0 OR v_total_bayar > 0 THEN
      RAISE EXCEPTION 'Invoice surat jalan % sudah menerima pembayaran — tidak bisa diedit', v_sj.nomor_sj;
    END IF;
  END IF;

  -- Validasi seluruh perubahan sebelum ada yang ditulis
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_item_id  := (v_item->>'surat_jalan_item_id')::UUID;
    v_qty_baru := (v_item->>'qty_kirim')::INT;

    SELECT sji.bundle_id, b.barcode,
           COALESCE(
             (b.status_tahap->'packing'->>'qty_selesai')::INT,
             (b.status_tahap->'cutting'->>'qty_aktual')::INT,
             pi.qty_per_bundle
           )
    INTO v_bundle_id, v_barcode, v_qty_jadi
    FROM surat_jalan_item sji
    JOIN bundle b ON b.id = sji.bundle_id
    JOIN po_item pi ON pi.id = b.po_item_id
    WHERE sji.id = v_item_id AND sji.sj_id = p_sj_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Item tidak ditemukan di surat jalan ini';
    END IF;

    IF v_qty_baru < 0 THEN
      RAISE EXCEPTION 'Qty tidak boleh negatif (%)', v_barcode;
    END IF;

    SELECT COALESCE(SUM(qty_kirim), 0) INTO v_lain
    FROM surat_jalan_item
    WHERE bundle_id = v_bundle_id AND sj_id <> p_sj_id;

    IF v_qty_baru + v_lain > v_qty_jadi THEN
      RAISE EXCEPTION 'Qty % untuk % melebihi yang tersedia — barang jadi % pcs, sudah terkirim % pcs di surat jalan lain',
        v_qty_baru, v_barcode, v_qty_jadi, v_lain;
    END IF;
  END LOOP;

  -- Eksekusi + catat pengajuan per baris yang berubah
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_item_id  := (v_item->>'surat_jalan_item_id')::UUID;
    v_qty_baru := (v_item->>'qty_kirim')::INT;

    SELECT bundle_id, qty_kirim INTO v_bundle_id, v_qty_lama
    FROM surat_jalan_item WHERE id = v_item_id;

    IF v_qty_lama IS DISTINCT FROM v_qty_baru THEN
      v_bundles := array_append(v_bundles, v_bundle_id);

      IF v_qty_baru = 0 THEN
        DELETE FROM surat_jalan_item WHERE id = v_item_id;
        v_dihapus := v_dihapus + 1;
      ELSE
        UPDATE surat_jalan_item SET qty_kirim = v_qty_baru WHERE id = v_item_id;
        v_diubah := v_diubah + 1;
      END IF;

      -- Perubahan sudah berlaku; ini catatan untuk dikonfirmasi Owner.
      INSERT INTO qty_approval_request (
        bundle_id, surat_jalan_id, tahap, qty_diajukan, qty_default,
        status, sumber, catatan_pengajuan, tenant_id, created_by
      ) VALUES (
        v_bundle_id, p_sj_id, 'pengiriman', v_qty_baru, v_qty_lama,
        'pending', 'edit_surat_jalan', TRIM(p_alasan), p_tenant_id, p_user_id
      );
    END IF;
  END LOOP;

  IF v_diubah = 0 AND v_dihapus = 0 THEN
    RAISE EXCEPTION 'Tidak ada perubahan untuk disimpan';
  END IF;

  SELECT COUNT(*) INTO v_sisa_item FROM surat_jalan_item WHERE sj_id = p_sj_id;
  IF v_sisa_item = 0 THEN
    RAISE EXCEPTION 'Surat jalan harus punya minimal satu barang. Kalau semuanya salah, batalkan saja surat jalannya.';
  END IF;

  WITH bernomor AS (
    SELECT id, ROW_NUMBER() OVER (ORDER BY urutan NULLS LAST, id) AS n
    FROM surat_jalan_item WHERE sj_id = p_sj_id
  )
  UPDATE surat_jalan_item sji SET urutan = bernomor.n
  FROM bernomor WHERE bernomor.id = sji.id;

  FOREACH v_bundle_id IN ARRAY v_bundles LOOP
    SELECT COALESCE(
             (b.status_tahap->'packing'->>'qty_selesai')::INT,
             (b.status_tahap->'cutting'->>'qty_aktual')::INT,
             pi.qty_per_bundle
           )
    INTO v_qty_jadi
    FROM bundle b JOIN po_item pi ON pi.id = b.po_item_id
    WHERE b.id = v_bundle_id;

    SELECT COALESCE(SUM(qty_kirim), 0) INTO v_total_kirim
    FROM surat_jalan_item WHERE bundle_id = v_bundle_id;

    IF v_total_kirim >= v_qty_jadi THEN
      SELECT sj_id INTO v_cap_sj FROM surat_jalan_item
      WHERE bundle_id = v_bundle_id ORDER BY created_at DESC LIMIT 1;
      UPDATE bundle SET surat_jalan_id = v_cap_sj
      WHERE id = v_bundle_id AND tenant_id = p_tenant_id;
    ELSE
      UPDATE bundle SET surat_jalan_id = NULL
      WHERE id = v_bundle_id AND tenant_id = p_tenant_id;
    END IF;
  END LOOP;

  IF v_invoice_id IS NOT NULL THEN
    SELECT COALESCE(SUM(sji.qty_kirim * COALESCE(pr.harga_jual, 0)), 0)
    INTO v_total_baru
    FROM surat_jalan_item sji
    JOIN bundle b   ON b.id  = sji.bundle_id
    JOIN po_item pi ON pi.id = b.po_item_id
    JOIN produk pr  ON pr.id = pi.produk_id
    WHERE sji.sj_id = p_sj_id;

    UPDATE invoice SET total_nilai = v_total_baru WHERE id = v_invoice_id;
  END IF;

  INSERT INTO audit_log (user_id, modul, aksi, target, metadata, tenant_id)
  VALUES (
    p_user_id, 'pengiriman', 'Edit Surat Jalan', v_sj.nomor_sj,
    jsonb_build_object(
      'nomor_sj',      v_sj.nomor_sj,
      'item_diubah',   v_diubah,
      'item_dihapus',  v_dihapus,
      'total_invoice', v_total_baru,
      'alasan',        TRIM(p_alasan)
    ),
    p_tenant_id
  );

  RETURN jsonb_build_object(
    'success',       true,
    'nomor_sj',      v_sj.nomor_sj,
    'item_diubah',   v_diubah,
    'item_dihapus',  v_dihapus,
    'sisa_item',     v_sisa_item,
    'total_invoice', COALESCE(v_total_baru, 0)
  );
END;
$function$;
