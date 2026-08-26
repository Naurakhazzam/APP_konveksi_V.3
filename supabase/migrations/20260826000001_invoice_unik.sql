-- ================================================================
-- MIGRATION: Pengaman keunikan invoice
--
-- Latar belakang: kolom invoice.nomor_invoice tidak punya aturan unik,
-- dan surat_jalan_id juga tidak. Akibatnya nomor invoice kembar dan
-- satu surat jalan dengan lebih dari satu invoice bisa masuk tanpa
-- ditolak database sama sekali — ini pernah benar-benar terjadi
-- (invoice dibuat manual, padahal trigger auto_create_invoice_on_sj
-- sudah otomatis membuatnya, jadi dobel dan tidak ada yang mencegah).
--
-- Dua pengaman dipasang:
-- 1. nomor_invoice unik per tenant — nomor kembar mustahil masuk.
-- 2. surat_jalan_id unik — satu surat jalan maksimal satu invoice,
--    sehingga tagihan ganda atas barang yang sama tidak bisa terjadi.
--    (Dibuat partial index supaya invoice tanpa surat jalan — kalau
--    suatu saat ada invoice manual lepas — tetap diperbolehkan.)
-- ================================================================

-- 1. Nomor invoice tidak boleh kembar dalam satu tenant
CREATE UNIQUE INDEX IF NOT EXISTS invoice_nomor_unik_per_tenant
  ON invoice (tenant_id, nomor_invoice);

-- 2. Satu surat jalan maksimal satu invoice
CREATE UNIQUE INDEX IF NOT EXISTS invoice_satu_per_surat_jalan
  ON invoice (surat_jalan_id)
  WHERE surat_jalan_id IS NOT NULL;
