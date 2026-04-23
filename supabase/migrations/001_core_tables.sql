-- =============================================================================
-- MIGRATION: 001_core_tables.sql
-- Phase 02 — Database Schema: Tabel Inti
-- Dibuat: 20 April 2026
-- =============================================================================

-- =============================================================================
-- 1. ENUMs
-- =============================================================================

CREATE TYPE user_role AS ENUM (
  'owner',
  'admin_produksi',
  'admin_keuangan',
  'supervisor',
  'mandor'
);

CREATE TYPE jenis_trx AS ENUM (
  'direct_bahan',
  'direct_upah',
  'overhead',
  'masuk'
);


-- =============================================================================
-- 2. TABELs
-- =============================================================================

-- Extension dari Supabase Auth user. Tidak ada tabel user terpisah.
CREATE TABLE user_profile (
  id          UUID        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  nama        TEXT        NOT NULL,
  role        user_role   NOT NULL DEFAULT 'mandor',
  aktif       BOOLEAN     NOT NULL DEFAULT TRUE,
  tenant_id   TEXT        NOT NULL DEFAULT 'STX-001',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Pekerja produksi (cutting, jahit, dll). BERBEDA dari user_profile (BR-10 §5).
CREATE TABLE karyawan (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  nama        TEXT        NOT NULL,
  jabatan     TEXT        NOT NULL,
  gaji_pokok  NUMERIC(12,2) NOT NULL DEFAULT 0,
  aktif       BOOLEAN     NOT NULL DEFAULT TRUE,
  tenant_id   TEXT        NOT NULL DEFAULT 'STX-001',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  UUID        REFERENCES user_profile(id)
);

-- Data klien / pemberi PO.
CREATE TABLE klien (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  nama        TEXT        NOT NULL,
  alamat      TEXT,
  kontak      TEXT,
  tenant_id   TEXT        NOT NULL DEFAULT 'STX-001',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  UUID        REFERENCES user_profile(id)
);

-- Kategori transaksi keuangan (direct_bahan, direct_upah, overhead, masuk).
CREATE TABLE kategori_trx (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  nama        TEXT        NOT NULL,
  jenis       jenis_trx   NOT NULL,
  aktif       BOOLEAN     NOT NULL DEFAULT TRUE,
  tenant_id   TEXT        NOT NULL DEFAULT 'STX-001',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- =============================================================================
-- 3. HELPER FUNCTIONS (SECURITY DEFINER — bypass RLS untuk cek role/status)
-- Dibuat SETELAH tabel ada agar tidak error "relation does not exist".
-- =============================================================================

-- Ambil role user yang sedang login (bypass RLS, tidak rekursif)
CREATE OR REPLACE FUNCTION get_current_user_role()
  RETURNS TEXT
  LANGUAGE SQL
  SECURITY DEFINER
  STABLE
AS $$
  SELECT role::TEXT FROM user_profile WHERE id = auth.uid();
$$;

-- Cek apakah user yang sedang login aktif (bypass RLS, tidak rekursif)
CREATE OR REPLACE FUNCTION is_active_user()
  RETURNS BOOLEAN
  LANGUAGE SQL
  SECURITY DEFINER
  STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_profile
    WHERE id = auth.uid()
      AND aktif = TRUE
  );
$$;


-- =============================================================================
-- 4. RLS & POLICIES
-- =============================================================================

-- user_profile
-- -----------------------------------------------------------------------------
ALTER TABLE user_profile ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_profile_select_self"
  ON user_profile FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "user_profile_select_owner"
  ON user_profile FOR SELECT
  USING (get_current_user_role() = 'owner');

CREATE POLICY "user_profile_update"
  ON user_profile FOR UPDATE
  USING (
    auth.uid() = id
    OR get_current_user_role() = 'owner'
  )
  WITH CHECK (
    auth.uid() = id
    OR get_current_user_role() = 'owner'
  );

CREATE POLICY "user_profile_insert_owner"
  ON user_profile FOR INSERT
  WITH CHECK (get_current_user_role() = 'owner');

CREATE POLICY "user_profile_delete_owner"
  ON user_profile FOR DELETE
  USING (get_current_user_role() = 'owner');


-- karyawan
-- -----------------------------------------------------------------------------
ALTER TABLE karyawan ENABLE ROW LEVEL SECURITY;

CREATE POLICY "karyawan_select_active_user"
  ON karyawan FOR SELECT
  USING (is_active_user() AND tenant_id = 'STX-001');

CREATE POLICY "karyawan_insert_owner"
  ON karyawan FOR INSERT
  WITH CHECK (get_current_user_role() = 'owner');

CREATE POLICY "karyawan_update_owner"
  ON karyawan FOR UPDATE
  USING (get_current_user_role() = 'owner');

CREATE POLICY "karyawan_delete_owner"
  ON karyawan FOR DELETE
  USING (get_current_user_role() = 'owner');


-- klien
-- -----------------------------------------------------------------------------
ALTER TABLE klien ENABLE ROW LEVEL SECURITY;

CREATE POLICY "klien_select_active_user"
  ON klien FOR SELECT
  USING (is_active_user() AND tenant_id = 'STX-001');

CREATE POLICY "klien_insert_owner"
  ON klien FOR INSERT
  WITH CHECK (get_current_user_role() = 'owner');

CREATE POLICY "klien_update_owner"
  ON klien FOR UPDATE
  USING (get_current_user_role() = 'owner');

CREATE POLICY "klien_delete_owner"
  ON klien FOR DELETE
  USING (get_current_user_role() = 'owner');


-- kategori_trx
-- -----------------------------------------------------------------------------
ALTER TABLE kategori_trx ENABLE ROW LEVEL SECURITY;

CREATE POLICY "kategori_trx_select_active_user"
  ON kategori_trx FOR SELECT
  USING (is_active_user() AND tenant_id = 'STX-001');

CREATE POLICY "kategori_trx_insert_owner"
  ON kategori_trx FOR INSERT
  WITH CHECK (get_current_user_role() = 'owner');

CREATE POLICY "kategori_trx_update_owner"
  ON kategori_trx FOR UPDATE
  USING (get_current_user_role() = 'owner');

CREATE POLICY "kategori_trx_delete_owner"
  ON kategori_trx FOR DELETE
  USING (get_current_user_role() = 'owner');
