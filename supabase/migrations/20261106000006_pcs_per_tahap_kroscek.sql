-- ================================================================
-- MIGRATION: Kroscek Pekerjaan — jumlah pcs dipisah per tahap
--
-- Sama dengan 20261106000004 (Overview Pekerja): tambah kolom
-- pcs_per_tahap (jsonb {tahap: pcs}) supaya pcs tidak dijumlah lintas
-- tahap. Logika lain tidak berubah.
-- ================================================================

CREATE OR REPLACE FUNCTION public.kroscek_pekerja_periode(p_dari date, p_sampai date, p_tenant_id text)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
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
                THEN (SELECT COALESCE(bb.status_tahap->'cutting'->>'qty_dipotong', bb.status_tahap->'cutting'->>'qty_aktual')::int
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
         ARRAY_REMOVE(ARRAY_AGG(DISTINCT g.tahap), NULL)::text[]    AS daftar_tahap,
         COALESCE((
           SELECT jsonb_object_agg(s.tahap, s.pcs)
           FROM (
             SELECT g2.tahap, SUM(g2.qty)::int AS pcs
             FROM gabungan g2
             WHERE g2.karyawan_id = k.id
               AND g2.tahap IN ('cutting','jahit','lubang_kancing','buang_benang','qc','steam','packing')
             GROUP BY g2.tahap
           ) s
         ), '{}'::jsonb) AS pcs_per_tahap
  FROM gabungan g JOIN karyawan k ON k.id = g.karyawan_id
  GROUP BY k.id, k.nama, k.jabatan
) x;
$function$;
