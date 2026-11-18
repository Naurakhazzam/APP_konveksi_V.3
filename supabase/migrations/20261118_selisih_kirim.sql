-- ════════════════════════════════════════════════════════════════════════════
-- Selisih Kirim (18 Nov 2026) — Fase 1 plan Pengiriman.
--
-- Kantor cukup mengisi qty diterima saat Validasi Kirim. Pcs yang kurang tidak
-- lagi dicatat sebagai reject_log (itu bukan reject), tapi masuk tabel
-- selisih_kirim berstatus 'menunggu' sampai OWNER menjelaskan:
--   • ketinggalan  → pcs kembali ke daftar Buat SJ, dikirim dengan SJ biasa
--                    baru (ditagih invoice baru); baris mencatat SJ pengganti.
--   • hilang       → hilang/rusak di konveksi, tutup permanen (wajib keterangan).
--   • salah_hitung → kantor salah hitung; SJ kembali ke antrian Validasi.
-- Hanya untuk SJ periode baru (tanggal >= tanggal_awal_periode()).
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS selisih_kirim (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           text NOT NULL,
  surat_jalan_id      uuid NOT NULL REFERENCES surat_jalan(id) ON DELETE CASCADE,
  surat_jalan_item_id uuid NOT NULL REFERENCES surat_jalan_item(id) ON DELETE CASCADE,
  bundle_id           uuid NOT NULL REFERENCES bundle(id),
  produk_id           uuid REFERENCES produk(id),
  qty_kirim           int  NOT NULL,
  qty_diterima        int  NOT NULL,
  qty                 int  NOT NULL CHECK (qty > 0),
  harga_satuan        numeric NOT NULL DEFAULT 0,
  status              text NOT NULL DEFAULT 'menunggu'
                      CHECK (status IN ('menunggu','ketinggalan','hilang','salah_hitung')),
  keterangan          text,
  sj_pengganti_id     uuid REFERENCES surat_jalan(id) ON DELETE SET NULL,
  dijawab_by          uuid,
  dijawab_at          timestamptz,
  created_by          uuid,
  created_at          timestamptz NOT NULL DEFAULT now()
);

-- Satu baris aktif per baris SJ; 'salah_hitung' = arsip (SJ divalidasi ulang).
CREATE UNIQUE INDEX IF NOT EXISTS selisih_kirim_aktif_uq
  ON selisih_kirim (surat_jalan_item_id) WHERE status <> 'salah_hitung';
CREATE INDEX IF NOT EXISTS selisih_kirim_bundle_idx ON selisih_kirim (bundle_id) WHERE status = 'ketinggalan';
CREATE INDEX IF NOT EXISTS selisih_kirim_status_idx ON selisih_kirim (tenant_id, status);

ALTER TABLE selisih_kirim ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS selisih_kirim_baca ON selisih_kirim;
CREATE POLICY selisih_kirim_baca ON selisih_kirim FOR SELECT TO authenticated USING (true);
GRANT SELECT ON selisih_kirim TO authenticated;

-- Pcs "ketinggalan" mengurangi qty yang dianggap sudah terkirim → bisa dikirim lagi.
CREATE OR REPLACE FUNCTION _qty_ketinggalan_bundle(p_bundle_id uuid)
RETURNS int LANGUAGE sql STABLE SET search_path TO 'public' AS $$
  SELECT COALESCE(SUM(qty), 0)::int FROM selisih_kirim
  WHERE bundle_id = p_bundle_id AND status = 'ketinggalan';
$$;

-- Tandai bundle "terkirim penuh" (bundle.surat_jalan_id) sesuai qty efektif.
CREATE OR REPLACE FUNCTION _segarkan_bundle_terkirim(p_bundle_id uuid)
RETURNS void LANGUAGE plpgsql SET search_path TO 'public' AS $$
DECLARE v_jadi int; v_kirim int; v_sj uuid;
BEGIN
  SELECT COALESCE((b.status_tahap->'packing'->>'qty_selesai')::int,
                  (b.status_tahap->'cutting'->>'qty_aktual')::int, pi.qty_per_bundle)
  INTO v_jadi FROM bundle b JOIN po_item pi ON pi.id = b.po_item_id WHERE b.id = p_bundle_id;
  SELECT COALESCE(SUM(qty_kirim), 0) - _qty_ketinggalan_bundle(p_bundle_id) INTO v_kirim
  FROM surat_jalan_item WHERE bundle_id = p_bundle_id;
  IF v_kirim >= v_jadi THEN
    SELECT sj_id INTO v_sj FROM surat_jalan_item WHERE bundle_id = p_bundle_id ORDER BY created_at DESC LIMIT 1;
    UPDATE bundle SET surat_jalan_id = COALESCE(surat_jalan_id, v_sj) WHERE id = p_bundle_id;
  ELSE
    UPDATE bundle SET surat_jalan_id = NULL WHERE id = p_bundle_id;
  END IF;
END;
$$;

-- Baris ketinggalan yang belum punya SJ pengganti dihubungkan ke SJ baru.
CREATE OR REPLACE FUNCTION _tautkan_sj_pengganti(p_bundle_id uuid, p_sj_id uuid)
RETURNS void LANGUAGE sql SET search_path TO 'public' AS $$
  UPDATE selisih_kirim SET sj_pengganti_id = p_sj_id
  WHERE bundle_id = p_bundle_id AND status = 'ketinggalan' AND sj_pengganti_id IS NULL
    AND surat_jalan_id <> p_sj_id;
$$;

-- ─── Jawab selisih (owner saja) ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION jawab_selisih_kirim(
  p_id uuid, p_jawaban text, p_keterangan text, p_user_id uuid, p_tenant_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_row selisih_kirim; v_uid uuid := COALESCE(auth.uid(), p_user_id); v_ket text := NULLIF(trim(p_keterangan), '');
BEGIN
  IF NOT EXISTS (SELECT 1 FROM user_profile WHERE id = v_uid AND role = 'owner') THEN
    RAISE EXCEPTION '[KHUSUS OWNER] Hanya owner yang boleh menjelaskan selisih kirim.';
  END IF;
  SELECT * INTO v_row FROM selisih_kirim WHERE id = p_id AND tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '[TIDAK DITEMUKAN] Data selisih tidak ditemukan. Muat ulang halaman.'; END IF;
  IF v_row.status <> 'menunggu' THEN RAISE EXCEPTION '[SUDAH DIJAWAB] Selisih ini sudah dijelaskan.'; END IF;
  IF p_jawaban NOT IN ('ketinggalan','hilang','salah_hitung') THEN
    RAISE EXCEPTION '[JAWABAN TIDAK VALID] Pilih ketinggalan, hilang/rusak, atau salah hitung.';
  END IF;
  IF p_jawaban = 'hilang' AND v_ket IS NULL THEN
    RAISE EXCEPTION '[KETERANGAN KOSONG] Tulis keterangan kenapa barangnya hilang/rusak.';
  END IF;

  UPDATE selisih_kirim SET status = p_jawaban, keterangan = v_ket, dijawab_by = v_uid, dijawab_at = now()
  WHERE id = p_id;

  IF p_jawaban = 'ketinggalan' THEN
    PERFORM _segarkan_bundle_terkirim(v_row.bundle_id);
  ELSIF p_jawaban = 'salah_hitung' THEN
    -- SJ kembali ke antrian Validasi Kirim untuk dihitung ulang kantor.
    UPDATE surat_jalan SET status = 'dikirim' WHERE id = v_row.surat_jalan_id AND tenant_id = p_tenant_id;
  END IF;

  INSERT INTO audit_log (user_id, modul, aksi, target, metadata, tenant_id)
  VALUES (v_uid, 'pengiriman', 'Jawab Selisih Kirim', p_id::text,
          jsonb_build_object('jawaban', p_jawaban, 'qty', v_row.qty, 'keterangan', v_ket), p_tenant_id);

  RETURN jsonb_build_object('status', p_jawaban);
END;
$$;

-- Batalkan jawaban (kembali 'menunggu'): hanya hilang, atau ketinggalan yang belum dikirim ulang.
CREATE OR REPLACE FUNCTION batal_jawab_selisih_kirim(p_id uuid, p_user_id uuid, p_tenant_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_row selisih_kirim; v_uid uuid := COALESCE(auth.uid(), p_user_id);
BEGIN
  IF NOT EXISTS (SELECT 1 FROM user_profile WHERE id = v_uid AND role = 'owner') THEN
    RAISE EXCEPTION '[KHUSUS OWNER] Hanya owner yang boleh mengubah jawaban selisih kirim.';
  END IF;
  SELECT * INTO v_row FROM selisih_kirim WHERE id = p_id AND tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '[TIDAK DITEMUKAN] Data selisih tidak ditemukan.'; END IF;
  IF v_row.status NOT IN ('ketinggalan','hilang') THEN
    RAISE EXCEPTION '[TIDAK BISA DIBATALKAN] Jawaban ini tidak bisa dibatalkan.';
  END IF;
  IF v_row.status = 'ketinggalan' THEN
    IF v_row.sj_pengganti_id IS NOT NULL THEN
      RAISE EXCEPTION '[SUDAH DIKIRIM ULANG] Pcs ketinggalan sudah dikirim lewat SJ pengganti — tidak bisa dibatalkan.';
    END IF;
    -- Pastikan sisa siap kirim tidak jadi minus (pcs ketinggalan belum dipakai SJ lain).
    IF (SELECT COALESCE(SUM(qty_kirim), 0) FROM surat_jalan_item WHERE bundle_id = v_row.bundle_id)
       - (_qty_ketinggalan_bundle(v_row.bundle_id) - v_row.qty)
       > (SELECT COALESCE((b.status_tahap->'packing'->>'qty_selesai')::int,
                          (b.status_tahap->'cutting'->>'qty_aktual')::int, pi.qty_per_bundle)
          FROM bundle b JOIN po_item pi ON pi.id = b.po_item_id WHERE b.id = v_row.bundle_id) THEN
      RAISE EXCEPTION '[SUDAH DIKIRIM ULANG] Pcs ketinggalan sudah masuk surat jalan lain — tidak bisa dibatalkan.';
    END IF;
  END IF;
  UPDATE selisih_kirim SET status = 'menunggu', keterangan = NULL, dijawab_by = NULL, dijawab_at = NULL WHERE id = p_id;
  PERFORM _segarkan_bundle_terkirim(v_row.bundle_id);
  RETURN jsonb_build_object('status', 'menunggu');
END;
$$;

GRANT EXECUTE ON FUNCTION jawab_selisih_kirim(uuid, text, text, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION batal_jawab_selisih_kirim(uuid, uuid, text) TO authenticated;

-- ─── Validasi Kirim: kurang → selisih_kirim (bukan reject_log) ──────────────
CREATE OR REPLACE FUNCTION public.validasi_pengiriman(p_surat_jalan_id uuid, p_items jsonb, p_catatan text, p_user_id uuid, p_tenant_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_item jsonb; v_sji_id uuid; v_bundle_id uuid; v_qty_kirim int; v_qty_diterima int; v_qty_lama int; v_selisih int;
  v_qty_reject int; v_reject_alasan_id uuid; v_reject_ket text; v_produk_id uuid;
  v_harga numeric; v_barcode text; v_delta_nilai numeric := 0; v_has_kurang boolean := false; v_has_lebih boolean := false;
  v_approval_ids jsonb := '[]'::jsonb; v_status_final sj_status := 'tervalidasi'; v_approval_id uuid;
  v_periode_baru boolean; v_dijawab selisih_kirim;
BEGIN
  IF EXISTS (SELECT 1 FROM surat_jalan WHERE id = p_surat_jalan_id AND jenis = 'kirim_ulang') THEN
    RAISE EXCEPTION '[SJ KIRIM ULANG] Surat jalan kirim ulang divalidasi lewat form kirim ulang.';
  END IF;
  SELECT tanggal >= tanggal_awal_periode() INTO v_periode_baru
  FROM surat_jalan WHERE id = p_surat_jalan_id AND tenant_id = p_tenant_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_sji_id := (v_item->>'surat_jalan_item_id')::uuid;
    v_qty_diterima := (v_item->>'qty_diterima')::int;
    v_qty_reject := COALESCE(NULLIF(v_item->>'qty_reject', '')::int, 0);
    v_reject_alasan_id := NULLIF(v_item->>'reject_alasan_id', '')::uuid;
    v_reject_ket := NULLIF(trim(v_item->>'reject_keterangan'), '');
    SELECT sji.bundle_id, sji.qty_kirim, sji.qty_diterima, pi.produk_id, COALESCE(sji.harga_satuan, pr.harga_jual, 0), b.barcode
    INTO v_bundle_id, v_qty_kirim, v_qty_lama, v_produk_id, v_harga, v_barcode
    FROM surat_jalan_item sji JOIN bundle b ON b.id = sji.bundle_id JOIN po_item pi ON pi.id = b.po_item_id JOIN produk pr ON pr.id = pi.produk_id
    WHERE sji.id = v_sji_id AND sji.sj_id = p_surat_jalan_id AND sji.tenant_id = p_tenant_id;
    IF NOT FOUND THEN RAISE EXCEPTION '[ITEM TIDAK DITEMUKAN] Baris surat jalan tidak cocok. Muat ulang halaman.'; END IF;
    IF v_qty_diterima IS NULL OR v_qty_diterima < 0 THEN RAISE EXCEPTION '[QTY TIDAK VALID] Qty diterima % tidak valid.', v_barcode; END IF;

    -- Selisih yang sudah dijelaskan owner (ketinggalan/hilang) mengunci qty diterima baris ini.
    SELECT * INTO v_dijawab FROM selisih_kirim
    WHERE surat_jalan_item_id = v_sji_id AND status IN ('ketinggalan','hilang');
    IF FOUND AND v_qty_diterima IS DISTINCT FROM v_dijawab.qty_diterima THEN
      RAISE EXCEPTION '[SELISIH SUDAH DIJELASKAN] %: kurang % pcs sudah dijelaskan owner (%), qty diterima tidak bisa diubah.',
        v_barcode, v_dijawab.qty, CASE v_dijawab.status WHEN 'ketinggalan' THEN 'ketinggalan' ELSE 'hilang/rusak' END;
    END IF;

    v_selisih := v_qty_diterima - v_qty_kirim;
    -- Pendapatan yang diakui = min(diterima, kirim); dihitung dari selisih terhadap pengakuan sebelumnya
    v_delta_nilai := v_delta_nilai + (LEAST(v_qty_diterima, v_qty_kirim) - LEAST(COALESCE(v_qty_lama, v_qty_kirim), v_qty_kirim)) * v_harga;
    UPDATE surat_jalan_item SET qty_diterima = v_qty_diterima WHERE id = v_sji_id AND tenant_id = p_tenant_id;

    IF v_selisih < 0 THEN
      v_has_kurang := true;
      IF v_periode_baru AND v_dijawab.id IS NULL THEN
        INSERT INTO selisih_kirim (tenant_id, surat_jalan_id, surat_jalan_item_id, bundle_id, produk_id,
                                   qty_kirim, qty_diterima, qty, harga_satuan, created_by)
        VALUES (p_tenant_id, p_surat_jalan_id, v_sji_id, v_bundle_id, v_produk_id,
                v_qty_kirim, v_qty_diterima, -v_selisih, v_harga, p_user_id)
        ON CONFLICT (surat_jalan_item_id) WHERE status <> 'salah_hitung'
        DO UPDATE SET qty_kirim = EXCLUDED.qty_kirim, qty_diterima = EXCLUDED.qty_diterima,
                      qty = EXCLUDED.qty, harga_satuan = EXCLUDED.harga_satuan, created_at = now();
      END IF;
    ELSE
      DELETE FROM selisih_kirim WHERE surat_jalan_item_id = v_sji_id AND status = 'menunggu';
    END IF;
    v_dijawab := NULL;

    IF v_selisih > 0 THEN
      v_has_lebih := true;
      INSERT INTO qty_approval_request (bundle_id, tahap, qty_diajukan, qty_default, status, tenant_id, created_by)
      VALUES (v_bundle_id, 'pengiriman', v_selisih, v_qty_kirim, 'pending', p_tenant_id, p_user_id) RETURNING id INTO v_approval_id;
      v_approval_ids := v_approval_ids || jsonb_build_array(v_approval_id::text);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM reject_kantor rk JOIN kirim_ulang_item k ON k.reject_kantor_id = rk.id WHERE rk.surat_jalan_item_id = v_sji_id AND rk.waktu_temuan = 'saat_terima') THEN
      DELETE FROM reject_kantor WHERE surat_jalan_item_id = v_sji_id AND waktu_temuan = 'saat_terima';
      IF v_qty_reject > 0 THEN
        IF v_reject_alasan_id IS NULL THEN RAISE EXCEPTION '[ALASAN KOSONG] Pilih alasan reject untuk %.', v_barcode; END IF;
        IF v_qty_reject > v_qty_diterima THEN RAISE EXCEPTION '[REJECT MELEBIHI] %: reject % pcs lebih banyak dari yang diterima (% pcs).', v_barcode, v_qty_reject, v_qty_diterima; END IF;
        INSERT INTO reject_kantor (nomor_reject, surat_jalan_id, surat_jalan_item_id, produk_id, bundle_id, alasan_reject_id, qty, harga_satuan, waktu_temuan, keterangan, tenant_id, created_by)
        VALUES (_nomor_reject_kantor(p_tenant_id, CURRENT_DATE), p_surat_jalan_id, v_sji_id, v_produk_id, v_bundle_id, v_reject_alasan_id, v_qty_reject, v_harga, 'saat_terima', v_reject_ket, p_tenant_id, p_user_id);
      END IF;
    END IF;
  END LOOP;
  IF v_delta_nilai <> 0 THEN
    UPDATE invoice SET total_nilai = GREATEST(total_nilai + v_delta_nilai, 0) WHERE surat_jalan_id = p_surat_jalan_id AND tenant_id = p_tenant_id;
  END IF;
  PERFORM _sinkron_potongan_invoice(p_surat_jalan_id);
  IF v_has_lebih THEN v_status_final := 'selisih_lebih'; ELSIF v_has_kurang THEN v_status_final := 'selisih_kurang'; END IF;
  UPDATE surat_jalan SET status = v_status_final, catatan_validasi = p_catatan, tanggal_validasi = CURRENT_DATE, validated_by = p_user_id
  WHERE id = p_surat_jalan_id AND tenant_id = p_tenant_id;
  RETURN jsonb_build_object('status', v_status_final, 'has_kurang', v_has_kurang, 'has_lebih', v_has_lebih, 'approval_ids', v_approval_ids);
END;
$function$;

-- ─── RPC surat jalan: qty sudah terkirim dikurangi pcs ketinggalan ──────────
CREATE OR REPLACE FUNCTION public.edit_surat_jalan(p_sj_id uuid, p_items jsonb, p_alasan text, p_user_id uuid, p_tenant_id text)
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
  v_jml_upah_lunas INT;
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

    SELECT COALESCE(SUM(qty_kirim), 0) - _qty_ketinggalan_bundle(v_bundle_id) INTO v_lain
    FROM surat_jalan_item
    WHERE bundle_id = v_bundle_id AND sj_id <> p_sj_id;

    IF v_qty_baru + v_lain > v_qty_jadi THEN
      RAISE EXCEPTION '[QTY MELEBIHI SISA] %: mau diubah jadi % pcs, tapi barang jadi cuma % pcs dan % pcs di antaranya sudah terkirim di surat jalan lain.',
        v_identitas, v_qty_baru, v_qty_jadi, v_lain;
    END IF;

    SELECT COUNT(*) INTO v_jml_upah_lunas
    FROM gaji_ledger gl
    WHERE gl.tenant_id = p_tenant_id AND gl.sumber_id = v_item_id::text
      AND gl.status IN ('lunas', 'escrow');

    IF v_jml_upah_lunas > 0 THEN
      RAISE EXCEPTION '[UPAH SUDAH DIBAYAR] %: upah finishing baris ini sudah lunas/ditahan — batalkan/koreksi upahnya dulu lewat Overview Pekerja sebelum mengedit baris ini.',
        v_identitas;
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

    SELECT COALESCE(SUM(qty_kirim), 0) - _qty_ketinggalan_bundle(v_bundle_id) INTO v_total_kirim
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

CREATE OR REPLACE FUNCTION public.finalize_surat_jalan(p_klien_id uuid, p_tanggal date, p_catatan text, p_bundles jsonb, p_tenant_id text DEFAULT 'STX-001'::text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
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
  v_no_po          TEXT;
  v_nama_produk    TEXT;
  v_status_packing TEXT;
  v_identitas      TEXT;
BEGIN
  IF jsonb_array_length(p_bundles) = 0 THEN
    RAISE EXCEPTION '[TIDAK ADA BARANG] Belum ada barang yang dipilih. Pilih dulu minimal 1 barang untuk dikirim.';
  END IF;

  FOR v_bundle IN SELECT * FROM jsonb_array_elements(p_bundles) LOOP
    v_bundle_id    := (v_bundle->>'bundle_id')::UUID;
    v_qty_kirim    := (v_bundle->>'qty_kirim')::INT;
    v_alasan_lebih := NULLIF(TRIM(v_bundle->>'alasan_lebih'), '');

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

    SELECT COALESCE(SUM(qty_kirim), 0) - _qty_ketinggalan_bundle(v_bundle_id) INTO v_sudah_kirim
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

    PERFORM _tautkan_sj_pengganti(v_bundle_id, v_sj_id);

    SELECT COALESCE(
             (b.status_tahap->'packing'->>'qty_selesai')::INT,
             (b.status_tahap->'cutting'->>'qty_aktual')::INT,
             pi.qty_per_bundle
           )
    INTO v_qty_jadi
    FROM bundle b
    JOIN po_item pi ON pi.id = b.po_item_id
    WHERE b.id = v_bundle_id;

    SELECT COALESCE(SUM(qty_kirim), 0) - _qty_ketinggalan_bundle(v_bundle_id) INTO v_sudah_kirim
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

CREATE OR REPLACE FUNCTION public.tambah_item_surat_jalan(p_sj_id uuid, p_bundles jsonb, p_alasan text, p_user_id uuid, p_tenant_id text)
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

    SELECT COALESCE(SUM(qty_kirim), 0) - _qty_ketinggalan_bundle(v_bundle_id) INTO v_sudah_kirim
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
    PERFORM _tautkan_sj_pengganti(v_bundle_id, p_sj_id);

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

-- ─── Izin halaman: lihat untuk owner/admin keuangan/admin produksi; jawab = owner (dijaga RPC) ──
INSERT INTO role_permissions (role, path, can_view, tenant_id, updated_at)
SELECT r, '/app/pengiriman/selisih-kirim', r IN ('owner','admin_keuangan','admin_produksi'), 'STX-001', now()
FROM unnest(ARRAY['owner','admin_keuangan','admin_produksi','mandor','supervisor']) r
WHERE NOT EXISTS (SELECT 1 FROM role_permissions WHERE role = r AND path = '/app/pengiriman/selisih-kirim' AND tenant_id = 'STX-001');

NOTIFY pgrst, 'reload schema';
