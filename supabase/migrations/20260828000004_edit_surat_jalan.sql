-- ================================================================
-- MIGRATION: Edit surat jalan yang sudah terbit (koreksi salah ketik)
--
-- Sebelumnya salah ketik qty pada 1–2 item memaksa seluruh surat jalan
-- dibatalkan lalu dibuat ulang — nomornya hangus dan semua item harus
-- dipilih dari awal. Fungsi ini mengoreksi qty item di tempat, nomor SJ
-- tetap.
--
-- KENAPA INVOICE HARUS DIHITUNG ULANG DARI NOL:
-- trigger trg_update_invoice_total_on_sj_item hanya AFTER INSERT, dan
-- isinya penjumlahan berjalan:
--
--     total_nilai = total_nilai + (NEW.qty_kirim * harga_jual)
--
-- Artinya UPDATE maupun DELETE pada item TIDAK menyentuh invoice sama
-- sekali. Kalau edit hanya mengubah qty_kirim, tagihan akan tetap
-- memakai angka lama tanpa ada yang memberi tahu. Karena itu fungsi ini
-- menyetel ulang total_nilai dari penjumlahan seluruh item yang tersisa
-- — sekaligus membetulkan selisih yang mungkin sudah terlanjur ada.
--
-- Cap "sudah terkirim" pada bundle juga dihitung ulang: qty yang
-- diturunkan bisa membuat bundle kembali punya sisa, dan ia harus muncul
-- lagi di daftar siap kirim.
--
-- Ditolak kalau pengeditan sudah tidak aman: item sudah divalidasi
-- klien, invoice sudah dibayar, atau ada reject_log terkait.
-- ================================================================

CREATE OR REPLACE FUNCTION public.edit_surat_jalan(
  p_sj_id uuid, p_items jsonb, p_alasan text, p_user_id uuid, p_tenant_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_sj             RECORD;
  v_item           JSONB;
  v_item_id        UUID;
  v_qty_baru       INT;
  v_row            RECORD;
  v_bundle_id      UUID;
  v_qty_jadi       INT;
  v_lain           INT;
  v_barcode        TEXT;
  v_invoice_id     UUID;
  v_total_bayar    NUMERIC;
  v_jml_bayar      INT;
  v_jml_divalidasi INT;
  v_jml_reject     INT;
  v_sisa_item      INT;
  v_total_baru     NUMERIC;
  v_diubah         INT := 0;
  v_dihapus        INT := 0;
  v_bundles        UUID[] := ARRAY[]::UUID[];
  v_cap_sj         UUID;
  v_total_kirim    INT;
BEGIN
  SELECT id, nomor_sj INTO v_sj
  FROM surat_jalan
  WHERE id = p_sj_id AND tenant_id = p_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Surat jalan tidak ditemukan';
  END IF;

  -- ── Pemeriksaan keamanan ──
  SELECT COUNT(*) FILTER (WHERE qty_diterima IS NOT NULL)
  INTO v_jml_divalidasi
  FROM surat_jalan_item WHERE sj_id = p_sj_id;

  IF v_jml_divalidasi > 0 THEN
    RAISE EXCEPTION 'Surat jalan % sudah divalidasi klien — tidak bisa diedit', v_sj.nomor_sj;
  END IF;

  SELECT COUNT(*) INTO v_jml_reject FROM reject_log WHERE surat_jalan_id = p_sj_id;
  IF v_jml_reject > 0 THEN
    RAISE EXCEPTION 'Surat jalan % punya catatan reject — tidak bisa diedit', v_sj.nomor_sj;
  END IF;

  SELECT i.id, COALESCE(i.total_bayar, 0) INTO v_invoice_id, v_total_bayar
  FROM invoice i WHERE i.surat_jalan_id = p_sj_id AND i.tenant_id = p_tenant_id LIMIT 1;

  IF v_invoice_id IS NOT NULL THEN
    SELECT COUNT(*) INTO v_jml_bayar FROM invoice_pembayaran WHERE invoice_id = v_invoice_id;
    IF v_jml_bayar > 0 OR v_total_bayar > 0 THEN
      RAISE EXCEPTION 'Invoice surat jalan % sudah menerima pembayaran — tidak bisa diedit', v_sj.nomor_sj;
    END IF;
  END IF;

  -- ── Validasi tiap perubahan sebelum ada yang ditulis ──
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_item_id  := (v_item->>'surat_jalan_item_id')::UUID;
    v_qty_baru := (v_item->>'qty_kirim')::INT;

    SELECT sji.bundle_id, b.barcode,
           COALESCE(
             (b.status_tahap->'packing'->>'qty_selesai')::INT,
             (b.status_tahap->'cutting'->>'qty_aktual')::INT,
             pi.qty_per_bundle
           )
    INTO v_bundle_id, v_barcode, v_qty_jadi
    FROM surat_jalan_item sji
    JOIN bundle b ON b.id = sji.bundle_id
    JOIN po_item pi ON pi.id = b.po_item_id
    WHERE sji.id = v_item_id AND sji.sj_id = p_sj_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Item tidak ditemukan di surat jalan ini';
    END IF;

    IF v_qty_baru < 0 THEN
      RAISE EXCEPTION 'Qty tidak boleh negatif (%)', v_barcode;
    END IF;

    -- Qty yang sudah terkirim lewat surat jalan LAIN untuk bundle yang sama
    SELECT COALESCE(SUM(qty_kirim), 0) INTO v_lain
    FROM surat_jalan_item
    WHERE bundle_id = v_bundle_id AND sj_id <> p_sj_id;

    IF v_qty_baru + v_lain > v_qty_jadi THEN
      RAISE EXCEPTION 'Qty % untuk % melebihi yang tersedia — barang jadi % pcs, sudah terkirim % pcs di surat jalan lain',
        v_qty_baru, v_barcode, v_qty_jadi, v_lain;
    END IF;
  END LOOP;

  -- ── Eksekusi ──
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_item_id  := (v_item->>'surat_jalan_item_id')::UUID;
    v_qty_baru := (v_item->>'qty_kirim')::INT;

    SELECT bundle_id INTO v_bundle_id FROM surat_jalan_item WHERE id = v_item_id;
    v_bundles := array_append(v_bundles, v_bundle_id);

    IF v_qty_baru = 0 THEN
      DELETE FROM surat_jalan_item WHERE id = v_item_id;
      v_dihapus := v_dihapus + 1;
    ELSE
      UPDATE surat_jalan_item SET qty_kirim = v_qty_baru
      WHERE id = v_item_id AND qty_kirim IS DISTINCT FROM v_qty_baru;
      IF FOUND THEN v_diubah := v_diubah + 1; END IF;
    END IF;
  END LOOP;

  SELECT COUNT(*) INTO v_sisa_item FROM surat_jalan_item WHERE sj_id = p_sj_id;
  IF v_sisa_item = 0 THEN
    RAISE EXCEPTION 'Surat jalan harus punya minimal satu barang. Kalau semuanya salah, batalkan saja surat jalannya.';
  END IF;

  -- Rapikan penomoran urut supaya tidak berlubang setelah ada yang dihapus
  WITH bernomor AS (
    SELECT id, ROW_NUMBER() OVER (ORDER BY urutan NULLS LAST, id) AS n
    FROM surat_jalan_item WHERE sj_id = p_sj_id
  )
  UPDATE surat_jalan_item sji SET urutan = bernomor.n
  FROM bernomor WHERE bernomor.id = sji.id;

  -- Hitung ulang cap "sudah terkirim" pada tiap bundle yang tersentuh
  FOREACH v_bundle_id IN ARRAY v_bundles LOOP
    SELECT COALESCE(
             (b.status_tahap->'packing'->>'qty_selesai')::INT,
             (b.status_tahap->'cutting'->>'qty_aktual')::INT,
             pi.qty_per_bundle
           )
    INTO v_qty_jadi
    FROM bundle b JOIN po_item pi ON pi.id = b.po_item_id
    WHERE b.id = v_bundle_id;

    SELECT COALESCE(SUM(qty_kirim), 0) INTO v_total_kirim
    FROM surat_jalan_item WHERE bundle_id = v_bundle_id;

    IF v_total_kirim >= v_qty_jadi THEN
      SELECT sj_id INTO v_cap_sj FROM surat_jalan_item
      WHERE bundle_id = v_bundle_id ORDER BY created_at DESC LIMIT 1;
      UPDATE bundle SET surat_jalan_id = v_cap_sj
      WHERE id = v_bundle_id AND tenant_id = p_tenant_id;
    ELSE
      UPDATE bundle SET surat_jalan_id = NULL
      WHERE id = v_bundle_id AND tenant_id = p_tenant_id;
    END IF;
  END LOOP;

  -- Invoice disetel ulang dari nol, bukan ditambah-kurangi
  IF v_invoice_id IS NOT NULL THEN
    SELECT COALESCE(SUM(sji.qty_kirim * COALESCE(pr.harga_jual, 0)), 0)
    INTO v_total_baru
    FROM surat_jalan_item sji
    JOIN bundle b   ON b.id  = sji.bundle_id
    JOIN po_item pi ON pi.id = b.po_item_id
    JOIN produk pr  ON pr.id = pi.produk_id
    WHERE sji.sj_id = p_sj_id;

    UPDATE invoice SET total_nilai = v_total_baru WHERE id = v_invoice_id;
  END IF;

  INSERT INTO audit_log (user_id, modul, aksi, target, metadata, tenant_id)
  VALUES (
    p_user_id, 'pengiriman', 'Edit Surat Jalan', v_sj.nomor_sj,
    jsonb_build_object(
      'nomor_sj',      v_sj.nomor_sj,
      'item_diubah',   v_diubah,
      'item_dihapus',  v_dihapus,
      'total_invoice', v_total_baru,
      'alasan',        p_alasan
    ),
    p_tenant_id
  );

  RETURN jsonb_build_object(
    'success',       true,
    'nomor_sj',      v_sj.nomor_sj,
    'item_diubah',   v_diubah,
    'item_dihapus',  v_dihapus,
    'sisa_item',     v_sisa_item,
    'total_invoice', COALESCE(v_total_baru, 0)
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.edit_surat_jalan(uuid, jsonb, text, uuid, text) TO authenticated;
