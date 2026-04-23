-- =============================================================================
-- MIGRATION: 009_jabatan_table.sql
-- Action: Buat tabel jabatan dengan mapping tahap produksi
-- Dibuat: 21 April 2026
-- =============================================================================

CREATE TABLE jabatan (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  nama                TEXT        NOT NULL,
  deskripsi           TEXT,
  tahap_produksi      TEXT[]      NOT NULL DEFAULT '{}',
  gaji_default        NUMERIC     NOT NULL DEFAULT 0,
  aktif               BOOLEAN     NOT NULL DEFAULT true,
  tenant_id           TEXT        NOT NULL DEFAULT 'STX-001',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS
ALTER TABLE jabatan ENABLE ROW LEVEL SECURITY;
CREATE POLICY "jabatan_select" ON jabatan FOR SELECT USING (is_active_user());
CREATE POLICY "jabatan_insert" ON jabatan FOR INSERT WITH CHECK (get_current_user_role() = 'owner');
CREATE POLICY "jabatan_update" ON jabatan FOR UPDATE USING (get_current_user_role() = 'owner');
CREATE POLICY "jabatan_delete" ON jabatan FOR DELETE USING (get_current_user_role() = 'owner');

-- Seed data jabatan default
INSERT INTO jabatan (nama, deskripsi, tahap_produksi, gaji_default) VALUES
  ('Operator Cutting',   'Bertugas memotong bahan sesuai pola', ARRAY['cutting'],              2500000),
  ('Penjahit',           'Bertugas menjahit potongan bahan',    ARRAY['jahit'],                2000000),
  ('Operator QC',        'Bertugas quality control produk',     ARRAY['qc'],                   2200000),
  ('Operator Finishing', 'Bertugas finishing dan packing',      ARRAY['finishing'],             1800000),
  ('Operator Gudang',    'Bertugas penerimaan bahan baku',      ARRAY['gudang'],                2000000),
  ('Bordir',             'Bertugas bordir detail produk',       ARRAY['bordir'],                2300000),
  ('Sablon',             'Bertugas sablon pada produk',         ARRAY['sablon'],                2300000),
  ('Supervisor',         'Mengawasi seluruh proses produksi',   ARRAY['cutting','jahit','qc','finishing'], 4000000);
