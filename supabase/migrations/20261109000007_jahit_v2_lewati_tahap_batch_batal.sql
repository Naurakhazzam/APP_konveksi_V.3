-- ════════════════════════════════════════════════════════════════════
-- Jahit v2: lewati tahap otomatis (dari HPP), batch atomik, batal
-- ════════════════════════════════════════════════════════════════════

-- 1. Apakah produk ini melewati tahap p_tahap?
--    Hanya Lubang Kancing & Steam. Dilewati bila baris upah tahap itu ADA
--    dan bernilai 0, DAN upah jahit terisi (> 0). Upah jahit 0 = HPP belum
--    lengkap → jangan dilewati (aman, perilaku lama).
CREATE OR REPLACE FUNCTION public.tahap_dilewati(p_produk_id uuid, p_tahap text)
RETURNS boolean
LANGUAGE sql STABLE
SET search_path TO 'public'
AS $$
  SELECT p_tahap IN ('lubang_kancing', 'steam')
    AND EXISTS (
      SELECT 1 FROM hpp_item hi JOIN hpp_komponen hk ON hk.id = hi.komponen_id
      WHERE hi.produk_id = p_produk_id AND hk.tahap_produksi::text = p_tahap)
    AND NOT EXISTS (
      SELECT 1 FROM hpp_item hi JOIN hpp_komponen hk ON hk.id = hi.komponen_id
      WHERE hi.produk_id = p_produk_id AND hk.tahap_produksi::text = p_tahap
        AND COALESCE(hi.harga_satuan, 0) > 0)
    AND EXISTS (
      SELECT 1 FROM hpp_item hi JOIN hpp_komponen hk ON hk.id = hi.komponen_id
      WHERE hi.produk_id = p_produk_id AND hk.tahap_produksi::text = 'jahit'
        AND COALESCE(hi.harga_satuan, 0) > 0);
$$;

-- 2. Trigger: begitu tahap sebelumnya berubah jadi 'selesai', tahap yang
--    dilewati langsung ditandai selesai (dilewati=true, tanpa upah/scan_log).
--    Semua antrian lama tetap bekerja karena tahap itu terlihat 'selesai'.
CREATE OR REPLACE FUNCTION public.trg_lewati_tahap_bundle()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_pasangan text[][] := ARRAY[ARRAY['jahit','lubang_kancing'], ARRAY['qc','steam']];
  v_i        int;
  v_prev     text;
  v_lewat    text;
  v_produk   uuid;
  v_qty      numeric;
BEGIN
  FOR v_i IN 1 .. array_length(v_pasangan, 1) LOOP
    v_prev  := v_pasangan[v_i][1];
    v_lewat := v_pasangan[v_i][2];
    IF (NEW.status_tahap -> v_prev ->> 'status') = 'selesai'
       AND (TG_OP = 'INSERT' OR COALESCE(OLD.status_tahap -> v_prev ->> 'status', '') <> 'selesai')
       AND NOT (NEW.status_tahap ? v_lewat) THEN
      IF v_produk IS NULL THEN
        SELECT produk_id INTO v_produk FROM po_item WHERE id = NEW.po_item_id;
      END IF;
      IF tahap_dilewati(v_produk, v_lewat) THEN
        v_qty := COALESCE((NEW.status_tahap -> v_prev ->> 'qty_selesai')::numeric,
                          (NEW.status_tahap -> v_prev ->> 'qty_terima')::numeric);
        NEW.status_tahap := jsonb_set(NEW.status_tahap, ARRAY[v_lewat], jsonb_build_object(
          'status', 'selesai', 'dilewati', true,
          'qty_terima', v_qty, 'qty_selesai', v_qty,
          'waktu_terima', now(), 'waktu_selesai', now(),
          'karyawan_id', NULL));
      END IF;
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_lewati_tahap_bundle ON public.bundle;
CREATE TRIGGER trg_lewati_tahap_bundle
  BEFORE INSERT OR UPDATE OF status_tahap ON public.bundle
  FOR EACH ROW EXECUTE FUNCTION public.trg_lewati_tahap_bundle();

-- 3. Serah terima jahit banyak bundle sekaligus (atomik).
--    p_items   : [{bundle_id, qty_selesai?, alasan_qty_id?}] — dipakai bila langsung selesai
--    p_benang  : [{inventory_item_id, qty}]
CREATE OR REPLACE FUNCTION public.jahit_serah_terima_batch(
  p_bundle_ids uuid[], p_karyawan_id uuid, p_langsung_selesai boolean,
  p_items jsonb, p_benang jsonb, p_user_id uuid, p_tenant_id text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_b        RECORD;
  v_res      jsonb;
  v_warn     jsonb := '[]'::jsonb;
  v_item     jsonb;
  v_qty      numeric;
  v_qty_sls  int;
  v_alasan   uuid;
  v_benang   jsonb;
  v_barcodes text[] := ARRAY[]::text[];
  v_n        int := 0;
  v_upah     numeric := 0;
BEGIN
  IF p_karyawan_id IS NULL THEN RAISE EXCEPTION 'Pilih penjahit dulu'; END IF;
  IF COALESCE(array_length(p_bundle_ids, 1), 0) = 0 THEN RAISE EXCEPTION 'Tidak ada bundle dipilih'; END IF;

  FOR v_b IN
    SELECT b.id, b.barcode, b.status_tahap, b.ditutup_at, pi.qty_per_bundle
    FROM bundle b JOIN po_item pi ON pi.id = b.po_item_id
    WHERE b.id = ANY(p_bundle_ids) AND b.tenant_id = p_tenant_id
    ORDER BY b.barcode
    FOR UPDATE OF b
  LOOP
    IF v_b.ditutup_at IS NOT NULL THEN
      RAISE EXCEPTION 'Bundle % sudah ditutup (data lama)', v_b.barcode;
    END IF;
    v_qty := COALESCE((v_b.status_tahap -> 'cutting' ->> 'qty_aktual')::numeric, v_b.qty_per_bundle);

    v_res := scan_jahit_terima(v_b.barcode, p_karyawan_id, v_qty, p_user_id, p_tenant_id);
    v_warn := v_warn || COALESCE(v_res -> 'stok_warnings', '[]'::jsonb);

    IF p_langsung_selesai THEN
      SELECT e INTO v_item FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb)) e
      WHERE (e ->> 'bundle_id')::uuid = v_b.id LIMIT 1;
      v_qty_sls := COALESCE((v_item ->> 'qty_selesai')::int, v_qty::int);
      v_alasan  := NULLIF(v_item ->> 'alasan_qty_id', '')::uuid;
      IF v_qty_sls < 1 THEN RAISE EXCEPTION 'Qty selesai % minimal 1', v_b.barcode; END IF;
      IF v_qty_sls > v_qty THEN
        RAISE EXCEPTION 'Qty selesai % (%) melebihi qty diterima (%)', v_b.barcode, v_qty_sls, v_qty;
      END IF;
      v_res := scan_selesai(v_b.barcode, 'jahit'::tahap_produksi, p_karyawan_id, v_qty_sls,
                            NULL, v_alasan, p_user_id, p_tenant_id);
      v_upah := v_upah + COALESCE((v_res ->> 'upah_nominal')::numeric, 0);
    END IF;

    v_barcodes := array_append(v_barcodes, v_b.barcode);
    v_n := v_n + 1;
  END LOOP;

  IF v_n <> array_length(p_bundle_ids, 1) THEN
    RAISE EXCEPTION 'Sebagian bundle tidak ditemukan';
  END IF;

  FOR v_benang IN SELECT * FROM jsonb_array_elements(COALESCE(p_benang, '[]'::jsonb)) LOOP
    IF COALESCE((v_benang ->> 'qty')::numeric, 0) > 0 THEN
      PERFORM catat_benang_serah_terima(
        p_karyawan_id, (v_benang ->> 'inventory_item_id')::uuid, (v_benang ->> 'qty')::numeric,
        CURRENT_DATE, to_jsonb(p_bundle_ids),
        'Serah terima jahit – ' || array_to_string(v_barcodes, ', '),
        p_user_id, p_tenant_id);
    END IF;
  END LOOP;

  RETURN jsonb_build_object('jumlah', v_n, 'stok_warnings', v_warn, 'upah_total', v_upah);
END;
$$;

-- 4. Selesaikan jahit banyak bundle sekaligus (atomik).
--    p_items: [{bundle_id, qty, alasan_qty_id?, catatan?}]
CREATE OR REPLACE FUNCTION public.jahit_selesai_batch(p_items jsonb, p_user_id uuid, p_tenant_id text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_item  jsonb;
  v_b     RECORD;
  v_res   jsonb;
  v_n     int := 0;
  v_lebih int := 0;
BEGIN
  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb)) LOOP
    SELECT b.id, b.barcode, b.status_tahap INTO v_b
    FROM bundle b WHERE b.id = (v_item ->> 'bundle_id')::uuid AND b.tenant_id = p_tenant_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Bundle tidak ditemukan'; END IF;
    IF NULLIF(v_b.status_tahap -> 'jahit' ->> 'karyawan_id', '') IS NULL THEN
      RAISE EXCEPTION 'Bundle % belum punya penjahit', v_b.barcode;
    END IF;
    v_res := scan_selesai(v_b.barcode, 'jahit'::tahap_produksi,
                          (v_b.status_tahap -> 'jahit' ->> 'karyawan_id')::uuid,
                          (v_item ->> 'qty')::int, NULLIF(v_item ->> 'catatan', ''),
                          NULLIF(v_item ->> 'alasan_qty_id', '')::uuid, p_user_id, p_tenant_id);
    IF (v_res ->> 'is_qty_lebih')::boolean THEN v_lebih := v_lebih + 1; END IF;
    v_n := v_n + 1;
  END LOOP;
  IF v_n = 0 THEN RAISE EXCEPTION 'Tidak ada bundle dipilih'; END IF;
  RETURN jsonb_build_object('jumlah', v_n, 'qty_lebih', v_lebih);
END;
$$;

-- 5. Batalkan, mundur satu langkah (atomik).
--    p_mode 'serah_terima' : Sedang Dijahit → Antrian
--    p_mode 'selesai'      : Selesai        → Sedang Dijahit
CREATE OR REPLACE FUNCTION public.jahit_batal_batch(
  p_bundle_ids uuid[], p_mode text, p_alasan text, p_user_id uuid, p_tenant_id text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_order text[] := ARRAY['lubang_kancing','buang_benang','qc','steam','packing'];
  v_b     RECORD;
  v_t     text;
  v_n     int := 0;
BEGIN
  IF p_mode NOT IN ('serah_terima', 'selesai') THEN RAISE EXCEPTION 'Mode batal tidak valid'; END IF;
  IF p_alasan IS NULL OR trim(p_alasan) = '' THEN RAISE EXCEPTION 'Alasan wajib diisi'; END IF;

  FOR v_b IN
    SELECT b.id, b.barcode, b.status_tahap FROM bundle b
    WHERE b.id = ANY(p_bundle_ids) AND b.tenant_id = p_tenant_id
    ORDER BY b.barcode FOR UPDATE OF b
  LOOP
    IF p_mode = 'serah_terima' THEN
      IF COALESCE(v_b.status_tahap -> 'jahit' ->> 'status', '') <> 'terima' THEN
        RAISE EXCEPTION 'Bundle % tidak sedang dijahit', v_b.barcode;
      END IF;
      -- Dibalik manual (bukan kembalikan_tahap_bundle) karena pengaman
      -- Split di sana menolak induk Split-Awal, padahal aman di sini.
      PERFORM _sesuaikan_aksesori_jahit(v_b.id,
        -COALESCE((v_b.status_tahap -> 'jahit' ->> 'qty_terima')::numeric, 0), p_user_id, p_tenant_id);
      UPDATE qty_approval_request SET scan_log_id = NULL
      WHERE scan_log_id IN (SELECT id FROM scan_log WHERE bundle_id = v_b.id AND tahap = 'jahit');
      DELETE FROM qty_approval_request
      WHERE bundle_id = v_b.id AND tahap = 'jahit' AND status = 'pending' AND tenant_id = p_tenant_id;
      DELETE FROM scan_log WHERE bundle_id = v_b.id AND tahap = 'jahit';
      UPDATE bundle SET status_tahap = status_tahap - 'jahit' WHERE id = v_b.id;
      INSERT INTO audit_log (user_id, modul, aksi, target, metadata, tenant_id)
      VALUES (p_user_id, 'produksi', 'Batal Serah Terima Jahit', v_b.barcode,
        jsonb_build_object('bundle_id', v_b.id, 'jahit_lama', v_b.status_tahap -> 'jahit', 'alasan', trim(p_alasan)),
        p_tenant_id);
    ELSE
      IF COALESCE(v_b.status_tahap -> 'jahit' ->> 'status', '') <> 'selesai' THEN
        RAISE EXCEPTION 'Bundle % belum selesai jahit', v_b.barcode;
      END IF;
      FOREACH v_t IN ARRAY v_order LOOP
        IF (v_b.status_tahap ? v_t)
           AND COALESCE((v_b.status_tahap -> v_t ->> 'dilewati')::boolean, false) = false THEN
          RAISE EXCEPTION 'Bundle % sudah masuk tahap % — batalkan dulu dari menu tahap itu (atau Lacak Barcode)',
            v_b.barcode, initcap(replace(v_t, '_', ' '));
        END IF;
      END LOOP;
      IF EXISTS (
        SELECT 1 FROM gaji_ledger gl
        WHERE gl.tenant_id = p_tenant_id AND gl.sumber_id = v_b.id::text
          AND gl.keterangan = 'Upah jahit - ' || v_b.barcode
          AND gl.status IN ('lunas', 'escrow')) THEN
        RAISE EXCEPTION 'Upah jahit bundle % sudah dibayar — tidak bisa dibatalkan', v_b.barcode;
      END IF;
      PERFORM kembalikan_tahap_bundle(v_b.id, 'jahit', 'Batal selesai jahit: ' || trim(p_alasan), p_user_id, p_tenant_id);
    END IF;
    v_n := v_n + 1;
  END LOOP;

  IF v_n <> COALESCE(array_length(p_bundle_ids, 1), 0) OR v_n = 0 THEN
    RAISE EXCEPTION 'Sebagian bundle tidak ditemukan';
  END IF;
  RETURN jsonb_build_object('jumlah', v_n);
END;
$$;
