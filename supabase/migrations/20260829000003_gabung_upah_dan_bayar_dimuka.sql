-- ================================================================
-- MIGRATION: Upah berjalan digabung, pelunasan mencakup yang sedang
-- dikerjakan (dibayar dimuka) supaya tidak muncul lagi minggu depan
--
-- Sebelumnya upah pekerjaan yang masih dipegang penjahit (belum discan
-- selesai) ditampilkan terpisah sebagai "perkiraan" dan TIDAK ikut saat
-- tombol Lunas ditekan. Sekarang digabung jadi satu angka, dan saat
-- pelunasan ditekan, pekerjaan yang sedang berjalan itu ikut dibayar
-- dimuka — dicatat sebagai entri gaji_ledger sungguhan berstatus lunas.
--
-- Supaya tidak terjadi bayar dobel saat bundle itu nanti benar-benar
-- discan selesai, dua penyesuaian dibuat:
--
--   1. scan_selesai TIDAK membuat entri upah baru jika bundle+tahap itu
--      sudah punya entri gaji_ledger (berarti sudah dibayar dimuka).
--   2. overview_pekerja_periode / detail_pekerja_periode TIDAK lagi
--      menghitung bundle+tahap itu sebagai "sedang dikerjakan" begitu
--      sudah dibayar dimuka, walau bundle-nya secara fisik masih di
--      tangan penjahit dan belum discan selesai.
-- ================================================================

CREATE OR REPLACE FUNCTION public.overview_pekerja_periode(
  p_dari date, p_sampai date, p_tenant_id text
)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
WITH belum_dibayar AS (
  SELECT g.karyawan_id, g.total, g.tipe,
         NULLIF(split_part(g.keterangan, ' ', 2), '') AS tahap,
         CASE WHEN g.sumber_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              THEN g.sumber_id::uuid END AS sumber_uuid
  FROM gaji_ledger g
  WHERE g.tenant_id = p_tenant_id AND g.status = 'belum_lunas'
    AND g.karyawan_id IS NOT NULL
    AND g.tanggal BETWEEN p_dari AND p_sampai
),
terbuka AS (
  SELECT d.karyawan_id, d.tahap, d.total AS upah, d.tipe,
         COALESCE(
           (SELECT SUM(sji.qty_kirim) FROM surat_jalan_item sji WHERE sji.sj_id = d.sumber_uuid),
           CASE WHEN d.tahap = 'cutting'
                THEN (SELECT (bb.status_tahap->'cutting'->>'qty_aktual')::int
                      FROM bundle bb WHERE bb.id = d.sumber_uuid)
                ELSE sl.qty END, 0) AS qty,
         'belum_dibayar'::text AS keadaan
  FROM belum_dibayar d
  LEFT JOIN LATERAL (
    SELECT s.qty FROM scan_log s
    WHERE s.bundle_id = d.sumber_uuid AND s.tahap::text = d.tahap
      AND s.tipe = 'selesai' AND s.tenant_id = p_tenant_id
    ORDER BY s.created_at DESC LIMIT 1
  ) sl ON TRUE
  UNION ALL
  -- Pekerjaan yang masih dipegang: upahnya diperkirakan dari tarif HPP dan
  -- DIGABUNG ke total (bukan kolom terpisah lagi). Bundle+tahap yang sudah
  -- dibayar dimuka (lihat lunaskan_upah_pekerja) tidak ikut di sini lagi.
  SELECT (b.status_tahap -> t.tahap ->> 'karyawan_id')::uuid, t.tahap,
         COALESCE((b.status_tahap -> t.tahap ->> 'qty_terima')::int, 0) * COALESCE(hi.harga_satuan, 0),
         'selesai'::gaji_ledger_tipe,
         COALESCE((b.status_tahap -> t.tahap ->> 'qty_terima')::int, 0),
         'sedang_dikerjakan'::text
  FROM bundle b
  CROSS JOIN LATERAL (VALUES
    ('jahit'),('lubang_kancing'),('buang_benang'),('qc'),('steam'),('packing')
  ) AS t(tahap)
  JOIN po_item pi ON pi.id = b.po_item_id
  LEFT JOIN hpp_item hi ON hi.produk_id = pi.produk_id AND hi.tenant_id = p_tenant_id
  LEFT JOIN hpp_komponen hk ON hk.id = hi.komponen_id AND hk.tahap_produksi::text = t.tahap
  WHERE b.tenant_id = p_tenant_id
    AND (b.status_tahap -> t.tahap ->> 'status') = 'terima'
    AND (b.status_tahap -> t.tahap ->> 'karyawan_id') IS NOT NULL
    AND (b.status_tahap -> t.tahap ->> 'waktu_terima')::timestamptz <= (p_sampai::date + 1)
    AND hk.id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM gaji_ledger gl
      WHERE gl.tenant_id = p_tenant_id AND gl.sumber_id = b.id::text
        AND gl.keterangan LIKE ('Upah ' || t.tahap || ' - %')
    )
)
SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.total_upah DESC), '[]'::jsonb)
FROM (
  SELECT k.id AS karyawan_id, k.nama, COALESCE(k.jabatan,'-') AS jabatan,
         COUNT(*)::int                AS jumlah_pekerjaan,
         COALESCE(SUM(o.qty),0)::int  AS total_pcs,
         (COALESCE(SUM(o.upah) FILTER (WHERE o.tipe IN ('selesai','rework')),0)
          - COALESCE(SUM(o.upah) FILTER (WHERE o.tipe='reject_potong'),0))::numeric AS total_upah,
         0::numeric                   AS upah_lunas,
         COALESCE(SUM(o.upah),0)::numeric AS upah_belum_lunas,
         COALESCE(SUM(o.upah) FILTER (WHERE o.keadaan='sedang_dikerjakan'),0)::numeric AS upah_perkiraan,
         COALESCE(SUM(o.upah) FILTER (WHERE o.tipe='reject_potong'),0)::numeric AS total_potongan,
         COUNT(*) FILTER (WHERE o.keadaan='belum_dibayar')::int     AS jml_belum_dibayar,
         COUNT(*) FILTER (WHERE o.keadaan='sedang_dikerjakan')::int AS jml_sedang_dikerjakan,
         ARRAY_REMOVE(ARRAY_AGG(DISTINCT o.tahap), NULL)::text[]    AS daftar_tahap
  FROM terbuka o JOIN karyawan k ON k.id = o.karyawan_id
  GROUP BY k.id, k.nama, k.jabatan
) x;
$function$;

CREATE OR REPLACE FUNCTION public.detail_pekerja_periode(
  p_karyawan_id uuid, p_dari date, p_sampai date, p_tenant_id text
)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
WITH baris AS (
  SELECT g.id::text AS id, g.tanggal, g.tanggal_bayar, g.total AS upah, g.tipe, g.status,
         NULLIF(split_part(g.keterangan, ' ', 2), '') AS tahap,
         CASE WHEN g.sumber_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              THEN g.sumber_id::uuid END AS sumber_uuid,
         'belum_dibayar'::text AS keadaan
  FROM gaji_ledger g
  WHERE g.tenant_id = p_tenant_id AND g.karyawan_id = p_karyawan_id
    AND g.status = 'belum_lunas' AND g.tanggal BETWEEN p_dari AND p_sampai
  UNION ALL
  SELECT b.id::text || '-' || t.tahap, (b.status_tahap -> t.tahap ->> 'waktu_terima')::date,
         NULL,
         COALESCE((b.status_tahap -> t.tahap ->> 'qty_terima')::int,0) * COALESCE(hi.harga_satuan,0),
         'selesai'::gaji_ledger_tipe, 'belum_lunas'::gaji_status,
         t.tahap, b.id, 'sedang_dikerjakan'::text
  FROM bundle b
  CROSS JOIN LATERAL (VALUES
    ('jahit'),('lubang_kancing'),('buang_benang'),('qc'),('steam'),('packing')
  ) AS t(tahap)
  JOIN po_item pi ON pi.id = b.po_item_id
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
)
SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.tanggal DESC, x.no_po, x.model_nama), '[]'::jsonb)
FROM (
  SELECT e.id, e.tanggal, e.tahap, e.tipe, e.status, e.tanggal_bayar, e.upah, e.keadaan,
         COALESCE(
           (SELECT SUM(sji.qty_kirim) FROM surat_jalan_item sji WHERE sji.sj_id = e.sumber_uuid),
           CASE WHEN e.tahap = 'cutting'
                     THEN (b.status_tahap->'cutting'->>'qty_aktual')::int
                WHEN e.keadaan = 'sedang_dikerjakan'
                     THEN (b.status_tahap -> e.tahap ->> 'qty_terima')::int
                ELSE sl.qty END, 0) AS qty,
         COALESCE(b.barcode, sjh.nomor_sj, '-') AS barcode,
         COALESCE(po.no_po, sjh.nomor_sj, '-')  AS no_po,
         COALESCE(mp.nama,
                  CASE WHEN sjh.id IS NOT NULL THEN 'Finishing per pengiriman' END,
                  '-')                          AS model_nama,
         COALESCE(pr.nama, '-')  AS produk_nama,
         COALESCE(pi.warna, '-') AS warna,
         COALESCE(pi.size, '-')  AS size,
         COALESCE(kl.nama, klsj.nama, '-') AS klien_nama
  FROM baris e
  LEFT JOIN bundle b        ON b.id   = e.sumber_uuid
  LEFT JOIN surat_jalan sjh ON sjh.id = e.sumber_uuid
  LEFT JOIN klien klsj      ON klsj.id = sjh.klien_id
  LEFT JOIN po              ON po.id  = b.po_id
  LEFT JOIN klien kl        ON kl.id  = po.klien_id
  LEFT JOIN po_item pi      ON pi.id  = b.po_item_id
  LEFT JOIN produk pr       ON pr.id  = pi.produk_id
  LEFT JOIN model_produk mp ON mp.id  = pr.model_id
  LEFT JOIN LATERAL (
    SELECT s.qty FROM scan_log s
    WHERE s.bundle_id = e.sumber_uuid AND s.tahap::text = e.tahap
      AND s.tipe = 'selesai' AND s.tenant_id = p_tenant_id
    ORDER BY s.created_at DESC LIMIT 1
  ) sl ON TRUE
) x;
$function$;

-- Pelunasan satu pekerja untuk satu periode. Yang sedang dikerjakan ikut
-- dibayar dimuka memakai perkiraan qty x tarif HPP, dicatat sebagai entri
-- gaji_ledger sungguhan berstatus 'lunas' supaya scan_selesai nanti tidak
-- membuat entri kedua untuk bundle+tahap yang sama.
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
  v_rate       NUMERIC;
  v_upah       NUMERIC;
BEGIN
  SELECT nama INTO v_nama FROM karyawan
  WHERE id = p_karyawan_id AND tenant_id = p_tenant_id;

  IF v_nama IS NULL THEN
    RAISE EXCEPTION 'Karyawan tidak ditemukan';
  END IF;

  -- 1) Upah yang entrinya sudah terbentuk
  SELECT COUNT(*), COALESCE(SUM(total),0) INTO v_jml_lama, v_total_lama
  FROM gaji_ledger
  WHERE tenant_id = p_tenant_id AND karyawan_id = p_karyawan_id
    AND status = 'belum_lunas' AND tanggal BETWEEN p_dari AND p_sampai;

  UPDATE gaji_ledger
  SET status = 'lunas', tanggal_bayar = CURRENT_DATE
  WHERE tenant_id = p_tenant_id AND karyawan_id = p_karyawan_id
    AND status = 'belum_lunas' AND tanggal BETWEEN p_dari AND p_sampai;

  -- 2) Pekerjaan yang masih dipegang: dibayar dimuka sekarang. Karena
  --    entrinya langsung dibuat berstatus lunas, ini tidak akan muncul
  --    lagi sebagai kewajiban minggu depan, dan scan_selesai tidak akan
  --    membuat entri kedua saat bundle ini nanti benar-benar selesai.
  FOR v_row IN
    SELECT b.id AS bundle_id, b.barcode, t.tahap,
           COALESCE((b.status_tahap -> t.tahap ->> 'qty_terima')::int, 0) AS qty,
           hi.harga_satuan AS rate
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
      INSERT INTO gaji_ledger (karyawan_id, tipe, total, tanggal, tanggal_bayar,
                               sumber_id, keterangan, status, tenant_id, created_by)
      VALUES (p_karyawan_id, 'selesai'::gaji_ledger_tipe, v_upah, CURRENT_DATE, CURRENT_DATE,
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

-- scan_selesai: jangan buat entri upah kedua kalau bundle+tahap ini sudah
-- pernah dibayar (baik lewat jalur normal maupun dibayar dimuka).
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

  -- Bundle+tahap ini mungkin sudah dibayar dimuka lewat pelunasan
  -- Overview Pekerja saat masih berjalan — jangan bayar dua kali.
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

    -- GUARD: hanya insert jika rate > 0 (hindari constraint total <> 0)
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
        CURRENT_DATE,
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
