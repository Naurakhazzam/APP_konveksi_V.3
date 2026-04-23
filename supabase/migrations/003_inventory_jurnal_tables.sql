-- =============================================================================
-- MIGRATION: 003_inventory_jurnal_tables.sql
-- Phase 02 — Database Schema: Inventory & Keuangan
-- Dibuat: 20 April 2026
-- Depends on: 001_core_tables.sql, 002_produksi_tables.sql
-- =============================================================================


-- =============================================================================
-- 1. TABEL: inventory_item
-- Master item bahan baku. Stok aktual di-update via trigger saat batch masuk/pakai.
-- =============================================================================

CREATE TABLE inventory_item (
  id              UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
  nama            TEXT            NOT NULL,
  satuan          TEXT            NOT NULL,                      -- pcs, meter, kg, dll
  stok_aktual     NUMERIC(14,3)   NOT NULL DEFAULT 0,
  stok_minimum    NUMERIC(14,3)   NOT NULL DEFAULT 0,
  tenant_id       TEXT            NOT NULL DEFAULT 'STX-001',
  created_at      TIMESTAMPTZ     NOT NULL DEFAULT now(),
  created_by      UUID            REFERENCES user_profile(id)
);

ALTER TABLE inventory_item ENABLE ROW LEVEL SECURITY;

-- Semua user aktif bisa READ
CREATE POLICY "inventory_item_select_active_user"
  ON inventory_item FOR SELECT
  USING (is_active_user() AND tenant_id = 'STX-001');

-- Hanya owner yang bisa INSERT / UPDATE / DELETE master inventory
CREATE POLICY "inventory_item_insert_owner"
  ON inventory_item FOR INSERT
  WITH CHECK (get_current_user_role() = 'owner');

CREATE POLICY "inventory_item_update_owner"
  ON inventory_item FOR UPDATE
  USING (get_current_user_role() = 'owner');

CREATE POLICY "inventory_item_delete_owner"
  ON inventory_item FOR DELETE
  USING (get_current_user_role() = 'owner');


-- =============================================================================
-- 2. TABEL: inventory_batch
-- Satu batch = satu pembelian bahan masuk. Dasar FIFO consume (BR-08).
-- qty_sisa berkurang saat pemakaian_bahan INSERT via Postgres trigger.
-- =============================================================================

CREATE TABLE inventory_batch (
  id                  UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
  inventory_item_id   UUID            NOT NULL REFERENCES inventory_item(id),
  qty_awal            NUMERIC(14,3)   NOT NULL CHECK (qty_awal > 0),
  qty_sisa            NUMERIC(14,3)   NOT NULL CHECK (qty_sisa >= 0),
  harga_satuan        NUMERIC(14,2)   NOT NULL CHECK (harga_satuan >= 0),
  tanggal_masuk       DATE            NOT NULL,
  jurnal_entry_id     UUID,           -- FK ke jurnal_entry (nullable, FK ditambah setelah tabel jurnal_entry dibuat)
  tenant_id           TEXT            NOT NULL DEFAULT 'STX-001',
  created_at          TIMESTAMPTZ     NOT NULL DEFAULT now(),

  CONSTRAINT batch_qty_sisa_lte_awal CHECK (qty_sisa <= qty_awal)
);

ALTER TABLE inventory_batch ENABLE ROW LEVEL SECURITY;

-- Semua user aktif bisa READ (untuk kalkulasi HPP)
CREATE POLICY "inventory_batch_select_active_user"
  ON inventory_batch FOR SELECT
  USING (is_active_user() AND tenant_id = 'STX-001');

-- Hanya owner yang bisa INSERT batch baru
CREATE POLICY "inventory_batch_insert_owner"
  ON inventory_batch FOR INSERT
  WITH CHECK (get_current_user_role() = 'owner');

-- qty_sisa di-update oleh Postgres function (SECURITY DEFINER), bukan langsung user
-- Tidak ada UPDATE policy via user — semua update qty_sisa melalui RPC
CREATE POLICY "inventory_batch_no_direct_update"
  ON inventory_batch FOR UPDATE
  USING (FALSE);

CREATE POLICY "inventory_batch_delete_owner"
  ON inventory_batch FOR DELETE
  USING (get_current_user_role() = 'owner');


-- =============================================================================
-- 3. TABEL: pemakaian_bahan
-- Catatan konsumsi bahan per bundle (diisi saat scan cutting — BR-08 FIFO).
-- UNIQUE(bundle_id, inventory_item_id) mencegah double consume per bundle per item.
-- =============================================================================

CREATE TABLE pemakaian_bahan (
  id                  UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
  bundle_id           UUID            NOT NULL REFERENCES bundle(id),
  inventory_item_id   UUID            NOT NULL REFERENCES inventory_item(id),
  qty_pakai           NUMERIC(14,3)   NOT NULL CHECK (qty_pakai > 0),
  inventory_batch_id  UUID            NOT NULL REFERENCES inventory_batch(id),
  tenant_id           TEXT            NOT NULL DEFAULT 'STX-001',
  created_at          TIMESTAMPTZ     NOT NULL DEFAULT now(),
  created_by          UUID            REFERENCES user_profile(id),

  CONSTRAINT unique_bundle_item UNIQUE (bundle_id, inventory_item_id)
);

ALTER TABLE pemakaian_bahan ENABLE ROW LEVEL SECURITY;

-- Semua user aktif bisa READ
CREATE POLICY "pemakaian_bahan_select_active_user"
  ON pemakaian_bahan FOR SELECT
  USING (is_active_user() AND tenant_id = 'STX-001');

-- INSERT via Postgres RPC (SECURITY DEFINER) saja — tidak ada akses langsung
CREATE POLICY "pemakaian_bahan_no_direct_insert"
  ON pemakaian_bahan FOR INSERT
  WITH CHECK (FALSE);

-- Tidak ada UPDATE atau DELETE — immutable setelah FIFO consume


-- =============================================================================
-- 4. TABEL: jurnal_entry
-- Semua transaksi keuangan: pembelian bahan, biaya produksi, pemasukan.
--
-- Constraint per jenis:
--   direct_bahan : no_faktur NOT NULL, qty NOT NULL, inventory_item_id NOT NULL
--   direct_upah  : detail_upah NOT NULL (JSONB ringkasan upah)
--   overhead     : -
--   masuk        : no_faktur opsional
-- =============================================================================

CREATE TABLE jurnal_entry (
  id                  UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
  kategori_trx_id     UUID            NOT NULL REFERENCES kategori_trx(id),
  jenis               TEXT            NOT NULL CHECK (jenis IN ('direct_bahan', 'direct_upah', 'overhead', 'masuk')),
  nominal             NUMERIC(16,2)   NOT NULL CHECK (nominal > 0),
  tanggal             DATE            NOT NULL,
  no_faktur           TEXT,
  tag_po_ids          JSONB           NOT NULL DEFAULT '[]',   -- array UUID PO yang terkait
  keterangan          TEXT            NOT NULL,
  detail_upah         JSONB,          -- untuk jenis direct_upah: ringkasan per karyawan
  qty                 NUMERIC(14,3),  -- untuk jenis direct_bahan
  inventory_item_id   UUID            REFERENCES inventory_item(id),
  tenant_id           TEXT            NOT NULL DEFAULT 'STX-001',
  created_at          TIMESTAMPTZ     NOT NULL DEFAULT now(),
  created_by          UUID            REFERENCES user_profile(id),

  -- Constraint: jurnal direct_bahan wajib no_faktur, qty, dan inventory_item_id
  CONSTRAINT jurnal_direct_bahan_check CHECK (
    jenis <> 'direct_bahan'
    OR (no_faktur IS NOT NULL AND qty IS NOT NULL AND inventory_item_id IS NOT NULL)
  )
);

ALTER TABLE jurnal_entry ENABLE ROW LEVEL SECURITY;

-- Hanya owner dan admin_keuangan yang bisa READ jurnal
CREATE POLICY "jurnal_entry_select"
  ON jurnal_entry FOR SELECT
  USING (
    get_current_user_role() IN ('owner', 'admin_keuangan')
    AND tenant_id = 'STX-001'
  );

-- Hanya owner dan admin_keuangan yang bisa INSERT
CREATE POLICY "jurnal_entry_insert"
  ON jurnal_entry FOR INSERT
  WITH CHECK (
    get_current_user_role() IN ('owner', 'admin_keuangan')
  );

-- Hanya owner yang bisa UPDATE (aksi destruktif — wajib sudo mode di app layer)
CREATE POLICY "jurnal_entry_update_owner"
  ON jurnal_entry FOR UPDATE
  USING (get_current_user_role() = 'owner');

-- Hanya owner yang bisa DELETE (aksi destruktif — wajib sudo mode di app layer)
CREATE POLICY "jurnal_entry_delete_owner"
  ON jurnal_entry FOR DELETE
  USING (get_current_user_role() = 'owner');


-- =============================================================================
-- 5. TABEL: koreksi_qty
-- Request koreksi jumlah bundle (reject, hilang, lebih dari ekspektasi).
-- Flow: pending → approved/cancelled (hanya owner bisa approve).
-- =============================================================================

CREATE TYPE koreksi_tipe AS ENUM (
  'reject',
  'hilang',
  'lebih'
);

CREATE TYPE koreksi_status AS ENUM (
  'pending',
  'approved',
  'cancelled'
);

CREATE TABLE koreksi_qty (
  id              UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
  bundle_id       UUID            NOT NULL REFERENCES bundle(id),
  tahap           tahap_produksi  NOT NULL,
  tipe            koreksi_tipe    NOT NULL,
  qty             INT             NOT NULL CHECK (qty > 0),
  status          koreksi_status  NOT NULL DEFAULT 'pending',
  alasan          TEXT            NOT NULL,
  approved_by     UUID            REFERENCES user_profile(id),
  tenant_id       TEXT            NOT NULL DEFAULT 'STX-001',
  created_at      TIMESTAMPTZ     NOT NULL DEFAULT now(),
  created_by      UUID            REFERENCES user_profile(id)
);

ALTER TABLE koreksi_qty ENABLE ROW LEVEL SECURITY;

-- Semua user aktif bisa READ (untuk monitoring)
CREATE POLICY "koreksi_qty_select_active_user"
  ON koreksi_qty FOR SELECT
  USING (is_active_user() AND tenant_id = 'STX-001');

-- Owner dan admin_produksi bisa INSERT request koreksi
CREATE POLICY "koreksi_qty_insert"
  ON koreksi_qty FOR INSERT
  WITH CHECK (
    get_current_user_role() IN ('owner', 'admin_produksi')
  );

-- Hanya owner yang bisa UPDATE status (approve/cancel) — sesuai BR-10 §2.2
CREATE POLICY "koreksi_qty_update_owner"
  ON koreksi_qty FOR UPDATE
  USING (get_current_user_role() = 'owner');

-- Tidak ada DELETE — koreksi bersifat permanent record


-- =============================================================================
-- FK TAMBAHAN: inventory_batch.jurnal_entry_id → jurnal_entry
-- Dibuat di sini (setelah jurnal_entry tersedia)
-- =============================================================================

ALTER TABLE inventory_batch
  ADD CONSTRAINT fk_batch_jurnal
  FOREIGN KEY (jurnal_entry_id) REFERENCES jurnal_entry(id);


-- =============================================================================
-- INDEXES
-- =============================================================================

-- GIN index untuk query JSONB tag_po_ids (contoh: cari semua jurnal untuk PO tertentu)
CREATE INDEX idx_jurnal_tag_po
  ON jurnal_entry USING gin(tag_po_ids);

-- Lookup jurnal berurutan per tanggal (laporan bulanan)
CREATE INDEX idx_jurnal_tanggal
  ON jurnal_entry(tenant_id, tanggal DESC);

-- FIFO lookup: batch dengan qty_sisa > 0, urut tanggal_masuk (paling lama dulu)
CREATE INDEX idx_batch_fifo
  ON inventory_batch(inventory_item_id, tanggal_masuk ASC)
  WHERE qty_sisa > 0;

-- Lookup semua pemakaian per bundle
CREATE INDEX idx_pemakaian_bundle
  ON pemakaian_bahan(bundle_id);

-- Lookup koreksi per status (untuk dashboard approval)
CREATE INDEX idx_koreksi_status
  ON koreksi_qty(tenant_id, status)
  WHERE status = 'pending';
