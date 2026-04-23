-- =============================================================================
-- MIGRATION: 007_master_tambahan.sql
-- Action: Menambah kelengkapan tabel Master Data
-- Dibuat: 21 April 2026
-- =============================================================================

-- =============================================================================
-- 1. DDL TABEL
-- =============================================================================

CREATE TABLE kategori_produk (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  nama        TEXT        NOT NULL,
  tenant_id   TEXT        NOT NULL DEFAULT 'STX-001',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE model_produk (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  nama        TEXT        NOT NULL,
  kategori_id UUID        NOT NULL REFERENCES kategori_produk(id),
  tenant_id   TEXT        NOT NULL DEFAULT 'STX-001',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE size (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  nama        TEXT        NOT NULL,
  urutan      INT         NOT NULL DEFAULT 0,
  tenant_id   TEXT        NOT NULL DEFAULT 'STX-001',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE warna (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  nama        TEXT        NOT NULL,
  kode_hex    TEXT,
  tenant_id   TEXT        NOT NULL DEFAULT 'STX-001',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE produk (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  sku_internal TEXT       UNIQUE NOT NULL,
  sku_klien   TEXT,
  nama        TEXT        NOT NULL,
  model_id    UUID        NOT NULL REFERENCES model_produk(id),
  size_id     UUID        NOT NULL REFERENCES size(id),
  warna_id    UUID        NOT NULL REFERENCES warna(id),
  aktif       BOOLEAN     NOT NULL DEFAULT true,
  tenant_id   TEXT        NOT NULL DEFAULT 'STX-001',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  UUID        REFERENCES user_profile(id)
);

CREATE TABLE satuan (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  nama        TEXT        UNIQUE NOT NULL,
  tenant_id   TEXT        NOT NULL DEFAULT 'STX-001',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE hpp_komponen (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  nama        TEXT        NOT NULL,
  kategori    TEXT        CHECK(kategori IN ('bahan_baku','biaya_produksi','overhead')) NOT NULL,
  satuan_id   UUID        NOT NULL REFERENCES satuan(id),
  aktif       BOOLEAN     NOT NULL DEFAULT true,
  tenant_id   TEXT        NOT NULL DEFAULT 'STX-001',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE hpp_item (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  produk_id   UUID        NOT NULL REFERENCES produk(id),
  komponen_id UUID        NOT NULL REFERENCES hpp_komponen(id),
  qty         NUMERIC     NOT NULL,
  harga_satuan NUMERIC    NOT NULL,
  tenant_id   TEXT        NOT NULL DEFAULT 'STX-001',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(produk_id, komponen_id)
);

CREATE TABLE jenis_reject (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  nama        TEXT        NOT NULL,
  tenant_id   TEXT        NOT NULL DEFAULT 'STX-001',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE alasan_reject (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  nama        TEXT        NOT NULL,
  jenis_reject_id UUID    NOT NULL REFERENCES jenis_reject(id),
  tahap_bertanggung_jawab TEXT NOT NULL,
  bisa_diperbaiki BOOLEAN NOT NULL DEFAULT false,
  dampak_potongan TEXT    CHECK(dampak_potongan IN ('upah_tahap','hpp_po')),
  tenant_id   TEXT        NOT NULL DEFAULT 'STX-001',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =============================================================================
-- 2. ROW LEVEL SECURITY (RLS) POLICIES
-- =============================================================================

-- 1. kategori_produk
ALTER TABLE kategori_produk ENABLE ROW LEVEL SECURITY;
CREATE POLICY "kategori_produk_select" ON kategori_produk FOR SELECT USING (is_active_user());
CREATE POLICY "kategori_produk_insert" ON kategori_produk FOR INSERT WITH CHECK (get_current_user_role() = 'owner');
CREATE POLICY "kategori_produk_update" ON kategori_produk FOR UPDATE USING (get_current_user_role() = 'owner');
CREATE POLICY "kategori_produk_delete" ON kategori_produk FOR DELETE USING (get_current_user_role() = 'owner');

-- 2. model_produk
ALTER TABLE model_produk ENABLE ROW LEVEL SECURITY;
CREATE POLICY "model_produk_select" ON model_produk FOR SELECT USING (is_active_user());
CREATE POLICY "model_produk_insert" ON model_produk FOR INSERT WITH CHECK (get_current_user_role() = 'owner');
CREATE POLICY "model_produk_update" ON model_produk FOR UPDATE USING (get_current_user_role() = 'owner');
CREATE POLICY "model_produk_delete" ON model_produk FOR DELETE USING (get_current_user_role() = 'owner');

-- 3. size
ALTER TABLE size ENABLE ROW LEVEL SECURITY;
CREATE POLICY "size_select" ON size FOR SELECT USING (is_active_user());
CREATE POLICY "size_insert" ON size FOR INSERT WITH CHECK (get_current_user_role() = 'owner');
CREATE POLICY "size_update" ON size FOR UPDATE USING (get_current_user_role() = 'owner');
CREATE POLICY "size_delete" ON size FOR DELETE USING (get_current_user_role() = 'owner');

-- 4. warna
ALTER TABLE warna ENABLE ROW LEVEL SECURITY;
CREATE POLICY "warna_select" ON warna FOR SELECT USING (is_active_user());
CREATE POLICY "warna_insert" ON warna FOR INSERT WITH CHECK (get_current_user_role() = 'owner');
CREATE POLICY "warna_update" ON warna FOR UPDATE USING (get_current_user_role() = 'owner');
CREATE POLICY "warna_delete" ON warna FOR DELETE USING (get_current_user_role() = 'owner');

-- 5. produk
ALTER TABLE produk ENABLE ROW LEVEL SECURITY;
CREATE POLICY "produk_select" ON produk FOR SELECT USING (is_active_user());
CREATE POLICY "produk_insert" ON produk FOR INSERT WITH CHECK (get_current_user_role() = 'owner');
CREATE POLICY "produk_update" ON produk FOR UPDATE USING (get_current_user_role() = 'owner');
CREATE POLICY "produk_delete" ON produk FOR DELETE USING (get_current_user_role() = 'owner');

-- 6. satuan
ALTER TABLE satuan ENABLE ROW LEVEL SECURITY;
CREATE POLICY "satuan_select" ON satuan FOR SELECT USING (is_active_user());
CREATE POLICY "satuan_insert" ON satuan FOR INSERT WITH CHECK (get_current_user_role() = 'owner');
CREATE POLICY "satuan_update" ON satuan FOR UPDATE USING (get_current_user_role() = 'owner');
CREATE POLICY "satuan_delete" ON satuan FOR DELETE USING (get_current_user_role() = 'owner');

-- 7. hpp_komponen
ALTER TABLE hpp_komponen ENABLE ROW LEVEL SECURITY;
CREATE POLICY "hpp_komponen_select" ON hpp_komponen FOR SELECT USING (is_active_user());
CREATE POLICY "hpp_komponen_insert" ON hpp_komponen FOR INSERT WITH CHECK (get_current_user_role() = 'owner');
CREATE POLICY "hpp_komponen_update" ON hpp_komponen FOR UPDATE USING (get_current_user_role() = 'owner');
CREATE POLICY "hpp_komponen_delete" ON hpp_komponen FOR DELETE USING (get_current_user_role() = 'owner');

-- 8. hpp_item
ALTER TABLE hpp_item ENABLE ROW LEVEL SECURITY;
CREATE POLICY "hpp_item_select" ON hpp_item FOR SELECT USING (is_active_user());
CREATE POLICY "hpp_item_insert" ON hpp_item FOR INSERT WITH CHECK (get_current_user_role() = 'owner');
CREATE POLICY "hpp_item_update" ON hpp_item FOR UPDATE USING (get_current_user_role() = 'owner');
CREATE POLICY "hpp_item_delete" ON hpp_item FOR DELETE USING (get_current_user_role() = 'owner');

-- 9. jenis_reject
ALTER TABLE jenis_reject ENABLE ROW LEVEL SECURITY;
CREATE POLICY "jenis_reject_select" ON jenis_reject FOR SELECT USING (is_active_user());
CREATE POLICY "jenis_reject_insert" ON jenis_reject FOR INSERT WITH CHECK (get_current_user_role() = 'owner');
CREATE POLICY "jenis_reject_update" ON jenis_reject FOR UPDATE USING (get_current_user_role() = 'owner');
CREATE POLICY "jenis_reject_delete" ON jenis_reject FOR DELETE USING (get_current_user_role() = 'owner');

-- 10. alasan_reject
ALTER TABLE alasan_reject ENABLE ROW LEVEL SECURITY;
CREATE POLICY "alasan_reject_select" ON alasan_reject FOR SELECT USING (is_active_user());
CREATE POLICY "alasan_reject_insert" ON alasan_reject FOR INSERT WITH CHECK (get_current_user_role() = 'owner');
CREATE POLICY "alasan_reject_update" ON alasan_reject FOR UPDATE USING (get_current_user_role() = 'owner');
CREATE POLICY "alasan_reject_delete" ON alasan_reject FOR DELETE USING (get_current_user_role() = 'owner');

-- =============================================================================
-- 3. SEEDING DEFAULT DATA
-- =============================================================================

-- Satuan
INSERT INTO satuan (nama) VALUES 
  ('meter'),
  ('gram'),
  ('pcs'),
  ('yard'),
  ('roll');

-- Jenis Reject  
INSERT INTO jenis_reject (nama) VALUES 
  ('Cacat Jahitan'),
  ('Cacat Bahan'),
  ('Ukuran Tidak Sesuai'),
  ('Kotor/Noda');
