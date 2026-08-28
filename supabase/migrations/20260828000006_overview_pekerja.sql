-- ================================================================
-- MIGRATION: Overview pekerjaan per pekerja dalam satu periode
--
-- Halaman Rekap Gaji dan Laporan Gaji yang sudah ada hanya menampilkan
-- ANGKA UANG per orang — tidak menunjukkan barang apa yang dikerjakan.
-- Dua fungsi ini untuk halaman overview: kartu ringkas per pekerja, lalu
-- rinciannya (artikel, warna, size, qty, PO) saat kartunya dibuka.
--
-- Qty diambil dari scan_log, BUKAN dari po_item.qty_per_bundle. Alasannya
-- qty_per_bundle adalah angka RENCANA — untuk bundle hasil split atau
-- cutting partial, angkanya berbeda dari yang benar-benar dikerjakan, dan
-- upahnya pun dihitung dari qty scan. Memakai qty_per_bundle akan membuat
-- "jumlah pcs" tidak cocok dengan upah yang tertera di sebelahnya.
--
-- gaji_ledger.sumber_id menyimpan bundle_id sebagai TEXT, jadi dicek dulu
-- bentuknya sebelum dicast — supaya baris yang sumber_id-nya bukan uuid
-- (kalau suatu saat ada) tidak menggagalkan seluruh laporan.
--
-- Tahap dibaca dari keterangan yang dibentuk scan_selesai:
--   'Upah ' || tahap || ' - ' || barcode
-- sehingga kata kedua adalah nama tahapnya.
-- ================================================================

-- ── Ringkasan per pekerja ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.overview_pekerja_periode(
  p_dari date, p_sampai date, p_tenant_id text
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
WITH entri AS (
  SELECT g.karyawan_id, g.total, g.status, g.tipe,
         NULLIF(split_part(g.keterangan, ' ', 2), '') AS tahap,
         CASE WHEN g.sumber_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              THEN g.sumber_id::uuid END AS bundle_id
  FROM gaji_ledger g
  WHERE g.tenant_id = p_tenant_id
    AND g.tanggal BETWEEN p_dari AND p_sampai
    AND g.karyawan_id IS NOT NULL
),
dgn_qty AS (
  SELECT e.*, COALESCE(sl.qty, 0) AS qty
  FROM entri e
  LEFT JOIN LATERAL (
    SELECT s.qty FROM scan_log s
    WHERE s.bundle_id = e.bundle_id
      AND s.tahap::text = e.tahap
      AND s.tipe = 'selesai'
      AND s.tenant_id = p_tenant_id
    ORDER BY s.created_at DESC
    LIMIT 1
  ) sl ON TRUE
)
SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.total_upah DESC), '[]'::jsonb)
FROM (
  SELECT k.id                                        AS karyawan_id,
         k.nama,
         COALESCE(k.jabatan, '-')                    AS jabatan,
         COUNT(*)::int                               AS jumlah_pekerjaan,
         COALESCE(SUM(d.qty), 0)::int                AS total_pcs,
         -- reject_potong adalah potongan, jadi dikurangkan
         (COALESCE(SUM(d.total) FILTER (WHERE d.tipe IN ('selesai','rework')), 0)
          - COALESCE(SUM(d.total) FILTER (WHERE d.tipe = 'reject_potong'), 0))::numeric AS total_upah,
         COALESCE(SUM(d.total) FILTER (WHERE d.status = 'lunas'), 0)::numeric        AS upah_lunas,
         COALESCE(SUM(d.total) FILTER (WHERE d.status = 'belum_lunas'), 0)::numeric  AS upah_belum_lunas,
         COALESCE(SUM(d.total) FILTER (WHERE d.tipe = 'reject_potong'), 0)::numeric  AS total_potongan,
         ARRAY_REMOVE(ARRAY_AGG(DISTINCT d.tahap), NULL)::text[]                     AS daftar_tahap
  FROM dgn_qty d
  JOIN karyawan k ON k.id = d.karyawan_id
  GROUP BY k.id, k.nama, k.jabatan
) x;
$function$;


-- ── Rincian pekerjaan satu pekerja ───────────────────────────────
CREATE OR REPLACE FUNCTION public.detail_pekerja_periode(
  p_karyawan_id uuid, p_dari date, p_sampai date, p_tenant_id text
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
WITH entri AS (
  SELECT g.id, g.total, g.status, g.tipe, g.tanggal, g.tanggal_bayar,
         NULLIF(split_part(g.keterangan, ' ', 2), '') AS tahap,
         CASE WHEN g.sumber_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              THEN g.sumber_id::uuid END AS bundle_id
  FROM gaji_ledger g
  WHERE g.tenant_id = p_tenant_id
    AND g.karyawan_id = p_karyawan_id
    AND g.tanggal BETWEEN p_dari AND p_sampai
)
SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.tanggal DESC, x.no_po, x.model_nama), '[]'::jsonb)
FROM (
  SELECT e.id,
         e.tanggal,
         e.tahap,
         e.tipe,
         e.status,
         e.tanggal_bayar,
         e.total::numeric                    AS upah,
         COALESCE(sl.qty, 0)::int            AS qty,
         COALESCE(b.barcode, '-')            AS barcode,
         COALESCE(po.no_po, '-')             AS no_po,
         COALESCE(mp.nama, '-')              AS model_nama,
         COALESCE(pr.nama, '-')              AS produk_nama,
         COALESCE(pi.warna, '-')             AS warna,
         COALESCE(pi.size, '-')              AS size,
         COALESCE(kl.nama, '-')              AS klien_nama
  FROM entri e
  LEFT JOIN bundle b        ON b.id  = e.bundle_id
  LEFT JOIN po              ON po.id = b.po_id
  LEFT JOIN klien kl        ON kl.id = po.klien_id
  LEFT JOIN po_item pi      ON pi.id = b.po_item_id
  LEFT JOIN produk pr       ON pr.id = pi.produk_id
  LEFT JOIN model_produk mp ON mp.id = pr.model_id
  LEFT JOIN LATERAL (
    SELECT s.qty FROM scan_log s
    WHERE s.bundle_id = e.bundle_id
      AND s.tahap::text = e.tahap
      AND s.tipe = 'selesai'
      AND s.tenant_id = p_tenant_id
    ORDER BY s.created_at DESC
    LIMIT 1
  ) sl ON TRUE
) x;
$function$;

GRANT EXECUTE ON FUNCTION public.overview_pekerja_periode(date, date, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.detail_pekerja_periode(uuid, date, date, text) TO authenticated;
