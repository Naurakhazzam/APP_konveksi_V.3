-- Jadikan stok minus satu bahan sebagai Setoran Modal (sisa bahan lama milik pemilik).
-- Dicatat "seolah dibeli": Stok Masuk sebesar minusnya (no_faktur MODAL-SISA, melunasi minus
-- sehingga stok kembali 0) + Buku Kas masuk kategori "Setoran Modal" senilai sama.
-- Biaya kain tetap terhitung; Setoran Modal bukan pendapatan.
CREATE OR REPLACE FUNCTION public.setoran_modal_sisa_bahan(
  p_inventory_item_id uuid,
  p_harga_satuan numeric,
  p_tanggal date,
  p_kategori_trx_id uuid,
  p_user_id uuid,
  p_tenant_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_item    record;
  v_qty     numeric;
  v_nominal numeric;
  v_res     jsonb;
  v_kas_id  uuid;
BEGIN
  IF p_tanggal IS NULL THEN RAISE EXCEPTION 'Tanggal tidak boleh kosong'; END IF;
  IF COALESCE(p_harga_satuan, 0) <= 0 THEN RAISE EXCEPTION 'Harga harus lebih dari 0'; END IF;

  SELECT id, nama, satuan, stok_aktual, jenis INTO v_item
  FROM inventory_item
  WHERE id = p_inventory_item_id AND tenant_id = p_tenant_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Item inventory tidak ditemukan'; END IF;
  IF v_item.jenis = 'pembantu' THEN
    RAISE EXCEPTION 'Bahan pembantu dihitung lewat stock opname, bukan setoran modal';
  END IF;
  IF v_item.stok_aktual >= 0 THEN
    RAISE EXCEPTION 'Stok % tidak minus — tidak ada yang dijadikan setoran modal', v_item.nama;
  END IF;

  v_qty     := -v_item.stok_aktual;
  v_nominal := round(v_qty * p_harga_satuan, 2);

  v_res := stok_masuk(
    p_inventory_item_id, v_qty, p_harga_satuan, p_tanggal, 'MODAL-SISA', p_kategori_trx_id,
    'Sisa bahan lama — setoran modal (pindah buku)', p_user_id, p_tenant_id);

  INSERT INTO buku_kas (tenant_id, tanggal, tipe, kategori, nominal, keterangan, no_referensi, created_by)
  VALUES (p_tenant_id, p_tanggal, 'masuk', 'Setoran Modal', v_nominal,
    'Setoran modal berupa sisa bahan lama (' || v_item.nama || ' '
      || replace(trim_scale(v_qty)::text, '.', ',') || ' ' || COALESCE(v_item.satuan, '')
      || ') — pindah buku, bukan pendapatan',
    'MODAL-SISA', p_user_id)
  RETURNING id INTO v_kas_id;

  RETURN v_res || jsonb_build_object('qty', v_qty, 'nominal', v_nominal, 'setoran_kas_id', v_kas_id);
END $function$;

REVOKE ALL ON FUNCTION public.setoran_modal_sisa_bahan(uuid, numeric, date, uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.setoran_modal_sisa_bahan(uuid, numeric, date, uuid, uuid, text) TO authenticated;
