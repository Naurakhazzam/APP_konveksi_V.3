-- =============================================================================
-- MIGRATION: 012_create_po_with_bundles_fn.sql
-- Phase 05 — Postgres Function: create_po_with_bundles
-- Dibuat: 21 April 2026
-- Depends on: 002_produksi_tables.sql, 005_postgres_functions.sql, 011_phase05_prep.sql
-- =============================================================================
-- Fungsi ini membuat PO beserta semua po_item dan bundle-nya dalam SATU transaksi atomic.
-- Barcode di-generate via generate_bundle_barcode() yang sudah ada (migration 005).
-- SECURITY DEFINER agar bisa bypass RLS saat INSERT bundle_sequence counter.
-- =============================================================================


CREATE OR REPLACE FUNCTION create_po_with_bundles(
  p_no_po          TEXT,
  p_klien_id       UUID,
  p_tanggal_order  DATE,
  p_tanggal_target DATE,
  p_catatan        TEXT,
  p_tenant_id      TEXT,
  p_user_id        UUID,
  p_items          JSONB
  -- Format p_items: [
  --   {
  --     "produk_id":      "uuid",
  --     "warna":          "text",
  --     "size":           "text",
  --     "qty_order":      12,
  --     "qty_per_bundle": 12
  --   },
  --   ...
  -- ]
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_po_id          UUID;
  v_po_item_id     UUID;
  v_barcode        TEXT;
  v_item           JSONB;
  v_bundle_count   INT;   -- jumlah bundle per item = CEIL(qty_order / qty_per_bundle)
  v_item_urut      INT;   -- no_urut: urutan bundle dalam po_item ini
  v_global_urut    INT := 0;  -- no_urut_po: urutan bundle global dalam PO
  v_produk_id      UUID;
  v_qty_order      INT;
  v_qty_per_bundle INT;
  v_warna          TEXT;
  v_size           TEXT;
  i                INT;
BEGIN

  -- -------------------------------------------------------------------------
  -- VALIDASI AWAL
  -- -------------------------------------------------------------------------

  -- Cek duplikat no_po
  IF EXISTS (
    SELECT 1 FROM po
    WHERE no_po = p_no_po AND tenant_id = p_tenant_id
  ) THEN
    RAISE EXCEPTION 'Nomor PO % sudah digunakan. Pilih nomor lain.', p_no_po;
  END IF;

  -- Cek items tidak kosong
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'PO harus memiliki minimal 1 item.';
  END IF;

  -- -------------------------------------------------------------------------
  -- STEP 1: INSERT po
  -- Status langsung 'aktif' karena bundle sudah di-generate bersamaan.
  -- -------------------------------------------------------------------------

  INSERT INTO po (
    no_po,
    klien_id,
    status,
    tanggal_order,
    tanggal_target,
    catatan,
    tenant_id,
    created_by
  )
  VALUES (
    p_no_po,
    p_klien_id,
    'aktif',
    p_tanggal_order,
    p_tanggal_target,
    p_catatan,
    p_tenant_id,
    p_user_id
  )
  RETURNING id INTO v_po_id;


  -- -------------------------------------------------------------------------
  -- STEP 2: Loop per item → INSERT po_item + INSERT bundle[]
  -- -------------------------------------------------------------------------

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP

    -- Ekstrak field dari JSONB
    v_produk_id      := (v_item->>'produk_id')::UUID;
    v_qty_order      := (v_item->>'qty_order')::INT;
    v_qty_per_bundle := (v_item->>'qty_per_bundle')::INT;
    v_warna          := v_item->>'warna';
    v_size           := v_item->>'size';

    -- Validasi: produk_id harus valid (ada di DB dan milik tenant ini)
    IF v_produk_id IS NULL THEN
      RAISE EXCEPTION 'produk_id tidak boleh null. Pastikan kombinasi model/warna/size valid.';
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM produk
      WHERE id = v_produk_id AND tenant_id = p_tenant_id
    ) THEN
      RAISE EXCEPTION 'produk_id % tidak ditemukan di database. Periksa kembali data item.', v_produk_id;
    END IF;

    -- Validasi: qty_per_bundle harus >= 1
    IF v_qty_per_bundle < 1 THEN
      RAISE EXCEPTION 'qty_per_bundle harus minimal 1.';
    END IF;

    -- Validasi: qty_order harus >= 1
    IF v_qty_order < 1 THEN
      RAISE EXCEPTION 'qty_order harus minimal 1.';
    END IF;

    -- INSERT po_item
    INSERT INTO po_item (
      po_id,
      produk_id,
      warna,
      size,
      qty_order,
      qty_per_bundle,
      tenant_id
    )
    VALUES (
      v_po_id,
      v_produk_id,
      v_warna,
      v_size,
      v_qty_order,
      v_qty_per_bundle,
      p_tenant_id
    )
    RETURNING id INTO v_po_item_id;

    -- Hitung jumlah bundle untuk item ini: CEIL(qty_order / qty_per_bundle)
    v_bundle_count := CEIL(v_qty_order::NUMERIC / v_qty_per_bundle::NUMERIC)::INT;

    -- STEP 3: Loop per bundle → generate barcode + INSERT bundle
    FOR i IN 1..v_bundle_count
    LOOP
      v_global_urut := v_global_urut + 1;  -- increment counter global PO
      v_item_urut   := i;                  -- counter per po_item (reset tiap item baru)

      -- Generate barcode atomic (increment bundle_sequence global)
      -- Function ini sudah ada di migration 005, tidak perlu dibuat ulang.
      v_barcode := generate_bundle_barcode(p_no_po, p_tenant_id);

      -- INSERT bundle
      INSERT INTO bundle (
        barcode,
        po_id,
        po_item_id,
        no_urut,
        no_urut_po,
        status_tahap,
        tenant_id,
        created_by
      )
      VALUES (
        v_barcode,
        v_po_id,
        v_po_item_id,
        v_item_urut,     -- urutan dalam po_item ini (1, 2, 3, ...)
        v_global_urut,   -- urutan global dalam PO (tidak reset antar item)
        '{}'::jsonb,
        p_tenant_id,
        p_user_id
      );

    END LOOP;
    -- END loop bundle per item

  END LOOP;
  -- END loop items


  -- -------------------------------------------------------------------------
  -- STEP 4: Catat audit_log
  -- -------------------------------------------------------------------------

  INSERT INTO audit_log (
    user_id,
    modul,
    aksi,
    target,
    metadata,
    tenant_id
  )
  VALUES (
    p_user_id,
    'produksi',
    'Input PO',
    p_no_po,
    jsonb_build_object(
      'po_id',          v_po_id,
      'klien_id',       p_klien_id,
      'jumlah_item',    jsonb_array_length(p_items),
      'jumlah_bundle',  v_global_urut
    ),
    p_tenant_id
  );


  -- -------------------------------------------------------------------------
  -- Return no_po sebagai konfirmasi sukses
  -- -------------------------------------------------------------------------
  RETURN p_no_po;


EXCEPTION
  WHEN OTHERS THEN
    -- Seluruh transaksi di-rollback otomatis oleh PostgreSQL.
    -- Re-raise error agar pesan asli sampai ke aplikasi.
    RAISE;

END;
$$;


-- =============================================================================
-- GRANT: izinkan authenticated role memanggil function ini via RPC Supabase
-- =============================================================================

GRANT EXECUTE ON FUNCTION create_po_with_bundles(TEXT, UUID, DATE, DATE, TEXT, TEXT, UUID, JSONB)
  TO authenticated;
