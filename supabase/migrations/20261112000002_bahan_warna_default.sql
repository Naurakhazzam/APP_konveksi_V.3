-- Bahan default per model + bagian warna, untuk deteksi bahan otomatis di Selesai Cutting.
-- Dipakai HANYA bila nama warna cocok ke lebih dari satu bahan (mis. "Grey" →
-- Toyobo Dark grey / Toyobo Light grey). "Grey" tidak selalu sama antar model:
-- Arslan "Black x Grey" = Dark grey, "Grey x White" = Light grey.
-- warna disimpan ternormalisasi: huruf kecil tanpa spasi ("grey", "lightgrey").
-- Kategori Sarung juga diberi jenis bahan Toyobo (sebelumnya kosong → bahan tidak terdeteksi).

UPDATE kategori_produk SET jenis_bahan = 'Toyobo'
WHERE nama = 'Sarung' AND tenant_id = 'STX-001' AND jenis_bahan IS NULL;

CREATE TABLE IF NOT EXISTS bahan_warna_default (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         TEXT        NOT NULL DEFAULT 'STX-001',
  model_id          UUID        NOT NULL REFERENCES model_produk(id) ON DELETE CASCADE,
  warna             TEXT        NOT NULL,
  inventory_item_id UUID        NOT NULL REFERENCES inventory_item(id) ON DELETE CASCADE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, model_id, warna)
);

ALTER TABLE bahan_warna_default ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bahan_warna_default_select ON bahan_warna_default;
DROP POLICY IF EXISTS bahan_warna_default_insert ON bahan_warna_default;
DROP POLICY IF EXISTS bahan_warna_default_update ON bahan_warna_default;
DROP POLICY IF EXISTS bahan_warna_default_delete ON bahan_warna_default;
CREATE POLICY bahan_warna_default_select ON bahan_warna_default FOR SELECT USING (is_active_user());
CREATE POLICY bahan_warna_default_insert ON bahan_warna_default FOR INSERT WITH CHECK (get_current_user_role() = 'owner');
CREATE POLICY bahan_warna_default_update ON bahan_warna_default FOR UPDATE USING (get_current_user_role() = 'owner');
CREATE POLICY bahan_warna_default_delete ON bahan_warna_default FOR DELETE USING (get_current_user_role() = 'owner');

-- Sarung Ilyasa "Grey x Navy": Grey = Toyobo Light grey (keputusan user 12 Nov 2026)
INSERT INTO bahan_warna_default (tenant_id, model_id, warna, inventory_item_id)
SELECT 'STX-001', m.id, 'grey', i.id
FROM model_produk m
JOIN inventory_item i ON i.nama = 'Toyobo Light grey' AND i.tenant_id = 'STX-001'
WHERE m.nama = 'Sarung Ilyasa' AND m.tenant_id = 'STX-001'
ON CONFLICT (tenant_id, model_id, warna) DO UPDATE SET inventory_item_id = EXCLUDED.inventory_item_id;
