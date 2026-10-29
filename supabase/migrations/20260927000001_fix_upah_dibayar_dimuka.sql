-- ================================================================
-- MIGRATION: Perbaiki upah jahit yang tertagih ulang setelah dibayar dimuka
--
-- Konteks: "Tandai Lunas" di Overview Pekerja ikut melunaskan jahit yang
-- MASIH dikerjakan (dibayar dimuka) dengan membuat entri gaji_ledger
-- berstatus 'lunas' ("Upah jahit - <barcode>", sumber_id = bundle.id).
-- scan_selesai sudah memeriksa entri itu sebelum membuat upah, tapi dua
-- jalur lain tidak:
--
--   1. scan_lanjut_tahap — saat tahap berikutnya di-scan sementara jahit
--      masih 'terima', jahit otomatis diselesaikan dan upahnya dibuat lagi
--      (belum_lunas), padahal sudah lunas. Upahnya juga jatuh ke karyawan
--      tahap berikutnya (p_karyawan_id), bukan ke penjahit aslinya.
--   2. scan_split_bundle — bundle dipecah: upah bagian selesai dibuat lagi,
--      dan bundle sisa (id baru) tertagih lagi saat selesai.
--
-- Tambahan: pemeriksaan "sudah ada entri upah" di scan_selesai, overview,
-- rincian pekerja, dan pelunasan tidak melihat status. Entri dimuka yang
-- sudah dibatalkan (status 'cancelled') membuat pekerjaannya hilang dari
-- overview dan tidak pernah ditagih. Sekarang entri batal diabaikan.
--
-- Tidak diubah (dicatat sebagai temuan): selisih qty antara yang dibayar
-- dimuka (qty_terima) dan qty saat selesai tidak disesuaikan.
-- ================================================================


-- ----------------------------------------------------------------
-- 1. Entri yang sudah 'cancelled' tidak dihitung sebagai "sudah ada upah"
--    (edit teks fungsi yang sedang aktif — hanya satu kondisi ditambahkan)
-- ----------------------------------------------------------------
DO $$
DECLARE
  r     RECORD;
  v_def TEXT;
  v_new TEXT;
BEGIN
  FOR r IN
    SELECT p.oid, p.proname
    FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.proname IN ('overview_pekerja_periode', 'detail_pekerja_periode',
                        'lunaskan_upah_pekerja', 'scan_selesai')
  LOOP
    v_def := pg_get_functiondef(r.oid);

    IF v_def LIKE '%gl.status <> ''cancelled''%' THEN
      CONTINUE; -- sudah diperbaiki
    END IF;

    v_new := replace(
      v_def,
      $a$AND gl.keterangan LIKE ('Upah ' || t.tahap || ' - %')$a$,
      $a$AND gl.keterangan LIKE ('Upah ' || t.tahap || ' - %')
        AND gl.status <> 'cancelled'$a$
    );
    v_new := replace(
      v_new,
      $a$AND gl.keterangan LIKE ('Upah ' || v_tahap_text || ' - %')$a$,
      $a$AND gl.keterangan LIKE ('Upah ' || v_tahap_text || ' - %')
        AND gl.status <> 'cancelled'$a$
    );

    IF v_new = v_def THEN
      RAISE EXCEPTION 'Pola pemeriksaan upah tidak ditemukan di %', r.proname;
    END IF;

    EXECUTE v_new;
  END LOOP;
END $$;


-- ----------------------------------------------------------------
-- 2. scan_lanjut_tahap — jangan buat upah lagi kalau sudah dibayar dimuka,
--    dan upah cutting/jahit jatuh ke karyawan yang mengerjakan tahap itu.
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

      IF v_tahap_prev IN ('cutting', 'jahit') THEN
        -- Upah milik karyawan yang mengerjakan tahap itu (tercatat saat
        -- diterima), bukan karyawan tahap berikutnya.
        v_resolved_karyawan := COALESCE(
          NULLIF(v_bundle_status -> v_tahap_prev ->> 'karyawan_id', '')::uuid,
          p_karyawan_id
        );
      ELSE
        SELECT default_karyawan_borongan_id
        INTO v_resolved_karyawan
        FROM settings
        WHERE tenant_id = p_tenant_id
        LIMIT 1;
      END IF;

      -- Sudah dibayar dimuka lewat "Tandai Lunas"? Jangan buat upah lagi.
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

      -- GUARD: hanya insert jika rate > 0 (hindari constraint total <> 0)
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
-- 3. scan_split_bundle — bundle dipecah saat upahnya sudah dibayar dimuka:
--    porsi upah dipindah ke bundle sisa (total tetap, tidak ada tagihan baru).
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.scan_split_bundle(
  p_barcode text, p_tahap tahap_produksi, p_qty_selesai integer,
  p_karyawan_id_asli uuid, p_karyawan_id_sisa uuid,
  p_user_id uuid, p_tenant_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_bundle              RECORD;
  v_qty_terima          INT;
  v_qty_sisa            INT;
  v_new_barcode         TEXT;
  v_new_bundle_id       UUID;
  v_scan_log_selesai_id UUID;
  v_scan_log_terima_id  UUID;
  v_rate                NUMERIC;
  v_upah                NUMERIC := 0;
  v_gaji_entry_id       UUID    := NULL;
  v_split_count         INT;
  v_new_no_urut         INT;
  v_tahap_text          TEXT    := p_tahap::TEXT;
  v_child_status_tahap  JSONB;
  v_dimuka              RECORD;
  v_ada_dimuka          BOOLEAN := false;
  v_porsi_sisa          NUMERIC;
  v_porsi_asli          NUMERIC;
BEGIN
  SELECT b.id, b.po_id, b.po_item_id, b.status_tahap, b.barcode,
         b.no_urut, b.no_urut_po, pi.produk_id
  INTO v_bundle
  FROM bundle b
  JOIN po_item pi ON pi.id = b.po_item_id
  WHERE b.barcode = p_barcode
    AND b.tenant_id = p_tenant_id
  FOR UPDATE OF b;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Barcode tidak ditemukan: %', p_barcode;
  END IF;

  IF (v_bundle.status_tahap -> v_tahap_text ->> 'status') IS DISTINCT FROM 'terima' THEN
    RAISE EXCEPTION 'Bundle tidak dalam status terima di tahap %', v_tahap_text;
  END IF;

  v_qty_terima := (v_bundle.status_tahap -> v_tahap_text ->> 'qty_terima')::INT;

  IF p_qty_selesai <= 0 OR p_qty_selesai >= v_qty_terima THEN
    RAISE EXCEPTION 'Qty selesai harus antara 1 dan %', v_qty_terima - 1;
  END IF;

  v_qty_sisa := v_qty_terima - p_qty_selesai;

  -- Upah tahap ini sudah dibayar dimuka lewat "Tandai Lunas"?
  SELECT gl.* INTO v_dimuka
  FROM gaji_ledger gl
  WHERE gl.tenant_id = p_tenant_id AND gl.sumber_id = v_bundle.id::text
    AND gl.keterangan LIKE ('Upah ' || v_tahap_text || ' - %')
    AND gl.status <> 'cancelled'
  ORDER BY gl.created_at
  LIMIT 1;
  v_ada_dimuka := FOUND;

  SELECT COUNT(*) INTO v_split_count
  FROM bundle
  WHERE barcode LIKE p_barcode || 's%'
    AND tenant_id = p_tenant_id;

  v_new_barcode := p_barcode || 's' || (v_split_count + 1)::TEXT;

  SELECT COALESCE(MAX(no_urut), 0) + 1 INTO v_new_no_urut
  FROM bundle
  WHERE po_id = v_bundle.po_id AND tenant_id = p_tenant_id;

  INSERT INTO scan_log (bundle_id, tahap, tipe, qty, karyawan_id, user_id, tenant_id)
  VALUES (v_bundle.id, p_tahap, 'selesai'::scan_tipe, p_qty_selesai, p_karyawan_id_asli, p_user_id, p_tenant_id)
  RETURNING id INTO v_scan_log_selesai_id;

  UPDATE bundle
  SET status_tahap = jsonb_set(
    status_tahap,
    ARRAY[v_tahap_text],
    jsonb_set(
      jsonb_set(
        jsonb_set(status_tahap -> v_tahap_text,
          '{status}',       '"selesai"'),
        '{qty_selesai}',    to_jsonb(p_qty_selesai)),
      '{waktu_selesai}',  to_jsonb(now())
    )
  )
  WHERE id = v_bundle.id;

  SELECT hi.harga_satuan INTO v_rate
  FROM hpp_item hi
  JOIN hpp_komponen hk ON hi.komponen_id = hk.id
  WHERE hi.produk_id   = v_bundle.produk_id
    AND hk.tahap_produksi = p_tahap
    AND hi.tenant_id   = p_tenant_id;

  IF NOT v_ada_dimuka
     AND v_rate IS NOT NULL AND v_rate > 0 AND p_karyawan_id_asli IS NOT NULL THEN
    v_upah := v_rate * p_qty_selesai;
    INSERT INTO gaji_ledger (
      karyawan_id, tipe, total, tanggal,
      sumber_id, keterangan, status, tenant_id, created_by
    )
    VALUES (
      p_karyawan_id_asli, 'selesai'::gaji_ledger_tipe, v_upah, CURRENT_DATE,
      v_bundle.id::text,
      'Upah ' || v_tahap_text || ' - ' || p_barcode,
      'belum_lunas'::gaji_status, p_tenant_id, p_user_id
    )
    RETURNING id INTO v_gaji_entry_id;
  END IF;

  v_child_status_tahap := (v_bundle.status_tahap - v_tahap_text) || jsonb_build_object(
    v_tahap_text, jsonb_build_object(
      'status',       'terima',
      'karyawan_id',  p_karyawan_id_sisa::text,
      'qty_terima',   v_qty_sisa,
      'waktu_terima', now()::text
    )
  );

  INSERT INTO bundle (
    barcode, po_id, po_item_id, no_urut, no_urut_po,
    parent_bundle_id, status_tahap, tenant_id, created_by
  )
  VALUES (
    v_new_barcode,
    v_bundle.po_id,
    v_bundle.po_item_id,
    v_new_no_urut,
    v_bundle.no_urut_po,
    v_bundle.id,
    v_child_status_tahap,
    p_tenant_id,
    p_user_id
  )
  RETURNING id INTO v_new_bundle_id;

  -- Upah yang sudah dibayar dimuka meliputi seluruh qty terima. Bagi sesuai
  -- qty: bagian bundle asli tetap di entri lama, bagian bundle sisa
  -- dipindahkan ke entri baru (status & tanggal bayar sama) supaya saat
  -- bundle sisa selesai tidak tertagih lagi. Total yang dibayar tidak berubah.
  IF v_ada_dimuka THEN
    v_porsi_sisa := ROUND(v_dimuka.total * v_qty_sisa / v_qty_terima);
    v_porsi_asli := v_dimuka.total - v_porsi_sisa;

    IF v_porsi_sisa > 0 AND v_porsi_asli > 0 THEN
      UPDATE gaji_ledger SET total = v_porsi_asli WHERE id = v_dimuka.id;

      INSERT INTO gaji_ledger (
        karyawan_id, tipe, total, tanggal, tanggal_bayar,
        sumber_id, keterangan, status, tenant_id, created_by
      )
      VALUES (
        v_dimuka.karyawan_id, v_dimuka.tipe, v_porsi_sisa, v_dimuka.tanggal,
        v_dimuka.tanggal_bayar,
        v_new_bundle_id::text,
        'Upah ' || v_tahap_text || ' - ' || v_new_barcode,
        v_dimuka.status, p_tenant_id, p_user_id
      );
    END IF;
  END IF;

  INSERT INTO scan_log (bundle_id, tahap, tipe, qty, karyawan_id, user_id, tenant_id)
  VALUES (v_new_bundle_id, p_tahap, 'terima'::scan_tipe, v_qty_sisa, p_karyawan_id_sisa, p_user_id, p_tenant_id)
  RETURNING id INTO v_scan_log_terima_id;

  RETURN jsonb_build_object(
    'original_scan_log_id', v_scan_log_selesai_id,
    'new_bundle_id',        v_new_bundle_id,
    'new_bundle_barcode',   v_new_barcode,
    'new_bundle_qty',       v_qty_sisa,
    'scan_log_terima_id',   v_scan_log_terima_id,
    'gaji_entry_id',        v_gaji_entry_id,
    'upah_nominal',         v_upah,
    'dibayar_dimuka',       v_ada_dimuka
  );
END;
$function$;
