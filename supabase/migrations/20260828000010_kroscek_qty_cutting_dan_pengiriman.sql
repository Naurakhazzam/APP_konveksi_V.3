-- ================================================================
-- MIGRATION: Kroscek — qty cutting, qty per pengiriman, dan id bundle
--
-- Tiga perbaikan pada halaman Kroscek Pekerjaan:
--
--   1. QTY CUTTING. Cutting jalannya lewat "Selesai Cutting" per batch dan
--      TIDAK PERNAH menulis scan_log, sehingga tukang potong selalu tampil
--      0 pcs. Qty-nya kini dibaca dari status_tahap->'cutting'->'qty_aktual'.
--
--   2. QTY UPAH PER PENGIRIMAN. Upah finishing dihitung per SURAT JALAN,
--      sehingga sumber_id entri itu berisi id surat jalan — bukan id bundle.
--      Qty-nya kini dibaca dari surat_jalan_item, dan barisnya menampilkan
--      nomor SJ sebagai ganti barcode.
--
--   3. ID BUNDLE. Rincian ikut membawa bundle_id dan po_item_id supaya
--      tombol Print SK bisa menyusun kartu bundle tanpa query tambahan.
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
           -- upah per surat jalan: qty dari total kiriman
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
         COALESCE(b.id::text, '')      AS bundle_id,
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
  LEFT JOIN bundle b        ON b.id  = e.sumber_uuid
  LEFT JOIN surat_jalan sjh ON sjh.id = e.sumber_uuid
  LEFT JOIN klien klsj      ON klsj.id = sjh.klien_id
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
) x;
$function$;
