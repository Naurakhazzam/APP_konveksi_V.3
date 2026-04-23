-- =============================================================================
-- MIGRATION: 016_fix_po_item_fk.sql
-- Tujuan: Menambahkan FK constraint yang hilang di tabel po_item.
-- Dibuat: 21 April 2026
-- Konteks: Migration 002 membuat po_item.produk_id sebagai plain UUID dengan
--          catatan "FK dibuat di migration selanjutnya" — tapi tidak pernah dibuat.
--          Tanpa FK ini, Supabase PostgREST tidak bisa navigate relasi po_item → produk,
--          sehingga query nested join gagal dengan error schema cache.
-- =============================================================================

-- Tambahkan FK dari po_item.produk_id → produk.id
-- Menggunakan ON DELETE SET NULL karena produk bisa di-deactivate tanpa hapus history PO
ALTER TABLE po_item
  ADD CONSTRAINT fk_po_item_produk
  FOREIGN KEY (produk_id) REFERENCES produk(id)
  ON DELETE SET NULL;

-- Catatan: Setelah migration ini dijalankan, query nested join berikut akan bekerja:
--   supabase.from('bundle').select(`
--     po_item:po_item_id (
--       warna, size, qty_order,
--       produk:produk_id (
--         nama,
--         model:model_id ( nama )
--       )
--     )
--   `)
--
-- File antrian.actions.ts saat ini menggunakan workaround 2-query.
-- Workaround tersebut tetap berfungsi setelah migration ini — tidak perlu diubah.
