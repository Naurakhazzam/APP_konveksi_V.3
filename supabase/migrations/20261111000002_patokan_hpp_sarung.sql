-- Patokan pemakaian bahan (sheet HPP, yard/pcs) untuk sarung instan (model Sarung Ilyasa).
-- Ukuran di atas XXXL ikut nilai XXL (aturan yang sama dengan model lain).
-- Sudah diterapkan langsung ke database 11 Nov 2026.
WITH g(sizes, rate) AS (VALUES ('S,M', 0.95), ('L,XL', 1.00), ('XXL,XXXL,4XL,5XL,6XL', 1.15)),
gs AS (SELECT unnest(string_to_array(sizes, ',')) AS size, rate FROM g)
INSERT INTO standar_pemakaian_bahan (tenant_id, model_id, size, rate_per_pcs, sumber, updated_at)
SELECT 'STX-001', m.id, gs.size, gs.rate, 'hpp', now()
FROM gs JOIN model_produk m ON m.nama = 'Sarung Ilyasa' AND m.tenant_id = 'STX-001'
ON CONFLICT (tenant_id, model_id, size)
DO UPDATE SET rate_per_pcs = EXCLUDED.rate_per_pcs, sumber = 'hpp', updated_at = now();
