-- Potong Puring (15 Nov 2026)
-- Alur: puring dibeli per kg (item "Bahan Puring", lewat Stok Masuk → Buku Kas)
-- → dipotong jadi lembaran (item "Puring", pcs) di menu Cutting → tiap bundle
-- jaket masuk jahit memakai 1 pcs puring (model_aksesori, sudah ada).
-- Roll boleh dipotong habis atau sebagian: yang dicatat kg yang dipakai.

-- 1. Bahan mentah puring per kg
INSERT INTO inventory_item (nama, satuan, stok_aktual, stok_minimum, tenant_id, harga_referensi)
SELECT 'Bahan Puring', 'kg', 0, 0, 'STX-001', 0
WHERE NOT EXISTS (SELECT 1 FROM inventory_item WHERE nama = 'Bahan Puring' AND tenant_id = 'STX-001');

-- 2. Log potong puring
CREATE TABLE IF NOT EXISTS potong_puring (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tanggal          date NOT NULL DEFAULT CURRENT_DATE,
  bahan_item_id    uuid NOT NULL REFERENCES inventory_item(id),
  puring_item_id   uuid NOT NULL REFERENCES inventory_item(id),
  puring_batch_id  uuid REFERENCES inventory_batch(id) ON DELETE SET NULL,
  kg_pakai         numeric NOT NULL CHECK (kg_pakai > 0),
  pcs_hasil        integer NOT NULL CHECK (pcs_hasil > 0),
  biaya_total      numeric NOT NULL DEFAULT 0,
  harga_per_pcs    numeric NOT NULL DEFAULT 0,
  habis_roll       boolean NOT NULL DEFAULT false,
  catatan          text,
  dibatalkan_at    timestamptz,
  dibatalkan_alasan text,
  harga_ref_sebelum numeric,
  tenant_id        text NOT NULL DEFAULT 'STX-001',
  created_by       uuid,
  created_at       timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE potong_puring ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS potong_puring_select ON potong_puring;
CREATE POLICY potong_puring_select ON potong_puring FOR SELECT TO authenticated USING (true);

-- 3. RPC potong puring
CREATE OR REPLACE FUNCTION public.potong_puring(
  p_bahan_item_id uuid, p_kg numeric, p_pcs integer, p_habis_roll boolean,
  p_catatan text, p_user_id uuid, p_tenant_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_bahan   RECORD;
  v_puring  RECORD;
  v_ambil   RECORD;
  v_per_pcs numeric;
  v_batch   uuid;
  v_id      uuid;
  v_ref     numeric;
BEGIN
  IF COALESCE(p_kg, 0) <= 0 THEN RAISE EXCEPTION 'Kg yang dipakai harus lebih dari 0'; END IF;
  IF COALESCE(p_pcs, 0) <= 0 THEN RAISE EXCEPTION 'Jumlah lembar puring harus lebih dari 0'; END IF;

  SELECT id, nama, stok_aktual INTO v_bahan FROM inventory_item
  WHERE id = p_bahan_item_id AND tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Bahan puring tidak ditemukan'; END IF;
  IF p_kg > v_bahan.stok_aktual + 0.0005 THEN
    RAISE EXCEPTION 'Stok % hanya % kg — input belanja (Stok Masuk) dulu', v_bahan.nama, v_bahan.stok_aktual;
  END IF;

  SELECT id, stok_aktual, harga_referensi INTO v_puring FROM inventory_item
  WHERE nama = 'Puring' AND tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Item "Puring" (pcs) tidak ditemukan di inventory'; END IF;

  -- Kurangi kg secara FIFO, dapat biaya asli dari harga beli
  SELECT * INTO v_ambil FROM _ambil_stok_bahan_fifo(p_bahan_item_id, p_kg, p_tenant_id);
  v_per_pcs := ROUND(COALESCE(v_ambil.harga, 0) / p_pcs, 2);

  -- Tambah lembaran puring (LOT tanpa jurnal pembelian — uangnya sudah keluar saat beli kg)
  INSERT INTO inventory_batch (inventory_item_id, qty_awal, qty_sisa, harga_satuan, tanggal_masuk, jurnal_entry_id, tenant_id)
  VALUES (v_puring.id, p_pcs, p_pcs, v_per_pcs, CURRENT_DATE, NULL, p_tenant_id)
  RETURNING id INTO v_batch;

  -- Harga referensi puring = rata-rata tertimbang stok yang ada + hasil potong ini
  IF COALESCE(v_puring.stok_aktual, 0) > 0 AND COALESCE(v_puring.harga_referensi, 0) > 0 THEN
    v_ref := ROUND((v_puring.stok_aktual * v_puring.harga_referensi + p_pcs * v_per_pcs) / (v_puring.stok_aktual + p_pcs), 2);
  ELSE
    v_ref := v_per_pcs;
  END IF;
  UPDATE inventory_item SET stok_aktual = stok_aktual + p_pcs,
         harga_referensi = CASE WHEN v_ref > 0 THEN v_ref ELSE harga_referensi END
  WHERE id = v_puring.id;

  INSERT INTO potong_puring (bahan_item_id, puring_item_id, puring_batch_id, kg_pakai, pcs_hasil, biaya_total,
                             harga_per_pcs, habis_roll, catatan, tenant_id, created_by, harga_ref_sebelum)
  VALUES (p_bahan_item_id, v_puring.id, v_batch, p_kg, p_pcs, ROUND(COALESCE(v_ambil.harga, 0), 2),
          v_per_pcs, COALESCE(p_habis_roll, false), NULLIF(trim(COALESCE(p_catatan, '')), ''), p_tenant_id, p_user_id,
          v_puring.harga_referensi)
  RETURNING id INTO v_id;

  INSERT INTO audit_log (user_id, modul, aksi, target, metadata, tenant_id)
  VALUES (p_user_id, 'produksi', 'Potong Puring', v_bahan.nama,
    jsonb_build_object('potong_puring_id', v_id, 'kg', p_kg, 'pcs', p_pcs, 'biaya', v_ambil.harga, 'per_pcs', v_per_pcs), p_tenant_id);

  RETURN jsonb_build_object('id', v_id, 'biaya_total', ROUND(COALESCE(v_ambil.harga, 0), 2), 'harga_per_pcs', v_per_pcs,
                            'stok_puring', COALESCE(v_puring.stok_aktual, 0) + p_pcs);
END; $function$;

-- 4. RPC batal potong puring (salah input): kg kembali, lembaran dikurangi
CREATE OR REPLACE FUNCTION public.batal_potong_puring(p_id uuid, p_alasan text, p_user_id uuid, p_tenant_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_pp RECORD;
BEGIN
  IF p_alasan IS NULL OR trim(p_alasan) = '' THEN RAISE EXCEPTION 'Alasan wajib diisi'; END IF;
  SELECT * INTO v_pp FROM potong_puring WHERE id = p_id AND tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Data potong puring tidak ditemukan'; END IF;
  IF v_pp.dibatalkan_at IS NOT NULL THEN RAISE EXCEPTION 'Sudah dibatalkan'; END IF;

  PERFORM _kembalikan_stok_bahan(v_pp.bahan_item_id, v_pp.kg_pakai, p_tenant_id);
  -- Harga referensi kembali ke nilai sebelum, bila belum ada potong puring lain sesudahnya
  UPDATE inventory_item SET stok_aktual = stok_aktual - v_pp.pcs_hasil,
         harga_referensi = CASE
           WHEN v_pp.harga_ref_sebelum IS NOT NULL AND NOT EXISTS (
             SELECT 1 FROM potong_puring x WHERE x.tenant_id = p_tenant_id AND x.dibatalkan_at IS NULL
               AND x.id <> v_pp.id AND x.created_at > v_pp.created_at)
           THEN v_pp.harga_ref_sebelum ELSE harga_referensi END
  WHERE id = v_pp.puring_item_id;
  DELETE FROM inventory_batch WHERE id = v_pp.puring_batch_id;
  UPDATE potong_puring SET dibatalkan_at = now(), dibatalkan_alasan = trim(p_alasan) WHERE id = p_id;

  INSERT INTO audit_log (user_id, modul, aksi, target, metadata, tenant_id)
  VALUES (p_user_id, 'produksi', 'Batal Potong Puring', 'Puring',
    jsonb_build_object('potong_puring_id', p_id, 'kg', v_pp.kg_pakai, 'pcs', v_pp.pcs_hasil, 'alasan', trim(p_alasan)), p_tenant_id);
  RETURN jsonb_build_object('success', true);
END; $function$;

GRANT EXECUTE ON FUNCTION public.potong_puring(uuid, numeric, integer, boolean, text, uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.batal_potong_puring(uuid, text, uuid, text) TO authenticated, service_role;

-- 5. Jaket yang belum memakai puring saat jahit: Ignite, Noir, Raizen
INSERT INTO model_aksesori (model_id, inventory_item_id, qty_per_pcs, tahap_pakai, tenant_id)
SELECT m.id, i.id, 1, 'jahit', 'STX-001'
FROM model_produk m CROSS JOIN inventory_item i
WHERE m.nama IN ('Ignite', 'Noir', 'Raizen') AND m.tenant_id = 'STX-001'
  AND i.nama = 'Puring' AND i.tenant_id = 'STX-001'
ON CONFLICT (model_id, inventory_item_id, tahap_pakai) DO NOTHING;
