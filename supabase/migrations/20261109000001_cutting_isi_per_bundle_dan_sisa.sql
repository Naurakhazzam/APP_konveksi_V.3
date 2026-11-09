-- =============================================================================
-- MIGRATION: Cutting — isi per bundle, sisa kembali ke Menunggu, bahan per artikel
-- Tanggal  : 9 Nov 2026
--
-- Masalah yang diperbaiki:
--  1. Isi bundle hanya diturunkan dari po_item.qty_per_bundle. Bundle sisa
--     (mis. order 21 per 10 → bundle ke-3 isinya 1) tetap terbaca 10 pcs:
--     total antrian membengkak dan bundle sisa yang dipotong penuh malah
--     ditandai 'partial'.
--  2. Potong sebagian harus lewat jalur Partial → Pending → Lanjut Cutting.
--     Sekarang qty dipotong ditentukan saat Mulai Cutting; sisanya otomatis
--     jadi bundle baru di Menunggu. Hasil kurang saat Selesai juga begitu.
--  3. selesai_cutting_batch mencatat SEMUA pemakaian bahan ke bundle pertama,
--     dan ON CONFLICT DO NOTHING membuang catatan kedua bila 2 artikel memakai
--     bahan yang sama. Versi baru mencatat per bundle, per artikel.
--  4. harga_pakai pemakaian_bahan selalu 0 sejak fungsi ditulis ulang (Juli).
--  5. mulai_cutting_batch bisa "memulai ulang" bundle yang sudah selesai.
--
-- Fungsi lama (mulai_cutting_batch, selesai_cutting_batch) TIDAK dihapus agar
-- aplikasi versi lama tetap jalan sampai versi baru di-deploy.
-- =============================================================================


-- ── 1. Kolom baru ────────────────────────────────────────────────────────────

ALTER TABLE bundle ADD COLUMN IF NOT EXISTS qty_rencana INT;
ALTER TABLE bundle ADD COLUMN IF NOT EXISTS sisa_dari_bundle_id UUID
  REFERENCES bundle(id) ON DELETE SET NULL;

COMMENT ON COLUMN bundle.qty_rencana IS
  'Isi rencana bundle ini (pcs). Bundle sisa pembagian berisi kurang dari qty_per_bundle. Hasil potong asli tetap di status_tahap.cutting.qty_aktual.';
COMMENT ON COLUMN bundle.sisa_dari_bundle_id IS
  'Bundle asal bila bundle ini dibuat dari sisa potong sebagian (Mulai/Selesai Cutting).';


-- ── 2. Backfill qty_rencana ──────────────────────────────────────────────────
-- Bundle asli (bukan pecahan/susulan): isi = sisa pembagian qty_order sesuai
-- urutan bundle dalam artikel. Pecahan/susulan: isi = hasil potong aslinya.

WITH base AS (
  SELECT b.id, pi.qty_order, pi.qty_per_bundle,
         ROW_NUMBER() OVER (PARTITION BY b.po_item_id ORDER BY b.no_urut, b.created_at) AS rn
  FROM bundle b
  JOIN po_item pi ON pi.id = b.po_item_id
  WHERE b.parent_bundle_id IS NULL
)
UPDATE bundle b
SET qty_rencana = CASE
      WHEN base.qty_order - (base.rn - 1) * base.qty_per_bundle >= 1
        THEN LEAST(base.qty_per_bundle, base.qty_order - (base.rn - 1) * base.qty_per_bundle)
      ELSE base.qty_per_bundle
    END
FROM base
WHERE base.id = b.id AND b.qty_rencana IS NULL;

UPDATE bundle
SET qty_rencana = (status_tahap->'cutting'->>'qty_aktual')::INT
WHERE parent_bundle_id IS NOT NULL
  AND qty_rencana IS NULL
  AND status_tahap->'cutting'->>'qty_aktual' IS NOT NULL;


-- ── 3. Trigger: bundle baru otomatis dapat qty_rencana ──────────────────────
-- Menutup semua jalur pembuatan bundle (create_po_with_bundles, add_items_to_po,
-- import, lanjut cutting, split jahit) tanpa menulis ulang fungsi-fungsinya.

CREATE OR REPLACE FUNCTION _isi_qty_rencana_bundle()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_qty_order INT;
  v_qpb       INT;
  v_sisa      INT;
BEGIN
  IF NEW.qty_rencana IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.status_tahap->'cutting'->>'qty_aktual' IS NOT NULL THEN
    NEW.qty_rencana := (NEW.status_tahap->'cutting'->>'qty_aktual')::INT;
    RETURN NEW;
  END IF;

  SELECT qty_order, qty_per_bundle INTO v_qty_order, v_qpb
  FROM po_item WHERE id = NEW.po_item_id;

  IF NEW.parent_bundle_id IS NULL AND NEW.no_urut IS NOT NULL THEN
    v_sisa := v_qty_order - (NEW.no_urut - 1) * v_qpb;
    NEW.qty_rencana := CASE WHEN v_sisa >= 1 THEN LEAST(v_qpb, v_sisa) ELSE v_qpb END;
  ELSE
    NEW.qty_rencana := v_qpb;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_isi_qty_rencana_bundle ON bundle;
CREATE TRIGGER trg_isi_qty_rencana_bundle
  BEFORE INSERT ON bundle
  FOR EACH ROW EXECUTE FUNCTION _isi_qty_rencana_bundle();


-- ── 4. Helper: buat bundle sisa di Menunggu ─────────────────────────────────
-- Barcode melanjutkan nomor bdl artikel yang sama:
--   PO-0098-00690-bdl02 dipotong 5 dari 10 → sisa PO-0098-00690-bdl04 (5 pcs)

CREATE OR REPLACE FUNCTION _buat_bundle_sisa(
  p_bundle_id UUID,
  p_qty       INT,
  p_user_id   UUID,
  p_tenant_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_asal     RECORD;
  v_prefix   TEXT;
  v_n        INT;
  v_barcode  TEXT;
  v_urut_po  INT;
  v_new_id   UUID;
BEGIN
  IF p_qty IS NULL OR p_qty < 1 THEN
    RAISE EXCEPTION 'Qty bundle sisa harus minimal 1';
  END IF;

  SELECT id, po_id, po_item_id, barcode INTO v_asal
  FROM bundle WHERE id = p_bundle_id AND tenant_id = p_tenant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bundle asal tidak ditemukan';
  END IF;

  -- "PO-0098-00690-bdl02" / "PO-0089-00552-bdl01c1" → "PO-0098-00690"
  v_prefix := regexp_replace(v_asal.barcode, '-bdl[0-9]+.*$', '');

  SELECT COALESCE(MAX(substring(barcode FROM '-bdl([0-9]+)$')::INT), 0) + 1
  INTO v_n
  FROM bundle
  WHERE po_item_id = v_asal.po_item_id
    AND barcode LIKE v_prefix || '-bdl%';

  LOOP
    v_barcode := v_prefix || '-bdl' || lpad(v_n::TEXT, 2, '0');
    EXIT WHEN NOT EXISTS (SELECT 1 FROM bundle WHERE barcode = v_barcode);
    v_n := v_n + 1;
  END LOOP;

  SELECT COALESCE(MAX(no_urut_po), 0) + 1 INTO v_urut_po
  FROM bundle WHERE po_id = v_asal.po_id;

  INSERT INTO bundle (
    barcode, po_id, po_item_id, no_urut, no_urut_po,
    status_tahap, qty_rencana, sisa_dari_bundle_id, tenant_id, created_by
  ) VALUES (
    v_barcode, v_asal.po_id, v_asal.po_item_id, v_n, v_urut_po,
    '{}'::jsonb, p_qty, v_asal.id, p_tenant_id, p_user_id
  )
  RETURNING id INTO v_new_id;

  RETURN jsonb_build_object('id', v_new_id, 'barcode', v_barcode, 'qty', p_qty);
END;
$$;


-- ── 5. mulai_cutting_v2 ─────────────────────────────────────────────────────
-- p_items: [{ "bundle_id": "uuid", "qty": 5 }, ...]
-- qty < isi bundle → bundle diperkecil, sisanya jadi bundle baru di Menunggu.

CREATE OR REPLACE FUNCTION mulai_cutting_v2(
  p_items     JSONB,
  p_user_id   UUID,
  p_tenant_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_item     JSONB;
  v_b        RECORD;
  v_qty      INT;
  v_rencana  INT;
  v_sisa     JSONB;
  v_sisa_all JSONB := '[]'::jsonb;
  v_count    INT := 0;
BEGIN
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Tidak ada bundle dipilih';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    SELECT b.id, b.barcode, b.status_tahap, b.ditutup_at,
           COALESCE(b.qty_rencana, pi.qty_per_bundle) AS rencana
    INTO v_b
    FROM bundle b JOIN po_item pi ON pi.id = b.po_item_id
    WHERE b.id = (v_item->>'bundle_id')::UUID AND b.tenant_id = p_tenant_id
    FOR UPDATE OF b;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Bundle tidak ditemukan';
    END IF;
    IF v_b.ditutup_at IS NOT NULL THEN
      RAISE EXCEPTION 'Bundle % sudah ditutup sebagai data lama', v_b.barcode;
    END IF;
    IF v_b.status_tahap->'cutting' IS NOT NULL THEN
      RAISE EXCEPTION 'Bundle % sudah mulai/selesai cutting — muat ulang halaman', v_b.barcode;
    END IF;

    v_rencana := v_b.rencana;
    v_qty     := COALESCE((v_item->>'qty')::INT, v_rencana);

    IF v_qty < 1 OR v_qty > v_rencana THEN
      RAISE EXCEPTION 'Qty dipotong bundle % harus 1–% pcs (diisi %)', v_b.barcode, v_rencana, v_qty;
    END IF;

    IF v_qty < v_rencana THEN
      v_sisa := _buat_bundle_sisa(v_b.id, v_rencana - v_qty, p_user_id, p_tenant_id);
      v_sisa_all := v_sisa_all || jsonb_build_object(
        'dari', v_b.barcode, 'barcode', v_sisa->>'barcode', 'qty', v_rencana - v_qty);
    END IF;

    UPDATE bundle
    SET qty_rencana  = v_qty,
        status_tahap = jsonb_set(
          COALESCE(status_tahap, '{}'::jsonb), '{cutting}',
          jsonb_build_object(
            'status',     'progress',
            'start_time', now(),
            'updated_by', p_user_id,
            'qty_mulai',  v_qty))
    WHERE id = v_b.id;

    v_count := v_count + 1;
  END LOOP;

  RETURN jsonb_build_object('jumlah_bundle', v_count, 'sisa', v_sisa_all);
END;
$$;

GRANT EXECUTE ON FUNCTION mulai_cutting_v2(JSONB, UUID, TEXT) TO authenticated;


-- ── 6. Pengaman fungsi lama: jangan timpa bundle yang sudah mulai/selesai ──

CREATE OR REPLACE FUNCTION public.mulai_cutting_batch(p_bundle_ids uuid[], p_user_id uuid, p_tenant_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    v_updated_count int;
BEGIN
    UPDATE bundle
    SET status_tahap = jsonb_set(
        COALESCE(status_tahap, '{}'::jsonb),
        '{cutting}',
        COALESCE(status_tahap->'cutting', '{}'::jsonb) || jsonb_build_object(
            'status', 'progress',
            'start_time', now(),
            'updated_by', p_user_id
        )
    )
    WHERE id = ANY(p_bundle_ids)
      AND tenant_id = p_tenant_id
      AND status_tahap->'cutting' IS NULL;   -- BARU: hanya bundle Menunggu

    GET DIAGNOSTICS v_updated_count = ROW_COUNT;

    RETURN jsonb_build_object('jumlah_bundle', v_updated_count);
END;
$function$;


-- ── 7. selesai_cutting_v2 ───────────────────────────────────────────────────
-- p_bundles   : [{ "bundle_id": "uuid", "qty_aktual": 12 }, ...]
-- p_pemakaian : [{ "po_item_id": "uuid", "inventory_item_id": "uuid", "rate_per_pcs": 1.4 }, ...]
-- p_kurangi_sisa: hasil lebih → kurangi bundle Menunggu artikel yang sama.
--
-- Hasil < isi  → bundle selesai dgn hasil asli, kekurangan jadi bundle Menunggu.
-- Hasil = 0    → bundle dikembalikan ke Menunggu (tidak ada yang dipotong).
-- Hasil > isi  → selesai, ditandai qty_lebih.
-- Bahan dicatat PER BUNDLE (qty_pakai = rate × hasil bundle itu), FIFO, + harga_pakai.

CREATE OR REPLACE FUNCTION selesai_cutting_v2(
  p_bundles      JSONB,
  p_pemakaian    JSONB,
  p_kurangi_sisa BOOLEAN,
  p_user_id      UUID,
  p_tenant_id    TEXT,
  p_karyawan_id  UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_item          JSONB;
  v_b             RECORD;
  v_qty           INT;
  v_rencana       INT;
  v_lebih         INT;
  v_kurangi       INT;
  v_w             RECORD;
  v_total_qty     INT := 0;
  v_count         INT := 0;
  v_kembali       INT := 0;
  v_sisa          JSONB;
  v_sisa_all      JSONB := '[]'::jsonb;
  v_lebih_all     JSONB := '[]'::jsonb;
  v_tarif         NUMERIC;
  v_total_upah    NUMERIC := 0;
  v_pk            RECORD;
  v_inv           RECORD;
  v_batch         RECORD;
  v_butuh         NUMERIC;
  v_sisa_butuh    NUMERIC;
  v_ambil         NUMERIC;
  v_harga         NUMERIC;
  v_first_batch   UUID;
  v_stok_warnings JSONB := '[]'::jsonb;
  v_hasil         JSONB := '[]'::jsonb;   -- hasil per bundle, dasar hitung bahan
BEGIN
  IF p_bundles IS NULL OR jsonb_array_length(p_bundles) = 0 THEN
    RAISE EXCEPTION 'Tidak ada bundle dipilih';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_bundles)
  LOOP
    SELECT b.id, b.barcode, b.po_item_id, b.status_tahap, b.ditutup_at,
           COALESCE(b.qty_rencana, pi.qty_per_bundle) AS rencana, pi.produk_id
    INTO v_b
    FROM bundle b JOIN po_item pi ON pi.id = b.po_item_id
    WHERE b.id = (v_item->>'bundle_id')::UUID AND b.tenant_id = p_tenant_id
    FOR UPDATE OF b;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Bundle tidak ditemukan';
    END IF;
    IF v_b.ditutup_at IS NOT NULL THEN
      RAISE EXCEPTION 'Bundle % sudah ditutup sebagai data lama', v_b.barcode;
    END IF;
    IF COALESCE(v_b.status_tahap->'cutting'->>'status', '') NOT IN ('progress', 'terima') THEN
      RAISE EXCEPTION 'Bundle % tidak sedang dipotong — muat ulang halaman', v_b.barcode;
    END IF;

    v_qty     := (v_item->>'qty_aktual')::INT;
    v_rencana := v_b.rencana;

    IF v_qty IS NULL OR v_qty < 0 THEN
      RAISE EXCEPTION 'Hasil cutting bundle % tidak valid', v_b.barcode;
    END IF;

    -- Hasil 0 → kembali ke Menunggu, tidak ada upah/bahan
    IF v_qty = 0 THEN
      UPDATE bundle SET status_tahap = status_tahap - 'cutting' WHERE id = v_b.id;
      v_kembali := v_kembali + 1;
      CONTINUE;
    END IF;

    v_lebih := GREATEST(v_qty - v_rencana, 0);

    -- Kurang → kekurangan jadi bundle baru di Menunggu
    IF v_qty < v_rencana THEN
      v_sisa := _buat_bundle_sisa(v_b.id, v_rencana - v_qty, p_user_id, p_tenant_id);
      v_sisa_all := v_sisa_all || jsonb_build_object(
        'dari', v_b.barcode, 'barcode', v_sisa->>'barcode', 'qty', v_rencana - v_qty);
    END IF;

    UPDATE bundle
    SET qty_rencana  = LEAST(v_qty, v_rencana),
        status_tahap = jsonb_set(status_tahap, '{cutting}',
          (status_tahap->'cutting') || jsonb_build_object(
            'status',        'selesai',
            'qty_aktual',    v_qty,
            'qty_rencana',   v_rencana,
            'qty_lebih',     v_lebih,
            'waktu_selesai', now(),
            'updated_by',    p_user_id,
            'karyawan_id',   p_karyawan_id))
    WHERE id = v_b.id;

    -- Lebih → kurangi bundle Menunggu artikel yang sama (bila diminta)
    IF v_lebih > 0 THEN
      v_kurangi := 0;
      IF COALESCE(p_kurangi_sisa, FALSE) THEN
        FOR v_w IN
          SELECT id, barcode, qty_rencana FROM bundle
          WHERE po_item_id = v_b.po_item_id AND tenant_id = p_tenant_id
            AND status_tahap->'cutting' IS NULL AND ditutup_at IS NULL
            AND id <> v_b.id
          ORDER BY no_urut DESC
          FOR UPDATE
        LOOP
          EXIT WHEN v_kurangi >= v_lebih;
          IF v_w.qty_rencana <= (v_lebih - v_kurangi) THEN
            v_kurangi := v_kurangi + v_w.qty_rencana;
            DELETE FROM bundle WHERE id = v_w.id;
          ELSE
            UPDATE bundle SET qty_rencana = qty_rencana - (v_lebih - v_kurangi) WHERE id = v_w.id;
            v_kurangi := v_lebih;
          END IF;
        END LOOP;
      END IF;
      v_lebih_all := v_lebih_all || jsonb_build_object(
        'barcode', v_b.barcode, 'lebih', v_lebih, 'sisa_dikurangi', v_kurangi);
    END IF;

    -- Upah cutting
    IF p_karyawan_id IS NOT NULL THEN
      SELECT hi.harga_satuan INTO v_tarif
      FROM hpp_item hi JOIN hpp_komponen hk ON hk.id = hi.komponen_id
      WHERE hi.produk_id = v_b.produk_id AND hk.tahap_produksi = 'cutting'
        AND hi.tenant_id = p_tenant_id
      LIMIT 1;

      IF v_tarif IS NOT NULL AND v_tarif > 0 THEN
        INSERT INTO gaji_ledger (karyawan_id, tipe, total, tanggal, sumber_id,
                                 keterangan, status, tenant_id, created_by)
        VALUES (p_karyawan_id, 'selesai'::gaji_ledger_tipe, v_tarif * v_qty, CURRENT_DATE,
                v_b.id::text, 'Upah cutting - ' || v_b.barcode,
                'belum_lunas'::gaji_status, p_tenant_id, p_user_id);
        v_total_upah := v_total_upah + v_tarif * v_qty;
      END IF;
    END IF;

    v_hasil := v_hasil || jsonb_build_object(
      'bundle_id', v_b.id, 'po_item_id', v_b.po_item_id, 'qty', v_qty);
    v_total_qty := v_total_qty + v_qty;
    v_count     := v_count + 1;
  END LOOP;

  -- ── Pemakaian bahan: per bundle, per bahan ────────────────────────────────
  -- Rate digabung per (po_item, bahan) kalau dikirim dobel.
  FOR v_pk IN
    SELECT h.bundle_id, h.po_item_id, h.qty, p.inventory_item_id, p.rate
    FROM jsonb_to_recordset(v_hasil) AS h(bundle_id UUID, po_item_id UUID, qty INT)
    JOIN (
      SELECT (e->>'po_item_id')::UUID AS po_item_id,
             (e->>'inventory_item_id')::UUID AS inventory_item_id,
             SUM((e->>'rate_per_pcs')::NUMERIC) AS rate
      FROM jsonb_array_elements(COALESCE(p_pemakaian, '[]'::jsonb)) e
      GROUP BY 1, 2
    ) p ON p.po_item_id = h.po_item_id
    WHERE p.rate > 0
  LOOP
    SELECT id, nama, stok_aktual, harga_referensi INTO v_inv
    FROM inventory_item
    WHERE id = v_pk.inventory_item_id AND tenant_id = p_tenant_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Bahan tidak ditemukan di inventory';
    END IF;

    v_butuh       := v_pk.rate * v_pk.qty;
    v_sisa_butuh  := v_butuh;
    v_harga       := 0;
    v_first_batch := NULL;

    FOR v_batch IN
      SELECT id, qty_sisa, harga_satuan FROM inventory_batch
      WHERE inventory_item_id = v_inv.id AND tenant_id = p_tenant_id AND qty_sisa > 0
      ORDER BY tanggal_masuk ASC
      FOR UPDATE
    LOOP
      EXIT WHEN v_sisa_butuh <= 0;
      v_ambil := LEAST(v_batch.qty_sisa, v_sisa_butuh);
      UPDATE inventory_batch SET qty_sisa = qty_sisa - v_ambil WHERE id = v_batch.id;
      v_harga      := v_harga + v_ambil * COALESCE(v_batch.harga_satuan, 0);
      v_sisa_butuh := v_sisa_butuh - v_ambil;
      IF v_first_batch IS NULL THEN v_first_batch := v_batch.id; END IF;
    END LOOP;

    -- Stok kurang: tetap dicatat (boleh minus), dihargai harga referensi
    IF v_sisa_butuh > 0 THEN
      v_harga := v_harga + v_sisa_butuh * COALESCE(v_inv.harga_referensi, 0);
      IF v_first_batch IS NULL THEN
        SELECT id INTO v_first_batch FROM inventory_batch
        WHERE inventory_item_id = v_inv.id AND tenant_id = p_tenant_id
        ORDER BY tanggal_masuk DESC LIMIT 1;
      END IF;
      v_stok_warnings := v_stok_warnings || jsonb_build_object(
        'item_nama',  v_inv.nama,
        'qty_kurang', v_sisa_butuh,
        'sisa_stok',  v_inv.stok_aktual - v_butuh);
    END IF;

    UPDATE inventory_item SET stok_aktual = stok_aktual - v_butuh WHERE id = v_inv.id;

    INSERT INTO pemakaian_bahan (
      bundle_id, po_item_id, inventory_item_id, inventory_batch_id,
      qty_pakai, rate_per_pcs, harga_pakai, tenant_id, created_by
    ) VALUES (
      v_pk.bundle_id, v_pk.po_item_id, v_inv.id, v_first_batch,
      v_butuh, v_pk.rate, ROUND(v_harga, 2), p_tenant_id, p_user_id
    );
  END LOOP;

  RETURN jsonb_build_object(
    'success',        true,
    'jumlah_bundle',  v_count,
    'total_qty',      v_total_qty,
    'kembali_antri',  v_kembali,
    'sisa',           v_sisa_all,
    'lebih',          v_lebih_all,
    'total_upah',     v_total_upah,
    'stok_warnings',  v_stok_warnings
  );
END;
$$;

GRANT EXECUTE ON FUNCTION selesai_cutting_v2(JSONB, JSONB, BOOLEAN, UUID, TEXT, UUID) TO authenticated;


-- ── 8. koreksi_hasil_cutting: ikut isi per bundle, kurang → sisa ke Menunggu ─
-- Hanya 3 potongan teks yang diganti; sisa fungsi identik.

DO $migr$
DECLARE
  d   TEXT;
  d0  TEXT;
BEGIN
  d := pg_get_functiondef('koreksi_hasil_cutting(uuid,numeric,text,uuid,text)'::regprocedure);
  d0 := d;

  -- Pastikan sisipan di RETURN hanya terjadi sekali
  IF (length(d) - length(replace(d, 'RETURN jsonb_build_object(', ''))) / length('RETURN jsonb_build_object(') <> 1 THEN
    RAISE EXCEPTION 'koreksi_hasil_cutting: RETURN jsonb_build_object( tidak tunggal';
  END IF;

  d := replace(d,
    'SELECT b.id, b.barcode, b.status_tahap, pi.qty_per_bundle, pi.produk_id',
    'SELECT b.id, b.barcode, b.status_tahap, COALESCE(b.qty_rencana, pi.qty_per_bundle) AS qty_per_bundle, pi.produk_id');
  IF d = d0 THEN RAISE EXCEPTION 'koreksi_hasil_cutting: pola SELECT tidak ditemukan'; END IF;
  d0 := d;

  d := replace(d,
    'WHEN v_total_baru >= v_bundle.qty_per_bundle OR (v_cutting ? ''closed_at'') THEN ''selesai''',
    'WHEN TRUE THEN ''selesai''  -- kurang dari isi → sisa dibuat di Menunggu (lihat bawah)');
  IF d = d0 THEN RAISE EXCEPTION 'koreksi_hasil_cutting: pola status tidak ditemukan'; END IF;
  d0 := d;

  d := replace(d,
    'RETURN jsonb_build_object(',
    '-- Koreksi turun di bawah isi bundle → kekurangan jadi bundle Menunggu
  IF v_delta < 0 AND v_total_baru < v_bundle.qty_per_bundle AND NOT (v_cutting ? ''closed_at'') THEN
    PERFORM _buat_bundle_sisa(v_bundle.id,
              LEAST((-v_delta)::int, (v_bundle.qty_per_bundle - v_total_baru)::int),
              p_user_id, p_tenant_id);
    UPDATE bundle SET qty_rencana = v_total_baru::int WHERE id = v_bundle.id;
  END IF;

  RETURN jsonb_build_object(');
  IF d = d0 THEN RAISE EXCEPTION 'koreksi_hasil_cutting: pola RETURN tidak ditemukan'; END IF;

  EXECUTE d;
END
$migr$;
