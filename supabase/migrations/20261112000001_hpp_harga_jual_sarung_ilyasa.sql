-- HPP & harga jual Sarung Ilyasa sesuai blok "Sarung" di sheet HPP (revisi user 12 Nov 2026).
-- Sebelumnya HPP model ini salinan Celana Arslan (bahan Drill).
-- Sudah diterapkan langsung ke database 12 Nov 2026. Nilai HPP awal dibackup di
-- tabel hpp_item_sarung_ilyasa_backup_20261112.
--
--   Size        Bahan (yd)  Biaya bahan  HPP     Harga jual
--   S-M         0,95        19.475       36.025  40.400
--   L-XL        1,00        20.500       37.050  41.500
--   XXL-XXXL    1,15        23.575       40.125  45.000
--
-- Komponen lain (semua size): Jahit 7.000, Potong 1.000, Sewa Rumah 1.500, Listrik 1.000,
-- Makan 1.500, Benang 1.000, Buang Benang 200, Steam 200, Packing 150, Operasional 1.000,
-- Karet 1.500, Velcro 500. Kancing, Kain Keras, Kain Saku, Lubang Kancing = 0
-- (LK 0 + jahit > 0 → tahap Lubang Kancing otomatis dilewati).

-- 1. Komponen baru Velcro
INSERT INTO hpp_komponen (nama, kategori, satuan_id, aktif, tenant_id, track_inventory)
SELECT 'Velcro', 'bahan_baku', k.satuan_id, true, 'STX-001', false
FROM hpp_komponen k
WHERE k.nama = 'Benang' AND k.tenant_id = 'STX-001'
  AND NOT EXISTS (SELECT 1 FROM hpp_komponen v WHERE v.nama = 'Velcro' AND v.tenant_id = 'STX-001');

INSERT INTO hpp_item (produk_id, komponen_id, qty, harga_satuan, tenant_id)
SELECT p.id, v.id, 1, 500, 'STX-001'
FROM produk p
JOIN model_produk m ON m.id = p.model_id AND m.nama = 'Sarung Ilyasa'
JOIN hpp_komponen v ON v.nama = 'Velcro' AND v.tenant_id = 'STX-001'
WHERE p.tenant_id = 'STX-001'
  AND NOT EXISTS (SELECT 1 FROM hpp_item h WHERE h.produk_id = p.id AND h.komponen_id = v.id);

-- 2. Harga komponen HPP
UPDATE hpp_item h SET harga_satuan = CASE k.nama
    WHEN 'HPP Bahan' THEN CASE s.nama WHEN 'S' THEN 19475 WHEN 'M' THEN 19475
                                      WHEN 'L' THEN 20500 WHEN 'XL' THEN 20500 ELSE 23575 END
    WHEN 'Upah Jahit'              THEN 7000
    WHEN 'Upah Cutting'            THEN 1000
    WHEN 'Operasional Rumah'       THEN 1500
    WHEN 'Operasional Listrik'     THEN 1000
    WHEN 'Uang Makan'              THEN 1500
    WHEN 'Benang'                  THEN 1000
    WHEN 'Upah Buang Benang'       THEN 200
    WHEN 'Upah Steam'              THEN 200
    WHEN 'Upah Packing'            THEN 150
    WHEN 'Operasional Sehari-hari' THEN 1000
    WHEN 'Karet'                   THEN 1500
    WHEN 'Velcro'                  THEN 500
    ELSE 0 END
FROM produk p, model_produk m, size s, hpp_komponen k
WHERE p.id = h.produk_id AND m.id = p.model_id AND s.id = p.size_id AND k.id = h.komponen_id
  AND m.nama = 'Sarung Ilyasa' AND p.tenant_id = 'STX-001';

-- 3. Harga jual
UPDATE produk p SET harga_jual = CASE s.nama
    WHEN 'S' THEN 40400 WHEN 'M' THEN 40400
    WHEN 'L' THEN 41500 WHEN 'XL' THEN 41500
    ELSE 45000 END
FROM model_produk m, size s
WHERE m.id = p.model_id AND s.id = p.size_id
  AND m.nama = 'Sarung Ilyasa' AND p.tenant_id = 'STX-001';
