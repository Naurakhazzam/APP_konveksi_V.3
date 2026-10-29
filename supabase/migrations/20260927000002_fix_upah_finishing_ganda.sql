-- ================================================================
-- MIGRATION: Perbaiki upah tahap finishing (lubang kancing, buang benang,
-- qc, steam, packing) yang tertagih ganda atau tidak terbayar sama sekali
--
-- Latar belakang: sampai dengan ~31 Agustus 2026, upah finishing dibuat
-- lewat scan_lanjut_tahap saat bundle discan lanjut ke tahap berikutnya
-- (nilainya dihitung dari qty_per_bundle, tercatat di sumber_id = bundle.id).
-- Mulai 1 September, upah finishing dibuat lewat finalize_surat_jalan saat
-- surat jalan dibuat (nilainya dari qty_kirim, tercatat di sumber_id =
-- surat_jalan_item.id — ini lebih akurat karena mengikuti kirim bertahap
-- per bundle). Kedua jalur berjalan tanpa saling memeriksa satu sama lain.
--
-- Akibatnya:
--   A) 19 entri (Rp95.900) tertagih DUA KALI: bundle itu sudah dicatat
--      lunas lewat jalur lama, lalu dikirim setelah 1 September dan
--      dicatat lagi lewat jalur baru. Entri jalur baru lebih akurat
--      (mengikuti qty yang benar-benar dikirim, termasuk kirim
--      sebagian) sehingga dipakai sebagai acuan; entri jalur lama
--      dibatalkan.
--   B) 58 baris di 10 surat jalan lama (SJ 00058, 00061–00068, 00070,
--      tanggal 18 & 26 Agustus) TIDAK PERNAH dibuatkan upah finishing
--      sama sekali — kemungkinan pembersihan 30 Agustus yang membatalkan
--      50 entri upah lama tidak diikuti pembuatan ulang untuk surat
--      jalan-surat jalan ini. Dibuatkan sekarang mengikuti rumus yang
--      sama dengan finalize_surat_jalan (qty_kirim x tarif tahap).
--   C) 15 bundle (55 entri, Rp197.900, status lunas) sudah tercatat
--      lunas lewat jalur lama tapi BELUM PERNAH dikirim. Ini uang yang
--      sudah dibayar dan TIDAK disentuh di sini. Tapi kalau nanti
--      bundle ini dikirim, finalize_surat_jalan akan menagih lagi upah
--      finishing yang sama — makanya finalize_surat_jalan diberi
--      pengaman baru (bagian 3) supaya tidak menagih ulang bundle yang
--      sudah pernah dibayar lewat jalur lama.
--
-- Perbaikan kode:
--   1. scan_lanjut_tahap tidak lagi membuat upah untuk tahap finishing
--      (lubang_kancing/buang_benang/qc/steam/packing) — upah tahap itu
--      sekarang HANYA dibuat lewat surat jalan, sesuai desain yang
--      sudah tertulis di komentar scan_selesai. Transisi status tahap
--      (auto-tutup tahap sebelumnya saat scan lanjut) tidak berubah.
--   2. finalize_surat_jalan diberi pengaman: tidak membuat upah
--      finishing baru untuk bundle+tahap yang sudah pernah dibayar
--      lewat bundle.id (jalur lama) — mencegah pengulangan kasus (A)
--      dan melindungi 15 bundle di poin (C). Kirim bertahap (bundle
--      yang sama dikirim di beberapa surat jalan berbeda) tidak
--      terpengaruh karena masing-masing pengiriman tetap py sumber_id
--      surat_jalan_item sendiri-sendiri.
--   3. batal_surat_jalan & edit_surat_jalan menolak membatalkan/
--      mengurangi qty kalau upah finishing terkait sudah lunas/escrow
--      — mencegah surat jalan dihapus/bundle jadi bisa dikirim ulang
--      padahal upahnya sudah terlanjur dibayar (lihat migrasi
--      sebelumnya, 20260927000001, untuk kasus serupa di upah jahit).
-- ================================================================


-- ----------------------------------------------------------------
-- A) Batalkan 19 entri finishing yang tertagih ganda (jalur bundle lama,
--    sudah ada padanan yang lebih akurat lewat surat jalan)
-- ----------------------------------------------------------------
UPDATE gaji_ledger
SET status = 'cancelled',
    keterangan = keterangan || ' [DIBATALKAN: dobel dengan upah dari surat jalan, lihat migrasi 20260927000002]'
WHERE id IN (
  '19324cdd-2771-42be-ae97-812eb1c4cc17', '9dd5d34a-5832-4d06-be02-f82953c6063d',
  '7952290a-2c81-4ea0-9c07-f1b58795e98b', 'f9f31ba2-9aae-40c5-81d1-ed78559ef1ee',
  '6ccecd7b-496c-4f0e-a480-5d899f909044', '9b3a90c6-3633-4eb6-9f45-10c8b718952e',
  '2160625f-785e-4ed3-8a88-42593218dc3d', '54874236-0885-4b34-8c0b-190df6995e3f',
  '106e5323-9e92-4819-bd0d-da14f633a337', '0ed6a4e8-bc5a-4294-acd8-f7d003d0a8ec',
  'ead2b39f-27a8-4eaf-8ff4-1215f42236e0', 'b1052ad0-913d-4ff9-9f88-e55f44711f14',
  'b5d41f26-9906-40a7-b499-dd9ff5c05344', 'd30e7f23-8f0a-43e2-9c28-45c9369f8c6b',
  'dc42f930-50a4-4330-8d9d-a043a11b720e', '58842369-c74f-47e7-9458-93d1c77e24c0',
  '2e1a0898-7855-49b6-ac65-e1d43dd3d8da', '28746019-e7d6-4a73-8bcc-e92fb23df3e6',
  'c1c4dbf9-629f-4b14-afde-d8bb4ba0c976'
) AND status = 'lunas';


-- ----------------------------------------------------------------
-- B) Buat upah finishing yang belum pernah dibuat untuk 10 surat jalan
--    lama (58 baris) — rumus & guard sama dengan finalize_surat_jalan.
-- ----------------------------------------------------------------
DO $$
DECLARE
  v_default_karyawan UUID;
  v_row RECORD;
  v_rate NUMERIC;
  v_dibuat INT := 0;
BEGIN
  SELECT default_karyawan_borongan_id INTO v_default_karyawan
  FROM settings WHERE tenant_id = 'STX-001' LIMIT 1;

  IF v_default_karyawan IS NULL THEN
    RAISE EXCEPTION 'default_karyawan_borongan_id kosong — tidak bisa membuat upah finishing susulan';
  END IF;

  FOR v_row IN
    SELECT sji.id AS sji_id, sji.qty_kirim, b.barcode, pi.produk_id, sj.tanggal, sj.nomor_sj
    FROM surat_jalan_item sji
    JOIN surat_jalan sj ON sj.id = sji.sj_id
    JOIN bundle b       ON b.id = sji.bundle_id
    JOIN po_item pi     ON pi.id = b.po_item_id
    WHERE sj.nomor_sj IN ('SJ/2026/00058', 'SJ/2026/00061', 'SJ/2026/00062',
                          'SJ/2026/00063', 'SJ/2026/00064', 'SJ/2026/00065',
                          'SJ/2026/00066', 'SJ/2026/00067', 'SJ/2026/00068',
                          'SJ/2026/00070')
      AND sj.tenant_id = 'STX-001'
  LOOP
    DECLARE
      v_tahap TEXT;
    BEGIN
      FOREACH v_tahap IN ARRAY ARRAY['lubang_kancing','buang_benang','qc','steam','packing']
      LOOP
        IF EXISTS (
          SELECT 1 FROM gaji_ledger gl
          WHERE gl.tenant_id = 'STX-001' AND gl.sumber_id = v_row.sji_id::text
            AND gl.keterangan LIKE ('Upah ' || v_tahap || ' - %')
        ) THEN
          CONTINUE;
        END IF;

        SELECT hi.harga_satuan INTO v_rate
        FROM hpp_item hi JOIN hpp_komponen hk ON hk.id = hi.komponen_id
        WHERE hi.produk_id = v_row.produk_id AND hk.tahap_produksi::text = v_tahap
          AND hi.tenant_id = 'STX-001';

        IF v_rate IS NOT NULL AND v_rate > 0 THEN
          INSERT INTO gaji_ledger (
            karyawan_id, tipe, total, tanggal,
            sumber_id, keterangan, status, tenant_id, created_by
          )
          VALUES (
            v_default_karyawan, 'selesai'::gaji_ledger_tipe,
            v_rate * v_row.qty_kirim, v_row.tanggal,
            v_row.sji_id::text, 'Upah ' || v_tahap || ' - ' || v_row.barcode,
            'belum_lunas'::gaji_status, 'STX-001', '71fb0890-5306-47be-a9c0-c5cce41cca95'
          );
          v_dibuat := v_dibuat + 1;
        END IF;
      END LOOP;
    END;
  END LOOP;

  INSERT INTO audit_log (user_id, modul, aksi, target, metadata, tenant_id)
  VALUES (
    '71fb0890-5306-47be-a9c0-c5cce41cca95', 'penggajian', 'Susulan Upah Finishing', 'migrasi 20260927000002',
    jsonb_build_object('jumlah_entri_dibuat', v_dibuat,
                       'surat_jalan', ARRAY['SJ/2026/00058','SJ/2026/00061','SJ/2026/00062',
                                            'SJ/2026/00063','SJ/2026/00064','SJ/2026/00065',
                                            'SJ/2026/00066','SJ/2026/00067','SJ/2026/00068',
                                            'SJ/2026/00070']),
    'STX-001'
  );
END $$;


-- ----------------------------------------------------------------
-- 1. scan_lanjut_tahap — upah HANYA untuk cutting & jahit. Finishing
--    baru dibayar saat surat jalan dibuat (lihat finalize_surat_jalan).
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

      -- Upah HANYA untuk cutting & jahit. Finishing (lubang_kancing,
      -- buang_benang, qc, steam, packing) upahnya dibuat saat surat
      -- jalan dibuat (finalize_surat_jalan), mengikuti qty yang benar-
      -- benar dikirim — bukan qty_terima yang bisa beda dari yang jadi
      -- dikirim (kirim sebagian, dsb).
      IF v_tahap_prev IN ('cutting', 'jahit') THEN
        v_resolved_karyawan := COALESCE(
          NULLIF(v_bundle_status -> v_tahap_prev ->> 'karyawan_id', '')::uuid,
          p_karyawan_id
        );

        SELECT EXISTS (
          SELECT 1 FROM gaji_ledger gl
          WHERE gl.tenant_id = p_tenant_id AND gl.sumber_id = v_bundle_id::text
            AND gl.keterangan LIKE ('Upah ' || v_tahap_prev || ' - %')
            AND gl.status <> 'cancelled'
        ) INTO v_sudah_dibayar_dimuka;

        SELECT hi.harga_satuan INTO v_rate
        FROM hpp_item hi
        JOIN hpp_komponen hk ON hi.komponen_id = hk.id
        WHERE hi.produk_id = v_produk_id
          AND hk.tahap_produksi = v_tahap_prev::tahap_produksi
          AND hi.tenant_id = p_tenant_id;

        IF NOT v_sudah_dibayar_dimuka
           AND v_rate IS NOT NULL AND v_rate > 0 AND v_resolved_karyawan IS NOT NULL THEN
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
            CURRENT_DATE,
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
-- 2. finalize_surat_jalan — jangan tagih ulang bundle yang upah
--    finishing-nya sudah pernah dibuat lewat jalur lama (sumber_id =
--    bundle.id, sebelum 1 September). Kirim bertahap tidak terpengaruh:
--    tiap pengiriman tetap punya sumber_id surat_jalan_item sendiri.
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
  v_produk_id      UUID;
  v_default_karyawan UUID;
  v_tahap_fin      TEXT;
  v_rate_fin       NUMERIC;
  v_upah_fin       NUMERIC;
  v_no_po          TEXT;
  v_nama_produk    TEXT;
  v_status_packing TEXT;
  v_identitas      TEXT;
  v_sudah_dibayar_legacy BOOLEAN;
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

    IF v_default_karyawan IS NOT NULL THEN
      FOR v_tahap_fin IN SELECT unnest(ARRAY['lubang_kancing','buang_benang','qc','steam','packing']) LOOP
        -- Pengaman: bundle ini sudah pernah dibayar untuk tahap ini lewat
        -- jalur lama (scan_lanjut_tahap, sebelum upah finishing dipindah
        -- ke surat jalan)? Kalau iya, jangan tagih lagi. Ini TIDAK
        -- memblokir kirim bertahap (bundle yang sama dikirim di beberapa
        -- SJ) karena pengecekannya khusus sumber_id = bundle.id, bukan
        -- surat_jalan_item lain.
        SELECT EXISTS (
          SELECT 1 FROM gaji_ledger gl
          WHERE gl.tenant_id = p_tenant_id AND gl.sumber_id = v_bundle_id::text
            AND gl.keterangan LIKE ('Upah ' || v_tahap_fin || ' - %')
            AND gl.status <> 'cancelled'
        ) INTO v_sudah_dibayar_legacy;

        IF v_sudah_dibayar_legacy THEN
          CONTINUE;
        END IF;

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


-- ----------------------------------------------------------------
-- 3a. batal_surat_jalan — tolak kalau ada upah (jahit/finishing) yang
--     sudah lunas/escrow terkait surat jalan ini.
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.batal_surat_jalan(p_sj_id uuid, p_alasan text, p_user_id uuid, p_tenant_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
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
  v_jml_upah_lunas  INT;
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

  -- Upah finishing terkait surat jalan ini sudah lunas/escrow? Kalau
  -- dibatalkan begitu saja, surat_jalan_item ikut terhapus (cascade),
  -- catatan upah itu jadi yatim, dan bundle-nya bisa dikirim ulang lalu
  -- ditagih lagi — dobel bayar. Tolak, minta selesaikan upahnya dulu.
  SELECT COUNT(*) INTO v_jml_upah_lunas
  FROM gaji_ledger gl
  WHERE gl.tenant_id = p_tenant_id
    AND gl.status IN ('lunas', 'escrow')
    AND gl.sumber_id IN (SELECT id::text FROM surat_jalan_item WHERE sj_id = p_sj_id);

  IF v_jml_upah_lunas > 0 THEN
    RAISE EXCEPTION '[UPAH SUDAH DIBAYAR] Surat jalan % punya % upah borongan yang sudah lunas/ditahan — batalkan/koreksi upahnya dulu lewat Overview Pekerja sebelum membatalkan surat jalan ini.',
      v_sj.nomor_sj, v_jml_upah_lunas;
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


-- ----------------------------------------------------------------
-- 3b. edit_surat_jalan — tolak mengubah/menghapus baris yang upah
--     finishing-nya sudah lunas/escrow.
-- ----------------------------------------------------------------
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

    SELECT COALESCE(SUM(qty_kirim), 0) INTO v_lain
    FROM surat_jalan_item
    WHERE bundle_id = v_bundle_id AND sj_id <> p_sj_id;

    IF v_qty_baru + v_lain > v_qty_jadi THEN
      RAISE EXCEPTION '[QTY MELEBIHI SISA] %: mau diubah jadi % pcs, tapi barang jadi cuma % pcs dan % pcs di antaranya sudah terkirim di surat jalan lain.',
        v_identitas, v_qty_baru, v_qty_jadi, v_lain;
    END IF;

    -- Upah finishing baris ini sudah lunas/ditahan? Tolak dulu — qty
    -- yang dibayar bisa jadi tidak cocok lagi kalau baris ini diubah/
    -- dihapus begitu saja.
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
