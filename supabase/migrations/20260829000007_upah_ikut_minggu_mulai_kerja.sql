-- ================================================================
-- MIGRATION: Upah tetap di minggu penggajian saat mulai dikerjakan,
-- bukan lompat ke minggu berikutnya kalau selesainya telat sehari
--
-- Siklus penggajian adalah Sabtu-Jumat, dan Sabtu berikutnya adalah hari
-- bayar tunai untuk periode yang baru saja tutup. Kalau sebuah bundle
-- diterima Jumat sore (hari terakhir suatu periode) tapi baru discan
-- selesai Sabtu pagi (hari pertama periode berikutnya, sekaligus hari
-- bayar periode sebelumnya), upahnya sebelumnya tercatat dengan tanggal
-- SELESAI (CURRENT_DATE) — sehingga "lompat" ke periode baru dan tidak
-- ikut terhitung di pembayaran tunai hari itu untuk periode yang baru
-- saja tutup.
--
-- Perbaikannya: kalau tanggal selesai jatuh di minggu penggajian yang
-- BERBEDA dari tanggal mulai (waktu_terima) tahap itu, upahnya dicatat
-- dengan tanggal MULAI, supaya tetap di minggu tempat ia pertama kali
-- terlihat sebagai "sedang dikerjakan". Kalau masih di minggu yang sama
-- (kasus umum — jahit biasanya 1-3 hari), tanggal selesai tetap dipakai
-- seperti sebelumnya, jadi tidak ada perubahan tampilan untuk kasus itu.
-- ================================================================

CREATE OR REPLACE FUNCTION public.awal_minggu_gaji(d date)
RETURNS date
LANGUAGE sql IMMUTABLE
AS $function$
  SELECT d - ((EXTRACT(DOW FROM d)::int + 1) % 7)::int;
$function$;

COMMENT ON FUNCTION public.awal_minggu_gaji(date) IS
  'Tanggal Sabtu yang mengawali minggu penggajian dari tanggal d. Siklus penggajian: Sabtu-Jumat.';

CREATE OR REPLACE FUNCTION public.scan_selesai(
  p_barcode text, p_tahap tahap_produksi, p_karyawan_id uuid, p_qty integer,
  p_catatan text, p_alasan_qty_id uuid, p_user_id uuid, p_tenant_id text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
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
  v_tanggal_upah         date;
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

  -- Kalau selesainya lompat ke minggu penggajian lain dari saat mulai,
  -- tetap catat di minggu mulai supaya tidak lompat periode.
  IF v_waktu_terima IS NOT NULL
     AND awal_minggu_gaji(CURRENT_DATE) <> awal_minggu_gaji(v_waktu_terima) THEN
    v_tanggal_upah := v_waktu_terima;
  ELSE
    v_tanggal_upah := CURRENT_DATE;
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

  SELECT EXISTS (
    SELECT 1 FROM gaji_ledger gl
    WHERE gl.tenant_id = p_tenant_id AND gl.sumber_id = v_bundle.id::text
      AND gl.keterangan LIKE ('Upah ' || v_tahap_text || ' - %')
  ) INTO v_sudah_dibayar_dimuka;

  IF NOT v_sudah_dibayar_dimuka THEN
    SELECT hi.harga_satuan INTO v_rate
    FROM hpp_item hi
    JOIN hpp_komponen hk ON hi.komponen_id = hk.id
    WHERE hi.produk_id = v_bundle.produk_id
      AND hk.tahap_produksi = p_tahap
      AND hi.tenant_id = p_tenant_id;

    IF v_rate IS NOT NULL AND v_rate > 0 AND v_resolved_karyawan IS NOT NULL THEN
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
        v_tanggal_upah,
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

-- Pelunasan pekerjaan yang sedang berjalan (dibayar dimuka) ikut aturan
-- yang sama: kalau hari pelunasan sudah beda minggu dari saat bundle itu
-- mulai dikerjakan, upahnya dicatat di minggu mulai — bukan minggu saat
-- tombol Lunas ditekan. tanggal_bayar tetap hari ini (itu memang hari
-- uangnya benar-benar diberikan).
CREATE OR REPLACE FUNCTION public.lunaskan_upah_pekerja(
  p_karyawan_id uuid, p_dari date, p_sampai date, p_user_id uuid, p_tenant_id text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_jml_lama   INT;
  v_total_lama NUMERIC;
  v_jml_baru   INT := 0;
  v_total_baru NUMERIC := 0;
  v_nama       TEXT;
  v_row        RECORD;
  v_upah       NUMERIC;
  v_tanggal_upah date;
BEGIN
  SELECT nama INTO v_nama FROM karyawan
  WHERE id = p_karyawan_id AND tenant_id = p_tenant_id;

  IF v_nama IS NULL THEN
    RAISE EXCEPTION 'Karyawan tidak ditemukan';
  END IF;

  SELECT COUNT(*), COALESCE(SUM(total),0) INTO v_jml_lama, v_total_lama
  FROM gaji_ledger
  WHERE tenant_id = p_tenant_id AND karyawan_id = p_karyawan_id
    AND status = 'belum_lunas' AND tanggal BETWEEN p_dari AND p_sampai;

  UPDATE gaji_ledger
  SET status = 'lunas', tanggal_bayar = CURRENT_DATE
  WHERE tenant_id = p_tenant_id AND karyawan_id = p_karyawan_id
    AND status = 'belum_lunas' AND tanggal BETWEEN p_dari AND p_sampai;

  FOR v_row IN
    SELECT b.id AS bundle_id, b.barcode, t.tahap,
           COALESCE((b.status_tahap -> t.tahap ->> 'qty_terima')::int, 0) AS qty,
           hi.harga_satuan AS rate,
           (b.status_tahap -> t.tahap ->> 'waktu_terima')::date AS waktu_terima
    FROM bundle b
    JOIN po_item pi ON pi.id = b.po_item_id
    CROSS JOIN LATERAL (VALUES
      ('jahit'),('lubang_kancing'),('buang_benang'),('qc'),('steam'),('packing')
    ) AS t(tahap)
    LEFT JOIN hpp_item hi ON hi.produk_id = pi.produk_id AND hi.tenant_id = p_tenant_id
    LEFT JOIN hpp_komponen hk ON hk.id = hi.komponen_id AND hk.tahap_produksi::text = t.tahap
    WHERE b.tenant_id = p_tenant_id
      AND (b.status_tahap -> t.tahap ->> 'status') = 'terima'
      AND (b.status_tahap -> t.tahap ->> 'karyawan_id')::uuid = p_karyawan_id
      AND (b.status_tahap -> t.tahap ->> 'waktu_terima')::timestamptz <= (p_sampai::date + 1)
      AND hk.id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM gaji_ledger gl
        WHERE gl.tenant_id = p_tenant_id AND gl.sumber_id = b.id::text
          AND gl.keterangan LIKE ('Upah ' || t.tahap || ' - %')
      )
  LOOP
    IF v_row.rate IS NOT NULL AND v_row.rate > 0 AND v_row.qty > 0 THEN
      v_upah := v_row.rate * v_row.qty;
      v_tanggal_upah := CASE
        WHEN v_row.waktu_terima IS NOT NULL
             AND awal_minggu_gaji(CURRENT_DATE) <> awal_minggu_gaji(v_row.waktu_terima)
        THEN v_row.waktu_terima
        ELSE CURRENT_DATE
      END;
      INSERT INTO gaji_ledger (karyawan_id, tipe, total, tanggal, tanggal_bayar,
                               sumber_id, keterangan, status, tenant_id, created_by)
      VALUES (p_karyawan_id, 'selesai'::gaji_ledger_tipe, v_upah, v_tanggal_upah, CURRENT_DATE,
              v_row.bundle_id::text, 'Upah ' || v_row.tahap || ' - ' || v_row.barcode,
              'lunas'::gaji_status, p_tenant_id, p_user_id);
      v_jml_baru   := v_jml_baru + 1;
      v_total_baru := v_total_baru + v_upah;
    END IF;
  END LOOP;

  IF v_jml_lama = 0 AND v_jml_baru = 0 THEN
    RAISE EXCEPTION 'Tidak ada upah yang perlu dibayar untuk % di periode ini', v_nama;
  END IF;

  INSERT INTO audit_log (user_id, modul, aksi, target, metadata, tenant_id)
  VALUES (p_user_id, 'penggajian', 'Lunaskan Upah', v_nama,
          jsonb_build_object('karyawan', v_nama, 'periode_dari', p_dari,
                             'periode_sampai', p_sampai,
                             'jumlah_entri', v_jml_lama + v_jml_baru,
                             'jumlah_dibayar_dimuka', v_jml_baru,
                             'total', v_total_lama + v_total_baru),
          p_tenant_id);

  RETURN jsonb_build_object('success', true, 'nama', v_nama,
                            'jumlah_entri', v_jml_lama + v_jml_baru,
                            'total', v_total_lama + v_total_baru);
END;
$function$;
