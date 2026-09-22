-- ================================================================
-- MIGRATION: Input PO-0089 (Raizen, Noir Navy, Storma, Dravo Navy,
-- Airflow Navy) yang belum pernah tercatat
--
-- Bagian terakhir dari rangkaian perbaikan nomor PO. PO-0089 asli
-- (24 artikel) belum pernah diinput ke sistem. 8 dari 24 baris punya
-- SKU+qty yang kebetulan sama dengan PO lama (PO-0001, 0003, 0004,
-- 0034, 0059, 0077, 0080 -- semuanya April-Agustus 2026, jauh sebelum
-- batch PO-0085/86/87 di September 2026) -- dicek dan dipastikan itu
-- cuma repeat-order SKU populer, BUKAN entri duplikat dari order yang
-- sama. Dikonfirmasi pengguna: nomor PO-0089 dari daftar order asli
-- MEMANG nomor yang benar, diinput persis seperti itu.
--
-- Data mengikuti pola PO-0084/85/86/87/88 (klien, user, tanggal, dan
-- qty_per_bundle = qty_order per baris -- satu bundle per artikel).
-- ================================================================

SELECT create_po_with_bundles(
  'PO-0089',
  '363276fa-ceb4-4756-a665-52de5c6e6de6',
  '2026-09-11',
  '2026-10-11',
  NULL,
  'STX-001',
  '71fb0890-5306-47be-a9c0-c5cce41cca95',
  '[
    {"produk_id":"adabc86a-c6ff-4a7b-8e40-02af7bbf9dcc","warna":"Black","size":"M","qty_order":10,"qty_per_bundle":10},
    {"produk_id":"9cb6bb06-29af-44e6-a3ad-f6eb3a1c8f5a","warna":"Black","size":"L","qty_order":10,"qty_per_bundle":10},
    {"produk_id":"f058303b-100c-4757-bf16-c83364963b17","warna":"Black","size":"XL","qty_order":12,"qty_per_bundle":12},
    {"produk_id":"72e459f5-e175-492c-bd61-db2be47dc356","warna":"Black","size":"XXL","qty_order":12,"qty_per_bundle":12},
    {"produk_id":"568348f5-e740-4189-8297-7a4aecdb7f97","warna":"Black","size":"XXXL","qty_order":12,"qty_per_bundle":12},
    {"produk_id":"f9317b25-db20-428b-9b2c-a3c365670351","warna":"Navy","size":"M","qty_order":10,"qty_per_bundle":10},
    {"produk_id":"07cd0682-dbbe-4a0e-becf-ce116d839785","warna":"Navy","size":"L","qty_order":10,"qty_per_bundle":10},
    {"produk_id":"d6068154-05c2-4658-9cd7-83e217cc0a4a","warna":"Navy","size":"XL","qty_order":12,"qty_per_bundle":12},
    {"produk_id":"dbf43cb9-f316-4f81-8dcd-46c309c8cbdc","warna":"Navy","size":"XXL","qty_order":12,"qty_per_bundle":12},
    {"produk_id":"3b425a4a-1810-420b-b059-25645a26b3d9","warna":"Navy","size":"XXXL","qty_order":12,"qty_per_bundle":12},
    {"produk_id":"15c4d715-420c-449c-8a9c-b9a2c46c6a5e","warna":"Navy","size":"M","qty_order":10,"qty_per_bundle":10},
    {"produk_id":"8b026209-b530-4574-be38-d120a3ceb0f0","warna":"Navy","size":"L","qty_order":10,"qty_per_bundle":10},
    {"produk_id":"cc32177f-117b-4e69-b639-8d70fb9e3006","warna":"Navy","size":"XL","qty_order":12,"qty_per_bundle":12},
    {"produk_id":"a5c09cc7-130d-41aa-a666-59cbf2c9c0c2","warna":"Navy","size":"XXL","qty_order":12,"qty_per_bundle":12},
    {"produk_id":"9af119ac-1c86-46d9-8790-443ae20d28cd","warna":"Navy","size":"XXXL","qty_order":12,"qty_per_bundle":12},
    {"produk_id":"57197673-4582-4a6a-aa00-a84c09cabedd","warna":"Black","size":"L","qty_order":10,"qty_per_bundle":10},
    {"produk_id":"61296e82-6ec2-4d3c-95c0-ba8509a54039","warna":"Black","size":"XL","qty_order":10,"qty_per_bundle":10},
    {"produk_id":"28aa293d-c6cb-4485-a6eb-1057e4a74d11","warna":"Black","size":"XXL","qty_order":12,"qty_per_bundle":12},
    {"produk_id":"ac1f9414-e466-4ae8-b51c-6eb3dd40d2b9","warna":"Black","size":"XXXL","qty_order":12,"qty_per_bundle":12},
    {"produk_id":"8817113f-b569-4a20-bc45-bcc1123ca3ae","warna":"Navy","size":"XXXL","qty_order":10,"qty_per_bundle":10},
    {"produk_id":"492f243b-7e3c-4cd4-9dee-b1e6c7fa0502","warna":"Black","size":"XXL","qty_order":10,"qty_per_bundle":10},
    {"produk_id":"3c88f7a8-9369-4c18-a74a-3b2f733b9b14","warna":"Navy","size":"XXL","qty_order":12,"qty_per_bundle":12},
    {"produk_id":"b1ba6917-6e95-47ab-8497-cb153341fb33","warna":"Navy","size":"L","qty_order":10,"qty_per_bundle":10},
    {"produk_id":"6bebaabc-89f4-4bf7-ad54-0d38ea291272","warna":"Navy","size":"XXL","qty_order":10,"qty_per_bundle":10}
  ]'::jsonb
);
