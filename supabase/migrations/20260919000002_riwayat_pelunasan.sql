-- ================================================================
-- MIGRATION: Riwayat pelunasan upah (history yang sudah dibayar)
--
-- Overview Pekerja sebelumnya cuma menampilkan yang BELUM lunas — begitu
-- ditandai lunas, baris itu hilang total dari halaman tanpa jejak yang
-- bisa dicek ulang. Kalau owner lupa sudah pencet atau ragu tombolnya
-- "kepencet beneran atau tidak", tidak ada cara memverifikasi dari UI.
--
-- Dua RPC baru, sumbernya gaji_ledger status = 'lunas' (kebalikan dari
-- overview_pekerja_periode/detail_pekerja_periode yang sumbernya
-- 'belum_lunas'), difilter berdasar TANGGAL BAYAR (bukan tanggal kerja)
-- supaya "minggu ini di histori" berarti "yang dibayar minggu ini":
--
--   1. riwayat_pekerja_periode  — ringkasan per pekerja yang sudah lunas.
--   2. detail_riwayat_pekerja   — rincian per baris (artikel), dengan
--      tanggal_bayar, supaya bisa dicocokkan lagi kapan & apa yang dibayar.
--      Row-nya tetap gaji_ledger asli, jadi tetap bisa dibatalkan lewat
--      hapus_entri_upah kalau ternyata salah tandai lunas.
-- ================================================================

CREATE OR REPLACE FUNCTION public.riwayat_pekerja_periode(
  p_dari date, p_sampai date, p_tenant_id text
)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
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
                THEN (SELECT (bb.status_tahap->'cutting'->>'qty_aktual')::int
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
         ARRAY_REMOVE(ARRAY_AGG(DISTINCT d.tahap), NULL)::text[] AS daftar_tahap
  FROM dengan_qty d JOIN karyawan k ON k.id = d.karyawan_id
  GROUP BY k.id, k.nama, k.jabatan
) x;
$function$;

CREATE OR REPLACE FUNCTION public.detail_riwayat_pekerja(
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
         'lunas'::text AS keadaan
  FROM gaji_ledger g
  WHERE g.tenant_id = p_tenant_id AND g.karyawan_id = p_karyawan_id
    AND g.status = 'lunas' AND g.tanggal_bayar::date BETWEEN p_dari AND p_sampai
),
-- Baris bersumber satu bundle (kasus umum, termasuk jahit/cutting).
dasar_bundle AS (
  SELECT e.id, e.tanggal, e.tahap, e.tipe, e.status, e.tanggal_bayar, e.upah, e.keadaan,
         COALESCE(
           CASE WHEN e.tahap = 'cutting'
                     THEN (b.status_tahap->'cutting'->>'qty_aktual')::int
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
SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.tanggal_bayar DESC, x.no_po, x.model_nama), '[]'::jsonb)
FROM (
  SELECT d.*, CASE WHEN d.qty > 0 THEN ROUND(d.upah / d.qty) ELSE 0 END AS harga_per_pcs
  FROM dasar d
) x;
$function$;

GRANT EXECUTE ON FUNCTION public.riwayat_pekerja_periode(date, date, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.detail_riwayat_pekerja(uuid, date, date, text) TO authenticated;
