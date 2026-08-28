-- ================================================================
-- MIGRATION: Kroscek membaca upah yang dihitung PER PENGIRIMAN
--
-- Upah finishing (lubang kancing, buang benang, QC, steam, packing)
-- untuk Hengky dihitung berdasarkan SURAT JALAN, bukan per bundle:
-- yang dibayar adalah barang yang benar-benar keluar dalam satu siklus
-- gaji Sabtu–Jumat, bukan yang selesai discan.
--
-- Akibatnya gaji_ledger.sumber_id untuk entri itu berisi id SURAT JALAN,
-- bukan id bundle. Tanpa penyesuaian ini Kroscek mencari bundle dengan id
-- tersebut, tidak menemukannya, lalu menampilkan qty 0 dan artikel kosong
-- — pekerjanya muncul tapi angkanya nol, yang justru menyesatkan.
--
-- Kedua fungsi Kroscek kini mengenali tiga bentuk sumber:
--   1. id surat jalan  -> qty dari total qty_kirim surat jalan itu
--   2. id bundle tahap cutting -> qty dari status_tahap (cutting tidak
--      pernah menulis scan_log)
--   3. id bundle tahap lain -> qty dari scan_log seperti biasa
--
-- Pada layar rincian, baris per-pengiriman ditandai "Finishing per
-- pengiriman" dengan nomor surat jalan sebagai rujukannya, supaya tidak
-- tertukar dengan baris per-bundle yang menyebut artikel.
-- ================================================================

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
  CROSS JOIN LATERAL (VALUES
    ('jahit'),('lubang_kancing'),('buang_benang'),('qc'),('steam'),('packing')
  ) AS t(tahap)
  WHERE b.tenant_id = p_tenant_id
    AND (b.status_tahap -> t.tahap ->> 'status') = 'terima'
    AND (b.status_tahap -> t.tahap ->> 'karyawan_id') IS NOT NULL
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
  CROSS JOIN LATERAL (VALUES
    ('jahit'),('lubang_kancing'),('buang_benang'),('qc'),('steam'),('packing')
  ) AS t(tahap)
  WHERE b.tenant_id = p_tenant_id
    AND (b.status_tahap -> t.tahap ->> 'status') = 'terima'
    AND (b.status_tahap -> t.tahap ->> 'karyawan_id')::uuid = p_karyawan_id
    AND (b.status_tahap -> t.tahap ->> 'waktu_terima')::timestamptz <= (p_sampai::date + 1)
),
gabungan AS (SELECT * FROM belum_dibayar UNION ALL SELECT * FROM berjalan)
SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.tanggal DESC, x.no_po, x.model_nama), '[]'::jsonb)
FROM (
  SELECT e.id, e.tanggal, e.tahap, e.keadaan,
         COALESCE(b.id::text, '')        AS bundle_id,
         COALESCE(b.po_item_id::text,'') AS po_item_id,
         COALESCE(
           (SELECT SUM(sji.qty_kirim) FROM surat_jalan_item sji WHERE sji.sj_id = e.sumber_uuid),
           CASE WHEN e.tahap = 'cutting'
                     THEN (b.status_tahap->'cutting'->>'qty_aktual')::int
                WHEN e.keadaan = 'sedang_dikerjakan'
                     THEN (b.status_tahap -> e.tahap ->> 'qty_terima')::int
                ELSE sl.qty END, 0) AS qty,
         COALESCE(b.barcode, sjh.nomor_sj, '-')  AS barcode,
         COALESCE(po.no_po, sjh.nomor_sj, '-')   AS no_po,
         COALESCE(mp.nama,
                  CASE WHEN sjh.id IS NOT NULL THEN 'Finishing per pengiriman' END,
                  '-')                           AS model_nama,
         COALESCE(pi.warna, '-')  AS warna,
         COALESCE(pi.size, '-')   AS size,
         COALESCE(kl.nama, klsj.nama, '-') AS klien_nama
  FROM gabungan e
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
