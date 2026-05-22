-- ================================================================
-- MIGRATION 038: Validasi Pengiriman
--
-- Tambahan:
-- 1. Kolom qty_diterima di surat_jalan_item
-- 2. Kolom catatan_validasi, tanggal_validasi, validated_by di surat_jalan
-- 3. RPC validasi_pengiriman — handle 3 skenario (cocok / kurang / lebih)
-- 4. RPC approve_qty_lebih_pengiriman — approve selisih lebih + update invoice
-- ================================================================

-- ── 1. Tambah kolom di surat_jalan_item ─────────────────────────────────────
ALTER TABLE surat_jalan_item
  ADD COLUMN IF NOT EXISTS qty_diterima integer DEFAULT NULL;

-- ── 2. Tambah kolom di surat_jalan ──────────────────────────────────────────
ALTER TABLE surat_jalan
  ADD COLUMN IF NOT EXISTS catatan_validasi  text    DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS tanggal_validasi  date    DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS validated_by      uuid    REFERENCES auth.users(id);

-- ── 3. RPC: validasi_pengiriman ──────────────────────────────────────────────
-- Input:
--   p_surat_jalan_id : uuid
--   p_items          : jsonb  -- [{surat_jalan_item_id, bundle_id, qty_kirim, qty_diterima, harga_satuan, alasan_reject_id?}]
--   p_catatan        : text
--   p_user_id        : uuid
--   p_tenant_id      : text
--
-- Logic:
--   a. Update qty_diterima di setiap surat_jalan_item
--   b. qty_diterima < qty_kirim → buat reject_log (source=pengiriman)
--   c. qty_diterima > qty_kirim → buat qty_approval_request (tahap=pengiriman)
--   d. Update status surat_jalan sesuai hasil
--
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
  v_status_final      text    := 'tervalidasi';
  v_approval_id       uuid;
BEGIN
  -- Proses setiap item
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_sji_id           := (v_item->>'surat_jalan_item_id')::uuid;
    v_bundle_id        := (v_item->>'bundle_id')::uuid;
    v_qty_kirim        := (v_item->>'qty_kirim')::int;
    v_qty_diterima     := (v_item->>'qty_diterima')::int;
    v_alasan_reject_id := NULLIF(v_item->>'alasan_reject_id', '')::uuid;
    v_selisih          := v_qty_diterima - v_qty_kirim;

    -- a. Update qty_diterima
    UPDATE surat_jalan_item
    SET qty_diterima = v_qty_diterima
    WHERE id = v_sji_id AND tenant_id = p_tenant_id;

    -- b. Qty kurang → buat reject_log
    IF v_selisih < 0 THEN
      v_has_kurang := true;

      IF v_alasan_reject_id IS NOT NULL THEN
        INSERT INTO reject_log (
          alasan_reject_id,
          qty_reject,
          tahap_ditemukan,
          source,
          bundle_id,
          surat_jalan_id,
          keterangan,
          status,
          tenant_id,
          created_by
        ) VALUES (
          v_alasan_reject_id,
          ABS(v_selisih),
          'pengiriman',
          'pengiriman',
          v_bundle_id,
          p_surat_jalan_id,
          'Selisih validasi pengiriman: kirim ' || v_qty_kirim || ' pcs, diterima ' || v_qty_diterima || ' pcs',
          'pending',
          p_tenant_id,
          p_user_id
        );
      END IF;
    END IF;

    -- c. Qty lebih → buat approval request
    IF v_selisih > 0 THEN
      v_has_lebih := true;

      INSERT INTO qty_approval_request (
        bundle_id,
        tahap,
        qty_diajukan,
        qty_default,
        status,
        tenant_id,
        created_by
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

  -- Tentukan status final SJ
  IF v_has_lebih THEN
    v_status_final := 'selisih_lebih';
  ELSIF v_has_kurang THEN
    v_status_final := 'selisih_kurang';
  END IF;

  -- Update status SJ
  UPDATE surat_jalan
  SET status           = v_status_final,
      catatan_validasi = p_catatan,
      tanggal_validasi = CURRENT_DATE,
      validated_by     = p_user_id
  WHERE id = p_surat_jalan_id AND tenant_id = p_tenant_id;

  RETURN jsonb_build_object(
    'status',      v_status_final,
    'has_kurang',  v_has_kurang,
    'has_lebih',   v_has_lebih,
    'approval_ids', v_approval_ids
  );
END;
$$;

GRANT EXECUTE ON FUNCTION validasi_pengiriman(uuid, jsonb, text, uuid, text) TO authenticated;


-- ── 4. RPC: approve_qty_lebih_pengiriman ─────────────────────────────────────
-- Dipanggil setelah owner approve (verifikasi PIN dilakukan di TypeScript layer).
-- Update invoice.total_nilai dan buat jurnal_entry pendapatan.
--
-- Input:
--   p_approval_id : uuid
--   p_user_id     : uuid
--   p_catatan     : text
--   p_tenant_id   : text
--
-- Returns: jsonb { success, tambahan, invoice_id }

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
  -- Ambil data approval request
  SELECT * INTO v_req
  FROM qty_approval_request
  WHERE id = p_approval_id AND tenant_id = p_tenant_id AND status = 'pending';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Approval request tidak ditemukan atau sudah diproses';
  END IF;

  -- Ambil harga_satuan dari po_item melalui bundle
  SELECT pi.harga_satuan, pi.po_id INTO v_po_item
  FROM bundle b
  JOIN po_item pi ON pi.id = b.po_item_id
  WHERE b.id = v_req.bundle_id AND b.tenant_id = p_tenant_id;

  -- Hitung tambahan pendapatan: qty_lebih × harga_satuan
  v_tambahan := v_req.qty_diajukan * COALESCE(v_po_item.harga_satuan, 0);

  -- Cari SJ terkait bundle ini (yang masih status selisih_lebih)
  SELECT sj.id INTO v_sj_id
  FROM surat_jalan sj
  JOIN surat_jalan_item sji ON sji.surat_jalan_id = sj.id
  WHERE sji.bundle_id = v_req.bundle_id
    AND sj.tenant_id  = p_tenant_id
    AND sj.status     = 'selisih_lebih'
  ORDER BY sj.created_at DESC
  LIMIT 1;

  -- Cari invoice yang terhubung ke SJ ini
  IF v_sj_id IS NOT NULL THEN
    SELECT id INTO v_invoice_id
    FROM invoice
    WHERE surat_jalan_id = v_sj_id AND tenant_id = p_tenant_id
    LIMIT 1;
  END IF;

  -- Update total_nilai invoice jika ada
  IF v_invoice_id IS NOT NULL AND v_tambahan > 0 THEN
    UPDATE invoice
    SET total_nilai = total_nilai + v_tambahan
    WHERE id = v_invoice_id;
  END IF;

  -- Buat jurnal_entry pendapatan jika ada nominal
  IF v_tambahan > 0 THEN
    SELECT id INTO v_kategori_id
    FROM kategori_trx
    WHERE jenis     = 'pendapatan'
      AND aktif     = TRUE
      AND tenant_id = p_tenant_id
    LIMIT 1;

    IF v_kategori_id IS NOT NULL THEN
      INSERT INTO jurnal_entry (
        kategori_trx_id,
        jenis,
        nominal,
        tanggal,
        no_faktur,
        keterangan,
        qty,
        tag_po_ids,
        tenant_id,
        created_by
      ) VALUES (
        v_kategori_id,
        'pendapatan',
        v_tambahan,
        CURRENT_DATE,
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

  -- Update status approval → approved
  UPDATE qty_approval_request
  SET status        = 'approved',
      catatan_owner = p_catatan,
      resolved_by   = p_user_id,
      resolved_at   = now()
  WHERE id = p_approval_id;

  -- Cek apakah semua approval untuk SJ ini sudah resolved
  -- Jika iya → update SJ status ke tervalidasi
  IF v_sj_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM qty_approval_request qar
    JOIN surat_jalan_item     sji ON sji.bundle_id        = qar.bundle_id
    WHERE sji.surat_jalan_id = v_sj_id
      AND qar.tahap          = 'pengiriman'
      AND qar.status         = 'pending'
      AND qar.tenant_id      = p_tenant_id
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
