-- =============================================================================
-- MIGRATION: 20261119_po_selesai_otomatis.sql
-- Tujuan : Status PO otomatis 'selesai' saat semua bundle yang masih hidup
--          (tidak ditutup) sudah masuk Surat Jalan, dan otomatis kembali
--          'aktif' bila ada pekerjaan baru (artikel tambahan, bundle sisa,
--          bundle dibuka lagi, bundle dikeluarkan dari SJ).
-- Dibuat : 19 November 2026
--
-- Latar  : Sebelumnya tidak ada proses yang pernah mengubah po.status ke
--          'selesai' (hanya 'dibatalkan'), sehingga kartu "PO Aktif" di
--          Monitoring/Dashboard menghitung 82 PO padahal 77 sudah terkirim.
--
-- Aturan selesai (keputusan owner 19 Nov 2026):
--   - PO punya minimal 1 bundle,
--   - setiap po_item punya minimal 1 bundle (artikel tanpa bundle = belum
--     dikerjakan → PO tetap aktif),
--   - tidak ada bundle hidup (ditutup_at IS NULL) yang surat_jalan_id-nya NULL.
--   Tidak menunggu validasi SJ. Kirim kurang dari order tetap selesai —
--   keterangannya dihitung di aplikasi (view v_po_ringkasan_kirim).
--   PO 'draft' / 'dibatalkan' tidak disentuh.
-- =============================================================================

-- 1. Fungsi inti: hitung ulang status satu PO ---------------------------------
CREATE OR REPLACE FUNCTION sinkron_status_po(p_po_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status  TEXT;
  v_selesai BOOLEAN;
BEGIN
  IF p_po_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT status::TEXT INTO v_status FROM po WHERE id = p_po_id;
  IF v_status IS NULL OR v_status NOT IN ('aktif', 'selesai') THEN
    RETURN v_status;
  END IF;

  v_selesai :=
        EXISTS (SELECT 1 FROM bundle b WHERE b.po_id = p_po_id)
    AND NOT EXISTS (
          SELECT 1 FROM po_item pi
          WHERE pi.po_id = p_po_id
            AND NOT EXISTS (SELECT 1 FROM bundle b WHERE b.po_item_id = pi.id)
        )
    AND NOT EXISTS (
          SELECT 1 FROM bundle b
          WHERE b.po_id = p_po_id
            AND b.ditutup_at IS NULL
            AND b.surat_jalan_id IS NULL
        );

  IF v_selesai AND v_status = 'aktif' THEN
    UPDATE po SET status = 'selesai' WHERE id = p_po_id;
    RETURN 'selesai';
  ELSIF NOT v_selesai AND v_status = 'selesai' THEN
    UPDATE po SET status = 'aktif' WHERE id = p_po_id;
    RETURN 'aktif';
  END IF;

  RETURN v_status;
END;
$$;

-- 2. Trigger di bundle ---------------------------------------------------------
CREATE OR REPLACE FUNCTION _trg_bundle_sinkron_status_po()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    PERFORM sinkron_status_po(OLD.po_id);
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE')
     AND (TG_OP = 'INSERT' OR NEW.po_id IS DISTINCT FROM OLD.po_id) THEN
    PERFORM sinkron_status_po(NEW.po_id);
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_bundle_sinkron_status_po ON bundle;
CREATE TRIGGER trg_bundle_sinkron_status_po
AFTER INSERT OR DELETE OR UPDATE OF surat_jalan_id, ditutup_at, po_id, po_item_id
ON bundle
FOR EACH ROW
EXECUTE FUNCTION _trg_bundle_sinkron_status_po();

-- 3. Trigger di po_item (artikel baru tanpa bundle → buka lagi) ---------------
CREATE OR REPLACE FUNCTION _trg_po_item_sinkron_status_po()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM sinkron_status_po(OLD.po_id);
  ELSE
    PERFORM sinkron_status_po(NEW.po_id);
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_po_item_sinkron_status_po ON po_item;
CREATE TRIGGER trg_po_item_sinkron_status_po
AFTER INSERT OR DELETE
ON po_item
FOR EACH ROW
EXECUTE FUNCTION _trg_po_item_sinkron_status_po();

-- 4. Ringkasan kirim per PO (untuk keterangan "terkirim X / Y pcs") ----------
CREATE OR REPLACE VIEW v_po_ringkasan_kirim
WITH (security_invoker = true) AS
SELECT
  p.id        AS po_id,
  p.tenant_id,
  COALESCE((SELECT SUM(pi.qty_order) FROM po_item pi WHERE pi.po_id = p.id), 0)::INT
              AS qty_order,
  COALESCE((
    SELECT SUM(sji.qty_kirim)
    FROM surat_jalan_item sji
    JOIN bundle b ON b.id = sji.bundle_id
    WHERE b.po_id = p.id
  ), 0)::INT  AS qty_kirim,
  (SELECT COUNT(*) FROM bundle b WHERE b.po_id = p.id)::INT
              AS bundle_total,
  (SELECT COUNT(*) FROM bundle b WHERE b.po_id = p.id AND b.ditutup_at IS NOT NULL)::INT
              AS bundle_ditutup
FROM po p;

GRANT SELECT ON v_po_ringkasan_kirim TO authenticated;

-- 5. add_items_to_po: PO 'selesai' juga boleh ditambah artikel ---------------
--    (bundle baru otomatis membuka PO kembali lewat trigger di atas)
CREATE OR REPLACE FUNCTION add_items_to_po(
  p_no_po     TEXT,
  p_tenant_id TEXT,
  p_user_id   UUID,
  p_items     JSONB
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_po_id           UUID;
  v_po_status       TEXT;
  v_po_item_id      UUID;
  v_barcode         TEXT;
  v_item            JSONB;
  v_bundle_count    INT;
  v_no_urut_global  INT;
  v_global_po_urut  INT;
  v_produk_id       UUID;
  v_qty_order       INT;
  v_qty_per_bundle  INT;
  v_warna           TEXT;
  v_size            TEXT;
  i                 INT;
  v_item_count      INT := 0;
  v_bundle_total    INT := 0;
BEGIN

  SELECT id, status INTO v_po_id, v_po_status
  FROM po
  WHERE no_po = p_no_po AND tenant_id = p_tenant_id;

  IF v_po_id IS NULL THEN
    RAISE EXCEPTION 'PO % tidak ditemukan.', p_no_po;
  END IF;

  -- PO aktif atau selesai boleh ditambah artikel (selesai akan dibuka lagi)
  IF v_po_status NOT IN ('aktif', 'selesai') THEN
    RAISE EXCEPTION 'PO % berstatus "%" — hanya PO aktif/selesai yang bisa ditambah artikel.',
      p_no_po, v_po_status;
  END IF;

  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Minimal 1 artikel untuk ditambahkan.';
  END IF;

  SELECT COALESCE(MAX(no_urut_po), 0) INTO v_global_po_urut
  FROM bundle
  WHERE po_id = v_po_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_produk_id      := (v_item->>'produk_id')::UUID;
    v_qty_order      := (v_item->>'qty_order')::INT;
    v_qty_per_bundle := (v_item->>'qty_per_bundle')::INT;
    v_warna          := v_item->>'warna';
    v_size           := v_item->>'size';

    IF v_produk_id IS NULL THEN
      RAISE EXCEPTION 'produk_id tidak boleh null.';
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM produk WHERE id = v_produk_id AND tenant_id = p_tenant_id
    ) THEN
      RAISE EXCEPTION 'produk_id % tidak ditemukan.', v_produk_id;
    END IF;

    IF v_qty_per_bundle < 1 THEN
      RAISE EXCEPTION 'qty_per_bundle harus minimal 1.';
    END IF;

    IF v_qty_order < 1 THEN
      RAISE EXCEPTION 'qty_order harus minimal 1.';
    END IF;

    UPDATE po_item_sequence
    SET    last_sequence = last_sequence + 1
    WHERE  tenant_id = p_tenant_id
    RETURNING last_sequence INTO v_no_urut_global;

    IF v_no_urut_global IS NULL THEN
      RAISE EXCEPTION 'po_item_sequence tidak ditemukan untuk tenant %', p_tenant_id;
    END IF;

    INSERT INTO po_item (
      po_id, produk_id, warna, size,
      qty_order, qty_per_bundle, no_urut_global, tenant_id
    )
    VALUES (
      v_po_id, v_produk_id, v_warna, v_size,
      v_qty_order, v_qty_per_bundle, v_no_urut_global, p_tenant_id
    )
    RETURNING id INTO v_po_item_id;

    v_bundle_count := CEIL(v_qty_order::NUMERIC / v_qty_per_bundle::NUMERIC)::INT;

    FOR i IN 1..v_bundle_count
    LOOP
      v_global_po_urut := v_global_po_urut + 1;
      v_barcode := generate_bundle_barcode(p_no_po, v_no_urut_global, i);

      INSERT INTO bundle (
        barcode, po_id, po_item_id,
        no_urut, no_urut_po,
        status_tahap, tenant_id, created_by
      )
      VALUES (
        v_barcode, v_po_id, v_po_item_id,
        i, v_global_po_urut,
        '{}'::jsonb, p_tenant_id, p_user_id
      );

      v_bundle_total := v_bundle_total + 1;
    END LOOP;

    v_item_count := v_item_count + 1;
  END LOOP;

  INSERT INTO audit_log (
    user_id, modul, aksi, target, metadata, tenant_id
  )
  VALUES (
    p_user_id, 'produksi', 'Tambah Item PO', p_no_po,
    jsonb_build_object(
      'po_id',         v_po_id,
      'jumlah_item',   v_item_count,
      'jumlah_bundle', v_bundle_total
    ),
    p_tenant_id
  );

  RETURN p_no_po;

EXCEPTION
  WHEN OTHERS THEN RAISE;
END;
$$;

GRANT EXECUTE ON FUNCTION add_items_to_po(TEXT, TEXT, UUID, JSONB) TO authenticated;

-- 6. Backfill: hanya PO yang sekarang 'aktif' -----------------------------------
--    (16 PO 'selesai' hasil impor lama tidak punya bundle; sengaja tidak
--     dihitung ulang supaya tidak terbuka lagi.)
SELECT sinkron_status_po(id) FROM po WHERE status = 'aktif';
