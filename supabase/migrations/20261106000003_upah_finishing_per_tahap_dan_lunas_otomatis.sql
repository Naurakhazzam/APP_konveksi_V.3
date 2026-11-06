-- ================================================================
-- MIGRATION: Upah finishing per tahap + tutup celah scan lanjut +
--            lunas otomatis tiap minggu
--
-- Praktik di lapangan: setiap Sabtu SEMUA upah minggu sebelumnya
-- (Sabtu-Jumat) dibayar tunai, termasuk jahit yang masih sedang
-- dikerjakan. Yang tidak tampil di sistem (cutting/finishing yang
-- belum selesai) belum dibayar.
--
-- 1. Upah finishing (lubang_kancing, buang_benang, qc, steam, packing)
--    sekarang dicatat SAAT TAHAPNYA SELESAI discan (qty selesai x tarif),
--    ke karyawan borongan default — tidak lagi menunggu Surat Jalan.
--    finalize_surat_jalan tidak lagi membuat upah.
--
-- 2. Tanggal upah:
--    - jahit  : minggu bundle DITERIMA (sudah dibayar sebagai "sedang
--               dikerjakan" kalau melewati hari bayar).
--    - lainnya: tanggal selesai (tidak pernah tampil sebagai sedang
--               dikerjakan, jadi belum dibayar sebelum selesai).
--    Aturan ini sekarang dipakai di scan_selesai DAN scan_lanjut_tahap
--    (sebelumnya scan_lanjut_tahap selalu memakai tanggal hari ini —
--    celah bayar ganda untuk jahit yang diterima minggu lalu).
--
-- 3. Pengaman bayar ganda: upah tahap tidak dibuat kalau bundle itu
--    sudah punya upah tahap yang sama, baik per bundle maupun per
--    surat jalan (jalur lama).
--
-- 4. Susulan: bundle yang tahap finishing-nya sudah selesai tapi belum
--    dikirim (jadi belum pernah dapat upah) dibuatkan upahnya sekarang,
--    tanggal hari ini (belum pernah dibayar).
--
-- 5. tutup_minggu_gaji_otomatis(): mulai hari Minggu (sehari setelah
--    hari bayar) semua upah minggu yang sudah lewat otomatis lunas,
--    dan jahit yang masih sedang dikerjakan dicatat "dibayar di muka"
--    supaya saat selesai tidak ditagih lagi. Dijalankan pg_cron tiap
--    hari 00:05 WIB, dan sekali saat migrasi ini. Semua entri yang
--    diubah dicatat di gaji_auto_lunas_log (bisa dibatalkan).
-- ================================================================


-- ----------------------------------------------------------------
-- Helper
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._upah_tahap_sudah_ada(
  p_bundle_id uuid, p_tahap text, p_tenant_id text
)
RETURNS boolean
LANGUAGE sql STABLE
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM gaji_ledger gl
    WHERE gl.tenant_id = p_tenant_id
      AND gl.status <> 'cancelled'
      AND gl.keterangan LIKE ('Upah ' || p_tahap || ' - %')
      AND (gl.sumber_id = p_bundle_id::text
           OR gl.sumber_id IN (SELECT s.id::text FROM surat_jalan_item s
                               WHERE s.bundle_id = p_bundle_id))
  );
$function$;

COMMENT ON FUNCTION public._upah_tahap_sudah_ada(uuid, text, text) IS
  'True kalau bundle sudah punya upah (tidak dibatalkan) untuk tahap ini — per bundle atau per surat jalan (jalur lama finishing).';

CREATE OR REPLACE FUNCTION public._tanggal_upah_tahap(p_tahap text, p_waktu_terima date)
RETURNS date
LANGUAGE sql STABLE
SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN p_tahap = 'jahit' AND p_waktu_terima IS NOT NULL
         AND awal_minggu_gaji(CURRENT_DATE) <> awal_minggu_gaji(p_waktu_terima)
    THEN p_waktu_terima
    ELSE CURRENT_DATE
  END;
$function$;

COMMENT ON FUNCTION public._tanggal_upah_tahap(text, date) IS
  'Tanggal upah: jahit ikut minggu diterima (sudah dibayar sbg sedang dikerjakan), tahap lain tanggal selesai.';


-- ----------------------------------------------------------------
-- 1. scan_selesai — upah untuk SEMUA tahap yang punya tarif
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.scan_selesai(
  p_barcode text, p_tahap tahap_produksi, p_karyawan_id uuid, p_qty integer,
  p_catatan text, p_alasan_qty_id uuid, p_user_id uuid, p_tenant_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_bundle              RECORD;
  v_tahap_status        TEXT;
  v_qty_terima          INT;
  v_resolved_karyawan   UUID;
  v_scan_log_id         UUID;
  v_gaji_entry_id       UUID := NULL;
  v_upah                NUMERIC := 0;
  v_rate                NUMERIC;
  v_tahap_text          TEXT := p_tahap::TEXT;
  v_approval_request_id UUID := NULL;
  v_is_qty_lebih        BOOLEAN := false;
  v_sudah_dibayar_dimuka BOOLEAN := false;
  v_waktu_terima        date;
BEGIN
  SELECT b.id, b.po_item_id, b.status_tahap, b.barcode, pi.produk_id
  INTO v_bundle
  FROM bundle b
  JOIN po_item pi ON pi.id = b.po_item_id
  WHERE b.barcode = p_barcode
    AND b.tenant_id = p_tenant_id
  FOR UPDATE OF b;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Barcode tidak ditemukan: %', p_barcode;
  END IF;

  v_tahap_status := v_bundle.status_tahap -> v_tahap_text ->> 'status';
  v_qty_terima   := (v_bundle.status_tahap -> v_tahap_text ->> 'qty_terima')::INT;
  v_waktu_terima := (v_bundle.status_tahap -> v_tahap_text ->> 'waktu_terima')::date;

  IF v_tahap_status IS NULL THEN
    RAISE EXCEPTION 'Bundle belum diterima di tahap ini: %', v_tahap_text;
  END IF;
  IF v_tahap_status = 'selesai' THEN
    RAISE EXCEPTION 'Bundle sudah selesai di tahap ini: %', v_tahap_text;
  END IF;
  IF p_qty < v_qty_terima AND p_alasan_qty_id IS NULL THEN
    RAISE EXCEPTION 'Qty kurang dari yang diterima. Wajib pilih alasan.';
  END IF;
  IF p_qty > v_qty_terima THEN
    v_is_qty_lebih := true;
  END IF;

  IF v_tahap_text = 'cutting' OR v_tahap_text = 'jahit' THEN
    v_resolved_karyawan := p_karyawan_id;
  ELSE
    SELECT default_karyawan_borongan_id
    INTO v_resolved_karyawan
    FROM settings
    WHERE tenant_id = p_tenant_id
    LIMIT 1;
  END IF;

  INSERT INTO scan_log (
    bundle_id, tahap, tipe, qty, karyawan_id,
    catatan, alasan_qty_id, is_qty_lebih,
    user_id, tenant_id
  )
  VALUES (
    v_bundle.id, p_tahap, 'selesai'::scan_tipe, p_qty, v_resolved_karyawan,
    p_catatan, p_alasan_qty_id, v_is_qty_lebih,
    p_user_id, p_tenant_id
  )
  RETURNING id INTO v_scan_log_id;

  UPDATE bundle
  SET status_tahap = jsonb_set(
    status_tahap,
    ARRAY[v_tahap_text],
    jsonb_set(
      jsonb_set(
        jsonb_set(
          status_tahap -> v_tahap_text,
          '{status}',      '"selesai"'
        ),
        '{qty_selesai}', to_jsonb(p_qty)
      ),
      '{waktu_selesai}', to_jsonb(now())
    )
  )
  WHERE id = v_bundle.id;

  -- Upah semua tahap yang punya tarif. Sudah ada (dibayar di muka /
  -- jalur lama surat jalan)? Jangan tagih lagi.
  v_sudah_dibayar_dimuka := _upah_tahap_sudah_ada(v_bundle.id, v_tahap_text, p_tenant_id);

  IF NOT v_sudah_dibayar_dimuka THEN
    SELECT hi.harga_satuan INTO v_rate
    FROM hpp_item hi
    JOIN hpp_komponen hk ON hi.komponen_id = hk.id
    WHERE hi.produk_id = v_bundle.produk_id
      AND hk.tahap_produksi = p_tahap
      AND hi.tenant_id = p_tenant_id;

    IF v_rate IS NOT NULL AND v_rate > 0 AND v_resolved_karyawan IS NOT NULL AND p_qty > 0 THEN
      v_upah := v_rate * p_qty;
      INSERT INTO gaji_ledger (
        karyawan_id, tipe, total, tanggal,
        sumber_id, keterangan, status,
        tenant_id, created_by
      )
      VALUES (
        v_resolved_karyawan,
        'selesai'::gaji_ledger_tipe,
        v_upah,
        _tanggal_upah_tahap(v_tahap_text, v_waktu_terima),
        v_bundle.id::text,
        'Upah ' || v_tahap_text || ' - ' || v_bundle.barcode,
        'belum_lunas'::gaji_status,
        p_tenant_id,
        p_user_id
      )
      RETURNING id INTO v_gaji_entry_id;
    END IF;
  END IF;

  IF v_is_qty_lebih THEN
    INSERT INTO qty_approval_request (
      scan_log_id, bundle_id, tahap,
      qty_diajukan, qty_default,
      tenant_id, created_by
    )
    VALUES (
      v_scan_log_id, v_bundle.id, p_tahap,
      p_qty, v_qty_terima,
      p_tenant_id, p_user_id
    )
    RETURNING id INTO v_approval_request_id;
  END IF;

  RETURN jsonb_build_object(
    'scan_log_id',          v_scan_log_id,
    'gaji_entry_id',        v_gaji_entry_id,
    'upah_nominal',         v_upah,
    'is_qty_lebih',         v_is_qty_lebih,
    'approval_request_id',  v_approval_request_id,
    'sudah_dibayar_dimuka', v_sudah_dibayar_dimuka
  );
END;
$function$;


-- ----------------------------------------------------------------
-- 2. scan_lanjut_tahap — tahap sebelumnya yang ditutup otomatis juga
--    dapat upah (semua tahap), dengan aturan tanggal yang sama.
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.scan_lanjut_tahap(
  p_barcode text, p_tahap_baru text, p_qty integer,
  p_user_id uuid, p_karyawan_id uuid, p_tenant_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_bundle_id           uuid;
  v_bundle_status       jsonb;
  v_barcode             text;
  v_produk_id           uuid;
  v_tahap_prev          text;
  v_prev_status         text;
  v_scan_log_id         uuid;
  v_gaji_entry_id       uuid;
  v_upah_nominal        numeric := 0;
  v_qty_terima_prev     integer;
  v_waktu_terima_prev   date;
  v_rate                numeric;
  v_resolved_karyawan   uuid;
  v_sudah_dibayar_dimuka boolean := false;
  v_model_id            uuid;
  v_aksesori            RECORD;
  v_qty_deduct          numeric;
  v_tahap_order text[] := ARRAY[
    'cutting','jahit','lubang_kancing','buang_benang','qc','steam','packing'
  ];
  v_idx_baru  integer;
  v_idx_prev  integer;
BEGIN
  SELECT b.id, b.status_tahap, b.barcode, poi.produk_id
  INTO v_bundle_id, v_bundle_status, v_barcode, v_produk_id
  FROM bundle b
  JOIN po_item poi ON poi.id = b.po_item_id
  WHERE b.barcode = p_barcode
    AND b.tenant_id = p_tenant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bundle tidak ditemukan: %', p_barcode;
  END IF;

  v_idx_baru := array_position(v_tahap_order, p_tahap_baru);
  IF v_idx_baru IS NULL THEN
    RAISE EXCEPTION 'Tahap tidak valid: %', p_tahap_baru;
  END IF;

  v_idx_prev := v_idx_baru - 1;
  IF v_idx_prev >= 1 THEN
    v_tahap_prev  := v_tahap_order[v_idx_prev];
    v_prev_status := v_bundle_status -> v_tahap_prev ->> 'status';

    IF v_prev_status = 'terima' THEN
      v_qty_terima_prev := COALESCE(
        (v_bundle_status -> v_tahap_prev ->> 'qty_terima')::integer,
        p_qty
      );
      v_waktu_terima_prev := (v_bundle_status -> v_tahap_prev ->> 'waktu_terima')::date;

      v_bundle_status := jsonb_set(
        v_bundle_status,
        ARRAY[v_tahap_prev],
        (v_bundle_status -> v_tahap_prev) ||
          jsonb_build_object(
            'status',      'selesai',
            'qty_selesai', v_qty_terima_prev,
            'end_time',    now(),
            'updated_by',  p_user_id
          )
      );
      INSERT INTO scan_log (
        bundle_id, tahap, tipe, qty, karyawan_id, user_id, tenant_id, created_at
      )
      VALUES (
        v_bundle_id,
        v_tahap_prev::tahap_produksi,
        'selesai'::scan_tipe,
        v_qty_terima_prev,
        p_karyawan_id,
        p_user_id,
        p_tenant_id,
        now()
      );

      IF v_tahap_prev IN ('cutting', 'jahit') THEN
        v_resolved_karyawan := COALESCE(
          NULLIF(v_bundle_status -> v_tahap_prev ->> 'karyawan_id', '')::uuid,
          p_karyawan_id
        );
      ELSE
        SELECT default_karyawan_borongan_id INTO v_resolved_karyawan
        FROM settings WHERE tenant_id = p_tenant_id LIMIT 1;
      END IF;

      v_sudah_dibayar_dimuka := _upah_tahap_sudah_ada(v_bundle_id, v_tahap_prev, p_tenant_id);

      SELECT hi.harga_satuan INTO v_rate
      FROM hpp_item hi
      JOIN hpp_komponen hk ON hi.komponen_id = hk.id
      WHERE hi.produk_id = v_produk_id
        AND hk.tahap_produksi = v_tahap_prev::tahap_produksi
        AND hi.tenant_id = p_tenant_id;

      IF NOT v_sudah_dibayar_dimuka
         AND v_rate IS NOT NULL AND v_rate > 0 AND v_resolved_karyawan IS NOT NULL
         AND v_qty_terima_prev > 0 THEN
        v_upah_nominal := v_rate * v_qty_terima_prev;
        INSERT INTO gaji_ledger (
          karyawan_id, tipe, total, tanggal,
          sumber_id, keterangan, status,
          tenant_id, created_by
        )
        VALUES (
          v_resolved_karyawan,
          'selesai'::gaji_ledger_tipe,
          v_upah_nominal,
          _tanggal_upah_tahap(v_tahap_prev, v_waktu_terima_prev),
          v_bundle_id::text,
          'Upah ' || v_tahap_prev || ' - ' || v_barcode,
          'belum_lunas'::gaji_status,
          p_tenant_id,
          p_user_id
        )
        RETURNING id INTO v_gaji_entry_id;
      END IF;
    END IF;
  END IF;

  v_bundle_status := jsonb_set(
    COALESCE(v_bundle_status, '{}'::jsonb),
    ARRAY[p_tahap_baru],
    jsonb_build_object(
      'status',      'terima',
      'qty_terima',  p_qty,
      'start_time',  now(),
      'karyawan_id', p_karyawan_id,
      'updated_by',  p_user_id
    )
  );
  UPDATE bundle
  SET status_tahap = v_bundle_status
  WHERE id = v_bundle_id;

  INSERT INTO scan_log (
    id, bundle_id, tahap, tipe, karyawan_id, qty, user_id, tenant_id, created_at
  )
  VALUES (
    gen_random_uuid(), v_bundle_id,
    p_tahap_baru::tahap_produksi,
    'terima'::scan_tipe,
    p_karyawan_id, p_qty, p_user_id, p_tenant_id, now()
  )
  RETURNING id INTO v_scan_log_id;

  SELECT p.model_id INTO v_model_id
  FROM produk p
  WHERE p.id = v_produk_id;

  IF v_model_id IS NOT NULL THEN
    FOR v_aksesori IN
      SELECT ma.inventory_item_id, ma.qty_per_pcs
      FROM model_aksesori ma
      WHERE ma.model_id = v_model_id
        AND ma.tahap_pakai = p_tahap_baru::tahap_produksi
        AND ma.tenant_id = p_tenant_id
    LOOP
      v_qty_deduct := v_aksesori.qty_per_pcs * p_qty;
      UPDATE inventory_item
      SET stok_aktual = stok_aktual - v_qty_deduct
      WHERE id = v_aksesori.inventory_item_id
        AND tenant_id = p_tenant_id;
      INSERT INTO pemakaian_aksesori (
        id, bundle_id, inventory_item_id, qty_pakai, tahap, tenant_id, created_at
      )
      VALUES (
        gen_random_uuid(),
        v_bundle_id,
        v_aksesori.inventory_item_id,
        v_qty_deduct,
        p_tahap_baru::tahap_produksi,
        p_tenant_id,
        now()
      )
      ON CONFLICT (bundle_id, inventory_item_id, tahap) DO NOTHING;
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'scan_log_id',          v_scan_log_id,
    'gaji_entry_id',        v_gaji_entry_id,
    'upah_nominal',         v_upah_nominal,
    'sudah_dibayar_dimuka', v_sudah_dibayar_dimuka
  );
END;
$function$;


-- ----------------------------------------------------------------
-- 3. finalize_surat_jalan — TIDAK lagi membuat upah finishing.
--    (Sama dengan versi 20260927000002, tanpa blok upah.)
-- ----------------------------------------------------------------
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

    -- Upah finishing TIDAK dibuat di sini lagi — sudah tercatat saat
    -- tiap tahap finishing selesai discan (lihat scan_selesai /
    -- scan_lanjut_tahap, migrasi 20261106000003).

    SELECT COALESCE(
             (b.status_tahap->'packing'->>'qty_selesai')::INT,
             (b.status_tahap->'cutting'->>'qty_aktual')::INT,
             pi.qty_per_bundle
           )
    INTO v_qty_jadi
    FROM bundle b
    JOIN po_item pi ON pi.id = b.po_item_id
    WHERE b.id = v_bundle_id;

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


-- ----------------------------------------------------------------
-- 4. Susulan upah finishing: tahap sudah selesai, belum dikirim,
--    belum pernah dapat upah. Tanggal hari ini (belum pernah dibayar).
-- ----------------------------------------------------------------
DO $$
DECLARE
  v_default UUID;
  v_jml INT;
  v_total NUMERIC;
BEGIN
  SELECT default_karyawan_borongan_id INTO v_default
  FROM settings WHERE tenant_id = 'STX-001' LIMIT 1;

  IF v_default IS NULL THEN
    RAISE EXCEPTION 'default_karyawan_borongan_id kosong — tidak bisa membuat upah finishing susulan';
  END IF;

  WITH baru AS (
    INSERT INTO gaji_ledger (karyawan_id, tipe, total, tanggal, sumber_id, keterangan, status, tenant_id, created_by)
    SELECT v_default, 'selesai'::gaji_ledger_tipe,
           hi.harga_satuan * x.qty, CURRENT_DATE,
           b.id::text, 'Upah ' || t.tahap || ' - ' || b.barcode,
           'belum_lunas'::gaji_status, 'STX-001', '71fb0890-5306-47be-a9c0-c5cce41cca95'
    FROM bundle b
    JOIN po_item pi ON pi.id = b.po_item_id
    CROSS JOIN (VALUES ('lubang_kancing'),('buang_benang'),('qc'),('steam'),('packing')) t(tahap)
    JOIN hpp_item hi ON hi.produk_id = pi.produk_id AND hi.tenant_id = 'STX-001'
    JOIN hpp_komponen hk ON hk.id = hi.komponen_id AND hk.tahap_produksi::text = t.tahap
    CROSS JOIN LATERAL (
      SELECT COALESCE((b.status_tahap->t.tahap->>'qty_selesai')::int,
                      (b.status_tahap->t.tahap->>'qty_terima')::int, 0) AS qty
    ) x
    WHERE b.tenant_id = 'STX-001'
      AND b.status_tahap->t.tahap->>'status' = 'selesai'
      AND hi.harga_satuan > 0 AND x.qty > 0
      AND NOT EXISTS (SELECT 1 FROM surat_jalan_item s WHERE s.bundle_id = b.id)
      AND NOT _upah_tahap_sudah_ada(b.id, t.tahap, 'STX-001')
    RETURNING total
  )
  SELECT COUNT(*), COALESCE(SUM(total), 0) INTO v_jml, v_total FROM baru;

  INSERT INTO audit_log (user_id, modul, aksi, target, metadata, tenant_id)
  VALUES ('71fb0890-5306-47be-a9c0-c5cce41cca95', 'penggajian', 'Susulan Upah Finishing per Tahap',
          'migrasi 20261106000003',
          jsonb_build_object('jumlah_entri', v_jml, 'total', v_total), 'STX-001');
END $$;


-- ----------------------------------------------------------------
-- 5. Lunas otomatis tiap minggu
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.gaji_auto_lunas_log (
  id          BIGSERIAL PRIMARY KEY,
  ledger_id   UUID NOT NULL,
  jenis       TEXT NOT NULL CHECK (jenis IN ('ditandai_lunas', 'dibayar_dimuka')),
  dijalankan  TIMESTAMPTZ NOT NULL DEFAULT now(),
  tenant_id   TEXT NOT NULL
);
ALTER TABLE public.gaji_auto_lunas_log ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.gaji_auto_lunas_log IS
  'Jejak entri gaji_ledger yang dilunaskan/dibuat otomatis oleh tutup_minggu_gaji_otomatis — dipakai untuk membatalkan kalau perlu.';

CREATE OR REPLACE FUNCTION public.tutup_minggu_gaji_otomatis(p_tenant_id text DEFAULT 'STX-001')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET "TimeZone" TO 'Asia/Jakarta'
AS $function$
DECLARE
  v_batas   date;
  v_dimuka  INT := 0;
  v_lunas   INT := 0;
  v_total   NUMERIC := 0;
BEGIN
  -- Hari bayar = Sabtu. Mulai Minggu, minggu yang baru saja dibayar
  -- dianggap lunas. Pada hari Sabtu sendiri minggu itu masih terbuka
  -- supaya masih terlihat saat membayar.
  v_batas := awal_minggu_gaji(CURRENT_DATE - 1);

  -- a) Jahit yang masih sedang dikerjakan dari minggu yang sudah dibayar
  --    -> catat sebagai dibayar di muka (qty diterima x tarif), supaya
  --    saat selesai nanti tidak ditagih lagi.
  WITH baru AS (
    INSERT INTO gaji_ledger (karyawan_id, tipe, total, tanggal, tanggal_bayar,
                             sumber_id, keterangan, status, tenant_id, created_by)
    SELECT (b.status_tahap->'jahit'->>'karyawan_id')::uuid, 'selesai'::gaji_ledger_tipe,
           hi.harga_satuan * (b.status_tahap->'jahit'->>'qty_terima')::int,
           (b.status_tahap->'jahit'->>'waktu_terima')::timestamptz::date,
           (awal_minggu_gaji((b.status_tahap->'jahit'->>'waktu_terima')::timestamptz::date) + 7)::timestamptz,
           b.id::text, 'Upah jahit - ' || b.barcode,
           'lunas'::gaji_status, p_tenant_id, '71fb0890-5306-47be-a9c0-c5cce41cca95'
    FROM bundle b
    JOIN po_item pi ON pi.id = b.po_item_id
    JOIN hpp_item hi ON hi.produk_id = pi.produk_id AND hi.tenant_id = p_tenant_id
    JOIN hpp_komponen hk ON hk.id = hi.komponen_id AND hk.tahap_produksi::text = 'jahit'
    WHERE b.tenant_id = p_tenant_id
      AND b.status_tahap->'jahit'->>'status' = 'terima'
      AND NULLIF(b.status_tahap->'jahit'->>'karyawan_id', '') IS NOT NULL
      AND (b.status_tahap->'jahit'->>'waktu_terima')::timestamptz::date < v_batas
      AND hi.harga_satuan > 0
      AND COALESCE((b.status_tahap->'jahit'->>'qty_terima')::int, 0) > 0
      AND NOT _upah_tahap_sudah_ada(b.id, 'jahit', p_tenant_id)
    RETURNING id
  ),
  log AS (
    INSERT INTO gaji_auto_lunas_log (ledger_id, jenis, tenant_id)
    SELECT id, 'dibayar_dimuka', p_tenant_id FROM baru
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_dimuka FROM log;

  -- b) Semua upah belum lunas dari minggu yang sudah dibayar -> lunas.
  WITH u AS (
    UPDATE gaji_ledger
    SET status = 'lunas',
        tanggal_bayar = (awal_minggu_gaji(tanggal) + 7)::timestamptz
    WHERE tenant_id = p_tenant_id
      AND status = 'belum_lunas'
      AND tanggal < v_batas
    RETURNING id, total
  ),
  log AS (
    INSERT INTO gaji_auto_lunas_log (ledger_id, jenis, tenant_id)
    SELECT id, 'ditandai_lunas', p_tenant_id FROM u
    RETURNING ledger_id
  )
  SELECT COUNT(*), COALESCE(SUM(u.total), 0) INTO v_lunas, v_total
  FROM log JOIN u ON u.id = log.ledger_id;

  IF v_dimuka > 0 OR v_lunas > 0 THEN
    INSERT INTO audit_log (user_id, modul, aksi, target, metadata, tenant_id)
    VALUES ('71fb0890-5306-47be-a9c0-c5cce41cca95', 'penggajian', 'Lunas Otomatis Mingguan',
            'sebelum ' || v_batas::text,
            jsonb_build_object('batas', v_batas, 'ditandai_lunas', v_lunas,
                               'total_ditandai_lunas', v_total, 'dibayar_dimuka', v_dimuka),
            p_tenant_id);
  END IF;

  RETURN jsonb_build_object('batas', v_batas, 'ditandai_lunas', v_lunas,
                            'total', v_total, 'dibayar_dimuka', v_dimuka);
END;
$function$;

REVOKE ALL ON FUNCTION public.tutup_minggu_gaji_otomatis(text) FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.tutup_minggu_gaji_otomatis(text) IS
  'Lunaskan otomatis semua upah minggu penggajian yang sudah lewat hari bayar (Sabtu). Dijalankan pg_cron tiap hari 00:05 WIB.';

-- Jadwal: tiap hari 17:05 UTC = 00:05 WIB (idempoten, aman dijalankan harian).
CREATE EXTENSION IF NOT EXISTS pg_cron;
SELECT cron.schedule('tutup-minggu-gaji', '5 17 * * *',
                     $$SELECT public.tutup_minggu_gaji_otomatis('STX-001')$$);

-- Jalankan sekali sekarang.
SELECT public.tutup_minggu_gaji_otomatis('STX-001');
