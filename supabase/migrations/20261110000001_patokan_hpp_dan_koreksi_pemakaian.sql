-- =============================================================================
-- 1. Patokan pemakaian bahan dari sheet HPP (yard/pcs, bahan utama kategori)
--    menggantikan standar hasil riwayat. Ukuran yang tidak ada di sheet ikut
--    nilai XXL. Ukuran S jaket M-L (Ignite/Raizen/Noir) ikut nilai M-L.
--    Patokan = total bahan utama per pcs; artikel dua warna (A x B) dibagi
--    ke kedua bahannya.
-- 2. koreksi_pemakaian_bahan: ubah bahan / pemakaian per pcs hasil cutting,
--    stok & LOT ikut disesuaikan, tercatat di audit_log.
-- =============================================================================

WITH g(model, sizes, rate) AS (VALUES
  ('Celana Arslan', 'S,M', 0.70), ('Celana Arslan', 'L,XL', 0.80), ('Celana Arslan', 'XXL,XXXL,4XL,5XL,6XL', 1.15),

  ('Zuno Panjang', 'S', 0.75), ('Zuno Panjang', 'M', 0.80), ('Zuno Panjang', 'L', 0.90), ('Zuno Panjang', 'XL', 1.00), ('Zuno Panjang', 'XXL,XXXL,4XL,5XL,6XL', 1.10),
  ('Zuno Pendek', 'S', 0.65), ('Zuno Pendek', 'M', 0.65), ('Zuno Pendek', 'L', 0.70), ('Zuno Pendek', 'XL', 0.77), ('Zuno Pendek', 'XXL,XXXL,4XL,5XL,6XL', 0.86),
  ('Hino Panjang', 'S', 0.65), ('Hino Panjang', 'M', 0.65), ('Hino Panjang', 'L', 0.75), ('Hino Panjang', 'XL', 0.85), ('Hino Panjang', 'XXL,XXXL,4XL,5XL,6XL', 0.90),
  ('Hino Pendek', 'S', 0.55), ('Hino Pendek', 'M', 0.55), ('Hino Pendek', 'L', 0.60), ('Hino Pendek', 'XL', 0.65), ('Hino Pendek', 'XXL,XXXL,4XL,5XL,6XL', 0.76),
  ('Jimo Panjang', 'S', 0.65), ('Jimo Panjang', 'M', 0.65), ('Jimo Panjang', 'L', 0.75), ('Jimo Panjang', 'XL', 0.85), ('Jimo Panjang', 'XXL,XXXL,4XL,5XL,6XL', 0.90),

  ('Zubair',     'S,M', 0.70), ('Zubair',     'L,XL', 0.75), ('Zubair',     'XXL,XXXL,4XL,5XL,6XL', 0.80),
  ('Arslan',     'S,M', 0.70), ('Arslan',     'L,XL', 0.75), ('Arslan',     'XXL,XXXL,4XL,5XL,6XL', 0.80),
  ('Arrazi',     'S,M', 0.80), ('Arrazi',     'L,XL', 0.85), ('Arrazi',     'XXL,XXXL,4XL,5XL,6XL', 0.96),
  ('Alfarghani', 'S,M', 0.80), ('Alfarghani', 'L,XL', 0.85), ('Alfarghani', 'XXL,XXXL,4XL,5XL,6XL', 0.96),
  ('Thalhah',    'S,M', 0.80), ('Thalhah',    'L,XL', 0.85), ('Thalhah',    'XXL,XXXL,4XL,5XL,6XL', 0.96),
  ('Abudzar',    'S,M', 0.80), ('Abudzar',    'L,XL', 0.85), ('Abudzar',    'XXL,XXXL,4XL,5XL,6XL', 0.96),
  ('Ilyasa',     'S,M', 0.80), ('Ilyasa',     'L,XL', 0.85), ('Ilyasa',     'XXL,XXXL,4XL,5XL,6XL', 0.96),
  ('Tameem',     'S,M', 0.82), ('Tameem',     'L,XL', 1.00), ('Tameem',     'XXL,XXXL,4XL,5XL,6XL', 1.25),

  ('Khalid', 'S,M', 1.60), ('Khalid', 'L', 1.85), ('Khalid', 'XL,XXL,XXXL,4XL,5XL,6XL', 2.15),
  ('Zayyan', 'S,M', 1.60), ('Zayyan', 'L', 1.85), ('Zayyan', 'XL,XXL,XXXL,4XL,5XL,6XL', 2.15),

  ('Neck',    'S,M', 1.15), ('Neck',    'L,XL', 1.40), ('Neck',    'XXL,XXXL,4XL,5XL,6XL', 1.60),
  ('Airflow', 'S,M', 1.15), ('Airflow', 'L,XL', 1.40), ('Airflow', 'XXL,XXXL,4XL,5XL,6XL', 1.60),
  ('Dravo',   'S,M', 1.15), ('Dravo',   'L,XL', 1.35), ('Dravo',   'XXL,XXXL,4XL,5XL,6XL', 1.55),
  ('Storma',  'S,M', 1.15), ('Storma',  'L,XL', 1.35), ('Storma',  'XXL,XXXL,4XL,5XL,6XL', 1.55),
  ('Ignite',  'S,M,L', 1.10), ('Ignite', 'XL,XXL,XXXL,4XL,5XL,6XL', 1.20),
  ('Raizen',  'S,M,L', 1.15), ('Raizen', 'XL,XXL,XXXL,4XL,5XL,6XL', 1.35),
  ('Noir',    'S,M,L', 1.20), ('Noir',   'XL,XXL,XXXL,4XL,5XL,6XL', 1.40)
),
gs AS (SELECT model, unnest(string_to_array(sizes, ',')) AS size, rate FROM g)
INSERT INTO standar_pemakaian_bahan (tenant_id, model_id, size, rate_per_pcs, sumber, updated_at)
SELECT 'STX-001', m.id, gs.size, gs.rate, 'hpp', now()
FROM gs JOIN model_produk m ON m.nama = gs.model AND m.tenant_id = 'STX-001'
ON CONFLICT (tenant_id, model_id, size)
DO UPDATE SET rate_per_pcs = EXCLUDED.rate_per_pcs, sumber = 'hpp', updated_at = now();

-- Standar lama dari riwayat tidak dipakai lagi
DELETE FROM standar_pemakaian_bahan WHERE tenant_id = 'STX-001' AND sumber = 'riwayat';


-- ─── Helper stok ─────────────────────────────────────────────────────────────

-- Kembalikan qty ke stok + LOT (kebalikan FIFO: batch terbaru yang terpakai dulu).
-- Batch tidak diisi melebihi stok_aktual (bagian yang dulu membuat stok minus
-- tidak pernah memotong batch).
CREATE OR REPLACE FUNCTION public._kembalikan_stok_bahan(
  p_item_id uuid, p_qty numeric, p_tenant_id text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_sisa  numeric;
  v_ambil numeric;
  v_batch RECORD;
BEGIN
  IF COALESCE(p_qty, 0) <= 0 THEN RETURN; END IF;

  UPDATE inventory_item SET stok_aktual = stok_aktual + p_qty
  WHERE id = p_item_id AND tenant_id = p_tenant_id;

  SELECT LEAST(p_qty, GREATEST(0, i.stok_aktual - COALESCE(
           (SELECT SUM(qty_sisa) FROM inventory_batch
            WHERE inventory_item_id = p_item_id AND tenant_id = p_tenant_id), 0)))
  INTO v_sisa
  FROM inventory_item i WHERE i.id = p_item_id;

  FOR v_batch IN
    SELECT id, qty_awal, qty_sisa FROM inventory_batch
    WHERE inventory_item_id = p_item_id AND tenant_id = p_tenant_id AND qty_sisa < qty_awal
    ORDER BY tanggal_masuk DESC, created_at DESC
    FOR UPDATE
  LOOP
    EXIT WHEN v_sisa <= 0;
    v_ambil := LEAST(v_batch.qty_awal - v_batch.qty_sisa, v_sisa);
    UPDATE inventory_batch SET qty_sisa = qty_sisa + v_ambil WHERE id = v_batch.id;
    v_sisa := v_sisa - v_ambil;
  END LOOP;
END;
$$;

-- Ambil qty dari stok secara FIFO (sama dengan selesai_cutting_v2).
-- Stok kurang tetap diambil (boleh minus), dihargai harga referensi.
CREATE OR REPLACE FUNCTION public._ambil_stok_bahan_fifo(
  p_item_id uuid, p_qty numeric, p_tenant_id text,
  OUT harga numeric, OUT batch_id uuid)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_inv   RECORD;
  v_sisa  numeric := p_qty;
  v_ambil numeric;
  v_batch RECORD;
BEGIN
  harga := 0;
  batch_id := NULL;
  SELECT id, nama, harga_referensi INTO v_inv
  FROM inventory_item WHERE id = p_item_id AND tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Bahan tidak ditemukan di inventory'; END IF;
  IF COALESCE(p_qty, 0) <= 0 THEN RETURN; END IF;

  FOR v_batch IN
    SELECT id, qty_sisa, harga_satuan FROM inventory_batch
    WHERE inventory_item_id = p_item_id AND tenant_id = p_tenant_id AND qty_sisa > 0
    ORDER BY tanggal_masuk ASC
    FOR UPDATE
  LOOP
    EXIT WHEN v_sisa <= 0;
    v_ambil := LEAST(v_batch.qty_sisa, v_sisa);
    UPDATE inventory_batch SET qty_sisa = qty_sisa - v_ambil WHERE id = v_batch.id;
    harga  := harga + v_ambil * COALESCE(v_batch.harga_satuan, 0);
    v_sisa := v_sisa - v_ambil;
    IF batch_id IS NULL THEN batch_id := v_batch.id; END IF;
  END LOOP;

  IF v_sisa > 0 THEN
    harga := harga + v_sisa * COALESCE(v_inv.harga_referensi, 0);
    IF batch_id IS NULL THEN
      SELECT id INTO batch_id FROM inventory_batch
      WHERE inventory_item_id = p_item_id AND tenant_id = p_tenant_id
      ORDER BY tanggal_masuk DESC LIMIT 1;
    END IF;
  END IF;
  IF batch_id IS NULL THEN
    RAISE EXCEPTION 'Bahan % belum punya LOT di inventory', v_inv.nama;
  END IF;

  UPDATE inventory_item SET stok_aktual = stok_aktual - p_qty WHERE id = p_item_id;
END;
$$;

REVOKE ALL ON FUNCTION public._kembalikan_stok_bahan(uuid, numeric, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._ambil_stok_bahan_fifo(uuid, numeric, text) FROM PUBLIC, anon, authenticated;


-- ─── Koreksi pemakaian bahan ────────────────────────────────────────────────
-- p_items: [{ id, inventory_item_id, rate_per_pcs }]
--   rate 0 → catatan dihapus, stok dikembalikan.
CREATE OR REPLACE FUNCTION public.koreksi_pemakaian_bahan(
  p_items jsonb, p_alasan text, p_user_id uuid, p_tenant_id text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_it      RECORD;
  v_pb      RECORD;
  v_qty_pcs numeric;
  v_baru    numeric;
  v_delta   numeric;
  v_ambil   RECORD;
  v_harga   numeric;
  v_batch   uuid;
  v_n       int := 0;
  v_hapus   int := 0;
BEGIN
  IF auth.uid() IS NOT NULL AND get_current_user_role() <> 'owner' THEN
    RAISE EXCEPTION 'Hanya owner yang boleh mengoreksi pemakaian bahan';
  END IF;
  IF p_alasan IS NULL OR trim(p_alasan) = '' THEN RAISE EXCEPTION 'Alasan koreksi wajib diisi'; END IF;
  IF jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Tidak ada perubahan';
  END IF;

  FOR v_it IN
    SELECT (e->>'id')::uuid AS id,
           (e->>'inventory_item_id')::uuid AS item_id,
           ROUND((e->>'rate_per_pcs')::numeric, 4) AS rate
    FROM jsonb_array_elements(p_items) e
  LOOP
    SELECT pb.*, b.barcode,
           COALESCE((b.status_tahap->'cutting'->>'qty_aktual')::numeric, b.qty_rencana, 0) AS qty_pcs,
           ii.nama AS item_nama
    INTO v_pb
    FROM pemakaian_bahan pb
    JOIN bundle b ON b.id = pb.bundle_id
    JOIN inventory_item ii ON ii.id = pb.inventory_item_id
    WHERE pb.id = v_it.id AND pb.tenant_id = p_tenant_id
    FOR UPDATE OF pb;
    IF NOT FOUND THEN RAISE EXCEPTION 'Catatan pemakaian tidak ditemukan — muat ulang halaman'; END IF;

    IF v_it.rate IS NULL OR v_it.rate < 0 THEN
      RAISE EXCEPTION 'Pemakaian bundle % tidak valid', v_pb.barcode;
    END IF;
    IF v_it.rate > 3 THEN
      RAISE EXCEPTION 'Pemakaian bundle % melebihi batas 3 per pcs — periksa lagi', v_pb.barcode;
    END IF;

    v_qty_pcs := v_pb.qty_pcs;
    v_baru    := ROUND(v_it.rate * v_qty_pcs, 3);

    -- Tidak berubah → lewati
    CONTINUE WHEN v_it.item_id = v_pb.inventory_item_id
              AND v_it.rate = ROUND(COALESCE(v_pb.rate_per_pcs, 0), 4)
              AND v_baru = v_pb.qty_pakai;

    IF v_it.rate = 0 THEN
      -- Hapus catatan
      PERFORM _kembalikan_stok_bahan(v_pb.inventory_item_id, v_pb.qty_pakai, p_tenant_id);
      DELETE FROM pemakaian_bahan WHERE id = v_pb.id;
      v_harga := 0;
      v_hapus := v_hapus + 1;

    ELSIF v_it.item_id = v_pb.inventory_item_id THEN
      -- Bahan sama, pemakaian berubah → hanya selisihnya
      v_delta := v_baru - v_pb.qty_pakai;
      v_batch := v_pb.inventory_batch_id;
      IF v_delta > 0 THEN
        SELECT * INTO v_ambil FROM _ambil_stok_bahan_fifo(v_pb.inventory_item_id, v_delta, p_tenant_id);
        v_harga := COALESCE(v_pb.harga_pakai, 0) + v_ambil.harga;
      ELSE
        PERFORM _kembalikan_stok_bahan(v_pb.inventory_item_id, -v_delta, p_tenant_id);
        v_harga := CASE WHEN v_pb.qty_pakai > 0
                        THEN COALESCE(v_pb.harga_pakai, 0) * v_baru / v_pb.qty_pakai ELSE 0 END;
      END IF;
      UPDATE pemakaian_bahan
      SET qty_pakai = v_baru, rate_per_pcs = v_it.rate, harga_pakai = ROUND(v_harga, 2)
      WHERE id = v_pb.id;

    ELSE
      -- Bahan diganti → kembalikan semua bahan lama, ambil bahan baru
      IF EXISTS (SELECT 1 FROM pemakaian_bahan
                 WHERE bundle_id = v_pb.bundle_id AND inventory_item_id = v_it.item_id AND id <> v_pb.id) THEN
        RAISE EXCEPTION 'Bundle % sudah punya catatan untuk bahan itu — ubah baris yang ada saja', v_pb.barcode;
      END IF;
      PERFORM _kembalikan_stok_bahan(v_pb.inventory_item_id, v_pb.qty_pakai, p_tenant_id);
      SELECT * INTO v_ambil FROM _ambil_stok_bahan_fifo(v_it.item_id, v_baru, p_tenant_id);
      v_harga := v_ambil.harga;
      UPDATE pemakaian_bahan
      SET inventory_item_id = v_it.item_id, inventory_batch_id = v_ambil.batch_id,
          qty_pakai = v_baru, rate_per_pcs = v_it.rate, harga_pakai = ROUND(v_harga, 2)
      WHERE id = v_pb.id;
    END IF;

    INSERT INTO audit_log (user_id, modul, aksi, target, metadata, tenant_id)
    VALUES (p_user_id, 'produksi', 'Koreksi Pemakaian Bahan', v_pb.barcode,
      jsonb_build_object(
        'pemakaian_id', v_pb.id, 'bundle_id', v_pb.bundle_id,
        'lama', jsonb_build_object('inventory_item_id', v_pb.inventory_item_id, 'bahan', v_pb.item_nama,
                                   'rate_per_pcs', v_pb.rate_per_pcs, 'qty_pakai', v_pb.qty_pakai,
                                   'harga_pakai', v_pb.harga_pakai),
        'baru', jsonb_build_object('inventory_item_id', v_it.item_id, 'rate_per_pcs', v_it.rate,
                                   'qty_pakai', v_baru, 'harga_pakai', ROUND(v_harga, 2),
                                   'dihapus', v_it.rate = 0),
        'alasan', trim(p_alasan)),
      p_tenant_id);

    v_n := v_n + 1;
  END LOOP;

  RETURN jsonb_build_object('diubah', v_n - v_hapus, 'dihapus', v_hapus);
END;
$$;

REVOKE ALL ON FUNCTION public.koreksi_pemakaian_bahan(jsonb, text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.koreksi_pemakaian_bahan(jsonb, text, uuid, text) TO authenticated;
