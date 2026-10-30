-- ================================================================
-- MIGRATION: Koreksi sampai tahap cutting dari Lacak Barcode
--
-- Lanjutan 20261030000001. Kasus yang belum tertangani:
--   - Cutting tercatat 10, semua tahap lolos dengan 10 sampai terkirim,
--     padahal nyatanya cuma 5 yang dipotong. Mundur tahap + scan ulang
--     semuanya terlalu berat untuk barang yang memang sudah jalan.
--   - Perlu mundur sampai sebelum Jahit (kembali ke Antrian Jahit) supaya
--     hasil cutting bisa dibetulkan lewat Koreksi Hasil Cutting.
--
-- 1. _sesuaikan_aksesori_jahit — rumus aksesori jahit dari
--    koreksi_serah_terima_jahit (model_aksesori + warna_aksesori, FIFO
--    batch + jurnal) dipisah jadi helper, dipakai dua fungsi di bawah.
-- 2. kembalikan_tahap_bundle — tujuan boleh 'cutting': jahit dan semua
--    tahap sesudahnya dibatalkan (aksesori jahit dikembalikan ke batch),
--    bundle kembali antre di Antrian Jahit. Hasil cutting tidak diubah.
-- 3. koreksi_qty_berantai — samakan qty mulai tahap X (cutting s/d
--    packing) sampai tahap terakhir dan pengiriman menjadi N:
--      - cutting: qty_aktual = N; status partial bila total potong
--        (+susulan) < rencana dan belum pernah ditutup → sisa muncul di
--        Pending Cutting untuk diputuskan (Lanjut / Tutup)
--      - tiap tahap: qty terima/selesai = N, scan_log ikut
--      - aksesori jahit & finishing dihitung ulang
--      - upah (cutting, jahit, finishing lama ber-sumber bundle, dan
--        finishing per surat jalan) disesuaikan proporsional apa pun
--        statusnya — keputusan owner: pembayaran riil mengikuti kondisi
--        nyata
--      - surat jalan: kalau total kirim > hasil packing baru, qty_kirim
--        dikurangi dari SJ terakhir (baris jadi 0 dihapus, SJ kosong
--        dihapus beserta invoice), invoice dihitung ulang
--    Ditolak bila bundle pernah di-Split, punya catatan reject, atau SJ-nya
--    sudah divalidasi klien / invoice sudah dibayar.
-- ================================================================


-- ── 1. Helper aksesori jahit ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._sesuaikan_aksesori_jahit(
  p_bundle_id uuid,
  p_delta     numeric,
  p_user_id   uuid,
  p_tenant_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_bundle               RECORD;
  v_warna_id             UUID;
  v_kategori_aksesori_id UUID;
  v_aksesori             RECORD;
  v_jumlah               NUMERIC;
  v_sisa                 NUMERIC;
  v_ambil                NUMERIC;
  v_batch                RECORD;
  v_jurnal               RECORD;
  v_ada_pemakaian        BOOLEAN;
  v_consume_result       JSONB;
  v_stok_warnings        JSONB := '[]'::JSONB;
BEGIN
  IF COALESCE(p_delta, 0) = 0 THEN RETURN v_stok_warnings; END IF;

  SELECT b.id, b.po_item_id, pi.po_id, pi.warna, produk.model_id
  INTO v_bundle
  FROM bundle b
  JOIN po_item pi ON pi.id = b.po_item_id
  JOIN produk     ON produk.id = pi.produk_id
  WHERE b.id = p_bundle_id AND b.tenant_id = p_tenant_id;

  IF NOT FOUND THEN RETURN v_stok_warnings; END IF;

  SELECT id INTO v_kategori_aksesori_id
  FROM kategori_trx
  WHERE nama = 'Pembelian Aksesori' AND jenis = 'direct_bahan'
    AND aktif = TRUE AND tenant_id = p_tenant_id
  LIMIT 1;

  SELECT id INTO v_warna_id
  FROM warna
  WHERE LOWER(nama) = LOWER(v_bundle.warna) AND tenant_id = p_tenant_id
  LIMIT 1;

  FOR v_aksesori IN
    SELECT ma.inventory_item_id, ma.qty_per_pcs
    FROM model_aksesori ma
    WHERE ma.model_id = v_bundle.model_id AND ma.tenant_id = p_tenant_id
      AND ma.tahap_pakai = 'jahit'
      AND (ma.warna_id IS NULL OR ma.warna_id = v_warna_id)
    UNION ALL
    SELECT wa.inventory_item_id, wa.qty_per_pcs
    FROM warna_aksesori wa
    WHERE v_warna_id IS NOT NULL AND wa.warna_id = v_warna_id
      AND wa.tenant_id = p_tenant_id AND wa.tahap_pakai = 'jahit'
  LOOP
    v_jumlah := v_aksesori.qty_per_pcs * abs(p_delta);
    CONTINUE WHEN v_jumlah <= 0;

    IF p_delta > 0 THEN
      SELECT EXISTS (
        SELECT 1 FROM pemakaian_aksesori
        WHERE bundle_id = v_bundle.id AND inventory_item_id = v_aksesori.inventory_item_id
          AND tahap = 'jahit'
      ) INTO v_ada_pemakaian;

      v_consume_result := consume_fifo_atomic(
        v_aksesori.inventory_item_id, v_jumlah, v_bundle.po_item_id,
        v_bundle.id, v_aksesori.qty_per_pcs, p_user_id, p_tenant_id,
        v_kategori_aksesori_id, 'jahit'
      );

      IF v_ada_pemakaian THEN
        UPDATE pemakaian_aksesori
        SET qty_pakai = qty_pakai + v_jumlah
        WHERE bundle_id = v_bundle.id AND inventory_item_id = v_aksesori.inventory_item_id
          AND tahap = 'jahit';
      END IF;

      IF v_consume_result ->> 'status' = 'stok_kurang' THEN
        v_stok_warnings := v_stok_warnings || jsonb_build_object(
          'item_nama',  v_consume_result ->> 'item_nama',
          'qty_kurang', v_consume_result -> 'qty_kurang',
          'sisa_stok',  v_consume_result -> 'sisa_stok'
        );
      END IF;

    ELSE
      UPDATE inventory_item
      SET stok_aktual = stok_aktual + v_jumlah
      WHERE id = v_aksesori.inventory_item_id AND tenant_id = p_tenant_id;

      v_sisa := v_jumlah;
      FOR v_batch IN
        SELECT id, qty_awal, qty_sisa
        FROM inventory_batch
        WHERE inventory_item_id = v_aksesori.inventory_item_id
          AND tenant_id = p_tenant_id AND qty_sisa < qty_awal
        ORDER BY tanggal_masuk DESC, created_at DESC
        FOR UPDATE
      LOOP
        EXIT WHEN v_sisa <= 0;
        v_ambil := LEAST(v_batch.qty_awal - v_batch.qty_sisa, v_sisa);
        UPDATE inventory_batch SET qty_sisa = qty_sisa + v_ambil WHERE id = v_batch.id;
        v_sisa := v_sisa - v_ambil;
      END LOOP;

      v_sisa := v_jumlah;
      FOR v_jurnal IN
        SELECT id, qty, nominal
        FROM jurnal_entry
        WHERE tenant_id = p_tenant_id AND jenis = 'direct_bahan'
          AND inventory_item_id = v_aksesori.inventory_item_id
          AND tag_po_ids @> jsonb_build_array(v_bundle.po_id::text)
          AND qty > 0
        ORDER BY created_at DESC
        FOR UPDATE
      LOOP
        EXIT WHEN v_sisa <= 0;
        v_ambil := LEAST(v_jurnal.qty, v_sisa);
        IF v_ambil >= v_jurnal.qty THEN
          DELETE FROM jurnal_entry WHERE id = v_jurnal.id;
        ELSE
          UPDATE jurnal_entry
          SET qty     = qty - v_ambil,
              nominal = GREATEST(round(nominal - nominal * v_ambil / v_jurnal.qty, 2), 0)
          WHERE id = v_jurnal.id;
        END IF;
        v_sisa := v_sisa - v_ambil;
      END LOOP;

      UPDATE pemakaian_aksesori
      SET qty_pakai = GREATEST(qty_pakai - v_jumlah, 0)
      WHERE bundle_id = v_bundle.id AND inventory_item_id = v_aksesori.inventory_item_id
        AND tahap = 'jahit';
    END IF;
  END LOOP;

  -- Baris yang habis dihapus: consume_fifo_atomic INSERT ... ON CONFLICT DO
  -- NOTHING, jadi baris 0 yang tertinggal membuat serah terima ulang
  -- memotong stok tanpa tercatat di pemakaian.
  DELETE FROM pemakaian_aksesori
  WHERE bundle_id = v_bundle.id AND tahap = 'jahit' AND qty_pakai <= 0;

  RETURN v_stok_warnings;
END;
$function$;


-- ── 2. kembalikan_tahap_bundle: boleh sampai cutting ────────────────
CREATE OR REPLACE FUNCTION public.kembalikan_tahap_bundle(
  p_bundle_id    uuid,
  p_tahap_tujuan text,
  p_alasan       text,
  p_user_id      uuid,
  p_tenant_id    text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_order         text[] := ARRAY['cutting','jahit','lubang_kancing','buang_benang','qc','steam','packing'];
  v_bundle        RECORD;
  v_st            JSONB;
  v_st_lama       JSONB;
  v_idx_tujuan    INT;
  v_tahap         TEXT;
  v_i             INT;
  v_dihapus       TEXT[] := ARRAY[]::TEXT[];
  v_upah_tahap    TEXT[] := ARRAY[]::TEXT[];
  v_tujuan_selesai BOOLEAN;
  v_sji           RECORD;
  v_inv           RECORD;
  v_jml_bayar     INT;
  v_child         RECORD;
  v_child_min     INT;
  v_sisa_item     INT;
  v_total_baru    NUMERIC;
  v_sj_info       JSONB := '[]'::JSONB;
  v_upah_batal    JSONB;
  v_scan_hapus    JSONB;
BEGIN
  IF p_alasan IS NULL OR trim(p_alasan) = '' THEN
    RAISE EXCEPTION 'Alasan wajib diisi';
  END IF;

  v_idx_tujuan := array_position(v_order, p_tahap_tujuan);
  IF v_idx_tujuan IS NULL THEN
    RAISE EXCEPTION 'Tahap tujuan tidak valid: %', p_tahap_tujuan;
  END IF;

  SELECT b.id, b.barcode, b.po_id, b.status_tahap
  INTO v_bundle
  FROM bundle b
  WHERE b.id = p_bundle_id AND b.tenant_id = p_tenant_id
  FOR UPDATE OF b;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bundle tidak ditemukan';
  END IF;

  v_st      := COALESCE(v_bundle.status_tahap, '{}'::jsonb);
  v_st_lama := v_st;

  IF NOT (v_st ? p_tahap_tujuan) THEN
    RAISE EXCEPTION 'Bundle % belum pernah sampai tahap % — tidak bisa dikembalikan ke sana', v_bundle.barcode, p_tahap_tujuan;
  END IF;

  FOR v_i IN (v_idx_tujuan + 1) .. array_length(v_order, 1) LOOP
    IF v_st ? v_order[v_i] THEN
      v_dihapus := array_append(v_dihapus, v_order[v_i]);
    END IF;
  END LOOP;

  -- Cutting sebagai tujuan tidak diubah statusnya — bundle cukup kembali
  -- antre di Antrian Jahit. Tahap lain kembali ke 'sedang dikerjakan'.
  v_tujuan_selesai := p_tahap_tujuan <> 'cutting'
                      AND (v_st -> p_tahap_tujuan ->> 'status') = 'selesai';

  IF array_length(v_dihapus, 1) IS NULL AND NOT v_tujuan_selesai
     AND NOT EXISTS (SELECT 1 FROM surat_jalan_item WHERE bundle_id = v_bundle.id) THEN
    RAISE EXCEPTION 'Bundle % sudah berada di tahap % — tidak ada yang perlu dikembalikan', v_bundle.barcode, p_tahap_tujuan;
  END IF;

  FOR v_child IN
    SELECT c.barcode, c.status_tahap
    FROM bundle c
    WHERE c.parent_bundle_id = v_bundle.id AND c.tenant_id = p_tenant_id
      AND c.barcode LIKE v_bundle.barcode || 'h%'
  LOOP
    SELECT MIN(array_position(v_order, k)) INTO v_child_min
    FROM jsonb_object_keys(COALESCE(v_child.status_tahap, '{}'::jsonb)) k
    WHERE k <> 'cutting';
    IF v_child_min IS NOT NULL AND v_child_min > v_idx_tujuan THEN
      RAISE EXCEPTION 'Bundle % pernah di-Split di tahap % (pecahan %). Tidak bisa dikembalikan ke tahap sebelum Split.',
        v_bundle.barcode, v_order[v_child_min], v_child.barcode;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1 FROM reject_log r
    WHERE r.bundle_id = v_bundle.id AND r.tenant_id = p_tenant_id
      AND (r.surat_jalan_id IS NOT NULL OR r.tahap_ditemukan = ANY(v_dihapus))
  ) THEN
    RAISE EXCEPTION 'Bundle % punya catatan reject di tahap yang mau dibatalkan/pengiriman — selesaikan dulu di menu Reject', v_bundle.barcode;
  END IF;

  FOR v_sji IN
    SELECT sji.id, sji.sj_id, sji.qty_kirim, sji.qty_diterima, sj.nomor_sj
    FROM surat_jalan_item sji
    JOIN surat_jalan sj ON sj.id = sji.sj_id
    WHERE sji.bundle_id = v_bundle.id
  LOOP
    IF v_sji.qty_diterima IS NOT NULL THEN
      RAISE EXCEPTION 'Bundle % di surat jalan % sudah divalidasi klien — tidak bisa ditarik. Perbaiki lewat retur.', v_bundle.barcode, v_sji.nomor_sj;
    END IF;

    SELECT i.id, i.nomor_invoice, COALESCE(i.total_bayar, 0) AS total_bayar INTO v_inv
    FROM invoice i WHERE i.surat_jalan_id = v_sji.sj_id AND i.tenant_id = p_tenant_id LIMIT 1;
    IF FOUND THEN
      SELECT COUNT(*) INTO v_jml_bayar FROM invoice_pembayaran WHERE invoice_id = v_inv.id;
      IF v_jml_bayar > 0 OR v_inv.total_bayar > 0 THEN
        RAISE EXCEPTION 'Invoice % (surat jalan %) sudah menerima pembayaran — bundle % tidak bisa ditarik.', v_inv.nomor_invoice, v_sji.nomor_sj, v_bundle.barcode;
      END IF;
    END IF;
  END LOOP;

  -- Lepas penanda kirim dulu: FK bundle.surat_jalan_id → surat_jalan
  -- tidak cascade, jadi SJ yang jadi kosong baru bisa dihapus sesudahnya.
  UPDATE bundle SET surat_jalan_id = NULL WHERE id = v_bundle.id;

  FOR v_sji IN
    SELECT sji.id, sji.sj_id, sji.qty_kirim, sj.nomor_sj
    FROM surat_jalan_item sji
    JOIN surat_jalan sj ON sj.id = sji.sj_id
    WHERE sji.bundle_id = v_bundle.id
    FOR UPDATE OF sji, sj
  LOOP
    SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, 'keterangan', keterangan, 'total', total, 'status', status)), '[]'::jsonb)
    INTO v_upah_batal
    FROM gaji_ledger
    WHERE tenant_id = p_tenant_id AND sumber_id = v_sji.id::text AND status <> 'cancelled';

    UPDATE gaji_ledger SET status = 'cancelled'
    WHERE tenant_id = p_tenant_id AND sumber_id = v_sji.id::text AND status <> 'cancelled';

    DELETE FROM surat_jalan_item WHERE id = v_sji.id;

    SELECT COUNT(*) INTO v_sisa_item FROM surat_jalan_item WHERE sj_id = v_sji.sj_id;

    SELECT i.id, i.nomor_invoice INTO v_inv
    FROM invoice i WHERE i.surat_jalan_id = v_sji.sj_id AND i.tenant_id = p_tenant_id LIMIT 1;

    IF v_sisa_item = 0 THEN
      IF v_inv.id IS NOT NULL THEN
        DELETE FROM invoice WHERE id = v_inv.id;
      END IF;
      UPDATE bundle SET surat_jalan_id = NULL
      WHERE surat_jalan_id = v_sji.sj_id AND tenant_id = p_tenant_id;
      DELETE FROM surat_jalan WHERE id = v_sji.sj_id AND tenant_id = p_tenant_id;
    ELSE
      WITH bernomor AS (
        SELECT id, ROW_NUMBER() OVER (ORDER BY urutan NULLS LAST, id) AS n
        FROM surat_jalan_item WHERE sj_id = v_sji.sj_id
      )
      UPDATE surat_jalan_item sji SET urutan = bernomor.n
      FROM bernomor WHERE bernomor.id = sji.id;

      IF v_inv.id IS NOT NULL THEN
        SELECT COALESCE(SUM(sji.qty_kirim * COALESCE(pr.harga_jual, 0)), 0)
        INTO v_total_baru
        FROM surat_jalan_item sji
        JOIN bundle b   ON b.id  = sji.bundle_id
        JOIN po_item pi ON pi.id = b.po_item_id
        JOIN produk pr  ON pr.id = pi.produk_id
        WHERE sji.sj_id = v_sji.sj_id;

        UPDATE invoice SET total_nilai = v_total_baru WHERE id = v_inv.id;
      END IF;
    END IF;

    v_sj_info := v_sj_info || jsonb_build_object(
      'nomor_sj',      v_sji.nomor_sj,
      'qty_kirim',     v_sji.qty_kirim,
      'sj_dihapus',    v_sisa_item = 0,
      'nomor_invoice', v_inv.nomor_invoice,
      'upah_dibatalkan', v_upah_batal
    );
  END LOOP;

  DELETE FROM qty_approval_request
  WHERE bundle_id = v_bundle.id AND tenant_id = p_tenant_id AND status = 'pending'
    AND (tahap::text = 'pengiriman' OR tahap::text = ANY(v_dihapus)
         OR (v_tujuan_selesai AND tahap::text = p_tahap_tujuan));

  v_upah_tahap := v_dihapus;
  IF v_tujuan_selesai THEN
    v_upah_tahap := array_append(v_upah_tahap, p_tahap_tujuan);
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, 'keterangan', keterangan, 'total', total, 'status', status)), '[]'::jsonb)
  INTO v_upah_batal
  FROM gaji_ledger
  WHERE tenant_id = p_tenant_id AND sumber_id = v_bundle.id::text AND status <> 'cancelled'
    AND keterangan = ANY(SELECT 'Upah ' || t || ' - ' || v_bundle.barcode FROM unnest(v_upah_tahap) t);

  UPDATE gaji_ledger SET status = 'cancelled'
  WHERE tenant_id = p_tenant_id AND sumber_id = v_bundle.id::text AND status <> 'cancelled'
    AND keterangan = ANY(SELECT 'Upah ' || t || ' - ' || v_bundle.barcode FROM unnest(v_upah_tahap) t);

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'tahap', s.tahap, 'tipe', s.tipe, 'qty', s.qty, 'karyawan_id', s.karyawan_id,
           'user_id', s.user_id, 'created_at', s.created_at) ORDER BY s.created_at), '[]'::jsonb)
  INTO v_scan_hapus
  FROM scan_log s
  WHERE s.bundle_id = v_bundle.id
    AND (s.tahap::text = ANY(v_dihapus)
         OR (v_tujuan_selesai AND s.tahap::text = p_tahap_tujuan AND s.tipe = 'selesai'));

  UPDATE qty_approval_request q SET scan_log_id = NULL
  FROM scan_log s
  WHERE q.scan_log_id = s.id AND s.bundle_id = v_bundle.id
    AND (s.tahap::text = ANY(v_dihapus)
         OR (v_tujuan_selesai AND s.tahap::text = p_tahap_tujuan AND s.tipe = 'selesai'));

  DELETE FROM scan_log s
  WHERE s.bundle_id = v_bundle.id
    AND (s.tahap::text = ANY(v_dihapus)
         OR (v_tujuan_selesai AND s.tahap::text = p_tahap_tujuan AND s.tipe = 'selesai'));

  -- Aksesori tahap yang dihapus kembali ke stok. Jahit memakai FIFO batch
  -- (consume_fifo_atomic) jadi dibalik lewat helpernya sendiri.
  FOREACH v_tahap IN ARRAY v_dihapus LOOP
    IF v_tahap = 'jahit' THEN
      PERFORM _sesuaikan_aksesori_jahit(
        v_bundle.id, -COALESCE((v_st_lama -> 'jahit' ->> 'qty_terima')::numeric, 0),
        p_user_id, p_tenant_id);
    ELSE
      PERFORM _kembalikan_aksesori_tahap(v_bundle.id, v_bundle.po_id, v_tahap, p_tenant_id);
    END IF;
  END LOOP;

  FOREACH v_tahap IN ARRAY v_dihapus LOOP
    v_st := v_st - v_tahap;
  END LOOP;

  IF v_tujuan_selesai THEN
    v_st := jsonb_set(
      v_st, ARRAY[p_tahap_tujuan],
      ((v_st -> p_tahap_tujuan) - 'qty_selesai' - 'waktu_selesai' - 'end_time')
        || jsonb_build_object('status', 'terima', 'updated_by', p_user_id)
    );
  END IF;

  UPDATE bundle SET status_tahap = v_st WHERE id = v_bundle.id;

  INSERT INTO audit_log (user_id, modul, aksi, target, metadata, tenant_id)
  VALUES (
    p_user_id, 'produksi', 'Kembalikan Tahap', v_bundle.barcode,
    jsonb_build_object(
      'bundle_id',        v_bundle.id,
      'tahap_tujuan',     p_tahap_tujuan,
      'tahap_dihapus',    to_jsonb(v_dihapus),
      'surat_jalan',      v_sj_info,
      'upah_dibatalkan',  v_upah_batal,
      'scan_log_dihapus', v_scan_hapus,
      'status_tahap_lama', v_st_lama,
      'alasan',           trim(p_alasan)
    ),
    p_tenant_id
  );

  RETURN jsonb_build_object(
    'success',       true,
    'tahap_tujuan',  p_tahap_tujuan,
    'tahap_dihapus', to_jsonb(v_dihapus),
    'surat_jalan',   v_sj_info
  );
END;
$function$;


-- ── 3. koreksi_qty_berantai ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.koreksi_qty_berantai(
  p_bundle_id   uuid,
  p_tahap_mulai text,
  p_qty         integer,
  p_alasan      text,
  p_user_id     uuid,
  p_tenant_id   text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_order       text[] := ARRAY['cutting','jahit','lubang_kancing','buang_benang','qc','steam','packing'];
  v_bundle      RECORD;
  v_idx         INT;
  v_i           INT;
  v_t           TEXT;
  v_st          JSONB;
  v_st_lama     JSONB;
  v_info        JSONB;
  v_prev        JSONB;
  v_prev_qty    INT;
  v_lama        INT;
  v_lama_terima INT;
  v_lama_selesai INT;
  v_dasar       INT;
  v_susulan     INT;
  v_status_cut  TEXT;
  v_perubahan   JSONB := '[]'::JSONB;
  v_upah        RECORD;
  v_upah_info   JSONB := '[]'::JSONB;
  v_warn        JSONB := '[]'::JSONB;
  v_sji         RECORD;
  v_inv         RECORD;
  v_jml_bayar   INT;
  v_hasil       INT;
  v_kirim_total INT;
  v_kurangi     INT;
  v_baru        INT;
  v_sj_ids      UUID[] := ARRAY[]::UUID[];
  v_sj_id       UUID;
  v_sj_info     JSONB := '[]'::JSONB;
  v_sisa_item   INT;
  v_total_baru  NUMERIC;
  v_cap_sj      UUID;
BEGIN
  IF p_alasan IS NULL OR trim(p_alasan) = '' THEN
    RAISE EXCEPTION 'Alasan wajib diisi';
  END IF;
  IF p_qty IS NULL OR p_qty < 1 THEN
    RAISE EXCEPTION 'Qty minimal 1';
  END IF;

  v_idx := array_position(v_order, p_tahap_mulai);
  IF v_idx IS NULL THEN
    RAISE EXCEPTION 'Tahap tidak valid: %', p_tahap_mulai;
  END IF;

  SELECT b.id, b.barcode, b.po_id, b.status_tahap, pi.qty_per_bundle
  INTO v_bundle
  FROM bundle b
  JOIN po_item pi ON pi.id = b.po_item_id
  WHERE b.id = p_bundle_id AND b.tenant_id = p_tenant_id
  FOR UPDATE OF b;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bundle tidak ditemukan';
  END IF;

  v_st      := COALESCE(v_bundle.status_tahap, '{}'::jsonb);
  v_st_lama := v_st;

  IF NOT (v_st ? p_tahap_mulai) THEN
    RAISE EXCEPTION 'Bundle % belum sampai tahap %', v_bundle.barcode, p_tahap_mulai;
  END IF;

  IF EXISTS (SELECT 1 FROM bundle c WHERE c.parent_bundle_id = v_bundle.id
             AND c.barcode LIKE v_bundle.barcode || 'h%') THEN
    RAISE EXCEPTION 'Bundle % pernah di-Split — qty-nya terbagi ke bundle pecahan, koreksi per tahap saja', v_bundle.barcode;
  END IF;

  IF EXISTS (SELECT 1 FROM reject_log r WHERE r.bundle_id = v_bundle.id AND r.tenant_id = p_tenant_id) THEN
    RAISE EXCEPTION 'Bundle % punya catatan reject — qty-nya sengaja berkurang, koreksi per tahap saja', v_bundle.barcode;
  END IF;

  IF v_idx > 1 THEN
    v_prev := v_st -> v_order[v_idx - 1];
    v_prev_qty := CASE WHEN v_idx - 1 = 1
                       THEN (v_prev ->> 'qty_aktual')::int
                       ELSE COALESCE((v_prev ->> 'qty_selesai')::int, (v_prev ->> 'qty_terima')::int) END;
    IF v_prev_qty IS NOT NULL AND p_qty > v_prev_qty THEN
      RAISE EXCEPTION 'Qty % melebihi hasil tahap % (% pcs) — mulai koreksi dari tahap yang lebih awal',
        p_qty, v_order[v_idx - 1], v_prev_qty;
    END IF;
  END IF;

  -- Surat jalan harus masih bisa diubah
  FOR v_sji IN
    SELECT sji.sj_id, sji.qty_diterima, sj.nomor_sj
    FROM surat_jalan_item sji JOIN surat_jalan sj ON sj.id = sji.sj_id
    WHERE sji.bundle_id = v_bundle.id
  LOOP
    IF v_sji.qty_diterima IS NOT NULL THEN
      RAISE EXCEPTION 'Surat jalan % sudah divalidasi klien — tidak bisa diubah. Perbaiki lewat retur.', v_sji.nomor_sj;
    END IF;
    SELECT i.id, i.nomor_invoice, COALESCE(i.total_bayar, 0) AS total_bayar INTO v_inv
    FROM invoice i WHERE i.surat_jalan_id = v_sji.sj_id AND i.tenant_id = p_tenant_id LIMIT 1;
    IF FOUND THEN
      SELECT COUNT(*) INTO v_jml_bayar FROM invoice_pembayaran WHERE invoice_id = v_inv.id;
      IF v_jml_bayar > 0 OR v_inv.total_bayar > 0 THEN
        RAISE EXCEPTION 'Invoice % (surat jalan %) sudah menerima pembayaran — tidak bisa diubah.', v_inv.nomor_invoice, v_sji.nomor_sj;
      END IF;
    END IF;
  END LOOP;

  -- ── Tiap tahap dari tahap mulai ──
  FOR v_i IN v_idx .. array_length(v_order, 1) LOOP
    v_t := v_order[v_i];
    CONTINUE WHEN NOT (v_st ? v_t);
    v_info := v_st -> v_t;

    IF v_t = 'cutting' THEN
      v_lama := (v_info ->> 'qty_aktual')::int;
      CONTINUE WHEN v_lama IS NOT DISTINCT FROM p_qty;

      SELECT COALESCE(SUM((c.status_tahap->'cutting'->>'qty_aktual')::int), 0) INTO v_susulan
      FROM bundle c
      WHERE c.parent_bundle_id = v_bundle.id AND c.barcode LIKE v_bundle.barcode || 'c%';

      v_status_cut := CASE
        WHEN p_qty + v_susulan >= v_bundle.qty_per_bundle OR (v_info ? 'closed_at') THEN 'selesai'
        ELSE 'partial' END;

      v_info := v_info || jsonb_build_object('qty_aktual', p_qty, 'status', v_status_cut, 'updated_by', p_user_id);
      v_dasar := v_lama;
      v_perubahan := v_perubahan || jsonb_build_object('tahap', v_t, 'lama', v_lama, 'baru', p_qty, 'status', v_status_cut);
    ELSE
      v_lama_terima  := (v_info ->> 'qty_terima')::int;
      v_lama_selesai := (v_info ->> 'qty_selesai')::int;
      CONTINUE WHEN v_lama_terima IS NOT DISTINCT FROM p_qty
                AND ((v_info ->> 'status') <> 'selesai' OR v_lama_selesai IS NOT DISTINCT FROM p_qty);

      v_info := v_info || jsonb_build_object('qty_terima', p_qty, 'updated_by', p_user_id);
      IF (v_info ->> 'status') = 'selesai' THEN
        v_info := v_info || jsonb_build_object('qty_selesai', p_qty);
      END IF;

      IF v_lama_terima IS DISTINCT FROM p_qty THEN
        IF v_t = 'jahit' THEN
          v_warn := v_warn || _sesuaikan_aksesori_jahit(v_bundle.id, p_qty - COALESCE(v_lama_terima, 0), p_user_id, p_tenant_id);
        ELSE
          PERFORM _kembalikan_aksesori_tahap(v_bundle.id, v_bundle.po_id, v_t, p_tenant_id);
          PERFORM _pakai_aksesori_tahap(v_bundle.id, v_t, p_qty, p_user_id, p_tenant_id);
        END IF;
      END IF;

      v_dasar := COALESCE(v_lama_selesai, v_lama_terima);
      v_perubahan := v_perubahan || jsonb_build_object(
        'tahap', v_t, 'terima_lama', v_lama_terima, 'selesai_lama', v_lama_selesai, 'baru', p_qty);
    END IF;

    -- Upah tahap ini yang ber-sumber bundle (cutting, jahit, finishing lama)
    IF COALESCE(v_dasar, 0) > 0 THEN
      FOR v_upah IN
        SELECT id, total, status FROM gaji_ledger
        WHERE tenant_id = p_tenant_id AND sumber_id = v_bundle.id::text AND status <> 'cancelled'
          AND (keterangan = 'Upah ' || v_t || ' - ' || v_bundle.barcode
               -- entri tambahan dari koreksi_hasil_cutting: "... (koreksi +N pcs)"
               OR keterangan LIKE 'Upah ' || v_t || ' - ' || v_bundle.barcode || ' (koreksi%')
        FOR UPDATE
      LOOP
        UPDATE gaji_ledger SET total = round(v_upah.total * p_qty / v_dasar, 2) WHERE id = v_upah.id;
        v_upah_info := v_upah_info || jsonb_build_object(
          'tahap', v_t, 'status', v_upah.status, 'total_lama', v_upah.total,
          'total_baru', round(v_upah.total * p_qty / v_dasar, 2));
      END LOOP;
    END IF;

    UPDATE scan_log SET qty = p_qty WHERE bundle_id = v_bundle.id AND tahap::text = v_t;

    v_st := jsonb_set(v_st, ARRAY[v_t], v_info);
  END LOOP;

  UPDATE bundle SET status_tahap = v_st WHERE id = v_bundle.id;

  -- ── Pengiriman ──
  v_hasil := COALESCE((v_st -> 'packing' ->> 'qty_selesai')::int, NULL);
  SELECT COALESCE(SUM(qty_kirim), 0) INTO v_kirim_total FROM surat_jalan_item WHERE bundle_id = v_bundle.id;

  UPDATE bundle SET surat_jalan_id = NULL WHERE id = v_bundle.id;

  IF v_hasil IS NOT NULL AND v_kirim_total > v_hasil THEN
    v_kurangi := v_kirim_total - v_hasil;

    FOR v_sji IN
      SELECT sji.id, sji.sj_id, sji.qty_kirim, sj.nomor_sj
      FROM surat_jalan_item sji JOIN surat_jalan sj ON sj.id = sji.sj_id
      WHERE sji.bundle_id = v_bundle.id
      ORDER BY sji.created_at DESC
      FOR UPDATE OF sji
    LOOP
      EXIT WHEN v_kurangi <= 0;
      v_baru := GREATEST(v_sji.qty_kirim - v_kurangi, 0);
      v_kurangi := v_kurangi - (v_sji.qty_kirim - v_baru);

      IF v_baru = 0 THEN
        UPDATE gaji_ledger SET status = 'cancelled'
        WHERE tenant_id = p_tenant_id AND sumber_id = v_sji.id::text AND status <> 'cancelled';
        DELETE FROM surat_jalan_item WHERE id = v_sji.id;
      ELSE
        UPDATE surat_jalan_item SET qty_kirim = v_baru WHERE id = v_sji.id;
        UPDATE gaji_ledger SET total = round(total * v_baru / v_sji.qty_kirim, 2)
        WHERE tenant_id = p_tenant_id AND sumber_id = v_sji.id::text AND status <> 'cancelled';
      END IF;

      v_sj_ids := array_append(v_sj_ids, v_sji.sj_id);
      v_sj_info := v_sj_info || jsonb_build_object(
        'nomor_sj', v_sji.nomor_sj, 'qty_lama', v_sji.qty_kirim, 'qty_baru', v_baru);
    END LOOP;

    FOREACH v_sj_id IN ARRAY v_sj_ids LOOP
      SELECT COUNT(*) INTO v_sisa_item FROM surat_jalan_item WHERE sj_id = v_sj_id;
      SELECT i.id INTO v_inv FROM invoice i WHERE i.surat_jalan_id = v_sj_id AND i.tenant_id = p_tenant_id LIMIT 1;

      IF v_sisa_item = 0 THEN
        IF v_inv.id IS NOT NULL THEN DELETE FROM invoice WHERE id = v_inv.id; END IF;
        UPDATE bundle SET surat_jalan_id = NULL WHERE surat_jalan_id = v_sj_id AND tenant_id = p_tenant_id;
        DELETE FROM surat_jalan WHERE id = v_sj_id AND tenant_id = p_tenant_id;
        v_sj_info := v_sj_info || jsonb_build_object('sj_dihapus', v_sj_id);
      ELSE
        WITH bernomor AS (
          SELECT id, ROW_NUMBER() OVER (ORDER BY urutan NULLS LAST, id) AS n
          FROM surat_jalan_item WHERE sj_id = v_sj_id
        )
        UPDATE surat_jalan_item sji SET urutan = bernomor.n
        FROM bernomor WHERE bernomor.id = sji.id;

        IF v_inv.id IS NOT NULL THEN
          SELECT COALESCE(SUM(sji.qty_kirim * COALESCE(pr.harga_jual, 0)), 0)
          INTO v_total_baru
          FROM surat_jalan_item sji
          JOIN bundle b   ON b.id  = sji.bundle_id
          JOIN po_item pi ON pi.id = b.po_item_id
          JOIN produk pr  ON pr.id = pi.produk_id
          WHERE sji.sj_id = v_sj_id;
          UPDATE invoice SET total_nilai = v_total_baru WHERE id = v_inv.id;
        END IF;
      END IF;
    END LOOP;
  END IF;

  -- Penanda terkirim: sama dengan edit_surat_jalan — terkirim penuh bila
  -- total kirim sudah menutup hasil packing.
  SELECT COALESCE(SUM(qty_kirim), 0) INTO v_kirim_total FROM surat_jalan_item WHERE bundle_id = v_bundle.id;
  IF v_kirim_total > 0 AND v_kirim_total >= COALESCE(v_hasil, 0) THEN
    SELECT sj_id INTO v_cap_sj FROM surat_jalan_item
    WHERE bundle_id = v_bundle.id ORDER BY created_at DESC LIMIT 1;
    UPDATE bundle SET surat_jalan_id = v_cap_sj WHERE id = v_bundle.id;
  END IF;

  IF jsonb_array_length(v_perubahan) = 0 AND jsonb_array_length(v_sj_info) = 0 THEN
    RAISE EXCEPTION 'Tidak ada perubahan — semua qty sudah % pcs', p_qty;
  END IF;

  INSERT INTO audit_log (user_id, modul, aksi, target, metadata, tenant_id)
  VALUES (
    p_user_id, 'produksi', 'Koreksi Qty Berantai', v_bundle.barcode,
    jsonb_build_object(
      'bundle_id',         v_bundle.id,
      'tahap_mulai',       p_tahap_mulai,
      'qty_baru',          p_qty,
      'perubahan',         v_perubahan,
      'surat_jalan',       v_sj_info,
      'upah',              v_upah_info,
      'stok_warnings',     v_warn,
      'status_tahap_lama', v_st_lama,
      'alasan',            trim(p_alasan)
    ),
    p_tenant_id
  );

  RETURN jsonb_build_object(
    'success', true, 'perubahan', v_perubahan, 'surat_jalan', v_sj_info,
    'upah', v_upah_info, 'stok_warnings', v_warn);
END;
$function$;
