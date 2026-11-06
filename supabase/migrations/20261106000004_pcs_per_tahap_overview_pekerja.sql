-- ================================================================
-- MIGRATION: Overview Pekerja — jumlah pcs dipisah per tahap
--
-- "Total Dikerjakan" sebelumnya menjumlahkan pcs semua tahap jadi satu
-- angka (jahit + steam + buang benang + ...), padahal satu potong baju
-- bisa terhitung di beberapa tahap — angkanya jadi tidak masuk akal.
-- Tambah kolom pcs_per_tahap (jsonb: {tahap: pcs}) di
-- overview_pekerja_periode dan riwayat_pekerja_periode. Logika lain
-- tidak berubah.
-- ================================================================

CREATE OR REPLACE FUNCTION public.overview_pekerja_periode(p_dari date, p_sampai date, p_tenant_id text)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
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
  UNION ALL
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
        AND gl.status <> 'cancelled'
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
         ARRAY_REMOVE(ARRAY_AGG(DISTINCT o.tahap), NULL)::text[]    AS daftar_tahap,
         COALESCE((
           SELECT jsonb_object_agg(s.tahap, s.pcs)
           FROM (
             SELECT o2.tahap, SUM(o2.qty)::int AS pcs
             FROM terbuka o2
             WHERE o2.karyawan_id = k.id AND o2.tipe IN ('selesai','rework')
               AND o2.tahap IN ('cutting','jahit','lubang_kancing','buang_benang','qc','steam','packing')
             GROUP BY o2.tahap
           ) s
         ), '{}'::jsonb) AS pcs_per_tahap
  FROM terbuka o JOIN karyawan k ON k.id = o.karyawan_id
  GROUP BY k.id, k.nama, k.jabatan
) x;
$function$;


CREATE OR REPLACE FUNCTION public.riwayat_pekerja_periode(p_dari date, p_sampai date, p_tenant_id text)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
WITH lunas AS (
  SELECT g.karyawan_id, g.total, g.tipe, g.tanggal_bayar,
         NULLIF(split_part(g.keterangan, ' ', 2), '') AS tahap,
         CASE WHEN g.sumber_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              THEN g.sumber_id::uuid END AS sumber_uuid
  FROM gaji_ledger g
  WHERE g.tenant_id = p_tenant_id AND g.status = 'lunas'
    AND g.karyawan_id IS NOT NULL
    AND g.tanggal_bayar::date BETWEEN p_dari AND p_sampai
),
dengan_qty AS (
  SELECT l.karyawan_id, l.tahap, l.total AS upah, l.tipe, l.tanggal_bayar,
         COALESCE(
           (SELECT qty_kirim FROM surat_jalan_item WHERE id = l.sumber_uuid),
           (SELECT SUM(sji.qty_kirim) FROM surat_jalan_item sji WHERE sji.sj_id = l.sumber_uuid),
           CASE WHEN l.tahap = 'cutting'
                THEN (SELECT COALESCE(bb.status_tahap->'cutting'->>'qty_dipotong', bb.status_tahap->'cutting'->>'qty_aktual')::int
                      FROM bundle bb WHERE bb.id = l.sumber_uuid)
                ELSE sl.qty END, 0) AS qty
  FROM lunas l
  LEFT JOIN LATERAL (
    SELECT s.qty FROM scan_log s
    WHERE s.bundle_id = l.sumber_uuid AND s.tahap::text = l.tahap
      AND s.tipe = 'selesai' AND s.tenant_id = p_tenant_id
    ORDER BY s.created_at DESC LIMIT 1
  ) sl ON TRUE
)
SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.tanggal_bayar_terakhir DESC, x.total_upah DESC), '[]'::jsonb)
FROM (
  SELECT k.id AS karyawan_id, k.nama, COALESCE(k.jabatan,'-') AS jabatan,
         COUNT(*)::int                AS jumlah_entri,
         COALESCE(SUM(d.qty), 0)::int AS total_pcs,
         (COALESCE(SUM(d.upah) FILTER (WHERE d.tipe IN ('selesai','rework')), 0)
          - COALESCE(SUM(d.upah) FILTER (WHERE d.tipe = 'reject_potong'), 0))::numeric AS total_upah,
         MAX(d.tanggal_bayar)::date   AS tanggal_bayar_terakhir,
         ARRAY_REMOVE(ARRAY_AGG(DISTINCT d.tahap), NULL)::text[] AS daftar_tahap,
         COALESCE((
           SELECT jsonb_object_agg(s.tahap, s.pcs)
           FROM (
             SELECT d2.tahap, SUM(d2.qty)::int AS pcs
             FROM dengan_qty d2
             WHERE d2.karyawan_id = k.id AND d2.tipe IN ('selesai','rework')
               AND d2.tahap IN ('cutting','jahit','lubang_kancing','buang_benang','qc','steam','packing')
             GROUP BY d2.tahap
           ) s
         ), '{}'::jsonb) AS pcs_per_tahap
  FROM dengan_qty d JOIN karyawan k ON k.id = d.karyawan_id
  GROUP BY k.id, k.nama, k.jabatan
) x;
$function$;
