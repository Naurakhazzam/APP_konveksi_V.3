-- Ubah tanggal baris Buku Kas yang dibuat otomatis oleh Stok Masuk.
-- Tanggal LOT (inventory_batch.tanggal_masuk) dan jurnal pembelian ikut diubah
-- agar ketiganya tetap cocok. Nominal/qty tidak disentuh.
CREATE OR REPLACE FUNCTION public.ubah_tanggal_stok_masuk(
  p_buku_kas_id uuid, p_tanggal date, p_tenant_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_kas record; v_jurnal uuid;
BEGIN
  IF p_tanggal IS NULL THEN RAISE EXCEPTION 'Tanggal tidak boleh kosong'; END IF;

  SELECT id, tanggal, inventory_batch_id, sumber_gaji INTO v_kas
  FROM buku_kas WHERE id = p_buku_kas_id AND tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Entri Buku Kas tidak ditemukan'; END IF;
  IF v_kas.inventory_batch_id IS NULL THEN
    RAISE EXCEPTION 'Entri ini bukan dari Stok Masuk';
  END IF;

  UPDATE buku_kas SET tanggal = p_tanggal WHERE id = v_kas.id;

  UPDATE inventory_batch SET tanggal_masuk = p_tanggal
  WHERE id = v_kas.inventory_batch_id AND tenant_id = p_tenant_id
  RETURNING jurnal_entry_id INTO v_jurnal;

  IF v_jurnal IS NOT NULL THEN
    UPDATE jurnal_entry SET tanggal = p_tanggal WHERE id = v_jurnal AND tenant_id = p_tenant_id;
  END IF;

  RETURN jsonb_build_object('tanggal_lama', v_kas.tanggal, 'tanggal_baru', p_tanggal);
END $function$;

REVOKE ALL ON FUNCTION public.ubah_tanggal_stok_masuk(uuid, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ubah_tanggal_stok_masuk(uuid, date, text) TO authenticated;
