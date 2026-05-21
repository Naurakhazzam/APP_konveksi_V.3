-- =============================================================================
-- MIGRATION 033: Tambah kolom hari_kerja_seminggu ke tabel settings
--
-- Sebelumnya, perhitungan gapok prorata di penggajian hardcode /6:
--   gapok_prorata = (gapok / 6) * hari_kerja_aktual
--
-- Dengan kolom ini, angka 6 bisa dikonfigurasi owner via halaman Settings.
-- Default 6 hari (Senin–Sabtu) sesuai konvensi konveksi umum.
-- =============================================================================

ALTER TABLE settings
  ADD COLUMN IF NOT EXISTS hari_kerja_seminggu INT NOT NULL DEFAULT 6;

COMMENT ON COLUMN settings.hari_kerja_seminggu IS
  'Jumlah hari kerja per minggu (default 6). Dipakai sebagai pembagi gapok prorata.';

-- Pastikan baris STX-001 sudah ada dan nilainya 6
UPDATE settings
SET hari_kerja_seminggu = 6
WHERE tenant_id = 'STX-001';
