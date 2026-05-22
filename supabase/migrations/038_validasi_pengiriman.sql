-- ================================================================
-- MIGRATION 038: Validasi Pengiriman (revised)
--
-- Fix dari percobaan pertama:
-- 1. sj_status ENUM hanya punya 'draft' dan 'final' — perlu ditambah nilai baru
-- 2. Semua SJ existing pakai status='final', bukan 'dikirim'
-- 3. qty_approval_request.scan_log_id NOT NULL — harus dibuat nullable dulu
-- 4. tahap_produksi ENUM tidak punya 'pengiriman' — harus ditambah
-- 5. po_item tidak punya harga_satuan — diambil dari hpp_estimasi sebagai proxy
--
-- Tambahan:
-- A. Extend enum sj_status → tambah dikirim, tervalidasi, selisih_kurang, selisih_lebih
-- B. Rename status 'final' → 'dikirim' (lebih deskriptif untuk flow pengiriman)
-- C. Update finalize_surat_jalan agar set status='dikirim'
-- D. Extend enum tahap_produksi → tambah 'pengiriman'
-- E. Buat scan_log_id nullable di qty_approval_request
-- F. Tambah kolom qty_diterima, catatan_validasi, dll.
-- G. Buat RPC validasi_pengiriman dan approve_qty_lebih_pengiriman
-- ================================================================


-- ── A. Extend sj_status ENUM ─────────────────────────────────────────────────
-- PostgreSQL tidak mendukung DROP VALUE dari enum, tapi bisa ADD VALUE

ALTER TYPE sj_status ADD VALUE IF NOT EXISTS 'dikirim';
ALTER TYPE sj_status ADD VALUE IF NOT EXISTS 'tervalidasi';
ALTER TYPE sj_status ADD VALUE IF NOT EXISTS 'selisih_kurang';
ALTER TYPE sj_status ADD VALUE IF NOT EXISTS 'selisih_lebih';


-- ── B. CATATAN: SJ lama tetap pakai status='final' — tidak perlu diupdate.
-- Filter di TypeScript sudah cover keduanya: 'final' (lama) dan 'dikirim' (baru).
-- SJ baru yang dibuat setelah migration ini akan pakai status='dikirim'.


-- ── C. Update finalize_surat_jalan → set status='dikirim' ────────────────────

CREATE OR REPLACE FUNCTION finalize_surat_jalan(
  p_klien_id  UUID,
  p_tanggal   DATE,
  p_items     JSONB,
  p_tenant_id TEXT,
  p_user_id   UUID
) RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_nomor_sj    TEXT;
  v_sj_id       UUID;
  v_bundle_item JSONB;
  v_bundle_id   UUID;
  v_qty_kirim   INT;
  v_year        INT  := EXTRACT(YEAR FROM p_tanggal);
  v_month       INT  := EXTRACT(MONTH FROM p_tanggal);
BEGIN
  -- Generate nomor SJ
  SELECT get_next_sj_number(p_tenant_id, v_year) INTO v_nomor_sj;

  -- INSERT header surat_jalan → status='dikirim' (bukan 'final')
  INSERT INTO surat_jalan (nomor_sj, klien_id, tanggal, status, catatan, tenant_id, created_by)
  VALUES (v_nomor_sj, p_klien_id, p_tanggal, 'dikirim', NULL, p_tenant_id, p_user_id)
  RETURNING id INTO v_sj_id;

  -- Auto-create invoice
  INSERT INTO invoice (
    nomor_invoice, surat_jalan_id, klien_id, tanggal,
    total_nilai, total_bayar, status, tenant_id, created_by
  )
  SELECT
    'INV-' || v_nomor_sj,
    v_sj_id,
    p_klien_id,
    p_tanggal,
    COALESCE(SUM(
      (item->>'qty_kirim')::INT *
      COALESCE(pi.hpp_estimasi, 0)
    ), 0),
    0,
    'belum_bayar',
    p_tenant_id,
    p_user_id
  FROM jsonb_array_elements(p_items) AS item
  JOIN bundle     b  ON b.id  = (item->>'bundle_id')::UUID
  JOIN po_item    pi ON pi.id = b.po_item_id;

  -- INSERT setiap bundle item
  FOR v_bundle_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_bundle_id := (v_bundle_item->>'bundle_id')::UUID;
    v_qty_kirim := (v_bundle_item->>'qty_kirim')::INT;

    INSERT INTO surat_jalan_item (sj_id, bundle_id, qty_kirim, tenant_id)
    VALUES (v_sj_id, v_bundle_id, v_qty_kirim, p_tenant_id);

    UPDATE bundle SET surat_jalan_id = v_sj_id WHERE id = v_bundle_id;
  END LOOP;

  RETURN v_nomor_sj;
END;
$$;

GRANT EXECUTE ON FUNCTION finalize_surat_jalan(UUID, DATE, JSONB, TEXT, UUID) TO authenticated;


-- ── D. Extend tahap_produksi ENUM → tambah 'pengiriman' ──────────────────────

ALTER TYPE tahap_produksi ADD VALUE IF NOT EXISTS 'pengiriman';


-- ── E. Buat scan_log_id nullable di qty_approval_request ─────────────────────

ALTER TABLE qty_approval_request
  ALTER COLUMN scan_log_id DROP NOT NULL;


-- ── F. Tambah kolom ke surat_jalan_item dan surat_jalan ──────────────────────

ALTER TABLE surat_jalan_item
  ADD COLUMN IF NOT EXISTS qty_diterima integer DEFAULT NULL;

ALTER TABLE surat_jalan
  ADD COLUMN IF NOT EXISTS catatan_validasi  text    DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS tanggal_validasi  date    DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS validated_by      uuid    REFERENCES auth.users(id);


-- ── G. RPC: validasi_pengiriman ───────────────────────────────────────────────
-- Input:
--   p_surat_jalan_id : uuid
--   p_items  : jsonb [{surat_jalan_item_id, bundle_id, qty_kirim, qty_diterima, alasan_reject_id?}]
--   p_catatan : text
--   p_user_id : uuid
--   p_tenant_id : text
-- Returns: jsonb { status, has_kurang, has_lebih, approval_ids }

DROP FUNCTION IF EXISTS validasi_pengiriman(uuid, jsonb, text, uuid, text);

CREATE OR REPLACE FUNCTION validasi_pengiriman(
  p_surat_jalan_id  uuid,
  p_items           jsonb,
  p_catatan         text,
  p_user_id         uuid,
  p_tenant_id       text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_item              jsonb;
  v_sji_id            uuid;
  v_bundle_id         uuid;
  v_qty_kirim         int;
  v_qty_diterima      int;
  v_selisih           int;
  v_alasan_reject_id  uuid;
  v_has_kurang        boolean := false;
  v_has_lebih         boolean := false;
  v_approval_ids      jsonb   := '[]'::jsonb;
  v_status_final      sj_status := 'tervalidasi';
  v_approval_id       uuid;
BEGIN
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_sji_id           := (v_item->>'surat_jalan_item_id')::uuid;
    v_bundle_id        := (v_item->>'bundle_id')::uuid;
    v_qty_kirim        := (v_item->>'qty_kirim')::int;
    v_qty_diterima     := (v_item->>'qty_diterima')::int;
    v_alasan_reject_id := NULLIF(v_item->>'alasan_reject_id', '')::uuid;
    v_selisih          := v_qty_diterima - v_qty_kirim;

    -- a. Update qty_diterima di surat_jalan_item
    UPDATE surat_jalan_item
    SET qty_diterima = v_qty_diterima
    WHERE id = v_sji_id AND tenant_id = p_tenant_id;

    -- b. Qty kurang → buat reject_log
    IF v_selisih < 0 THEN
      v_has_kurang := true;
      IF v_alasan_reject_id IS NOT NULL THEN
        INSERT INTO reject_log (
          alasan_reject_id, qty_reject, tahap_ditemukan,
          source, bundle_id, surat_jalan_id,
          keterangan, status, tenant_id, created_by
        ) VALUES (
          v_alasan_reject_id,
          ABS(v_selisih),
          'pengiriman',
          'pengiriman',
          v_bundle_id,
          p_surat_jalan_id,
          'Selisih validasi: kirim ' || v_qty_kirim || ' pcs, diterima ' || v_qty_diterima || ' pcs',
          'pending',
          p_tenant_id,
          p_user_id
        );
      END IF;
    END IF;

    -- c. Qty lebih → buat approval request (scan_log_id nullable setelah migration)
    IF v_selisih > 0 THEN
      v_has_lebih := true;
      INSERT INTO qty_approval_request (
        bundle_id, tahap,
        qty_diajukan, qty_default,
        status, tenant_id, created_by
      ) VALUES (
        v_bundle_id,
        'pengiriman',
        v_selisih,
        v_qty_kirim,
        'pending',
        p_tenant_id,
        p_user_id
      )
      RETURNING id INTO v_approval_id;

      v_approval_ids := v_approval_ids || jsonb_build_array(v_approval_id::text);
    END IF;
  END LOOP;

  -- Tentukan status final
  IF v_has_lebih THEN
    v_status_final := 'selisih_lebih';
  ELSIF v_has_kurang THEN
    v_status_final := 'selisih_kurang';
  END IF;

  UPDATE surat_jalan
  SET status           = v_status_final,
      catatan_validasi = p_catatan,
      tanggal_validasi = CURRENT_DATE,
      validated_by     = p_user_id
  WHERE id = p_surat_jalan_id AND tenant_id = p_tenant_id;

  RETURN jsonb_build_object(
    'status',       v_status_final,
    'has_kurang',   v_has_kurang,
    'has_lebih',    v_has_lebih,
    'approval_ids', v_approval_ids
  );
END;
$$;

GRANT EXECUTE ON FUNCTION validasi_pengiriman(uuid, jsonb, text, uuid, text) TO authenticated;


-- ── H. RPC: approve_qty_lebih_pengiriman ─────────────────────────────────────
-- Dipanggil setelah owner approve (verifikasi PIN di TypeScript layer).
-- nominal tambahan diambil dari hpp_estimasi sebagai proxy harga jual per pcs.

DROP FUNCTION IF EXISTS approve_qty_lebih_pengiriman(uuid, uuid, text, text);

CREATE OR REPLACE FUNCTION approve_qty_lebih_pengiriman(
  p_approval_id  uuid,
  p_user_id      uuid,
  p_catatan      text,
  p_tenant_id    text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_req          record;
  v_po_item      record;
  v_sj_id        uuid;
  v_invoice_id   uuid;
  v_tambahan     numeric;
  v_kategori_id  uuid;
BEGIN
  SELECT * INTO v_req
  FROM qty_approval_request
  WHERE id = p_approval_id AND tenant_id = p_tenant_id AND status = 'pending';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Approval request tidak ditemukan atau sudah diproses';
  END IF;

  -- Ambil hpp_estimasi dari po_item melalui bundle (sebagai proxy harga jual per pcs)
  SELECT pi.hpp_estimasi, pi.po_id INTO v_po_item
  FROM bundle  b
  JOIN po_item pi ON pi.id = b.po_item_id
  WHERE b.id = v_req.bundle_id AND b.tenant_id = p_tenant_id;

  v_tambahan := v_req.qty_diajukan * COALESCE(v_po_item.hpp_estimasi, 0);

  -- Cari SJ terkait bundle ini (via surat_jalan_item.sj_id — perhatikan kolom sj_id, bukan surat_jalan_id)
  SELECT sj.id INTO v_sj_id
  FROM surat_jalan      sj
  JOIN surat_jalan_item sji ON sji.sj_id = sj.id
  WHERE sji.bundle_id  = v_req.bundle_id
    AND sj.tenant_id   = p_tenant_id
    AND sj.status      = 'selisih_lebih'
  ORDER BY sj.created_at DESC
  LIMIT 1;

  -- Cari invoice
  IF v_sj_id IS NOT NULL THEN
    SELECT id INTO v_invoice_id
    FROM invoice
    WHERE surat_jalan_id = v_sj_id AND tenant_id = p_tenant_id
    LIMIT 1;
  END IF;

  -- Update total invoice
  IF v_invoice_id IS NOT NULL AND v_tambahan > 0 THEN
    UPDATE invoice
    SET total_nilai = total_nilai + v_tambahan
    WHERE id = v_invoice_id;
  END IF;

  -- Buat jurnal_entry pendapatan
  IF v_tambahan > 0 THEN
    SELECT id INTO v_kategori_id
    FROM kategori_trx
    WHERE jenis = 'pendapatan' AND aktif = TRUE AND tenant_id = p_tenant_id
    LIMIT 1;

    IF v_kategori_id IS NOT NULL THEN
      INSERT INTO jurnal_entry (
        kategori_trx_id, jenis, nominal, tanggal,
        no_faktur, keterangan, qty,
        tag_po_ids, tenant_id, created_by
      ) VALUES (
        v_kategori_id, 'pendapatan', v_tambahan, CURRENT_DATE,
        'AUTO-LEBIH-' || to_char(CURRENT_DATE, 'YYYYMMDD'),
        'Qty lebih diterima klien (approved): ' || COALESCE(p_catatan, ''),
        v_req.qty_diajukan,
        CASE WHEN v_po_item.po_id IS NOT NULL
             THEN jsonb_build_array(v_po_item.po_id::text)
             ELSE '[]'::jsonb
        END,
        p_tenant_id,
        p_user_id
      );
    END IF;
  END IF;

  -- Update status approval
  UPDATE qty_approval_request
  SET status        = 'approved',
      catatan_owner = p_catatan,
      resolved_by   = p_user_id,
      resolved_at   = now()
  WHERE id = p_approval_id;

  -- Jika semua approval untuk SJ ini sudah resolved → update ke tervalidasi
  IF v_sj_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM qty_approval_request qar
    JOIN surat_jalan_item     sji ON sji.bundle_id   = qar.bundle_id
    WHERE sji.sj_id     = v_sj_id          -- ← pakai sj_id, bukan surat_jalan_id
      AND qar.tahap     = 'pengiriman'
      AND qar.status    = 'pending'
      AND qar.tenant_id = p_tenant_id
  ) THEN
    UPDATE surat_jalan
    SET status = 'tervalidasi'
    WHERE id = v_sj_id AND tenant_id = p_tenant_id;
  END IF;

  RETURN jsonb_build_object(
    'success',    true,
    'tambahan',   v_tambahan,
    'invoice_id', v_invoice_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION approve_qty_lebih_pengiriman(uuid, uuid, text, text) TO authenticated;
