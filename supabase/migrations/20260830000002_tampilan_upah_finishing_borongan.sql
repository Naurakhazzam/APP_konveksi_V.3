-- ================================================================
-- MIGRATION: RPC tampilan menyesuaikan aturan upah finishing borongan
--
-- Karena upah finishing borongan (lubang_kancing, buang_benang, qc,
-- steam, packing) sekarang baru terbentuk saat dikirim (lihat migrasi
-- upah_finishing_borongan_dari_surat_jalan), dua penyesuaian dibuat di
-- semua RPC tampilan:
--
--   1. "Sedang dikerjakan" (estimasi pekerjaan berjalan) TIDAK lagi
--      dihitung untuk 5 tahap itu — cuma jahit yang masih relevan
--      punya estimasi berjalan, karena finishing borongan tidak ada
--      lagi konsep "upah sementara sebelum dikirim".
--   2. Qty & artikel bisa dibaca dari entri yang sumbernya SATU BARIS
--      surat_jalan_item (bukan bundle atau surat_jalan utuh seperti
--      sebelumnya).
--
-- Berlaku di overview_pekerja_periode, detail_pekerja_periode,
-- kroscek_pekerja_periode, kroscek_detail_pekerja, dan
-- lunaskan_upah_pekerja (prepay juga cuma relevan untuk jahit sekarang).
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
           (SELECT qty_kirim FROM surat_jalan_item WHERE id = d.sumber_uuid),
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
  -- Estimasi pekerjaan berjalan cuma relevan untuk jahit — finishing
  -- borongan tidak ada lagi upah sebelum benar-benar dikirim.
  SELECT (b.status_tahap -> t.tahap ->> 'karyawan_id')::uuid, t.tahap,
         COALESCE((b.status_tahap -> t.tahap ->> 'qty_terima')::int, 0) * COALESCE(hi.harga_satuan, 0),
         'selesai'::gaji_ledger_tipe,
         COALESCE((b.status_tahap -> t.tahap ->> 'qty_terima')::int, 0),
         'sedang_dikerjakan'::text
  FROM bundle b
  CROSS JOIN LATERAL (VALUES ('jahit')) AS t(tahap)
  JOIN po_item pi ON pi.id = b.po_item_id
  LEFT JOIN hpp_item hi ON hi.produk_id = pi.produk_id AND hi.tenant_id = p_tenant_id
  LEFT JOIN hpp_komponen hk ON hk.id = hi.komponen_id AND hk.tahap_produksi::text = t.tahap
  WHERE b.tenant_id = p_tenant_id
    AND (b.status_tahap -> t.tahap ->> 'status') = 'terima'
    AND (b.status_tahap -> t.tahap ->> 'karyawan_id') IS NOT NULL
    AND (b.status_tahap -> t.tahap ->> 'waktu_terima')::timestamptz >= p_dari::date
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
  CROSS JOIN LATERAL (VALUES ('jahit')) AS t(tahap)
  JOIN po_item pi ON pi.id = b.po_item_id
  LEFT JOIN hpp_item hi ON hi.produk_id = pi.produk_id AND hi.tenant_id = p_tenant_id
  LEFT JOIN hpp_komponen hk ON hk.id = hi.komponen_id AND hk.tahap_produksi::text = t.tahap
  WHERE b.tenant_id = p_tenant_id
    AND (b.status_tahap -> t.tahap ->> 'status') = 'terima'
    AND (b.status_tahap -> t.tahap ->> 'karyawan_id')::uuid = p_karyawan_id
    AND (b.status_tahap -> t.tahap ->> 'waktu_terima')::timestamptz >= p_dari::date
    AND (b.status_tahap -> t.tahap ->> 'waktu_terima')::timestamptz <= (p_sampai::date + 1)
    AND hk.id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM gaji_ledger gl
      WHERE gl.tenant_id = p_tenant_id AND gl.sumber_id = b.id::text
        AND gl.keterangan LIKE ('Upah ' || t.tahap || ' - %')
    )
),
-- Baris bersumber satu bundle (kasus umum, termasuk jahit/cutting).
dasar_bundle AS (
  SELECT e.id, e.tanggal, e.tahap, e.tipe, e.status, e.tanggal_bayar, e.upah, e.keadaan,
         COALESCE(
           CASE WHEN e.tahap = 'cutting'
                     THEN (b.status_tahap->'cutting'->>'qty_aktual')::int
                WHEN e.keadaan = 'sedang_dikerjakan'
                     THEN (b.status_tahap -> e.tahap ->> 'qty_terima')::int
                ELSE sl.qty END, 0) AS qty,
         b.barcode AS barcode,
         po.no_po  AS no_po,
         COALESCE(mp.nama, '-') AS model_nama,
         COALESCE(pr.nama, '-') AS produk_nama,
         COALESCE(pi.warna, '-') AS warna,
         COALESCE(pi.size, '-')  AS size,
         COALESCE(kl.nama, '-') AS klien_nama
  FROM baris e
  JOIN bundle b        ON b.id  = e.sumber_uuid
  LEFT JOIN po              ON po.id = b.po_id
  LEFT JOIN klien kl        ON kl.id = po.klien_id
  LEFT JOIN po_item pi      ON pi.id = b.po_item_id
  LEFT JOIN produk pr       ON pr.id = pi.produk_id
  LEFT JOIN model_produk mp ON mp.id = pr.model_id
  LEFT JOIN LATERAL (
    SELECT s.qty FROM scan_log s
    WHERE s.bundle_id = e.sumber_uuid AND s.tahap::text = e.tahap
      AND s.tipe = 'selesai' AND s.tenant_id = p_tenant_id
    ORDER BY s.created_at DESC LIMIT 1
  ) sl ON TRUE
),
-- Baris bersumber satu ITEM surat jalan — upah finishing borongan per
-- pengiriman (skema baru, satu baris per tahap per item, bukan lump-sum).
dasar_sji AS (
  SELECT e.id, e.tanggal, e.tahap, e.tipe, e.status, e.tanggal_bayar, e.upah, e.keadaan,
         sji.qty_kirim AS qty,
         b3.barcode AS barcode,
         po3.no_po  AS no_po,
         COALESCE(mp3.nama, '-') AS model_nama,
         COALESCE(pr3.nama, '-') AS produk_nama,
         COALESCE(pi3.warna, '-') AS warna,
         COALESCE(pi3.size, '-')  AS size,
         COALESCE(kl3.nama, '-') AS klien_nama
  FROM baris e
  JOIN surat_jalan_item sji  ON sji.id = e.sumber_uuid
  JOIN bundle b3             ON b3.id = sji.bundle_id
  LEFT JOIN po po3           ON po3.id = b3.po_id
  LEFT JOIN klien kl3        ON kl3.id = po3.klien_id
  LEFT JOIN po_item pi3      ON pi3.id = b3.po_item_id
  LEFT JOIN produk pr3       ON pr3.id = pi3.produk_id
  LEFT JOIN model_produk mp3 ON mp3.id = pr3.model_id
),
-- Baris lump-sum lama (SJ 60/73, sebelum aturan per-item ini ada) —
-- dipecah per artikel saat ditampilkan seperti sebelumnya.
dasar_sj_raw AS (
  SELECT e.id AS orig_id, e.id || '-' || b2.id::text AS id, e.tanggal, e.tahap, e.tipe,
         e.status, e.tanggal_bayar,
         (sji2.qty_kirim * hi2.harga_satuan)::numeric AS upah, e.keadaan,
         sji2.qty_kirim AS qty,
         b2.barcode AS barcode,
         po2.no_po  AS no_po,
         COALESCE(mp2.nama, '-') AS model_nama,
         COALESCE(pr2.nama, '-') AS produk_nama,
         COALESCE(pi2.warna, '-') AS warna,
         COALESCE(pi2.size, '-')  AS size,
         COALESCE(kl2.nama, '-') AS klien_nama
  FROM baris e
  JOIN surat_jalan sjh       ON sjh.id = e.sumber_uuid
  JOIN surat_jalan_item sji2 ON sji2.sj_id = sjh.id
  JOIN bundle b2             ON b2.id = sji2.bundle_id
  JOIN po_item pi2           ON pi2.id = b2.po_item_id
  JOIN hpp_item hi2          ON hi2.produk_id = pi2.produk_id AND hi2.tenant_id = p_tenant_id
  JOIN hpp_komponen hk2      ON hk2.id = hi2.komponen_id AND hk2.tahap_produksi::text = e.tahap
  LEFT JOIN po po2           ON po2.id = b2.po_id
  LEFT JOIN klien kl2        ON kl2.id = po2.klien_id
  LEFT JOIN produk pr2       ON pr2.id = pi2.produk_id
  LEFT JOIN model_produk mp2 ON mp2.id = pr2.model_id
  WHERE hi2.harga_satuan > 0
),
dasar_fallback AS (
  SELECT e.id, e.tanggal, e.tahap, e.tipe, e.status, e.tanggal_bayar, e.upah, e.keadaan,
         COALESCE((SELECT SUM(sji.qty_kirim) FROM surat_jalan_item sji WHERE sji.sj_id = e.sumber_uuid), 0) AS qty,
         COALESCE(sjh.nomor_sj, '-') AS barcode,
         COALESCE(sjh.nomor_sj, '-') AS no_po,
         CASE WHEN sjh.id IS NOT NULL THEN 'Finishing per pengiriman' ELSE '-' END AS model_nama,
         '-'::text AS produk_nama, '-'::text AS warna, '-'::text AS size,
         COALESCE(klsj.nama, '-') AS klien_nama
  FROM baris e
  LEFT JOIN surat_jalan sjh ON sjh.id = e.sumber_uuid
  LEFT JOIN klien klsj      ON klsj.id = sjh.klien_id
  WHERE NOT EXISTS (SELECT 1 FROM bundle bx WHERE bx.id = e.sumber_uuid)
    AND NOT EXISTS (SELECT 1 FROM surat_jalan_item six WHERE six.id = e.sumber_uuid)
    AND NOT EXISTS (SELECT 1 FROM dasar_sj_raw r WHERE r.orig_id = e.id)
),
dasar AS (
  SELECT id, tanggal, tahap, tipe, status, tanggal_bayar, upah, keadaan, qty,
         barcode, no_po, model_nama, produk_nama, warna, size, klien_nama
  FROM dasar_bundle
  UNION ALL
  SELECT id, tanggal, tahap, tipe, status, tanggal_bayar, upah, keadaan, qty,
         barcode, no_po, model_nama, produk_nama, warna, size, klien_nama
  FROM dasar_sji
  UNION ALL
  SELECT id, tanggal, tahap, tipe, status, tanggal_bayar, upah, keadaan, qty,
         barcode, no_po, model_nama, produk_nama, warna, size, klien_nama
  FROM dasar_sj_raw
  UNION ALL
  SELECT id, tanggal, tahap, tipe, status, tanggal_bayar, upah, keadaan, qty,
         barcode, no_po, model_nama, produk_nama, warna, size, klien_nama
  FROM dasar_fallback
)
SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.tanggal DESC, x.no_po, x.model_nama), '[]'::jsonb)
FROM (
  SELECT d.*, CASE WHEN d.qty > 0 THEN ROUND(d.upah / d.qty) ELSE 0 END AS harga_per_pcs
  FROM dasar d
) x;
$function$;

CREATE OR REPLACE FUNCTION public.kroscek_pekerja_periode(
  p_dari date, p_sampai date, p_tenant_id text
)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
WITH belum_dibayar AS (
  SELECT g.karyawan_id,
         NULLIF(split_part(g.keterangan, ' ', 2), '') AS tahap,
         CASE WHEN g.sumber_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              THEN g.sumber_id::uuid END AS sumber_uuid
  FROM gaji_ledger g
  WHERE g.tenant_id = p_tenant_id AND g.status = 'belum_lunas'
    AND g.karyawan_id IS NOT NULL
    AND g.tanggal BETWEEN p_dari AND p_sampai
),
qty_dibayar AS (
  SELECT d.karyawan_id, d.tahap, d.sumber_uuid AS bundle_id,
         COALESCE(
           (SELECT qty_kirim FROM surat_jalan_item WHERE id = d.sumber_uuid),
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
),
berjalan AS (
  SELECT (b.status_tahap -> t.tahap ->> 'karyawan_id')::uuid AS karyawan_id,
         t.tahap, b.id AS bundle_id,
         COALESCE((b.status_tahap -> t.tahap ->> 'qty_terima')::int, 0) AS qty,
         'sedang_dikerjakan'::text AS keadaan
  FROM bundle b
  CROSS JOIN LATERAL (VALUES ('jahit')) AS t(tahap)
  WHERE b.tenant_id = p_tenant_id
    AND (b.status_tahap -> t.tahap ->> 'status') = 'terima'
    AND (b.status_tahap -> t.tahap ->> 'karyawan_id') IS NOT NULL
    AND (b.status_tahap -> t.tahap ->> 'waktu_terima')::timestamptz >= p_dari::date
    AND (b.status_tahap -> t.tahap ->> 'waktu_terima')::timestamptz <= (p_sampai::date + 1)
),
gabungan AS (SELECT * FROM qty_dibayar UNION ALL SELECT * FROM berjalan)
SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.total_pcs DESC), '[]'::jsonb)
FROM (
  SELECT k.id AS karyawan_id, k.nama, COALESCE(k.jabatan,'-') AS jabatan,
         COUNT(*)::int AS jumlah_pekerjaan,
         COALESCE(SUM(g.qty),0)::int AS total_pcs,
         COUNT(*) FILTER (WHERE g.keadaan='belum_dibayar')::int     AS jml_belum_dibayar,
         COUNT(*) FILTER (WHERE g.keadaan='sedang_dikerjakan')::int AS jml_sedang_dikerjakan,
         ARRAY_REMOVE(ARRAY_AGG(DISTINCT g.tahap), NULL)::text[]    AS daftar_tahap
  FROM gabungan g JOIN karyawan k ON k.id = g.karyawan_id
  GROUP BY k.id, k.nama, k.jabatan
) x;
$function$;

CREATE OR REPLACE FUNCTION public.kroscek_detail_pekerja(
  p_karyawan_id uuid, p_dari date, p_sampai date, p_tenant_id text
)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
WITH belum_dibayar AS (
  SELECT g.id::text AS id, g.tanggal,
         NULLIF(split_part(g.keterangan, ' ', 2), '') AS tahap,
         CASE WHEN g.sumber_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              THEN g.sumber_id::uuid END AS sumber_uuid,
         'belum_dibayar'::text AS keadaan
  FROM gaji_ledger g
  WHERE g.tenant_id = p_tenant_id AND g.karyawan_id = p_karyawan_id
    AND g.status = 'belum_lunas' AND g.tanggal BETWEEN p_dari AND p_sampai
),
berjalan AS (
  SELECT b.id::text || '-' || t.tahap AS id,
         (b.status_tahap -> t.tahap ->> 'waktu_terima')::date AS tanggal,
         t.tahap, b.id AS sumber_uuid, 'sedang_dikerjakan'::text AS keadaan
  FROM bundle b
  CROSS JOIN LATERAL (VALUES ('jahit')) AS t(tahap)
  WHERE b.tenant_id = p_tenant_id
    AND (b.status_tahap -> t.tahap ->> 'status') = 'terima'
    AND (b.status_tahap -> t.tahap ->> 'karyawan_id')::uuid = p_karyawan_id
    AND (b.status_tahap -> t.tahap ->> 'waktu_terima')::timestamptz >= p_dari::date
    AND (b.status_tahap -> t.tahap ->> 'waktu_terima')::timestamptz <= (p_sampai::date + 1)
),
gabungan AS (SELECT * FROM belum_dibayar UNION ALL SELECT * FROM berjalan)
SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.tanggal DESC, x.no_po, x.model_nama), '[]'::jsonb)
FROM (
  SELECT e.id, e.tanggal, e.tahap, e.keadaan,
         COALESCE(b.id::text, sji.bundle_id::text, '')      AS bundle_id,
         COALESCE(b.po_item_id::text, b3.po_item_id::text, '') AS po_item_id,
         COALESCE(
           (SELECT qty_kirim FROM surat_jalan_item WHERE id = e.sumber_uuid),
           (SELECT SUM(sji2.qty_kirim) FROM surat_jalan_item sji2 WHERE sji2.sj_id = e.sumber_uuid),
           CASE WHEN e.tahap = 'cutting'
                     THEN (b.status_tahap->'cutting'->>'qty_aktual')::int
                WHEN e.keadaan = 'sedang_dikerjakan'
                     THEN (b.status_tahap -> e.tahap ->> 'qty_terima')::int
                ELSE sl.qty END, 0) AS qty,
         COALESCE(b.barcode, b3.barcode, sjh.nomor_sj, '-')  AS barcode,
         COALESCE(po.no_po, po3.no_po, sjh.nomor_sj, '-')   AS no_po,
         COALESCE(mp.nama, mp3.nama,
                  CASE WHEN sjh.id IS NOT NULL THEN 'Finishing per pengiriman' END,
                  '-')                           AS model_nama,
         COALESCE(pi.warna, pi3.warna, '-')  AS warna,
         COALESCE(pi.size, pi3.size, '-')   AS size,
         COALESCE(kl.nama, kl3.nama, klsj.nama, '-') AS klien_nama
  FROM gabungan e
  LEFT JOIN bundle b        ON b.id  = e.sumber_uuid
  LEFT JOIN surat_jalan_item sji ON sji.id = e.sumber_uuid
  LEFT JOIN bundle b3       ON b3.id = sji.bundle_id
  LEFT JOIN surat_jalan sjh ON sjh.id = e.sumber_uuid
  LEFT JOIN klien klsj      ON klsj.id = sjh.klien_id
  LEFT JOIN po              ON po.id = b.po_id
  LEFT JOIN klien kl        ON kl.id = po.klien_id
  LEFT JOIN po_item pi      ON pi.id = b.po_item_id
  LEFT JOIN produk pr       ON pr.id = pi.produk_id
  LEFT JOIN model_produk mp ON mp.id = pr.model_id
  LEFT JOIN po po3          ON po3.id = b3.po_id
  LEFT JOIN klien kl3       ON kl3.id = po3.klien_id
  LEFT JOIN po_item pi3     ON pi3.id = b3.po_item_id
  LEFT JOIN produk pr3      ON pr3.id = pi3.produk_id
  LEFT JOIN model_produk mp3 ON mp3.id = pr3.model_id
  LEFT JOIN LATERAL (
    SELECT s.qty FROM scan_log s
    WHERE s.bundle_id = e.sumber_uuid AND s.tahap::text = e.tahap
      AND s.tipe = 'selesai' AND s.tenant_id = p_tenant_id
    ORDER BY s.created_at DESC LIMIT 1
  ) sl ON TRUE
) x;
$function$;

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

  -- Pekerjaan yang masih berjalan (dibayar dimuka) cuma relevan untuk
  -- jahit sekarang — finishing borongan tidak ada lagi konsep berjalan.
  FOR v_row IN
    SELECT b.id AS bundle_id, b.barcode, t.tahap,
           COALESCE((b.status_tahap -> t.tahap ->> 'qty_terima')::int, 0) AS qty,
           hi.harga_satuan AS rate,
           (b.status_tahap -> t.tahap ->> 'waktu_terima')::date AS waktu_terima
    FROM bundle b
    JOIN po_item pi ON pi.id = b.po_item_id
    CROSS JOIN LATERAL (VALUES ('jahit')) AS t(tahap)
    LEFT JOIN hpp_item hi ON hi.produk_id = pi.produk_id AND hi.tenant_id = p_tenant_id
    LEFT JOIN hpp_komponen hk ON hk.id = hi.komponen_id AND hk.tahap_produksi::text = t.tahap
    WHERE b.tenant_id = p_tenant_id
      AND (b.status_tahap -> t.tahap ->> 'status') = 'terima'
      AND (b.status_tahap -> t.tahap ->> 'karyawan_id')::uuid = p_karyawan_id
      AND (b.status_tahap -> t.tahap ->> 'waktu_terima')::timestamptz >= p_dari::date
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
