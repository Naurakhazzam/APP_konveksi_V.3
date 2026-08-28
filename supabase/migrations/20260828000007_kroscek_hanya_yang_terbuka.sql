-- ================================================================
-- MIGRATION: Kroscek Pekerjaan hanya menampilkan yang masih terbuka
--
-- Sebelumnya halaman Kroscek memakai overview_pekerja_periode, yang
-- menampilkan SEMUA pekerjaan selesai — termasuk yang upahnya sudah lunas.
-- Untuk kroscek lapangan itu jadi ramai tanpa guna: pekerjaan yang sudah
-- dibayar dan sudah beres tidak ada lagi yang perlu dicocokkan.
--
-- Dua sumber yang benar-benar perlu dicek ke lapangan:
--   1. Selesai dijahit tapi upahnya BELUM dibayar — masih jadi kewajiban.
--   2. SEDANG dikerjakan — barangnya sedang di tangan pekerja.
--
-- Yang kedua sebelumnya tidak muncul sama sekali, karena catatan upah baru
-- terbentuk saat scan selesai. Padahal justru pekerjaan yang sedang berjalan
-- itulah yang paling sering perlu dicocokkan fisiknya.
--
-- Pekerjaan berjalan disaring dengan waktu_terima <= akhir periode, supaya
-- saat menengok minggu lampau tidak ikut muncul pekerjaan yang baru
-- diserahterimakan sesudahnya.
--
-- Fungsi ini TIDAK mengembalikan nilai upah sama sekali — halaman Kroscek
-- dipakai admin produksi, yang tidak boleh melihat angka rupiah.
-- ================================================================

CREATE OR REPLACE FUNCTION public.kroscek_pekerja_periode(
  p_dari date, p_sampai date, p_tenant_id text
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
WITH belum_dibayar AS (
  SELECT g.karyawan_id,
         NULLIF(split_part(g.keterangan, ' ', 2), '') AS tahap,
         CASE WHEN g.sumber_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              THEN g.sumber_id::uuid END AS bundle_id
  FROM gaji_ledger g
  WHERE g.tenant_id = p_tenant_id
    AND g.status = 'belum_lunas'
    AND g.karyawan_id IS NOT NULL
    AND g.tanggal BETWEEN p_dari AND p_sampai
),
qty_dibayar AS (
  SELECT d.karyawan_id, d.tahap, d.bundle_id, COALESCE(sl.qty, 0) AS qty,
         'belum_dibayar'::text AS keadaan
  FROM belum_dibayar d
  LEFT JOIN LATERAL (
    SELECT s.qty FROM scan_log s
    WHERE s.bundle_id = d.bundle_id AND s.tahap::text = d.tahap
      AND s.tipe = 'selesai' AND s.tenant_id = p_tenant_id
    ORDER BY s.created_at DESC LIMIT 1
  ) sl ON TRUE
),
-- Pekerjaan yang sedang di tangan pekerja, tahap apa pun
berjalan AS (
  SELECT (b.status_tahap -> t.tahap ->> 'karyawan_id')::uuid AS karyawan_id,
         t.tahap,
         b.id AS bundle_id,
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
gabungan AS (
  SELECT * FROM qty_dibayar
  UNION ALL
  SELECT * FROM berjalan
)
SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.total_pcs DESC), '[]'::jsonb)
FROM (
  SELECT k.id                             AS karyawan_id,
         k.nama,
         COALESCE(k.jabatan, '-')         AS jabatan,
         COUNT(*)::int                    AS jumlah_pekerjaan,
         COALESCE(SUM(g.qty), 0)::int     AS total_pcs,
         COUNT(*) FILTER (WHERE g.keadaan = 'belum_dibayar')::int     AS jml_belum_dibayar,
         COUNT(*) FILTER (WHERE g.keadaan = 'sedang_dikerjakan')::int AS jml_sedang_dikerjakan,
         ARRAY_REMOVE(ARRAY_AGG(DISTINCT g.tahap), NULL)::text[]      AS daftar_tahap
  FROM gabungan g
  JOIN karyawan k ON k.id = g.karyawan_id
  GROUP BY k.id, k.nama, k.jabatan
) x;
$function$;


CREATE OR REPLACE FUNCTION public.kroscek_detail_pekerja(
  p_karyawan_id uuid, p_dari date, p_sampai date, p_tenant_id text
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
WITH belum_dibayar AS (
  SELECT g.id::text AS id, g.tanggal,
         NULLIF(split_part(g.keterangan, ' ', 2), '') AS tahap,
         CASE WHEN g.sumber_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              THEN g.sumber_id::uuid END AS bundle_id,
         'belum_dibayar'::text AS keadaan
  FROM gaji_ledger g
  WHERE g.tenant_id = p_tenant_id AND g.karyawan_id = p_karyawan_id
    AND g.status = 'belum_lunas'
    AND g.tanggal BETWEEN p_dari AND p_sampai
),
berjalan AS (
  SELECT b.id::text || '-' || t.tahap AS id,
         (b.status_tahap -> t.tahap ->> 'waktu_terima')::date AS tanggal,
         t.tahap, b.id AS bundle_id,
         'sedang_dikerjakan'::text AS keadaan
  FROM bundle b
  CROSS JOIN LATERAL (VALUES
    ('jahit'),('lubang_kancing'),('buang_benang'),('qc'),('steam'),('packing')
  ) AS t(tahap)
  WHERE b.tenant_id = p_tenant_id
    AND (b.status_tahap -> t.tahap ->> 'status') = 'terima'
    AND (b.status_tahap -> t.tahap ->> 'karyawan_id')::uuid = p_karyawan_id
    AND (b.status_tahap -> t.tahap ->> 'waktu_terima')::timestamptz <= (p_sampai::date + 1)
),
gabungan AS (
  SELECT * FROM belum_dibayar UNION ALL SELECT * FROM berjalan
)
SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.tanggal DESC, x.no_po, x.model_nama), '[]'::jsonb)
FROM (
  SELECT e.id, e.tanggal, e.tahap, e.keadaan,
         COALESCE(
           CASE WHEN e.keadaan = 'sedang_dikerjakan'
                THEN (b.status_tahap -> e.tahap ->> 'qty_terima')::int
                ELSE sl.qty END, 0)      AS qty,
         COALESCE(b.barcode, '-')        AS barcode,
         COALESCE(po.no_po, '-')         AS no_po,
         COALESCE(mp.nama, '-')          AS model_nama,
         COALESCE(pi.warna, '-')         AS warna,
         COALESCE(pi.size, '-')          AS size,
         COALESCE(kl.nama, '-')          AS klien_nama
  FROM gabungan e
  LEFT JOIN bundle b        ON b.id  = e.bundle_id
  LEFT JOIN po              ON po.id = b.po_id
  LEFT JOIN klien kl        ON kl.id = po.klien_id
  LEFT JOIN po_item pi      ON pi.id = b.po_item_id
  LEFT JOIN produk pr       ON pr.id = pi.produk_id
  LEFT JOIN model_produk mp ON mp.id = pr.model_id
  LEFT JOIN LATERAL (
    SELECT s.qty FROM scan_log s
    WHERE s.bundle_id = e.bundle_id AND s.tahap::text = e.tahap
      AND s.tipe = 'selesai' AND s.tenant_id = p_tenant_id
    ORDER BY s.created_at DESC LIMIT 1
  ) sl ON TRUE
) x;
$function$;

GRANT EXECUTE ON FUNCTION public.kroscek_pekerja_periode(date, date, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.kroscek_detail_pekerja(uuid, date, date, text) TO authenticated;
