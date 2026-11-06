-- ================================================================
-- MIGRATION: Tambah item ke surat jalan yang sudah dibuat
--
-- Supaya barang yang tertinggal bisa disusulkan ke surat jalan yang
-- sama, tanpa membatalkan & membuat ulang. Aturannya mengikuti
-- finalize_surat_jalan & edit_surat_jalan:
--   - surat jalan belum divalidasi klien, tidak ada catatan reject,
--     invoice-nya (kalau ada) belum menerima pembayaran;
--   - bundle harus sudah selesai packing, milik klien yang sama, belum
--     ada di surat jalan ini, dan masih punya sisa yang belum terkirim;
--   - qty melebihi sisa wajib alasan → jadi pengajuan approval;
--   - bundle yang ditutup sebagai data lama ditolak (trigger);
--   - TIDAK membuat upah (upah finishing sudah tercatat per tahap);
--   - total invoice dihitung ulang; tercatat di audit_log.
-- ================================================================

CREATE OR REPLACE FUNCTION public.tambah_item_surat_jalan(
  p_sj_id uuid, p_bundles jsonb, p_alasan text, p_user_id uuid, p_tenant_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_sj             RECORD;
  v_bundle         JSONB;
  v_bundle_id      UUID;
  v_qty_kirim      INT;
  v_alasan_lebih   TEXT;
  v_barcode        TEXT;
  v_no_po          TEXT;
  v_nama_produk    TEXT;
  v_status_packing TEXT;
  v_klien_bundle   UUID;
  v_qty_jadi       INT;
  v_sudah_kirim    INT;
  v_sisa           INT;
  v_identitas      TEXT;
  v_urutan         INT;
  v_invoice_id     UUID;
  v_total_bayar    NUMERIC;
  v_jml_bayar      INT;
  v_total_baru     NUMERIC;
  v_jumlah         INT := 0;
  v_total_qty      INT := 0;
  v_barcodes       TEXT[] := ARRAY[]::TEXT[];
BEGIN
  IF p_alasan IS NULL OR TRIM(p_alasan) = '' THEN
    RAISE EXCEPTION '[ALASAN KOSONG] Alasan menambah barang wajib diisi.';
  END IF;
  IF p_bundles IS NULL OR jsonb_array_length(p_bundles) = 0 THEN
    RAISE EXCEPTION '[TIDAK ADA BARANG] Pilih minimal satu barang untuk ditambahkan.';
  END IF;

  SELECT id, nomor_sj, klien_id INTO v_sj
  FROM surat_jalan
  WHERE id = p_sj_id AND tenant_id = p_tenant_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '[SJ TIDAK DITEMUKAN] Surat jalan ini tidak ada di sistem.';
  END IF;

  IF EXISTS (SELECT 1 FROM surat_jalan_item WHERE sj_id = p_sj_id AND qty_diterima IS NOT NULL) THEN
    RAISE EXCEPTION '[SUDAH DIVALIDASI] Surat jalan % sudah divalidasi klien — tidak bisa ditambah barang. Buat surat jalan baru.', v_sj.nomor_sj;
  END IF;
  IF EXISTS (SELECT 1 FROM reject_log WHERE surat_jalan_id = p_sj_id) THEN
    RAISE EXCEPTION '[ADA CATATAN REJECT] Surat jalan % punya catatan reject — tidak bisa ditambah barang.', v_sj.nomor_sj;
  END IF;

  SELECT i.id, COALESCE(i.total_bayar, 0) INTO v_invoice_id, v_total_bayar
  FROM invoice i WHERE i.surat_jalan_id = p_sj_id AND i.tenant_id = p_tenant_id LIMIT 1;
  IF v_invoice_id IS NOT NULL THEN
    SELECT COUNT(*) INTO v_jml_bayar FROM invoice_pembayaran WHERE invoice_id = v_invoice_id;
    IF v_jml_bayar > 0 OR v_total_bayar > 0 THEN
      RAISE EXCEPTION '[INVOICE SUDAH DIBAYAR] Invoice surat jalan % sudah menerima pembayaran — tidak bisa ditambah barang. Buat surat jalan baru.', v_sj.nomor_sj;
    END IF;
  END IF;

  SELECT COALESCE(MAX(urutan), 0) INTO v_urutan FROM surat_jalan_item WHERE sj_id = p_sj_id;

  FOR v_bundle IN SELECT * FROM jsonb_array_elements(p_bundles) LOOP
    v_bundle_id    := (v_bundle->>'bundle_id')::UUID;
    v_qty_kirim    := (v_bundle->>'qty_kirim')::INT;
    v_alasan_lebih := NULLIF(TRIM(v_bundle->>'alasan_lebih'), '');

    SELECT b.barcode, po.no_po, pr.nama, po.klien_id,
           b.status_tahap->'packing'->>'status',
           COALESCE(
             (b.status_tahap->'packing'->>'qty_selesai')::INT,
             (b.status_tahap->'cutting'->>'qty_aktual')::INT,
             pi.qty_per_bundle
           )
    INTO v_barcode, v_no_po, v_nama_produk, v_klien_bundle, v_status_packing, v_qty_jadi
    FROM bundle b
    JOIN po_item pi ON pi.id = b.po_item_id
    JOIN po        ON po.id = b.po_id
    JOIN produk pr ON pr.id = pi.produk_id
    WHERE b.id = v_bundle_id AND b.tenant_id = p_tenant_id
    FOR UPDATE OF b;

    IF NOT FOUND THEN
      RAISE EXCEPTION '[BARANG TIDAK DITEMUKAN] Data barang yang dipilih tidak ada di sistem. Muat ulang halaman lalu pilih lagi.';
    END IF;

    v_identitas := v_no_po || ' — ' || v_nama_produk || ' (' || v_barcode || ')';

    IF v_klien_bundle IS DISTINCT FROM v_sj.klien_id THEN
      RAISE EXCEPTION '[KLIEN BERBEDA] %: milik klien lain — satu surat jalan hanya untuk satu klien.', v_identitas;
    END IF;
    IF v_status_packing IS DISTINCT FROM 'selesai' THEN
      RAISE EXCEPTION '[BELUM SELESAI PACKING] %: belum selesai tahap Packing, jadi belum bisa dikirim.', v_identitas;
    END IF;
    IF EXISTS (SELECT 1 FROM surat_jalan_item WHERE sj_id = p_sj_id AND bundle_id = v_bundle_id) THEN
      RAISE EXCEPTION '[SUDAH ADA DI SJ INI] %: sudah ada di surat jalan % — ubah qty-nya lewat Edit Item.', v_identitas, v_sj.nomor_sj;
    END IF;
    IF v_qty_kirim IS NULL OR v_qty_kirim <= 0 THEN
      RAISE EXCEPTION '[QTY TIDAK VALID] %: qty kirim harus lebih dari 0.', v_identitas;
    END IF;

    SELECT COALESCE(SUM(qty_kirim), 0) INTO v_sudah_kirim
    FROM surat_jalan_item WHERE bundle_id = v_bundle_id;
    v_sisa := v_qty_jadi - v_sudah_kirim;

    IF v_sisa <= 0 THEN
      RAISE EXCEPTION '[SUDAH TERKIRIM] %: sudah terkirim semua (% pcs).', v_identitas, v_sudah_kirim;
    END IF;
    IF v_qty_kirim > v_sisa AND v_alasan_lebih IS NULL THEN
      RAISE EXCEPTION '[QTY MELEBIHI SISA] %: mau kirim % pcs, tapi sisa yang belum terkirim cuma % dari % pcs. Isi dulu alasannya kalau memang mau melebihkan.',
        v_identitas, v_qty_kirim, v_sisa, v_qty_jadi;
    END IF;

    v_urutan := v_urutan + 1;
    INSERT INTO surat_jalan_item (sj_id, bundle_id, qty_kirim, urutan, tenant_id)
    VALUES (p_sj_id, v_bundle_id, v_qty_kirim, v_urutan, p_tenant_id);

    v_sudah_kirim := v_sudah_kirim + v_qty_kirim;

    IF v_sudah_kirim >= v_qty_jadi THEN
      UPDATE bundle SET surat_jalan_id = p_sj_id
      WHERE id = v_bundle_id AND surat_jalan_id IS NULL;
    END IF;

    IF v_sudah_kirim > v_qty_jadi THEN
      INSERT INTO qty_approval_request (
        bundle_id, surat_jalan_id, tahap, qty_diajukan, qty_default,
        status, sumber, catatan_pengajuan, tenant_id, created_by
      ) VALUES (
        v_bundle_id, p_sj_id, 'pengiriman', v_sudah_kirim - v_qty_jadi, v_qty_jadi,
        'pending', 'buat_surat_jalan', v_alasan_lebih, p_tenant_id, p_user_id
      );
    END IF;

    v_jumlah    := v_jumlah + 1;
    v_total_qty := v_total_qty + v_qty_kirim;
    v_barcodes  := array_append(v_barcodes, v_barcode);
  END LOOP;

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
  VALUES (p_user_id, 'pengiriman', 'Tambah Item Surat Jalan', v_sj.nomor_sj,
          jsonb_build_object('nomor_sj', v_sj.nomor_sj, 'jumlah_bundle', v_jumlah,
                             'total_qty', v_total_qty, 'barcode', v_barcodes,
                             'total_invoice', v_total_baru, 'alasan', TRIM(p_alasan)),
          p_tenant_id);

  RETURN jsonb_build_object('nomor_sj', v_sj.nomor_sj, 'jumlah_bundle', v_jumlah,
                            'total_qty', v_total_qty, 'total_invoice', v_total_baru);
END;
$function$;

REVOKE ALL ON FUNCTION public.tambah_item_surat_jalan(uuid, jsonb, text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tambah_item_surat_jalan(uuid, jsonb, text, uuid, text) TO authenticated;
