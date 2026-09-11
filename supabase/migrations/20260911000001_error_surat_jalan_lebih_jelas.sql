-- ================================================================
-- MIGRATION: Error surat jalan menyebutkan PO + nama barang + kode
--
-- Sebelumnya error hanya menyebut barcode mentah ("PO-0083-00511-bdl01")
-- atau bahkan UUID bundle yang sama sekali tidak bisa dibaca orang biasa
-- ("Bundle % belum selesai tahap Packing", v_bundle_id -- ini bug: raise
-- dipanggil SEBELUM barcode-nya diambil, jadi yang tampil UUID mentah).
--
-- Sekarang setiap error menyebutkan: [KODE SINGKAT] No PO — Nama Barang
-- (barcode): penjelasan. Kode singkat di depan supaya bisa langsung
-- disebutkan/dicatat orang yang mengerjakan tanpa perlu membaca kalimat
-- penuh -- misalnya lapor ke atasan cukup bilang "SUDAH TERKIRIM di PO
-- sekian", tidak perlu mengeja pesan panjang.
--
-- Berlaku di finalize_surat_jalan (Buat Surat Jalan), edit_surat_jalan,
-- dan batal_surat_jalan.
-- ================================================================

CREATE OR REPLACE FUNCTION public.finalize_surat_jalan(
  p_klien_id uuid, p_tanggal date, p_catatan text, p_bundles jsonb,
  p_tenant_id text DEFAULT 'STX-001'::text
)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_tahun          INT;
  v_seq            INT;
  v_nomor_sj       TEXT;
  v_sj_id          UUID;
  v_bundle         JSONB;
  v_row            RECORD;
  v_bundle_id      UUID;
  v_qty_kirim      INT;
  v_qty_jadi       INT;
  v_sudah_kirim    INT;
  v_sisa           INT;
  v_barcode        TEXT;
  v_alasan_lebih   TEXT;
  v_sji_id         UUID;
  v_produk_id      UUID;
  v_default_karyawan UUID;
  v_tahap_fin      TEXT;
  v_rate_fin       NUMERIC;
  v_upah_fin       NUMERIC;
  v_no_po          TEXT;
  v_nama_produk    TEXT;
  v_status_packing TEXT;
  v_identitas      TEXT;
BEGIN
  IF jsonb_array_length(p_bundles) = 0 THEN
    RAISE EXCEPTION '[TIDAK ADA BARANG] Belum ada barang yang dipilih. Pilih dulu minimal 1 barang untuk dikirim.';
  END IF;

  SELECT default_karyawan_borongan_id INTO v_default_karyawan
  FROM settings WHERE tenant_id = p_tenant_id LIMIT 1;

  FOR v_bundle IN SELECT * FROM jsonb_array_elements(p_bundles) LOOP
    v_bundle_id    := (v_bundle->>'bundle_id')::UUID;
    v_qty_kirim    := (v_bundle->>'qty_kirim')::INT;
    v_alasan_lebih := NULLIF(TRIM(v_bundle->>'alasan_lebih'), '');

    -- Ambil identitas barang (No PO + nama barang + barcode) SEKALI di
    -- awal, supaya semua pesan error di bawah bisa langsung menyebutkan
    -- barang mana yang bermasalah -- bukan barcode mentah atau UUID.
    SELECT b.barcode, po.no_po, pr.nama,
           b.status_tahap->'packing'->>'status',
           COALESCE(
             (b.status_tahap->'packing'->>'qty_selesai')::INT,
             (b.status_tahap->'cutting'->>'qty_aktual')::INT,
             pi.qty_per_bundle
           )
    INTO v_barcode, v_no_po, v_nama_produk, v_status_packing, v_qty_jadi
    FROM bundle b
    JOIN po_item pi ON pi.id = b.po_item_id
    JOIN po        ON po.id = b.po_id
    JOIN produk pr ON pr.id = pi.produk_id
    WHERE b.id = v_bundle_id AND b.tenant_id = p_tenant_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION '[BARANG TIDAK DITEMUKAN] Data barang yang dipilih tidak ada di sistem. Coba muat ulang halaman lalu pilih lagi.';
    END IF;

    v_identitas := v_no_po || ' — ' || v_nama_produk || ' (' || v_barcode || ')';

    IF v_status_packing IS DISTINCT FROM 'selesai' THEN
      RAISE EXCEPTION '[BELUM SELESAI PACKING] %: belum selesai tahap Packing, jadi belum bisa dikirim.', v_identitas;
    END IF;

    SELECT COALESCE(SUM(qty_kirim), 0) INTO v_sudah_kirim
    FROM surat_jalan_item WHERE bundle_id = v_bundle_id;

    v_sisa := v_qty_jadi - v_sudah_kirim;

    IF v_sisa <= 0 THEN
      RAISE EXCEPTION '[SUDAH TERKIRIM] %: sudah terkirim semua (% pcs), tidak bisa dikirim lagi. Coba muat ulang halaman ini supaya daftarnya update.',
        v_identitas, v_sudah_kirim;
    END IF;

    IF v_qty_kirim > v_sisa AND v_alasan_lebih IS NULL THEN
      RAISE EXCEPTION '[QTY MELEBIHI SISA] %: mau kirim % pcs, tapi sisa yang belum terkirim cuma % dari % pcs. Isi dulu alasannya kalau memang mau melebihkan.',
        v_identitas, v_qty_kirim, v_sisa, v_qty_jadi;
    END IF;
  END LOOP;

  v_tahun := EXTRACT(YEAR FROM p_tanggal)::INT;

  INSERT INTO sj_sequence (tahun, tenant_id, last_sequence)
  VALUES (v_tahun, p_tenant_id, 1)
  ON CONFLICT (tahun, tenant_id)
  DO UPDATE SET last_sequence = sj_sequence.last_sequence + 1
  RETURNING last_sequence INTO v_seq;

  v_nomor_sj := 'SJ/' || v_tahun || '/' || LPAD(v_seq::TEXT, 5, '0');

  INSERT INTO surat_jalan (nomor_sj, klien_id, tanggal, status, catatan, tenant_id, created_by)
  VALUES (v_nomor_sj, p_klien_id, p_tanggal, 'final', p_catatan, p_tenant_id, auth.uid())
  RETURNING id INTO v_sj_id;

  FOR v_row IN
    SELECT value, ordinality FROM jsonb_array_elements(p_bundles) WITH ORDINALITY
  LOOP
    v_bundle       := v_row.value;
    v_bundle_id    := (v_bundle->>'bundle_id')::UUID;
    v_qty_kirim    := (v_bundle->>'qty_kirim')::INT;
    v_alasan_lebih := NULLIF(TRIM(v_bundle->>'alasan_lebih'), '');

    INSERT INTO surat_jalan_item (sj_id, bundle_id, qty_kirim, urutan, tenant_id)
    VALUES (v_sj_id, v_bundle_id, v_qty_kirim, v_row.ordinality::INT, p_tenant_id)
    RETURNING id INTO v_sji_id;

    SELECT b.barcode, pi.produk_id,
           COALESCE(
             (b.status_tahap->'packing'->>'qty_selesai')::INT,
             (b.status_tahap->'cutting'->>'qty_aktual')::INT,
             pi.qty_per_bundle
           )
    INTO v_barcode, v_produk_id, v_qty_jadi
    FROM bundle b
    JOIN po_item pi ON pi.id = b.po_item_id
    WHERE b.id = v_bundle_id;

    -- Upah finishing borongan: satu baris per tahap, per item SJ ini,
    -- memakai qty_kirim (bukan qty hasil scan).
    IF v_default_karyawan IS NOT NULL THEN
      FOR v_tahap_fin IN SELECT unnest(ARRAY['lubang_kancing','buang_benang','qc','steam','packing']) LOOP
        SELECT hi.harga_satuan INTO v_rate_fin
        FROM hpp_item hi JOIN hpp_komponen hk ON hk.id = hi.komponen_id
        WHERE hi.produk_id = v_produk_id AND hk.tahap_produksi::text = v_tahap_fin
          AND hi.tenant_id = p_tenant_id;

        IF v_rate_fin IS NOT NULL AND v_rate_fin > 0 THEN
          v_upah_fin := v_rate_fin * v_qty_kirim;
          INSERT INTO gaji_ledger (
            karyawan_id, tipe, total, tanggal,
            sumber_id, keterangan, status, tenant_id, created_by
          )
          VALUES (
            v_default_karyawan, 'selesai'::gaji_ledger_tipe, v_upah_fin, p_tanggal,
            v_sji_id::text, 'Upah ' || v_tahap_fin || ' - ' || v_barcode,
            'belum_lunas'::gaji_status, p_tenant_id, auth.uid()
          );
        END IF;
      END LOOP;
    END IF;

    SELECT COALESCE(SUM(qty_kirim), 0) INTO v_sudah_kirim
    FROM surat_jalan_item WHERE bundle_id = v_bundle_id;

    IF v_sudah_kirim >= v_qty_jadi THEN
      UPDATE bundle SET surat_jalan_id = v_sj_id
      WHERE id = v_bundle_id AND surat_jalan_id IS NULL;
    END IF;

    IF v_sudah_kirim > v_qty_jadi THEN
      INSERT INTO qty_approval_request (
        bundle_id, tahap, qty_diajukan, qty_default,
        status, sumber, catatan_pengajuan, tenant_id, created_by
      ) VALUES (
        v_bundle_id, 'pengiriman', v_sudah_kirim - v_qty_jadi, v_qty_jadi,
        'pending', 'buat_surat_jalan', v_alasan_lebih, p_tenant_id, auth.uid()
      );
    END IF;
  END LOOP;

  INSERT INTO audit_log (user_id, modul, aksi, target, metadata, tenant_id)
  VALUES (
    auth.uid(), 'pengiriman', 'Buat Surat Jalan', v_sj_id::TEXT,
    jsonb_build_object(
      'nomor_sj', v_nomor_sj,
      'klien_id', p_klien_id,
      'jumlah_bundle', jsonb_array_length(p_bundles)
    ),
    p_tenant_id
  );

  RETURN v_nomor_sj;
END;
$function$;

CREATE OR REPLACE FUNCTION public.edit_surat_jalan(
  p_sj_id uuid, p_items jsonb, p_alasan text, p_user_id uuid, p_tenant_id text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_sj             RECORD;
  v_item           JSONB;
  v_item_id        UUID;
  v_qty_baru       INT;
  v_qty_lama       INT;
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
  v_tahap_fin      TEXT;
  v_no_po          TEXT;
  v_nama_produk    TEXT;
  v_identitas      TEXT;
BEGIN
  IF p_alasan IS NULL OR TRIM(p_alasan) = '' THEN
    RAISE EXCEPTION '[ALASAN KOSONG] Alasan perubahan wajib diisi dulu sebelum disimpan.';
  END IF;

  SELECT id, nomor_sj INTO v_sj
  FROM surat_jalan
  WHERE id = p_sj_id AND tenant_id = p_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '[SJ TIDAK DITEMUKAN] Surat jalan ini tidak ada di sistem.';
  END IF;

  SELECT COUNT(*) FILTER (WHERE qty_diterima IS NOT NULL)
  INTO v_jml_divalidasi
  FROM surat_jalan_item WHERE sj_id = p_sj_id;

  IF v_jml_divalidasi > 0 THEN
    RAISE EXCEPTION '[SUDAH DIVALIDASI] Surat jalan % sudah divalidasi klien — tidak bisa diedit lagi.', v_sj.nomor_sj;
  END IF;

  SELECT COUNT(*) INTO v_jml_reject FROM reject_log WHERE surat_jalan_id = p_sj_id;
  IF v_jml_reject > 0 THEN
    RAISE EXCEPTION '[ADA CATATAN REJECT] Surat jalan % punya catatan reject — tidak bisa diedit.', v_sj.nomor_sj;
  END IF;

  SELECT i.id, COALESCE(i.total_bayar, 0) INTO v_invoice_id, v_total_bayar
  FROM invoice i WHERE i.surat_jalan_id = p_sj_id AND i.tenant_id = p_tenant_id LIMIT 1;

  IF v_invoice_id IS NOT NULL THEN
    SELECT COUNT(*) INTO v_jml_bayar FROM invoice_pembayaran WHERE invoice_id = v_invoice_id;
    IF v_jml_bayar > 0 OR v_total_bayar > 0 THEN
      RAISE EXCEPTION '[INVOICE SUDAH DIBAYAR] Invoice surat jalan % sudah menerima pembayaran — tidak bisa diedit.', v_sj.nomor_sj;
    END IF;
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_item_id  := (v_item->>'surat_jalan_item_id')::UUID;
    v_qty_baru := (v_item->>'qty_kirim')::INT;

    SELECT sji.bundle_id, b.barcode, po.no_po, pr.nama,
           COALESCE(
             (b.status_tahap->'packing'->>'qty_selesai')::INT,
             (b.status_tahap->'cutting'->>'qty_aktual')::INT,
             pi.qty_per_bundle
           )
    INTO v_bundle_id, v_barcode, v_no_po, v_nama_produk, v_qty_jadi
    FROM surat_jalan_item sji
    JOIN bundle b   ON b.id  = sji.bundle_id
    JOIN po_item pi ON pi.id = b.po_item_id
    JOIN po         ON po.id = b.po_id
    JOIN produk pr  ON pr.id = pi.produk_id
    WHERE sji.id = v_item_id AND sji.sj_id = p_sj_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION '[BARANG TIDAK DITEMUKAN] Barang ini tidak ada di surat jalan %.', v_sj.nomor_sj;
    END IF;

    v_identitas := v_no_po || ' — ' || v_nama_produk || ' (' || v_barcode || ')';

    IF v_qty_baru < 0 THEN
      RAISE EXCEPTION '[QTY NEGATIF] %: qty tidak boleh kurang dari 0.', v_identitas;
    END IF;

    SELECT COALESCE(SUM(qty_kirim), 0) INTO v_lain
    FROM surat_jalan_item
    WHERE bundle_id = v_bundle_id AND sj_id <> p_sj_id;

    IF v_qty_baru + v_lain > v_qty_jadi THEN
      RAISE EXCEPTION '[QTY MELEBIHI SISA] %: mau diubah jadi % pcs, tapi barang jadi cuma % pcs dan % pcs di antaranya sudah terkirim di surat jalan lain.',
        v_identitas, v_qty_baru, v_qty_jadi, v_lain;
    END IF;
  END LOOP;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_item_id  := (v_item->>'surat_jalan_item_id')::UUID;
    v_qty_baru := (v_item->>'qty_kirim')::INT;

    SELECT bundle_id, qty_kirim INTO v_bundle_id, v_qty_lama
    FROM surat_jalan_item WHERE id = v_item_id;

    IF v_qty_lama IS DISTINCT FROM v_qty_baru THEN
      v_bundles := array_append(v_bundles, v_bundle_id);

      IF v_qty_baru = 0 THEN
        DELETE FROM surat_jalan_item WHERE id = v_item_id;
        v_dihapus := v_dihapus + 1;

        UPDATE gaji_ledger
        SET status = 'cancelled'
        WHERE sumber_id = v_item_id::text AND status = 'belum_lunas';
      ELSE
        UPDATE surat_jalan_item SET qty_kirim = v_qty_baru WHERE id = v_item_id;
        v_diubah := v_diubah + 1;

        -- Upah finishing borongan yang sudah terbentuk untuk item ini
        -- ikut dikoreksi ke qty baru, pakai tarif HPP yang sama.
        FOR v_tahap_fin IN SELECT unnest(ARRAY['lubang_kancing','buang_benang','qc','steam','packing']) LOOP
          UPDATE gaji_ledger gl
          SET total = v_qty_baru * hi.harga_satuan
          FROM hpp_item hi
          JOIN hpp_komponen hk ON hk.id = hi.komponen_id
          JOIN bundle b ON b.id = v_bundle_id
          JOIN po_item pi ON pi.id = b.po_item_id
          WHERE gl.sumber_id = v_item_id::text
            AND gl.status = 'belum_lunas'
            AND gl.keterangan LIKE ('Upah ' || v_tahap_fin || ' - %')
            AND hi.produk_id = pi.produk_id
            AND hk.tahap_produksi::text = v_tahap_fin
            AND hi.tenant_id = p_tenant_id;
        END LOOP;
      END IF;

      INSERT INTO qty_approval_request (
        bundle_id, surat_jalan_id, tahap, qty_diajukan, qty_default,
        status, sumber, catatan_pengajuan, tenant_id, created_by
      ) VALUES (
        v_bundle_id, p_sj_id, 'pengiriman', v_qty_baru, v_qty_lama,
        'pending', 'edit_surat_jalan', TRIM(p_alasan), p_tenant_id, p_user_id
      );
    END IF;
  END LOOP;

  IF v_diubah = 0 AND v_dihapus = 0 THEN
    RAISE EXCEPTION '[TIDAK ADA PERUBAHAN] Tidak ada qty yang berubah, tidak ada yang disimpan.';
  END IF;

  SELECT COUNT(*) INTO v_sisa_item FROM surat_jalan_item WHERE sj_id = p_sj_id;
  IF v_sisa_item = 0 THEN
    RAISE EXCEPTION '[SJ JADI KOSONG] Surat jalan harus punya minimal satu barang. Kalau semuanya salah, batalkan saja surat jalannya lewat menu Batal.';
  END IF;

  WITH bernomor AS (
    SELECT id, ROW_NUMBER() OVER (ORDER BY urutan NULLS LAST, id) AS n
    FROM surat_jalan_item WHERE sj_id = p_sj_id
  )
  UPDATE surat_jalan_item sji SET urutan = bernomor.n
  FROM bernomor WHERE bernomor.id = sji.id;

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
      'alasan',        TRIM(p_alasan)
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

CREATE OR REPLACE FUNCTION public.batal_surat_jalan(
  p_sj_id uuid, p_alasan text, p_user_id uuid, p_tenant_id text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_sj              RECORD;
  v_nomor_invoice   TEXT;
  v_invoice_id      UUID;
  v_jml_divalidasi  INT;
  v_jml_reject      INT;
  v_jml_bayar       INT;
  v_total_bayar     NUMERIC;
  v_jml_item        INT;
  v_total_qty       INT;
  v_bundle_ids      UUID[];
BEGIN
  SELECT id, nomor_sj, status, klien_id
  INTO v_sj
  FROM surat_jalan
  WHERE id = p_sj_id AND tenant_id = p_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '[SJ TIDAK DITEMUKAN] Surat jalan ini tidak ada di sistem.';
  END IF;

  SELECT COUNT(*) FILTER (WHERE qty_diterima IS NOT NULL),
         COUNT(*), COALESCE(SUM(qty_kirim), 0),
         ARRAY_AGG(bundle_id)
  INTO v_jml_divalidasi, v_jml_item, v_total_qty, v_bundle_ids
  FROM surat_jalan_item
  WHERE sj_id = p_sj_id;

  IF v_jml_divalidasi > 0 THEN
    RAISE EXCEPTION '[SUDAH DIVALIDASI] Surat jalan % sudah divalidasi klien (% barang) — tidak bisa dibatalkan. Perbaiki lewat proses retur/penyesuaian.',
      v_sj.nomor_sj, v_jml_divalidasi;
  END IF;

  SELECT COUNT(*) INTO v_jml_reject
  FROM reject_log WHERE surat_jalan_id = p_sj_id;

  IF v_jml_reject > 0 THEN
    RAISE EXCEPTION '[ADA CATATAN REJECT] Surat jalan % punya % catatan reject — tidak bisa dibatalkan.',
      v_sj.nomor_sj, v_jml_reject;
  END IF;

  SELECT i.id, i.nomor_invoice, COALESCE(i.total_bayar, 0)
  INTO v_invoice_id, v_nomor_invoice, v_total_bayar
  FROM invoice i
  WHERE i.surat_jalan_id = p_sj_id AND i.tenant_id = p_tenant_id
  LIMIT 1;

  IF v_invoice_id IS NOT NULL THEN
    SELECT COUNT(*) INTO v_jml_bayar
    FROM invoice_pembayaran WHERE invoice_id = v_invoice_id;

    IF v_jml_bayar > 0 OR v_total_bayar > 0 THEN
      RAISE EXCEPTION '[INVOICE SUDAH DIBAYAR] Invoice % sudah menerima pembayaran — surat jalan % tidak bisa dibatalkan.',
        v_nomor_invoice, v_sj.nomor_sj;
    END IF;
  END IF;

  IF v_invoice_id IS NOT NULL THEN
    DELETE FROM invoice WHERE id = v_invoice_id;
  END IF;

  -- Upah finishing borongan yang terbentuk dari item-item SJ ini ikut
  -- dibatalkan SEBELUM item-itemnya ikut terhapus lewat cascade.
  UPDATE gaji_ledger
  SET status = 'cancelled'
  WHERE status = 'belum_lunas'
    AND sumber_id IN (SELECT id::text FROM surat_jalan_item WHERE sj_id = p_sj_id);

  UPDATE bundle
  SET surat_jalan_id = NULL
  WHERE surat_jalan_id = p_sj_id AND tenant_id = p_tenant_id;

  IF v_bundle_ids IS NOT NULL THEN
    DELETE FROM qty_approval_request
    WHERE bundle_id = ANY(v_bundle_ids)
      AND tahap = 'pengiriman'
      AND sumber = 'buat_surat_jalan'
      AND status = 'pending'
      AND tenant_id = p_tenant_id;
  END IF;

  DELETE FROM surat_jalan WHERE id = p_sj_id AND tenant_id = p_tenant_id;

  INSERT INTO audit_log (user_id, modul, aksi, target, metadata, tenant_id)
  VALUES (
    p_user_id, 'pengiriman', 'Batal Surat Jalan', v_sj.nomor_sj,
    jsonb_build_object(
      'nomor_sj',       v_sj.nomor_sj,
      'nomor_invoice',  v_nomor_invoice,
      'jumlah_bundle',  v_jml_item,
      'total_qty',      v_total_qty,
      'alasan',         p_alasan
    ),
    p_tenant_id
  );

  RETURN jsonb_build_object(
    'success',        true,
    'nomor_sj',       v_sj.nomor_sj,
    'nomor_invoice',  v_nomor_invoice,
    'jumlah_bundle',  v_jml_item,
    'total_qty',      v_total_qty
  );
END;
$function$;
