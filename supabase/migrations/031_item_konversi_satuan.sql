-- ================================================================
-- MIGRATION 031: Faktor konversi satuan beli → satuan pakai
-- Dinamis per item inventory. Contoh:
--   kain keras: satuan_beli='roll', faktor_konversi=400 (1 roll = 400 pcs)
--   karet:      satuan_beli='kg',   faktor_konversi=20  (1 kg   = 20 pcs)
--   benang:     satuan_beli='lusin',faktor_konversi=12  (1 lusin= 12 pcs)
-- ================================================================

ALTER TABLE inventory_item
  ADD COLUMN IF NOT EXISTS satuan_beli      TEXT,
  ADD COLUMN IF NOT EXISTS faktor_konversi  NUMERIC(10,4);

COMMENT ON COLUMN inventory_item.satuan_beli IS
  'Satuan pembelian (misal: roll, kg, lusin). NULL = sama dengan satuan pakai.';

COMMENT ON COLUMN inventory_item.faktor_konversi IS
  'Berapa satuan_pakai per 1 satuan_beli. Contoh: 1 roll = 400 pcs → faktor=400.';
