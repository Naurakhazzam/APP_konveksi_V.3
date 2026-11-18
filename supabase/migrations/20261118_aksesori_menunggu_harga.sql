-- Aksesori "menunggu harga" (18 Nov 2026) — Fase 1 Laporan PO perkiraan vs aktual
-- Bila aksesori dipakai saat LOT kurang, bagian yang kurang TIDAK lagi dihargai
-- harga_referensi. Bagian itu masuk antrean aksesori_tunggu_harga (tanpa harga).
-- LOT baru (Stok Masuk / Potong Puring) melunasi antrean lebih dulu (FIFO):
-- harga LOT itu menjadi modal pemakaian (pemakaian_aksesori.harga_pakai + jurnal
-- direct_bahan bertanggal pemakaian). Invarian [stok-minus-lunasi] tetap:
-- LOT baru qty_sisa = qty − hutang, total LOT = stok_aktual bila stok ≥ 0.

-- ─── Tabel antrean & pelunasan ───
CREATE TABLE IF NOT EXISTS aksesori_tunggu_harga (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         text NOT NULL,
  inventory_item_id uuid NOT NULL REFERENCES inventory_item(id),
  bundle_id         uuid NOT NULL REFERENCES bundle(id) ON DELETE CASCADE,
  po_id             uuid,
  tahap             tahap_produksi NOT NULL,
  qty               numeric NOT NULL,   -- qty yang dipakai tanpa LOT (dikurangi bila dikembalikan)
  qty_sisa          numeric NOT NULL,   -- yang masih belum punya harga
  tanggal           date NOT NULL DEFAULT CURRENT_DATE,  -- tanggal pemakaian
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid
);
CREATE INDEX IF NOT EXISTS aksesori_tunggu_harga_item_idx
  ON aksesori_tunggu_harga (inventory_item_id, created_at) WHERE qty_sisa > 0;
CREATE INDEX IF NOT EXISTS aksesori_tunggu_harga_bundle_idx
  ON aksesori_tunggu_harga (bundle_id, inventory_item_id, tahap);

CREATE TABLE IF NOT EXISTS aksesori_pelunasan_harga (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          text NOT NULL,
  tunggu_id          uuid NOT NULL REFERENCES aksesori_tunggu_harga(id) ON DELETE CASCADE,
  inventory_batch_id uuid REFERENCES inventory_batch(id) ON DELETE SET NULL,
  qty                numeric NOT NULL,
  harga_satuan       numeric NOT NULL,
  nominal            numeric NOT NULL,
  jurnal_entry_id    uuid,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS aksesori_pelunasan_harga_batch_idx ON aksesori_pelunasan_harga (inventory_batch_id);

ALTER TABLE aksesori_tunggu_harga ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS aksesori_tunggu_harga_select ON aksesori_tunggu_harga;
CREATE POLICY aksesori_tunggu_harga_select ON aksesori_tunggu_harga FOR SELECT TO authenticated USING (true);
ALTER TABLE aksesori_pelunasan_harga ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS aksesori_pelunasan_harga_select ON aksesori_pelunasan_harga;
CREATE POLICY aksesori_pelunasan_harga_select ON aksesori_pelunasan_harga FOR SELECT TO authenticated USING (true);

-- ─── Helper: catat antrean ───
CREATE OR REPLACE FUNCTION public._catat_tunggu_harga(p_item_id uuid, p_bundle_id uuid, p_po_id uuid, p_tahap text, p_qty numeric, p_user_id uuid, p_tenant_id text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF COALESCE(p_qty, 0) <= 0 THEN RETURN; END IF;
  INSERT INTO aksesori_tunggu_harga (tenant_id, inventory_item_id, bundle_id, po_id, tahap, qty, qty_sisa, created_by)
  VALUES (p_tenant_id, p_item_id, p_bundle_id, p_po_id, p_tahap::tahap_produksi, p_qty, p_qty, p_user_id);
END $function$;

-- ─── Helper: LOT baru melunasi antrean (FIFO). Mengembalikan qty yang terlunasi ───
CREATE OR REPLACE FUNCTION public._lunasi_tunggu_harga(p_item_id uuid, p_batch_id uuid, p_qty_max numeric, p_harga numeric, p_user_id uuid, p_tenant_id text)
 RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_sisa    numeric := COALESCE(p_qty_max, 0);
  v_total   numeric := 0;
  v_t       RECORD;
  v_ambil   numeric;
  v_nominal numeric;
  v_kat     uuid;
  v_nama    text;
  v_jurnal  uuid;
BEGIN
  IF v_sisa <= 0 THEN RETURN 0; END IF;

  SELECT nama INTO v_nama FROM inventory_item WHERE id = p_item_id;
  SELECT id INTO v_kat FROM kategori_trx
  WHERE jenis = 'direct_bahan' AND aktif = TRUE AND tenant_id = p_tenant_id
  ORDER BY (nama = 'Pembelian Aksesori') DESC LIMIT 1;

  FOR v_t IN
    SELECT * FROM aksesori_tunggu_harga
    WHERE inventory_item_id = p_item_id AND tenant_id = p_tenant_id AND qty_sisa > 0
    ORDER BY created_at, id
    FOR UPDATE
  LOOP
    EXIT WHEN v_sisa <= 0;
    v_ambil   := LEAST(v_t.qty_sisa, v_sisa);
    v_nominal := ROUND(v_ambil * COALESCE(p_harga, 0), 2);

    UPDATE aksesori_tunggu_harga SET qty_sisa = qty_sisa - v_ambil WHERE id = v_t.id;
    UPDATE pemakaian_aksesori SET harga_pakai = COALESCE(harga_pakai, 0) + v_nominal
    WHERE bundle_id = v_t.bundle_id AND inventory_item_id = p_item_id AND tahap = v_t.tahap;

    v_jurnal := NULL;
    IF v_kat IS NOT NULL AND v_t.po_id IS NOT NULL AND v_nominal > 0 THEN
      INSERT INTO jurnal_entry (kategori_trx_id, jenis, nominal, tanggal, no_faktur, keterangan,
                                qty, inventory_item_id, tag_po_ids, tenant_id, created_by)
      VALUES (v_kat, 'direct_bahan', v_nominal, v_t.tanggal,
              'AUTO-AKS-' || to_char(v_t.tanggal, 'YYYYMMDD'),
              'Pemakaian aksesori ' || v_t.tahap::text || ': ' || v_nama,
              v_ambil, p_item_id, jsonb_build_array(v_t.po_id::text), p_tenant_id, p_user_id)
      RETURNING id INTO v_jurnal;
    END IF;

    INSERT INTO aksesori_pelunasan_harga (tenant_id, tunggu_id, inventory_batch_id, qty, harga_satuan, nominal, jurnal_entry_id)
    VALUES (p_tenant_id, v_t.id, p_batch_id, v_ambil, COALESCE(p_harga, 0), v_nominal, v_jurnal);

    v_sisa  := v_sisa - v_ambil;
    v_total := v_total + v_ambil;
  END LOOP;
  RETURN v_total;
END $function$;

-- ─── Helper: batalkan pelunasan dari satu LOT (dipakai Batal Potong Puring) ───
CREATE OR REPLACE FUNCTION public._batal_pelunasan_batch(p_batch_id uuid, p_tenant_id text)
 RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_p     RECORD;
  v_balik numeric;
  v_total numeric := 0;
BEGIN
  FOR v_p IN
    SELECT pl.*, t.bundle_id, t.inventory_item_id, t.tahap, t.qty AS t_qty, t.qty_sisa AS t_sisa
    FROM aksesori_pelunasan_harga pl
    JOIN aksesori_tunggu_harga t ON t.id = pl.tunggu_id
    WHERE pl.inventory_batch_id = p_batch_id AND pl.tenant_id = p_tenant_id
    FOR UPDATE OF pl, t
  LOOP
    -- jangan melebihi qty yang masih tercatat dipakai (bisa sudah dikembalikan)
    v_balik := LEAST(v_p.qty, GREATEST(v_p.t_qty - v_p.t_sisa, 0));
    IF v_balik > 0 THEN
      UPDATE aksesori_tunggu_harga SET qty_sisa = qty_sisa + v_balik WHERE id = v_p.tunggu_id;
      UPDATE pemakaian_aksesori
      SET harga_pakai = GREATEST(COALESCE(harga_pakai, 0) - ROUND(v_p.nominal * v_balik / v_p.qty, 2), 0)
      WHERE bundle_id = v_p.bundle_id AND inventory_item_id = v_p.inventory_item_id AND tahap = v_p.tahap;
      v_total := v_total + v_balik;
    END IF;
    IF v_p.jurnal_entry_id IS NOT NULL THEN
      DELETE FROM jurnal_entry WHERE id = v_p.jurnal_entry_id;
    END IF;
    DELETE FROM aksesori_pelunasan_harga WHERE id = v_p.id;
  END LOOP;
  RETURN v_total;
END $function$;

-- ─── Helper: kembalikan sebagian pemakaian aksesori satu bundle × item × tahap ───
-- Urutan: bagian yang masih menunggu harga dikembalikan lebih dulu (tanpa jurnal),
-- sisanya membalik jurnal & modal FIFO secara proporsional.
CREATE OR REPLACE FUNCTION public._kembalikan_aksesori_qty(p_bundle_id uuid, p_item_id uuid, p_tahap text, p_qty numeric, p_tenant_id text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_pa       RECORD;
  v_po_id    uuid;
  v_nama     text;
  v_tunggu   numeric;
  v_dari_tg  numeric := 0;
  v_berharga numeric;
  v_sisa     numeric;
  v_ambil    numeric;
  v_t        RECORD;
  v_j        RECORD;
BEGIN
  IF COALESCE(p_qty, 0) <= 0 THEN RETURN; END IF;

  SELECT pi.po_id INTO v_po_id FROM bundle b JOIN po_item pi ON pi.id = b.po_item_id WHERE b.id = p_bundle_id;
  SELECT nama INTO v_nama FROM inventory_item WHERE id = p_item_id;
  SELECT id, qty_pakai, harga_pakai INTO v_pa FROM pemakaian_aksesori
  WHERE bundle_id = p_bundle_id AND inventory_item_id = p_item_id AND tahap::text = p_tahap
  FOR UPDATE;

  SELECT COALESCE(SUM(qty_sisa), 0) INTO v_tunggu FROM aksesori_tunggu_harga
  WHERE bundle_id = p_bundle_id AND inventory_item_id = p_item_id AND tahap::text = p_tahap;

  -- 1. kurangi antrean (yang terbaru dulu)
  v_sisa := LEAST(p_qty, v_tunggu);
  FOR v_t IN
    SELECT id, qty_sisa FROM aksesori_tunggu_harga
    WHERE bundle_id = p_bundle_id AND inventory_item_id = p_item_id AND tahap::text = p_tahap AND qty_sisa > 0
    ORDER BY created_at DESC, id DESC FOR UPDATE
  LOOP
    EXIT WHEN v_sisa <= 0;
    v_ambil := LEAST(v_t.qty_sisa, v_sisa);
    UPDATE aksesori_tunggu_harga SET qty_sisa = qty_sisa - v_ambil, qty = qty - v_ambil WHERE id = v_t.id;
    v_sisa := v_sisa - v_ambil;
    v_dari_tg := v_dari_tg + v_ambil;
  END LOOP;
  DELETE FROM aksesori_tunggu_harga
  WHERE bundle_id = p_bundle_id AND inventory_item_id = p_item_id AND tahap::text = p_tahap AND qty <= 0;

  -- 2. stok kembali (LOT hanya diisi sebatas stok di atas total LOT)
  PERFORM _kembalikan_stok_bahan(p_item_id, p_qty, p_tenant_id);

  -- 3. bagian berharga: balik jurnal & kurangi modal proporsional
  v_berharga := p_qty - v_dari_tg;
  IF v_berharga > 0 AND v_po_id IS NOT NULL THEN
    v_sisa := v_berharga;
    FOR v_j IN
      SELECT id, qty, nominal FROM jurnal_entry
      WHERE tenant_id = p_tenant_id AND jenis = 'direct_bahan'
        AND inventory_item_id = p_item_id
        AND tag_po_ids @> jsonb_build_array(v_po_id::text)
        AND (keterangan LIKE ('Pemakaian aksesori ' || p_tahap || ':%') OR keterangan = v_nama)
        AND qty > 0
      ORDER BY created_at DESC FOR UPDATE
    LOOP
      EXIT WHEN v_sisa <= 0;
      v_ambil := LEAST(v_j.qty, v_sisa);
      IF v_ambil >= v_j.qty THEN
        DELETE FROM jurnal_entry WHERE id = v_j.id;
      ELSE
        UPDATE jurnal_entry
        SET qty = qty - v_ambil,
            nominal = GREATEST(round(nominal - nominal * v_ambil / v_j.qty, 2), 0)
        WHERE id = v_j.id;
      END IF;
      v_sisa := v_sisa - v_ambil;
    END LOOP;
  END IF;

  IF v_pa.id IS NOT NULL THEN
    UPDATE pemakaian_aksesori
    SET harga_pakai = CASE
          WHEN harga_pakai IS NOT NULL AND v_berharga > 0 AND (qty_pakai - v_tunggu) > 0
            THEN GREATEST(ROUND(harga_pakai * (1 - LEAST(v_berharga / (qty_pakai - v_tunggu), 1)), 2), 0)
          ELSE harga_pakai END,
        qty_pakai = GREATEST(qty_pakai - p_qty, 0)
    WHERE id = v_pa.id;
  END IF;
END $function$;

-- ─── consume_fifo_atomic (9 argumen, jalur jahit): kekurangan → antrean, bukan harga_referensi ───
CREATE OR REPLACE FUNCTION public.consume_fifo_atomic(p_inventory_item_id uuid, p_qty_needed numeric, p_po_item_id uuid, p_bundle_id uuid, p_rate_per_pcs numeric, p_user_id uuid, p_tenant_id text, p_kategori_trx_id uuid DEFAULT NULL::uuid, p_tahap text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_item              RECORD;
  v_batch             RECORD;
  v_sisa_kebutuhan    NUMERIC := p_qty_needed;
  v_total_consumed    NUMERIC := 0;
  v_first_batch_id    UUID    := NULL;
  v_ambil             NUMERIC;
  v_po_id             UUID;
  v_kategori_id       UUID;
  v_nominal           NUMERIC;
  v_total_nominal     NUMERIC := 0;
  v_aksesori          BOOLEAN := (p_tahap IS NOT NULL AND p_tahap <> 'cutting');
BEGIN
  SELECT id, nama, stok_aktual, harga_referensi
  INTO v_item
  FROM inventory_item
  WHERE id = p_inventory_item_id AND tenant_id = p_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'status', 'error', 'item_nama', 'Item tidak ditemukan',
      'qty_consumed', 0, 'qty_kurang', p_qty_needed, 'sisa_stok', 0
    );
  END IF;

  SELECT po_id INTO v_po_id FROM po_item WHERE id = p_po_item_id;

  IF p_kategori_trx_id IS NOT NULL THEN
    v_kategori_id := p_kategori_trx_id;
  ELSE
    SELECT id INTO v_kategori_id
    FROM kategori_trx
    WHERE jenis = 'direct_bahan' AND aktif = TRUE AND tenant_id = p_tenant_id
    LIMIT 1;
  END IF;

  FOR v_batch IN
    SELECT id, qty_sisa, harga_satuan
    FROM inventory_batch
    WHERE inventory_item_id = p_inventory_item_id
      AND tenant_id = p_tenant_id AND qty_sisa > 0
    ORDER BY tanggal_masuk ASC, created_at ASC
    FOR UPDATE
  LOOP
    EXIT WHEN v_sisa_kebutuhan <= 0;
    v_ambil := LEAST(v_batch.qty_sisa, v_sisa_kebutuhan);
    UPDATE inventory_batch SET qty_sisa = qty_sisa - v_ambil WHERE id = v_batch.id;
    v_total_consumed := v_total_consumed + v_ambil;
    v_sisa_kebutuhan := v_sisa_kebutuhan - v_ambil;
    IF v_first_batch_id IS NULL THEN v_first_batch_id := v_batch.id; END IF;

    v_nominal := v_ambil * v_batch.harga_satuan;
    v_total_nominal := v_total_nominal + COALESCE(v_nominal, 0);
    IF v_kategori_id IS NOT NULL AND v_po_id IS NOT NULL AND v_nominal > 0 THEN
      INSERT INTO jurnal_entry (
        kategori_trx_id, jenis, nominal, tanggal, no_faktur,
        keterangan, qty, inventory_item_id, tag_po_ids, tenant_id, created_by
      ) VALUES (
        v_kategori_id, 'direct_bahan', v_nominal, CURRENT_DATE,
        'AUTO-BAHAN-' || to_char(CURRENT_DATE, 'YYYYMMDD'),
        v_item.nama,
        v_ambil, p_inventory_item_id,
        jsonb_build_array(v_po_id::TEXT), p_tenant_id, p_user_id
      );
    END IF;
  END LOOP;

  -- Kekurangan LOT: aksesori → menunggu harga (dicatat di bawah); jalur lain tetap harga_referensi
  IF v_sisa_kebutuhan > 0 AND NOT v_aksesori THEN
    v_nominal := v_sisa_kebutuhan * v_item.harga_referensi;
    v_total_nominal := v_total_nominal + COALESCE(v_nominal, 0);
    IF v_kategori_id IS NOT NULL AND v_po_id IS NOT NULL AND v_nominal > 0 THEN
      INSERT INTO jurnal_entry (
        kategori_trx_id, jenis, nominal, tanggal, no_faktur,
        keterangan, qty, inventory_item_id, tag_po_ids, tenant_id, created_by
      ) VALUES (
        v_kategori_id, 'direct_bahan', v_nominal, CURRENT_DATE,
        'AUTO-BAHAN-' || to_char(CURRENT_DATE, 'YYYYMMDD'),
        v_item.nama,
        v_sisa_kebutuhan, p_inventory_item_id,
        jsonb_build_array(v_po_id::TEXT), p_tenant_id, p_user_id
      );
    END IF;
  END IF;

  IF p_qty_needed > 0 THEN
    UPDATE inventory_item SET stok_aktual = stok_aktual - p_qty_needed WHERE id = p_inventory_item_id;

    IF v_aksesori THEN
      -- Satu baris per bundle × item × tahap. Bila baris sudah ada, qty diurus
      -- pemanggil (seperti sebelumnya); modal FIFO ditambahkan di sini.
      INSERT INTO pemakaian_aksesori (bundle_id, inventory_item_id, qty_pakai, tahap, tenant_id, harga_pakai)
      VALUES (p_bundle_id, p_inventory_item_id, p_qty_needed, p_tahap::tahap_produksi, p_tenant_id, ROUND(v_total_nominal, 2))
      ON CONFLICT (bundle_id, inventory_item_id, tahap)
      DO UPDATE SET harga_pakai = COALESCE(pemakaian_aksesori.harga_pakai,
                                           pemakaian_aksesori.qty_pakai * v_item.harga_referensi)
                                  + EXCLUDED.harga_pakai;
      PERFORM _catat_tunggu_harga(p_inventory_item_id, p_bundle_id, v_po_id, p_tahap, v_sisa_kebutuhan, p_user_id, p_tenant_id);
    ELSIF v_total_consumed > 0 THEN
      INSERT INTO pemakaian_bahan (
        bundle_id, po_item_id, inventory_item_id,
        qty_pakai, inventory_batch_id, rate_per_pcs, tenant_id
      ) VALUES (
        p_bundle_id, p_po_item_id, p_inventory_item_id,
        v_total_consumed, v_first_batch_id, p_rate_per_pcs, p_tenant_id
      ) ON CONFLICT DO NOTHING;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'status',       CASE WHEN v_sisa_kebutuhan > 0 THEN 'stok_kurang' ELSE 'ok' END,
    'qty_consumed', p_qty_needed - v_sisa_kebutuhan,
    'qty_kurang',   v_sisa_kebutuhan,
    'menunggu_harga', CASE WHEN v_aksesori THEN GREATEST(v_sisa_kebutuhan, 0) ELSE 0 END,
    'sisa_stok',    v_item.stok_aktual - p_qty_needed,
    'item_nama',    v_item.nama,
    'nominal',      ROUND(v_total_nominal, 2)
  );
END;
$function$;

-- ─── _pakai_aksesori_tahap (koreksi qty): kekurangan → antrean ───
CREATE OR REPLACE FUNCTION public._pakai_aksesori_tahap(p_bundle_id uuid, p_tahap text, p_qty numeric, p_user_id uuid, p_tenant_id text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_bundle      RECORD;
  v_aksesori    RECORD;
  v_qty_deduct  NUMERIC;
  v_kategori_id UUID;
  v_nominal     NUMERIC;
  v_sisa        NUMERIC;
  v_ambil       NUMERIC;
  v_batch       RECORD;
BEGIN
  IF COALESCE(p_qty, 0) <= 0 THEN RETURN; END IF;

  SELECT b.id, mp.id AS model_id, pi.po_id
  INTO v_bundle
  FROM bundle b
  JOIN po_item pi      ON pi.id = b.po_item_id
  JOIN produk p        ON p.id  = pi.produk_id
  JOIN model_produk mp ON mp.id = p.model_id
  WHERE b.id = p_bundle_id AND b.tenant_id = p_tenant_id;

  IF NOT FOUND THEN RETURN; END IF;

  SELECT id INTO v_kategori_id
  FROM kategori_trx
  WHERE jenis = 'direct_bahan' AND aktif = TRUE AND tenant_id = p_tenant_id
  LIMIT 1;

  FOR v_aksesori IN
    SELECT ma.inventory_item_id, ma.qty_per_pcs, ii.harga_referensi, ii.nama AS item_nama
    FROM model_aksesori ma
    JOIN inventory_item ii ON ii.id = ma.inventory_item_id
    WHERE ma.model_id = v_bundle.model_id AND ma.tahap_pakai::text = p_tahap
      AND ma.tenant_id = p_tenant_id
  LOOP
    v_qty_deduct := v_aksesori.qty_per_pcs * p_qty;
    v_sisa := v_qty_deduct; v_nominal := 0;

    PERFORM 1 FROM inventory_item WHERE id = v_aksesori.inventory_item_id FOR UPDATE;
    FOR v_batch IN
      SELECT id, qty_sisa, harga_satuan FROM inventory_batch
      WHERE inventory_item_id = v_aksesori.inventory_item_id AND tenant_id = p_tenant_id AND qty_sisa > 0
      ORDER BY tanggal_masuk ASC, created_at ASC FOR UPDATE
    LOOP
      EXIT WHEN v_sisa <= 0;
      v_ambil := LEAST(v_batch.qty_sisa, v_sisa);
      UPDATE inventory_batch SET qty_sisa = qty_sisa - v_ambil WHERE id = v_batch.id;
      v_nominal := v_nominal + v_ambil * COALESCE(v_batch.harga_satuan, 0);
      v_sisa := v_sisa - v_ambil;
    END LOOP;

    UPDATE inventory_item SET stok_aktual = stok_aktual - v_qty_deduct
    WHERE id = v_aksesori.inventory_item_id;

    INSERT INTO pemakaian_aksesori (bundle_id, inventory_item_id, qty_pakai, tahap, tenant_id, harga_pakai)
    VALUES (p_bundle_id, v_aksesori.inventory_item_id, v_qty_deduct, p_tahap::tahap_produksi, p_tenant_id, ROUND(v_nominal, 2))
    ON CONFLICT (bundle_id, inventory_item_id, tahap)
    DO UPDATE SET qty_pakai = pemakaian_aksesori.qty_pakai + EXCLUDED.qty_pakai,
                  harga_pakai = COALESCE(pemakaian_aksesori.harga_pakai,
                                         pemakaian_aksesori.qty_pakai * v_aksesori.harga_referensi)
                                + EXCLUDED.harga_pakai;

    PERFORM _catat_tunggu_harga(v_aksesori.inventory_item_id, p_bundle_id, v_bundle.po_id, p_tahap, v_sisa, p_user_id, p_tenant_id);

    IF v_kategori_id IS NOT NULL AND v_bundle.po_id IS NOT NULL AND v_nominal > 0 THEN
      INSERT INTO jurnal_entry (
        kategori_trx_id, jenis, nominal, tanggal, no_faktur,
        keterangan, qty, inventory_item_id, tag_po_ids, tenant_id, created_by
      ) VALUES (
        v_kategori_id, 'direct_bahan', ROUND(v_nominal, 2), CURRENT_DATE,
        'AUTO-AKS-' || to_char(CURRENT_DATE, 'YYYYMMDD'),
        'Pemakaian aksesori ' || p_tahap || ': ' || v_aksesori.item_nama,
        v_qty_deduct - v_sisa, v_aksesori.inventory_item_id,
        jsonb_build_array(v_bundle.po_id::TEXT), p_tenant_id, p_user_id
      );
    END IF;
  END LOOP;
END;
$function$;

-- ─── _kembalikan_aksesori_tahap: lewat helper (antrean dibatalkan dulu) ───
CREATE OR REPLACE FUNCTION public._kembalikan_aksesori_tahap(p_bundle_id uuid, p_po_id uuid, p_tahap text, p_tenant_id text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_pakai RECORD;
BEGIN
  FOR v_pakai IN
    SELECT pa.id, pa.inventory_item_id, pa.qty_pakai
    FROM pemakaian_aksesori pa
    WHERE pa.bundle_id = p_bundle_id AND pa.tahap::text = p_tahap
  LOOP
    PERFORM _kembalikan_aksesori_qty(p_bundle_id, v_pakai.inventory_item_id, p_tahap, v_pakai.qty_pakai, p_tenant_id);
    DELETE FROM pemakaian_aksesori WHERE id = v_pakai.id;
    DELETE FROM aksesori_tunggu_harga
    WHERE bundle_id = p_bundle_id AND inventory_item_id = v_pakai.inventory_item_id AND tahap::text = p_tahap;
  END LOOP;
END;
$function$;

-- ─── _sesuaikan_aksesori_jahit: cabang kurangi lewat helper ───
CREATE OR REPLACE FUNCTION public._sesuaikan_aksesori_jahit(p_bundle_id uuid, p_delta numeric, p_user_id uuid, p_tenant_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_bundle               RECORD;
  v_warna_id             UUID;
  v_kategori_aksesori_id UUID;
  v_aksesori             RECORD;
  v_jumlah               NUMERIC;
  v_ada_pemakaian        BOOLEAN;
  v_consume_result       JSONB;
  v_stok_warnings        JSONB := '[]'::JSONB;
BEGIN
  IF COALESCE(p_delta, 0) = 0 THEN RETURN v_stok_warnings; END IF;

  SELECT b.id, b.po_item_id, pi.po_id, pi.warna, produk.model_id
  INTO v_bundle
  FROM bundle b
  JOIN po_item pi ON pi.id = b.po_item_id
  JOIN produk     ON produk.id = pi.produk_id
  WHERE b.id = p_bundle_id AND b.tenant_id = p_tenant_id;

  IF NOT FOUND THEN RETURN v_stok_warnings; END IF;

  SELECT id INTO v_kategori_aksesori_id
  FROM kategori_trx
  WHERE nama = 'Pembelian Aksesori' AND jenis = 'direct_bahan'
    AND aktif = TRUE AND tenant_id = p_tenant_id
  LIMIT 1;

  SELECT id INTO v_warna_id
  FROM warna
  WHERE LOWER(nama) = LOWER(v_bundle.warna) AND tenant_id = p_tenant_id
  LIMIT 1;

  FOR v_aksesori IN
    SELECT ma.inventory_item_id, ma.qty_per_pcs
    FROM model_aksesori ma
    WHERE ma.model_id = v_bundle.model_id AND ma.tenant_id = p_tenant_id
      AND ma.tahap_pakai = 'jahit'
      AND (ma.warna_id IS NULL OR ma.warna_id = v_warna_id)
    UNION ALL
    SELECT wa.inventory_item_id, wa.qty_per_pcs
    FROM warna_aksesori wa
    WHERE v_warna_id IS NOT NULL AND wa.warna_id = v_warna_id
      AND wa.tenant_id = p_tenant_id AND wa.tahap_pakai = 'jahit'
  LOOP
    v_jumlah := v_aksesori.qty_per_pcs * abs(p_delta);
    CONTINUE WHEN v_jumlah <= 0;

    IF p_delta > 0 THEN
      SELECT EXISTS (
        SELECT 1 FROM pemakaian_aksesori
        WHERE bundle_id = v_bundle.id AND inventory_item_id = v_aksesori.inventory_item_id
          AND tahap = 'jahit'
      ) INTO v_ada_pemakaian;

      v_consume_result := consume_fifo_atomic(
        v_aksesori.inventory_item_id, v_jumlah, v_bundle.po_item_id,
        v_bundle.id, v_aksesori.qty_per_pcs, p_user_id, p_tenant_id,
        v_kategori_aksesori_id, 'jahit'
      );

      IF v_ada_pemakaian THEN
        UPDATE pemakaian_aksesori
        SET qty_pakai = qty_pakai + v_jumlah
        WHERE bundle_id = v_bundle.id AND inventory_item_id = v_aksesori.inventory_item_id
          AND tahap = 'jahit';
      END IF;

      IF v_consume_result ->> 'status' = 'stok_kurang' THEN
        v_stok_warnings := v_stok_warnings || jsonb_build_object(
          'item_nama',  v_consume_result ->> 'item_nama',
          'qty_kurang', v_consume_result -> 'qty_kurang',
          'sisa_stok',  v_consume_result -> 'sisa_stok'
        );
      END IF;
    ELSE
      PERFORM _kembalikan_aksesori_qty(v_bundle.id, v_aksesori.inventory_item_id, 'jahit', v_jumlah, p_tenant_id);
    END IF;
  END LOOP;

  DELETE FROM pemakaian_aksesori
  WHERE bundle_id = v_bundle.id AND tahap = 'jahit' AND qty_pakai <= 0;

  RETURN v_stok_warnings;
END;
$function$;

-- ─── koreksi_serah_terima_jahit: cabang kurangi lewat helper (patch teks) ───
DO $$
DECLARE v_def text; v_a int; v_b int; v_end text;
BEGIN
  SELECT pg_get_functiondef('public.koreksi_serah_terima_jahit(uuid,uuid,numeric,text,uuid,text,boolean)'::regprocedure) INTO v_def;
  v_def := replace(v_def, E'\r\n', E'\n');  -- badan fungsi tersimpan dengan CRLF
  v_a := strpos(v_def, E'        UPDATE inventory_item\n        SET stok_aktual = stok_aktual + v_jumlah');
  v_end := E'        UPDATE pemakaian_aksesori\n        SET qty_pakai = GREATEST(qty_pakai - v_jumlah, 0)\n        WHERE bundle_id = v_bundle.id AND inventory_item_id = v_aksesori.inventory_item_id\n          AND tahap = ''jahit'';\n';
  v_b := strpos(v_def, v_end);
  IF v_a = 0 OR v_b = 0 OR v_b < v_a THEN
    RAISE EXCEPTION 'Patch koreksi_serah_terima_jahit tidak menemukan targetnya (% %)', v_a, v_b;
  END IF;
  v_def := substr(v_def, 1, v_a - 1)
    || E'        PERFORM _kembalikan_aksesori_qty(v_bundle.id, v_aksesori.inventory_item_id, ''jahit'', v_jumlah, p_tenant_id);\n'
    || substr(v_def, v_b + length(v_end));
  EXECUTE v_def;
END $$;

-- ─── stok_masuk: bagian yang melunasi stok minus juga melunasi antrean harga ───
CREATE OR REPLACE FUNCTION public.stok_masuk(p_inventory_item_id uuid, p_qty numeric, p_harga_satuan numeric, p_tanggal_masuk date, p_no_faktur text, p_kategori_trx_id uuid, p_keterangan text, p_user_id uuid, p_tenant_id text, p_qty_beli numeric DEFAULT NULL::numeric, p_harga_beli numeric DEFAULT NULL::numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_item       RECORD;
  v_jurnal_id  UUID;
  v_batch_id   UUID;
  v_kas_id     UUID;
  v_qty        NUMERIC;
  v_harga      NUMERIC;
  v_nominal    NUMERIC;
  v_total_lot  NUMERIC;
  v_hutang     NUMERIC;
  v_lunas      NUMERIC;
  v_lunas_tg   NUMERIC := 0;
  v_ket_qty    TEXT;
BEGIN
  SELECT id, nama, satuan, stok_aktual, satuan_beli, faktor_konversi INTO v_item
  FROM inventory_item
  WHERE id = p_inventory_item_id AND tenant_id = p_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'Item inventory tidak ditemukan'; END IF;

  IF p_qty_beli IS NOT NULL THEN
    IF v_item.satuan_beli IS NULL OR COALESCE(v_item.faktor_konversi, 0) <= 0 THEN
      RAISE EXCEPTION '% tidak punya konversi satuan beli', v_item.nama;
    END IF;
    IF p_qty_beli <= 0 THEN RAISE EXCEPTION 'Qty beli harus lebih dari 0'; END IF;
    IF COALESCE(p_harga_beli, -1) < 0 THEN RAISE EXCEPTION 'Harga beli tidak valid'; END IF;
    v_qty     := p_qty_beli * v_item.faktor_konversi;
    v_nominal := round(p_qty_beli * p_harga_beli, 2);
    v_harga   := round(v_nominal / v_qty, 2);
    v_ket_qty := replace(trim_scale(p_qty_beli)::text, '.', ',') || ' ' || v_item.satuan_beli
      || ' (' || replace(trim_scale(v_qty)::text, '.', ',') || ' ' || COALESCE(v_item.satuan, '') || ')'
      || ' @ Rp ' || replace(to_char(p_harga_beli, 'FM999G999G999G990'), ',', '.') || '/' || v_item.satuan_beli;
  ELSE
    v_qty     := p_qty;
    v_harga   := p_harga_satuan;
    v_nominal := p_qty * p_harga_satuan;
    v_ket_qty := replace(trim_scale(p_qty)::text, '.', ',') || ' ' || COALESCE(v_item.satuan, '');
  END IF;

  IF COALESCE(v_qty, 0) <= 0 THEN RAISE EXCEPTION 'Qty harus lebih dari 0'; END IF;

  SELECT COALESCE(SUM(qty_sisa), 0) INTO v_total_lot
  FROM inventory_batch WHERE inventory_item_id = p_inventory_item_id AND tenant_id = p_tenant_id;
  v_hutang := GREATEST(v_total_lot - v_item.stok_aktual, 0);
  v_lunas  := LEAST(v_hutang, v_qty);

  INSERT INTO jurnal_entry (
    kategori_trx_id, jenis, nominal, tanggal,
    no_faktur, keterangan, qty, inventory_item_id,
    tag_po_ids, tenant_id, created_by
  ) VALUES (
    p_kategori_trx_id, 'pembelian_bahan', v_nominal, p_tanggal_masuk,
    p_no_faktur,
    COALESCE(p_keterangan, 'Stok masuk: ' || v_item.nama),
    v_qty, p_inventory_item_id,
    '[]'::JSONB, p_tenant_id, p_user_id
  ) RETURNING id INTO v_jurnal_id;

  INSERT INTO inventory_batch (
    inventory_item_id, qty_awal, qty_sisa,
    harga_satuan, tanggal_masuk, jurnal_entry_id, tenant_id
  ) VALUES (
    p_inventory_item_id, v_qty, v_qty - v_lunas,
    v_harga, p_tanggal_masuk, v_jurnal_id, p_tenant_id
  ) RETURNING id INTO v_batch_id;

  IF v_lunas > 0 THEN
    v_lunas_tg := _lunasi_tunggu_harga(p_inventory_item_id, v_batch_id, v_lunas, v_harga, p_user_id, p_tenant_id);
  END IF;

  IF v_nominal > 0 THEN
    INSERT INTO buku_kas (
      tenant_id, tanggal, tipe, kategori, nominal, keterangan,
      no_referensi, qty, satuan, inventory_batch_id, created_by
    ) VALUES (
      p_tenant_id, p_tanggal_masuk, 'keluar', 'Pembelian Bahan', v_nominal,
      'Belanja ' || v_item.nama || ' ' || v_ket_qty
        || CASE WHEN NULLIF(trim(COALESCE(p_keterangan, '')), '') IS NOT NULL THEN ' — ' || trim(p_keterangan) ELSE '' END,
      p_no_faktur, v_qty, v_item.satuan, v_batch_id, p_user_id
    ) RETURNING id INTO v_kas_id;
  END IF;

  UPDATE inventory_item
  SET stok_aktual = stok_aktual + v_qty
  WHERE id = p_inventory_item_id;

  RETURN jsonb_build_object(
    'batch_id',  v_batch_id,
    'jurnal_id', v_jurnal_id,
    'buku_kas_id', v_kas_id,
    'stok_baru', v_item.stok_aktual + v_qty,
    'qty_lunasi_minus', v_lunas,
    'qty_lunasi_tunggu', v_lunas_tg,
    'nominal', v_nominal
  );
END; $function$;

-- ─── potong_puring: LOT Puring baru melunasi stok minus & antrean dulu ───
CREATE OR REPLACE FUNCTION public.potong_puring(p_bahan_item_id uuid, p_kg numeric, p_pcs integer, p_habis_roll boolean, p_catatan text, p_user_id uuid, p_tenant_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_bahan   RECORD;
  v_puring  RECORD;
  v_ambil   RECORD;
  v_per_pcs numeric;
  v_batch   uuid;
  v_id      uuid;
  v_ref     numeric;
  v_lot     numeric;
  v_lunas   numeric;
  v_lunas_tg numeric := 0;
BEGIN
  IF COALESCE(p_kg, 0) <= 0 THEN RAISE EXCEPTION 'Kg yang dipakai harus lebih dari 0'; END IF;
  IF COALESCE(p_pcs, 0) <= 0 THEN RAISE EXCEPTION 'Jumlah lembar puring harus lebih dari 0'; END IF;

  SELECT id, nama, stok_aktual INTO v_bahan FROM inventory_item
  WHERE id = p_bahan_item_id AND tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Bahan puring tidak ditemukan'; END IF;
  IF p_kg > v_bahan.stok_aktual + 0.0005 THEN
    RAISE EXCEPTION 'Stok % hanya % kg — input belanja (Stok Masuk) dulu', v_bahan.nama, v_bahan.stok_aktual;
  END IF;

  SELECT id, stok_aktual, harga_referensi INTO v_puring FROM inventory_item
  WHERE nama = 'Puring' AND tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Item "Puring" (pcs) tidak ditemukan di inventory'; END IF;

  SELECT * INTO v_ambil FROM _ambil_stok_bahan_fifo(p_bahan_item_id, p_kg, p_tenant_id);
  v_per_pcs := ROUND(COALESCE(v_ambil.harga, 0) / p_pcs, 2);

  SELECT COALESCE(SUM(qty_sisa), 0) INTO v_lot FROM inventory_batch
  WHERE inventory_item_id = v_puring.id AND tenant_id = p_tenant_id;
  v_lunas := LEAST(GREATEST(v_lot - COALESCE(v_puring.stok_aktual, 0), 0), p_pcs);

  INSERT INTO inventory_batch (inventory_item_id, qty_awal, qty_sisa, harga_satuan, tanggal_masuk, jurnal_entry_id, tenant_id)
  VALUES (v_puring.id, p_pcs, p_pcs - v_lunas, v_per_pcs, CURRENT_DATE, NULL, p_tenant_id)
  RETURNING id INTO v_batch;

  IF v_lunas > 0 THEN
    v_lunas_tg := _lunasi_tunggu_harga(v_puring.id, v_batch, v_lunas, v_per_pcs, p_user_id, p_tenant_id);
  END IF;

  IF COALESCE(v_puring.stok_aktual, 0) > 0 AND COALESCE(v_puring.harga_referensi, 0) > 0 THEN
    v_ref := ROUND((v_puring.stok_aktual * v_puring.harga_referensi + p_pcs * v_per_pcs) / (v_puring.stok_aktual + p_pcs), 2);
  ELSE
    v_ref := v_per_pcs;
  END IF;
  UPDATE inventory_item SET stok_aktual = stok_aktual + p_pcs,
         harga_referensi = CASE WHEN v_ref > 0 THEN v_ref ELSE harga_referensi END
  WHERE id = v_puring.id;

  INSERT INTO potong_puring (bahan_item_id, puring_item_id, puring_batch_id, kg_pakai, pcs_hasil, biaya_total,
                             harga_per_pcs, habis_roll, catatan, tenant_id, created_by, harga_ref_sebelum)
  VALUES (p_bahan_item_id, v_puring.id, v_batch, p_kg, p_pcs, ROUND(COALESCE(v_ambil.harga, 0), 2),
          v_per_pcs, COALESCE(p_habis_roll, false), NULLIF(trim(COALESCE(p_catatan, '')), ''), p_tenant_id, p_user_id,
          v_puring.harga_referensi)
  RETURNING id INTO v_id;

  INSERT INTO audit_log (user_id, modul, aksi, target, metadata, tenant_id)
  VALUES (p_user_id, 'produksi', 'Potong Puring', v_bahan.nama,
    jsonb_build_object('potong_puring_id', v_id, 'kg', p_kg, 'pcs', p_pcs, 'biaya', v_ambil.harga, 'per_pcs', v_per_pcs,
                       'lunasi_minus', v_lunas, 'lunasi_tunggu', v_lunas_tg), p_tenant_id);

  RETURN jsonb_build_object('id', v_id, 'biaya_total', ROUND(COALESCE(v_ambil.harga, 0), 2), 'harga_per_pcs', v_per_pcs,
                            'stok_puring', COALESCE(v_puring.stok_aktual, 0) + p_pcs,
                            'qty_lunasi_tunggu', v_lunas_tg);
END; $function$;

-- ─── batal_potong_puring: pelunasan antrean dari LOT ini ikut dibatalkan ───
DO $$
DECLARE v_def text; v_new text;
BEGIN
  SELECT pg_get_functiondef('public.batal_potong_puring(uuid,text,uuid,text)'::regprocedure) INTO v_def;
  v_new := replace(v_def,
    '  PERFORM _kembalikan_stok_bahan(v_pp.bahan_item_id, v_pp.kg_pakai, p_tenant_id);',
    E'  PERFORM _batal_pelunasan_batch(v_pp.puring_batch_id, p_tenant_id);\n  PERFORM _kembalikan_stok_bahan(v_pp.bahan_item_id, v_pp.kg_pakai, p_tenant_id);');
  IF v_new = v_def THEN RAISE EXCEPTION 'Patch batal_potong_puring tidak menemukan targetnya'; END IF;
  EXECUTE v_new;
END $$;

-- ─── Ringkasan antrean (untuk UI & laporan) ───
CREATE OR REPLACE FUNCTION public.get_aksesori_tunggu_harga(p_tenant_id text)
 RETURNS TABLE(inventory_item_id uuid, item_nama text, satuan text, po_id uuid, no_po text, qty_tunggu numeric, tanggal_pertama date)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT t.inventory_item_id, ii.nama, ii.satuan, t.po_id, po.no_po,
         SUM(t.qty_sisa), MIN(t.tanggal)
  FROM aksesori_tunggu_harga t
  JOIN inventory_item ii ON ii.id = t.inventory_item_id
  LEFT JOIN po ON po.id = t.po_id
  WHERE t.tenant_id = p_tenant_id AND t.qty_sisa > 0
  GROUP BY t.inventory_item_id, ii.nama, ii.satuan, t.po_id, po.no_po
  ORDER BY ii.nama, po.no_po;
$function$;
