-- ================================================================
-- MIGRATION: Input PO-0087 (Hino Pendek + Jimo Panjang) yang belum
-- pernah tercatat
--
-- Lanjutan dari rangkaian perbaikan nomor PO. Setelah dicek, PO-0087
-- asli (dari daftar order klien: Hino Panjang XXXL, Hino Pendek
-- L/XXL/XXXL, Jimo Panjang XL) TIDAK PERNAH diinput ke sistem sama
-- sekali -- produknya sudah ada di master data, tapi nol transaksi PO
-- di manapun untuk 4 dari 5 artikelnya. Nomor "PO-0087" sendiri sudah
-- kosong sejak isi lamanya (salah label) digabung ke PO-0084 di
-- migrasi 20260922000002.
--
-- Dikonfirmasi pengguna: nomor PO-0087 dari daftar order asli itu
-- MEMANG nomor yang benar dan harus dipakai persis, bukan nomor baru.
--
-- Data mengikuti pola PO-0084/85/86/88 (klien & user yang sama):
--   - klien_id  = Elyasr Kids (363276fa-ceb4-4756-a665-52de5c6e6de6)
--   - created_by = 71fb0890-5306-47be-a9c0-c5cce41cca95 (sama dgn PO 85/86/88)
--   - tanggal_order = 2026-09-11 (disamakan dgn PO-0085/0086 per konfirmasi pengguna)
--   - tanggal_target = +30 hari, mengikuti pola PO-0084/0088
--   - qty_per_bundle = qty_order per baris (satu bundle per artikel),
--     konsisten dengan seluruh PO Elyasr Kids lain di sistem ini.
-- ================================================================

SELECT create_po_with_bundles(
  'PO-0087',
  '363276fa-ceb4-4756-a665-52de5c6e6de6',
  '2026-09-11',
  '2026-10-11',
  NULL,
  'STX-001',
  '71fb0890-5306-47be-a9c0-c5cce41cca95',
  '[
    {"produk_id":"e4ac2413-f1ad-4782-8a85-f3b42ce8a7c3","warna":"Black","size":"XXXL","qty_order":40,"qty_per_bundle":40},
    {"produk_id":"599b2ebd-769a-4686-b654-a857ca7f90ed","warna":"Black","size":"L","qty_order":10,"qty_per_bundle":10},
    {"produk_id":"28eb5724-9af8-492e-a234-57c19f723a7b","warna":"Black","size":"XXL","qty_order":10,"qty_per_bundle":10},
    {"produk_id":"5dcd72ba-227e-4e43-88ff-016eca36e0bc","warna":"Black","size":"XXXL","qty_order":10,"qty_per_bundle":10},
    {"produk_id":"ebf934c7-fe79-4245-b14f-dbc44685c571","warna":"Black","size":"XL","qty_order":30,"qty_per_bundle":30}
  ]'::jsonb
);
