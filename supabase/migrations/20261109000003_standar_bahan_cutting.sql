-- =============================================================================
-- Jenis bahan utama per kategori + standar pemakaian bahan per model + ukuran.
-- Standar diisi awal dari nilai tengah riwayat cutting (warna bahan cocok).
-- Ukuran besar boleh lebih kecil dari ukuran kecil — faktor lapangan, bukan error.
-- =============================================================================
ALTER TABLE kategori_produk ADD COLUMN IF NOT EXISTS jenis_bahan TEXT;
COMMENT ON COLUMN kategori_produk.jenis_bahan IS
  'Awalan nama bahan utama di inventory, mis. "Bahan JN", "Toyobo". Dicocokkan dengan warna produk untuk mengisi bahan otomatis saat Selesai Cutting.';

UPDATE kategori_produk SET jenis_bahan = CASE nama
  WHEN 'Jacket' THEN 'Bahan JN' WHEN 'Koko' THEN 'Toyobo' WHEN 'Koko Set' THEN 'Toyobo'
  WHEN 'Chinos' THEN 'Chinos' WHEN 'Celana Dril' THEN 'Drill'
  WHEN 'Kemeja Polo' THEN 'Lakos' WHEN 'Polo Wangky' THEN 'Lakos' END
WHERE tenant_id = 'STX-001' AND jenis_bahan IS NULL;

CREATE TABLE IF NOT EXISTS standar_pemakaian_bahan (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    TEXT NOT NULL,
  model_id     UUID NOT NULL REFERENCES model_produk(id) ON DELETE CASCADE,
  size         TEXT NOT NULL,
  rate_per_pcs NUMERIC(8,3) NOT NULL CHECK (rate_per_pcs > 0),
  sumber       TEXT NOT NULL DEFAULT 'manual',
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by   UUID,
  UNIQUE (tenant_id, model_id, size)
);
ALTER TABLE standar_pemakaian_bahan ENABLE ROW LEVEL SECURITY;
CREATE POLICY standar_pemakaian_bahan_select ON standar_pemakaian_bahan FOR SELECT USING (is_active_user());
CREATE POLICY standar_pemakaian_bahan_insert ON standar_pemakaian_bahan FOR INSERT WITH CHECK (get_current_user_role() = 'owner');
CREATE POLICY standar_pemakaian_bahan_update ON standar_pemakaian_bahan FOR UPDATE USING (get_current_user_role() = 'owner');
CREATE POLICY standar_pemakaian_bahan_delete ON standar_pemakaian_bahan FOR DELETE USING (get_current_user_role() = 'owner');

INSERT INTO standar_pemakaian_bahan (tenant_id, model_id, size, rate_per_pcs, sumber)
SELECT 'STX-001', p.model_id, pi.size,
       ROUND(percentile_cont(0.5) WITHIN GROUP (ORDER BY pb.rate_per_pcs)::numeric, 2), 'riwayat'
FROM pemakaian_bahan pb
JOIN po_item pi ON pi.id = pb.po_item_id
JOIN produk p ON p.id = pi.produk_id
JOIN inventory_item ii ON ii.id = pb.inventory_item_id
LEFT JOIN warna wi ON wi.id = ii.warna_id
WHERE pb.tenant_id = 'STX-001' AND p.model_id IS NOT NULL AND pb.rate_per_pcs > 0
  AND ( lower(wi.nama) = lower(pi.warna)
     OR (pi.warna ILIKE '% x %' AND EXISTS (
          SELECT 1 FROM unnest(string_to_array(lower(pi.warna), ' x ')) part
          WHERE lower(wi.nama) = trim(part) OR lower(wi.nama) LIKE '%' || trim(part)
             OR (trim(part) = 'darkgrey' AND lower(wi.nama) = 'dark grey'))) )
GROUP BY p.model_id, pi.size
ON CONFLICT (tenant_id, model_id, size) DO NOTHING;
