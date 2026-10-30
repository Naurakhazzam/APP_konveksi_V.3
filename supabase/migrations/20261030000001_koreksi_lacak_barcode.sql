-- ================================================================
-- MIGRATION: Koreksi bundle dari tab Lacak Barcode
--
-- Konteks: beberapa PO punya selisih qty yang tidak bisa dibetulkan di
-- sistem karena memang tidak ada jalan mundurnya, misalnya:
--   - Sisa cutting partial ter-"Tutup" padahal sebenarnya masih akan
--     dipotong (PO-0076/0078/0080/0089, 38 pcs) — bundle hilang dari
--     Pending Cutting sehingga Lanjut Cutting tidak bisa dipakai.
--   - Qty salah ketik di salah satu tahap lalu bundle sudah lanjut,
--     bahkan sudah terkirim.
--
-- Fungsi baru (semua wajib alasan dan tercatat di audit_log, yang
-- ditampilkan sebagai timeline di Lacak Barcode):
--   1. buka_kembali_cutting   — batalkan "Tutup" cutting: status kembali
--      'partial' sehingga sisa muncul lagi di Pending Cutting dan bisa
--      dilanjutkan jadi bundle susulan (…c1).
--   2. kembalikan_tahap_bundle — mundurkan bundle ke tahap X (jahit s/d
--      packing) sebagai "sedang dikerjakan", walau sudah terkirim:
--        - tahap sesudah X dihapus, X kembali ke status 'terima'
--        - scan_log tahap yang dihapus ikut dihapus (snapshot disimpan
--          di audit_log) supaya scan ulang tidak terhitung dobel
--        - aksesori tahap yang dihapus dikembalikan ke stok
--        - bundle dikeluarkan dari surat jalan; invoice dihitung ulang,
--          SJ yang jadi kosong dihapus beserta invoicenya. Ditolak kalau
--          klien sudah validasi / invoice sudah dibayar / ada reject.
--        - upah tahap yang dibatalkan → 'cancelled' APA PUN statusnya
--          (termasuk 'lunas'). Keputusan owner: pembayaran riil selalu
--          mengikuti kondisi nyata, bukan angka sistem, jadi tidak ada
--          potongan. Upah terbentuk lagi saat tahap dikerjakan ulang.
--   3. koreksi_qty_tahap — betulkan qty terima/selesai satu tahap
--      (jahit: qty selesai saja; finishing: terima & selesai) untuk
--      bundle yang belum dikirim. Upah tahap itu ikut disesuaikan
--      proporsional, aksesori tahap itu dihitung ulang.
--
-- Perubahan fungsi lama:
--   - close_bundle_cutting menerima p_alasan dan mencatat audit_log,
--     supaya "Tutup" tidak lagi hilang tanpa jejak.
-- ================================================================


-- ── Helper: kembalikan seluruh aksesori satu tahap ke stok ──────────
-- Kebalikan scan_terima_generic: stok_aktual naik, jurnal biaya
-- aksesori tahap itu untuk PO ini dikurangi, baris pemakaian dihapus.
CREATE OR REPLACE FUNCTION public._kembalikan_aksesori_tahap(
  p_bundle_id uuid,
  p_po_id     uuid,
  p_tahap     text,
  p_tenant_id text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_pakai  RECORD;
  v_jurnal RECORD;
  v_sisa   NUMERIC;
  v_ambil  NUMERIC;
BEGIN
  FOR v_pakai IN
    SELECT id, inventory_item_id, qty_pakai
    FROM pemakaian_aksesori
    WHERE bundle_id = p_bundle_id AND tahap::text = p_tahap
    FOR UPDATE
  LOOP
    IF COALESCE(v_pakai.qty_pakai, 0) > 0 THEN
      UPDATE inventory_item
      SET stok_aktual = stok_aktual + v_pakai.qty_pakai
      WHERE id = v_pakai.inventory_item_id AND tenant_id = p_tenant_id;

      v_sisa := v_pakai.qty_pakai;
      FOR v_jurnal IN
        SELECT id, qty, nominal
        FROM jurnal_entry
        WHERE tenant_id = p_tenant_id AND jenis = 'direct_bahan'
          AND inventory_item_id = v_pakai.inventory_item_id
          AND tag_po_ids @> jsonb_build_array(p_po_id::text)
          AND keterangan LIKE ('Pemakaian aksesori ' || p_tahap || ':%')
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
    END IF;

    DELETE FROM pemakaian_aksesori WHERE id = v_pakai.id;
  END LOOP;
END;
$function$;


-- ── Helper: pakai aksesori satu tahap (rumus scan_terima_generic) ───
CREATE OR REPLACE FUNCTION public._pakai_aksesori_tahap(
  p_bundle_id uuid,
  p_tahap     text,
  p_qty       numeric,
  p_user_id   uuid,
  p_tenant_id text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_bundle      RECORD;
  v_aksesori    RECORD;
  v_qty_deduct  NUMERIC;
  v_kategori_id UUID;
  v_nominal     NUMERIC;
BEGIN
  IF COALESCE(p_qty, 0) <= 0 THEN RETURN; END IF;

  SELECT b.id, mp.id AS model_id, pi.po_id
  INTO v_bundle
  FROM bundle b
  JOIN po_item pi      ON pi.id = b.po_item_id
  JOIN produk p        ON p.id  = pi.produk_id
  JOIN model_produk mp ON mp.id = p.model_id
  WHERE b.id = p_bundle_id AND b.tenant_id = p_tenant_id;

  IF NOT FOUND THEN RETURN; END IF;

  SELECT id INTO v_kategori_id
  FROM kategori_trx
  WHERE jenis = 'direct_bahan' AND aktif = TRUE AND tenant_id = p_tenant_id
  LIMIT 1;

  FOR v_aksesori IN
    SELECT ma.inventory_item_id, ma.qty_per_pcs, ii.harga_referensi, ii.nama AS item_nama
    FROM model_aksesori ma
    JOIN inventory_item ii ON ii.id = ma.inventory_item_id
    WHERE ma.model_id = v_bundle.model_id AND ma.tahap_pakai::text = p_tahap
      AND ma.tenant_id = p_tenant_id
  LOOP
    v_qty_deduct := v_aksesori.qty_per_pcs * p_qty;

    UPDATE inventory_item SET stok_aktual = stok_aktual - v_qty_deduct
    WHERE id = v_aksesori.inventory_item_id;

    INSERT INTO pemakaian_aksesori (bundle_id, inventory_item_id, qty_pakai, tahap, tenant_id)
    VALUES (p_bundle_id, v_aksesori.inventory_item_id, v_qty_deduct, p_tahap::tahap_produksi, p_tenant_id)
    ON CONFLICT (bundle_id, inventory_item_id, tahap)
    DO UPDATE SET qty_pakai = pemakaian_aksesori.qty_pakai + EXCLUDED.qty_pakai;

    v_nominal := v_qty_deduct * v_aksesori.harga_referensi;
    IF v_kategori_id IS NOT NULL AND v_bundle.po_id IS NOT NULL AND v_nominal > 0 THEN
      INSERT INTO jurnal_entry (
        kategori_trx_id, jenis, nominal, tanggal, no_faktur,
        keterangan, qty, inventory_item_id, tag_po_ids, tenant_id, created_by
      ) VALUES (
        v_kategori_id, 'direct_bahan', v_nominal, CURRENT_DATE,
        'AUTO-AKS-' || to_char(CURRENT_DATE, 'YYYYMMDD'),
        'Pemakaian aksesori ' || p_tahap || ': ' || v_aksesori.item_nama,
        v_qty_deduct, v_aksesori.inventory_item_id,
        jsonb_build_array(v_bundle.po_id::TEXT), p_tenant_id, p_user_id
      );
    END IF;
  END LOOP;
END;
$function$;


-- ── 1. close_bundle_cutting: wajib jejak ────────────────────────────
DROP FUNCTION IF EXISTS public.close_bundle_cutting(uuid, uuid, text);

CREATE OR REPLACE FUNCTION public.close_bundle_cutting(
  p_bundle_id uuid,
  p_user_id   uuid,
  p_tenant_id text,
  p_alasan    text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_bundle    RECORD;
  v_terpotong INT;
BEGIN
  SELECT b.id, b.barcode, b.status_tahap, pi.qty_per_bundle
  INTO v_bundle
  FROM bundle b
  JOIN po_item pi ON pi.id = b.po_item_id
  WHERE b.id = p_bundle_id AND b.tenant_id = p_tenant_id
    AND b.status_tahap->'cutting'->>'status' = 'partial'
  FOR UPDATE OF b;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', true);
  END IF;

  SELECT COALESCE((v_bundle.status_tahap->'cutting'->>'qty_dipotong')::int,
                  (v_bundle.status_tahap->'cutting'->>'qty_aktual')::int, 0)
         + COALESCE((
             SELECT SUM(COALESCE((c.status_tahap->'cutting'->>'qty_aktual')::int, 0))
             FROM bundle c
             WHERE c.parent_bundle_id = v_bundle.id AND c.tenant_id = p_tenant_id
               AND c.barcode LIKE v_bundle.barcode || 'c%'
           ), 0)
  INTO v_terpotong;

  UPDATE bundle
  SET status_tahap = jsonb_set(
    status_tahap,
    '{cutting}',
    status_tahap->'cutting' || jsonb_build_object(
      'status', 'selesai',
      'closed_at', now(),
      'closed_by', p_user_id,
      'closed_alasan', NULLIF(trim(COALESCE(p_alasan, '')), '')
    )
  )
  WHERE id = v_bundle.id;

  INSERT INTO audit_log (user_id, modul, aksi, target, metadata, tenant_id)
  VALUES (
    p_user_id, 'produksi', 'Tutup Sisa Cutting', v_bundle.barcode,
    jsonb_build_object(
      'bundle_id',   v_bundle.id,
      'qty_rencana', v_bundle.qty_per_bundle,
      'qty_dipotong', v_terpotong,
      'sisa_ditutup', GREATEST(v_bundle.qty_per_bundle - v_terpotong, 0),
      'alasan',      NULLIF(trim(COALESCE(p_alasan, '')), '')
    ),
    p_tenant_id
  );

  RETURN jsonb_build_object('success', true);
END;
$function$;


-- ── 2. buka_kembali_cutting ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.buka_kembali_cutting(
  p_bundle_id uuid,
  p_alasan    text,
  p_user_id   uuid,
  p_tenant_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_bundle    RECORD;
  v_cutting   JSONB;
  v_terpotong INT;
  v_sisa      INT;
BEGIN
  IF p_alasan IS NULL OR trim(p_alasan) = '' THEN
    RAISE EXCEPTION 'Alasan wajib diisi';
  END IF;

  SELECT b.id, b.barcode, b.parent_bundle_id, b.status_tahap, pi.qty_per_bundle
  INTO v_bundle
  FROM bundle b
  JOIN po_item pi ON pi.id = b.po_item_id
  WHERE b.id = p_bundle_id AND b.tenant_id = p_tenant_id
  FOR UPDATE OF b;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bundle tidak ditemukan';
  END IF;

  v_cutting := v_bundle.status_tahap -> 'cutting';

  IF v_bundle.parent_bundle_id IS NOT NULL THEN
    RAISE EXCEPTION 'Bundle % adalah bundle pecahan/susulan — buka kembali cutting dari bundle induknya', v_bundle.barcode;
  END IF;
  IF (v_cutting ->> 'status') IS DISTINCT FROM 'selesai' THEN
    RAISE EXCEPTION 'Cutting bundle % tidak berstatus selesai — tidak ada yang perlu dibuka', v_bundle.barcode;
  END IF;

  SELECT COALESCE((v_cutting->>'qty_dipotong')::int, (v_cutting->>'qty_aktual')::int, 0)
         + COALESCE((
             SELECT SUM(COALESCE((c.status_tahap->'cutting'->>'qty_aktual')::int, 0))
             FROM bundle c
             WHERE c.parent_bundle_id = v_bundle.id AND c.tenant_id = p_tenant_id
               AND c.barcode LIKE v_bundle.barcode || 'c%'
           ), 0)
  INTO v_terpotong;

  v_sisa := v_bundle.qty_per_bundle - v_terpotong;
  IF v_sisa <= 0 THEN
    RAISE EXCEPTION 'Bundle % sudah terpotong penuh (% dari rencana % pcs) — tidak ada sisa untuk dilanjutkan',
      v_bundle.barcode, v_terpotong, v_bundle.qty_per_bundle;
  END IF;

  UPDATE bundle
  SET status_tahap = jsonb_set(
    status_tahap,
    '{cutting}',
    (status_tahap->'cutting') - 'closed_at' - 'closed_by' - 'closed_alasan'
      || jsonb_build_object(
           'status',             'partial',
           'dibuka_kembali_at',  now(),
           'dibuka_kembali_by',  p_user_id
         )
  )
  WHERE id = v_bundle.id;

  INSERT INTO audit_log (user_id, modul, aksi, target, metadata, tenant_id)
  VALUES (
    p_user_id, 'produksi', 'Buka Kembali Cutting', v_bundle.barcode,
    jsonb_build_object(
      'bundle_id',     v_bundle.id,
      'qty_rencana',   v_bundle.qty_per_bundle,
      'qty_dipotong',  v_terpotong,
      'sisa',          v_sisa,
      'closed_at_lama', v_cutting->>'closed_at',
      'closed_by_lama', v_cutting->>'closed_by',
      'alasan',        trim(p_alasan)
    ),
    p_tenant_id
  );

  RETURN jsonb_build_object('success', true, 'sisa', v_sisa, 'qty_dipotong', v_terpotong);
END;
$function$;


-- ── 3. kembalikan_tahap_bundle ──────────────────────────────────────
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
  IF v_idx_tujuan IS NULL OR v_idx_tujuan < 2 THEN
    RAISE EXCEPTION 'Tahap tujuan tidak valid: % (pilih Jahit s/d Packing)', p_tahap_tujuan;
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

  -- Tahap yang dihapus = semua tahap sesudah tujuan yang sudah tersentuh
  FOR v_i IN (v_idx_tujuan + 1) .. array_length(v_order, 1) LOOP
    IF v_st ? v_order[v_i] THEN
      v_dihapus := array_append(v_dihapus, v_order[v_i]);
    END IF;
  END LOOP;

  v_tujuan_selesai := (v_st -> p_tahap_tujuan ->> 'status') = 'selesai';

  IF array_length(v_dihapus, 1) IS NULL AND NOT v_tujuan_selesai
     AND NOT EXISTS (SELECT 1 FROM surat_jalan_item WHERE bundle_id = v_bundle.id) THEN
    RAISE EXCEPTION 'Bundle % sudah berada di tahap % (sedang dikerjakan) — tidak ada yang perlu dikembalikan', v_bundle.barcode, p_tahap_tujuan;
  END IF;

  -- Bundle pecahan (Split) yang lahir di tahap sesudah tujuan: qty induk
  -- di tahap itu sudah dibagi ke pecahannya, mundur melewatinya akan
  -- membuat qty dobel.
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

  -- Reject yang sudah tercatat di tahap yang dihapus / di pengiriman
  IF EXISTS (
    SELECT 1 FROM reject_log r
    WHERE r.bundle_id = v_bundle.id AND r.tenant_id = p_tenant_id
      AND (r.surat_jalan_id IS NOT NULL OR r.tahap_ditemukan = ANY(v_dihapus))
  ) THEN
    RAISE EXCEPTION 'Bundle % punya catatan reject di tahap yang mau dibatalkan/pengiriman — selesaikan dulu di menu Reject', v_bundle.barcode;
  END IF;

  -- ── Cek pengiriman dulu (semua atau tidak sama sekali) ──
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

  -- ── Tarik dari surat jalan ──
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

  -- ── Upah tahap yang dibatalkan (sumber = bundle) ──
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

  -- ── scan_log: hapus baris tahap yang dibatalkan (snapshot ke audit) ──
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'tahap', s.tahap, 'tipe', s.tipe, 'qty', s.qty, 'karyawan_id', s.karyawan_id,
           'user_id', s.user_id, 'created_at', s.created_at) ORDER BY s.created_at), '[]'::jsonb)
  INTO v_scan_hapus
  FROM scan_log s
  WHERE s.bundle_id = v_bundle.id
    AND (s.tahap::text = ANY(v_dihapus)
         OR (v_tujuan_selesai AND s.tahap::text = p_tahap_tujuan AND s.tipe = 'selesai'));

  -- Permintaan approval qty lebih yang sudah diputus tetap disimpan,
  -- hanya kaitannya ke baris scan_log yang dilepas (FK tidak cascade).
  UPDATE qty_approval_request q SET scan_log_id = NULL
  FROM scan_log s
  WHERE q.scan_log_id = s.id AND s.bundle_id = v_bundle.id
    AND (s.tahap::text = ANY(v_dihapus)
         OR (v_tujuan_selesai AND s.tahap::text = p_tahap_tujuan AND s.tipe = 'selesai'));

  DELETE FROM scan_log s
  WHERE s.bundle_id = v_bundle.id
    AND (s.tahap::text = ANY(v_dihapus)
         OR (v_tujuan_selesai AND s.tahap::text = p_tahap_tujuan AND s.tipe = 'selesai'));

  -- ── Aksesori tahap yang dihapus kembali ke stok ──
  FOREACH v_tahap IN ARRAY v_dihapus LOOP
    PERFORM _kembalikan_aksesori_tahap(v_bundle.id, v_bundle.po_id, v_tahap, p_tenant_id);
  END LOOP;

  -- ── Status tahap ──
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


-- ── 4. koreksi_qty_tahap ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.koreksi_qty_tahap(
  p_bundle_id   uuid,
  p_tahap       text,
  p_qty_terima  integer,
  p_qty_selesai integer,
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
  v_order        text[] := ARRAY['cutting','jahit','lubang_kancing','buang_benang','qc','steam','packing'];
  v_bundle       RECORD;
  v_idx          INT;
  v_info         JSONB;
  v_prev         JSONB;
  v_next         JSONB;
  v_prev_qty     INT;
  v_terima_lama  INT;
  v_selesai_lama INT;
  v_status       TEXT;
  v_upah         RECORD;
  v_upah_info    JSONB := '[]'::JSONB;
  v_total_baru   NUMERIC;
BEGIN
  IF p_alasan IS NULL OR trim(p_alasan) = '' THEN
    RAISE EXCEPTION 'Alasan wajib diisi';
  END IF;

  v_idx := array_position(v_order, p_tahap);
  IF v_idx IS NULL OR v_idx < 2 THEN
    RAISE EXCEPTION 'Tahap tidak valid: % (pilih Jahit s/d Packing)', p_tahap;
  END IF;

  SELECT b.id, b.barcode, b.po_id, b.status_tahap
  INTO v_bundle
  FROM bundle b
  WHERE b.id = p_bundle_id AND b.tenant_id = p_tenant_id
  FOR UPDATE OF b;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bundle tidak ditemukan';
  END IF;

  IF EXISTS (SELECT 1 FROM surat_jalan_item WHERE bundle_id = v_bundle.id) THEN
    RAISE EXCEPTION 'Bundle % sudah masuk surat jalan — pakai "Kembalikan ke Tahap" dulu supaya surat jalan & invoice ikut dibetulkan', v_bundle.barcode;
  END IF;

  v_info := v_bundle.status_tahap -> p_tahap;
  IF v_info IS NULL THEN
    RAISE EXCEPTION 'Bundle % belum sampai tahap %', v_bundle.barcode, p_tahap;
  END IF;

  v_status       := v_info ->> 'status';
  v_terima_lama  := (v_info ->> 'qty_terima')::int;
  v_selesai_lama := (v_info ->> 'qty_selesai')::int;

  IF p_qty_terima IS NULL OR p_qty_terima < 1 THEN
    RAISE EXCEPTION 'Qty terima minimal 1';
  END IF;

  IF p_tahap = 'jahit' AND p_qty_terima IS DISTINCT FROM v_terima_lama THEN
    RAISE EXCEPTION 'Qty terima Jahit dibetulkan lewat Koreksi Serah Terima (stok aksesori jahit ikut disesuaikan)';
  END IF;

  IF v_status = 'selesai' THEN
    IF p_qty_selesai IS NULL OR p_qty_selesai < 1 THEN
      RAISE EXCEPTION 'Qty selesai minimal 1';
    END IF;
    IF p_qty_selesai > p_qty_terima THEN
      RAISE EXCEPTION 'Qty selesai (%) tidak boleh melebihi qty terima (%)', p_qty_selesai, p_qty_terima;
    END IF;
  ELSIF p_qty_selesai IS NOT NULL THEN
    RAISE EXCEPTION 'Tahap % belum selesai — hanya qty terima yang bisa dibetulkan', p_tahap;
  END IF;

  -- Batas atas: hasil tahap sebelumnya
  v_prev := v_bundle.status_tahap -> v_order[v_idx - 1];
  IF v_idx - 1 = 1 THEN
    v_prev_qty := COALESCE((v_prev ->> 'qty_aktual')::int, NULL);
  ELSE
    v_prev_qty := COALESCE((v_prev ->> 'qty_selesai')::int, (v_prev ->> 'qty_terima')::int);
  END IF;
  IF p_tahap <> 'jahit' AND v_prev_qty IS NOT NULL AND p_qty_terima > v_prev_qty THEN
    RAISE EXCEPTION 'Qty terima % (%) melebihi hasil tahap sebelumnya (% pcs) — betulkan tahap sebelumnya dulu',
      p_tahap, p_qty_terima, v_prev_qty;
  END IF;

  -- Batas bawah: tahap sesudahnya tidak boleh menerima lebih dari hasil ini
  IF v_idx < array_length(v_order, 1) THEN
    v_next := v_bundle.status_tahap -> v_order[v_idx + 1];
    IF v_next IS NOT NULL
       AND (v_next ->> 'qty_terima')::int > COALESCE(p_qty_selesai, p_qty_terima) THEN
      RAISE EXCEPTION 'Tahap % sudah menerima % pcs — hasil % tidak boleh lebih kecil dari itu. Betulkan tahap % dulu.',
        v_order[v_idx + 1], (v_next ->> 'qty_terima')::int, p_tahap, v_order[v_idx + 1];
    END IF;
  END IF;

  IF p_qty_terima IS NOT DISTINCT FROM v_terima_lama
     AND p_qty_selesai IS NOT DISTINCT FROM v_selesai_lama THEN
    RAISE EXCEPTION 'Tidak ada perubahan';
  END IF;

  -- Status tahap
  v_info := v_info || jsonb_build_object('qty_terima', p_qty_terima, 'updated_by', p_user_id);
  IF v_status = 'selesai' THEN
    v_info := v_info || jsonb_build_object('qty_selesai', p_qty_selesai);
  END IF;

  UPDATE bundle
  SET status_tahap = jsonb_set(status_tahap, ARRAY[p_tahap], v_info)
  WHERE id = v_bundle.id;

  -- scan_log ikut dibetulkan supaya monitoring/kroscek membaca qty benar
  IF p_qty_terima IS DISTINCT FROM v_terima_lama THEN
    UPDATE scan_log SET qty = p_qty_terima
    WHERE id = (SELECT id FROM scan_log WHERE bundle_id = v_bundle.id AND tahap::text = p_tahap
                AND tipe = 'terima' ORDER BY created_at DESC LIMIT 1);

    -- Aksesori tahap ini dihitung ulang dengan qty baru
    PERFORM _kembalikan_aksesori_tahap(v_bundle.id, v_bundle.po_id, p_tahap, p_tenant_id);
    PERFORM _pakai_aksesori_tahap(v_bundle.id, p_tahap, p_qty_terima, p_user_id, p_tenant_id);
  END IF;

  IF v_status = 'selesai' AND p_qty_selesai IS DISTINCT FROM v_selesai_lama THEN
    UPDATE scan_log SET qty = p_qty_selesai
    WHERE id = (SELECT id FROM scan_log WHERE bundle_id = v_bundle.id AND tahap::text = p_tahap
                AND tipe = 'selesai' ORDER BY created_at DESC LIMIT 1);

    -- Upah tahap ini (sumber = bundle) disesuaikan proporsional, apa pun
    -- statusnya — pembayaran riil mengikuti kondisi nyata.
    FOR v_upah IN
      SELECT id, total, status FROM gaji_ledger
      WHERE tenant_id = p_tenant_id AND sumber_id = v_bundle.id::text AND status <> 'cancelled'
        AND keterangan = 'Upah ' || p_tahap || ' - ' || v_bundle.barcode
      FOR UPDATE
    LOOP
      IF COALESCE(v_selesai_lama, 0) > 0 THEN
        v_total_baru := round(v_upah.total * p_qty_selesai / v_selesai_lama, 2);
        UPDATE gaji_ledger SET total = v_total_baru WHERE id = v_upah.id;
        v_upah_info := v_upah_info || jsonb_build_object(
          'id', v_upah.id, 'status', v_upah.status, 'total_lama', v_upah.total, 'total_baru', v_total_baru);
      END IF;
    END LOOP;
  END IF;

  INSERT INTO audit_log (user_id, modul, aksi, target, metadata, tenant_id)
  VALUES (
    p_user_id, 'produksi', 'Koreksi Qty Tahap', v_bundle.barcode,
    jsonb_build_object(
      'bundle_id',        v_bundle.id,
      'tahap',            p_tahap,
      'qty_terima_lama',  v_terima_lama,
      'qty_terima_baru',  p_qty_terima,
      'qty_selesai_lama', v_selesai_lama,
      'qty_selesai_baru', p_qty_selesai,
      'upah',             v_upah_info,
      'alasan',           trim(p_alasan)
    ),
    p_tenant_id
  );

  RETURN jsonb_build_object('success', true, 'upah', v_upah_info);
END;
$function$;
