-- ================================================================
-- MIGRATION: qty_dipotong (dasar upah cutting) + koreksi cutting dari jahit
--
-- BAGIAN 1 — Bug harga per pcs upah cutting dobel setelah Split
--   split_bundle_awal_jahit mengurangi status_tahap.cutting.qty_aktual bundle
--   induk (mis. 10 → 5) karena qty_aktual dipakai sebagai qty efektif bundle
--   untuk tahap berikutnya. Padahal entri upah cutting (gaji_ledger) tetap
--   menempel di induk dengan nominal untuk 10 pcs. Laporan pekerja membaca
--   qty cutting dari qty_aktual → tampil 5 pcs, harga per pcs = 30.000/5 =
--   6.000 (seharusnya 3.000). Contoh: PO-0097 Khalid 00676 & 00678.
--
--   Perbaikan: simpan qty yang benar-benar dipotong di
--   status_tahap.cutting.qty_dipotong (hanya di induk yang pernah di-split).
--   Laporan pekerja memakai COALESCE(qty_dipotong, qty_aktual).
--   Nominal upah TIDAK berubah — sudah benar sejak awal.
--
-- BAGIAN 2 — Koreksi cutting dari tab Jahit
--   koreksi_serah_terima_jahit mendapat parameter p_koreksi_cutting. Kalau
--   qty jahit yang benar melebihi hasil cutting (salah input saat cutting),
--   hasil cutting ikut dibetulkan: qty_aktual/qty_dipotong, status partial →
--   selesai bila sudah mencapai rencana, dan upah cutting (belum lunas →
--   nominal diubah; sudah lunas → entri baru untuk selisihnya).
--   Ditolak kalau bundle punya potongan susulan (Lanjut Cutting).
-- ================================================================


-- ── 1a. Backfill qty_dipotong untuk induk yang sudah pernah di-split ────
UPDATE bundle r
SET status_tahap = jsonb_set(r.status_tahap, '{cutting,qty_dipotong}', to_jsonb(x.total))
FROM (
  SELECT p.id,
         COALESCE((p.status_tahap->'cutting'->>'qty_aktual')::numeric, 0)
           + SUM(COALESCE((c.status_tahap->'cutting'->>'qty_aktual')::numeric, 0)) AS total
  FROM bundle p
  JOIN bundle c ON c.parent_bundle_id = p.id AND c.barcode LIKE p.barcode || 'h%'
  GROUP BY p.id, p.status_tahap
) x
WHERE r.id = x.id
  AND NOT (r.status_tahap->'cutting' ? 'qty_dipotong');


-- ── detail_pekerja_periode(uuid,date,date,text) ─────────────────
CREATE OR REPLACE FUNCTION public.detail_pekerja_periode(p_karyawan_id uuid, p_dari date, p_sampai date, p_tenant_id text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
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
        AND gl.status <> 'cancelled'
    )
),
dasar_bundle AS (
  SELECT e.id, e.tanggal, e.tahap, e.tipe, e.status, e.tanggal_bayar, e.upah, e.keadaan,
         COALESCE(
           CASE WHEN e.tahap = 'cutting'
                     THEN COALESCE(b.status_tahap->'cutting'->>'qty_dipotong', b.status_tahap->'cutting'->>'qty_aktual')::int
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

-- ── kroscek_detail_pekerja(uuid,date,date,text) ─────────────────
CREATE OR REPLACE FUNCTION public.kroscek_detail_pekerja(p_karyawan_id uuid, p_dari date, p_sampai date, p_tenant_id text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
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
                     THEN COALESCE(b.status_tahap->'cutting'->>'qty_dipotong', b.status_tahap->'cutting'->>'qty_aktual')::int
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

-- ── overview_pekerja_periode(date,date,text) ────────────────────
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
         ARRAY_REMOVE(ARRAY_AGG(DISTINCT o.tahap), NULL)::text[]    AS daftar_tahap
  FROM terbuka o JOIN karyawan k ON k.id = o.karyawan_id
  GROUP BY k.id, k.nama, k.jabatan
) x;
$function$;

-- ── detail_riwayat_pekerja(uuid,date,date,text) ─────────────────
CREATE OR REPLACE FUNCTION public.detail_riwayat_pekerja(p_karyawan_id uuid, p_dari date, p_sampai date, p_tenant_id text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
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
                     THEN COALESCE(b.status_tahap->'cutting'->>'qty_dipotong', b.status_tahap->'cutting'->>'qty_aktual')::int
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

-- ── kroscek_pekerja_periode(date,date,text) ─────────────────────
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
         ARRAY_REMOVE(ARRAY_AGG(DISTINCT g.tahap), NULL)::text[]    AS daftar_tahap
  FROM gabungan g JOIN karyawan k ON k.id = g.karyawan_id
  GROUP BY k.id, k.nama, k.jabatan
) x;
$function$;

-- ── riwayat_pekerja_periode(date,date,text) ─────────────────────
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
         ARRAY_REMOVE(ARRAY_AGG(DISTINCT d.tahap), NULL)::text[] AS daftar_tahap
  FROM dengan_qty d JOIN karyawan k ON k.id = d.karyawan_id
  GROUP BY k.id, k.nama, k.jabatan
) x;
$function$;

-- ── split_bundle_awal_jahit(text,numeric,uuid,uuid,text) ────────
CREATE OR REPLACE FUNCTION public.split_bundle_awal_jahit(p_barcode text, p_qty_assign numeric, p_karyawan_id uuid, p_user_id uuid, p_tenant_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_bundle               RECORD;
  v_qty_total             NUMERIC;
  v_qty_sisa              NUMERIC;
  v_split_count           INT;
  v_new_barcode           TEXT;
  v_new_no_urut           INT;
  v_new_bundle_id         UUID;
  v_child_status_tahap    JSONB;
  v_scan_log_id           UUID;
  v_stok_warnings         JSONB := '[]'::JSONB;
  v_consume_result        JSONB;
  v_aksesori              RECORD;
  v_warna_id              UUID;
  v_qty_pakai             NUMERIC;
  v_kategori_aksesori_id  UUID;
BEGIN
  SELECT id INTO v_kategori_aksesori_id
  FROM kategori_trx
  WHERE nama = 'Pembelian Aksesori' AND jenis = 'direct_bahan'
    AND aktif = TRUE AND tenant_id = p_tenant_id
  LIMIT 1;

  SELECT b.id, b.po_id, b.po_item_id, b.status_tahap, b.barcode,
         b.no_urut_po, pi.warna, pi.qty_per_bundle, produk.model_id
  INTO v_bundle
  FROM bundle b
  JOIN po_item pi  ON pi.id = b.po_item_id
  JOIN produk      ON produk.id = pi.produk_id
  WHERE b.barcode = p_barcode AND b.tenant_id = p_tenant_id
  FOR UPDATE OF b;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Barcode tidak ditemukan: %', p_barcode;
  END IF;

  IF NOT tahap_sudah_beres(v_bundle.status_tahap, 'cutting') THEN
    RAISE EXCEPTION 'Bundle belum selesai tahap Cutting';
  END IF;

  IF (v_bundle.status_tahap -> 'jahit' ->> 'status') IS NOT NULL THEN
    RAISE EXCEPTION 'Bundle sudah diserahterimakan di tahap Jahit — gunakan fitur Split biasa untuk membagi pekerjaan yang sedang berjalan';
  END IF;

  v_qty_total := COALESCE(
    (v_bundle.status_tahap -> 'cutting' ->> 'qty_aktual')::NUMERIC,
    v_bundle.qty_per_bundle
  );

  IF p_qty_assign IS NULL OR p_qty_assign <= 0 OR p_qty_assign >= v_qty_total THEN
    RAISE EXCEPTION 'Qty yang ditugaskan harus antara 1 dan % (kalau mau semua, pakai Serah Terima biasa)', v_qty_total - 1;
  END IF;

  v_qty_sisa := v_qty_total - p_qty_assign;

  SELECT COUNT(*) INTO v_split_count
  FROM bundle WHERE barcode LIKE p_barcode || 'h%' AND tenant_id = p_tenant_id;

  v_new_barcode := p_barcode || 'h' || (v_split_count + 1)::TEXT;

  SELECT COALESCE(MAX(no_urut), 0) + 1 INTO v_new_no_urut
  FROM bundle WHERE po_id = v_bundle.po_id AND tenant_id = p_tenant_id;

  -- qty_dipotong (dasar upah cutting) hanya milik bundle induk — jangan ikut tersalin ke anak
  v_child_status_tahap := jsonb_set(
    jsonb_set(v_bundle.status_tahap, '{cutting}', (v_bundle.status_tahap -> 'cutting') - 'qty_dipotong'),
    '{cutting,qty_aktual}', to_jsonb(p_qty_assign)
  ) || jsonb_build_object(
    'jahit', jsonb_build_object(
      'status','terima','qty_terima',p_qty_assign,'waktu_terima',now(),
      'qty_selesai',NULL,'waktu_selesai',NULL,'karyawan_id',p_karyawan_id
    )
  );

  INSERT INTO bundle (
    barcode, po_id, po_item_id, no_urut, no_urut_po,
    parent_bundle_id, status_tahap, tenant_id, created_by
  )
  VALUES (
    v_new_barcode, v_bundle.po_id, v_bundle.po_item_id, v_new_no_urut,
    v_bundle.no_urut_po, v_bundle.id, v_child_status_tahap, p_tenant_id, p_user_id
  )
  RETURNING id INTO v_new_bundle_id;

  SELECT id INTO v_warna_id
  FROM warna WHERE LOWER(nama) = LOWER(v_bundle.warna) AND tenant_id = p_tenant_id
  LIMIT 1;

  FOR v_aksesori IN
    SELECT inventory_item_id, qty_per_pcs
    FROM model_aksesori
    WHERE model_id = v_bundle.model_id AND tenant_id = p_tenant_id
      AND tahap_pakai = 'jahit' AND (warna_id IS NULL OR warna_id = v_warna_id)
  LOOP
    v_qty_pakai := v_aksesori.qty_per_pcs * p_qty_assign;
    v_consume_result := consume_fifo_atomic(
      v_aksesori.inventory_item_id, v_qty_pakai, v_bundle.po_item_id,
      v_new_bundle_id, v_aksesori.qty_per_pcs, p_user_id, p_tenant_id,
      v_kategori_aksesori_id, 'jahit'
    );
    IF v_consume_result ->> 'status' = 'stok_kurang' THEN
      v_stok_warnings := v_stok_warnings || jsonb_build_object(
        'item_nama',  v_consume_result ->> 'item_nama',
        'qty_kurang', v_consume_result -> 'qty_kurang',
        'sisa_stok',  v_consume_result -> 'sisa_stok'
      );
    END IF;
  END LOOP;

  IF v_warna_id IS NOT NULL THEN
    FOR v_aksesori IN
      SELECT inventory_item_id, qty_per_pcs
      FROM warna_aksesori
      WHERE warna_id = v_warna_id AND tenant_id = p_tenant_id AND tahap_pakai = 'jahit'
    LOOP
      v_qty_pakai := v_aksesori.qty_per_pcs * p_qty_assign;
      v_consume_result := consume_fifo_atomic(
        v_aksesori.inventory_item_id, v_qty_pakai, v_bundle.po_item_id,
        v_new_bundle_id, v_aksesori.qty_per_pcs, p_user_id, p_tenant_id,
        v_kategori_aksesori_id, 'jahit'
      );
      IF v_consume_result ->> 'status' = 'stok_kurang' THEN
        v_stok_warnings := v_stok_warnings || jsonb_build_object(
          'item_nama',  v_consume_result ->> 'item_nama',
          'qty_kurang', v_consume_result -> 'qty_kurang',
          'sisa_stok',  v_consume_result -> 'sisa_stok'
        );
      END IF;
    END LOOP;
  END IF;

  INSERT INTO scan_log (bundle_id, tahap, tipe, qty, karyawan_id, user_id, tenant_id)
  VALUES (v_new_bundle_id, 'jahit'::tahap_produksi, 'terima'::scan_tipe,
          p_qty_assign, p_karyawan_id, p_user_id, p_tenant_id)
  RETURNING id INTO v_scan_log_id;

  UPDATE bundle
  -- Simpan qty yang benar-benar dipotong sebelum qty_aktual induk dikurangi.
  -- qty_aktual = qty efektif bundle ini untuk tahap berikutnya; qty_dipotong =
  -- dasar upah cutting (entri gaji_ledger cutting menempel di bundle induk).
  SET status_tahap = jsonb_set(
        jsonb_set(status_tahap, '{cutting,qty_dipotong}',
                  to_jsonb(COALESCE((status_tahap->'cutting'->>'qty_dipotong')::numeric, v_qty_total))),
        '{cutting,qty_aktual}', to_jsonb(v_qty_sisa))
  WHERE id = v_bundle.id;

  RETURN jsonb_build_object(
    'scan_log_id', v_scan_log_id,
    'new_bundle_id', v_new_bundle_id,
    'new_bundle_barcode', v_new_barcode,
    'new_bundle_qty', p_qty_assign,
    'parent_bundle_id', v_bundle.id,
    'parent_sisa_qty', v_qty_sisa,
    'stok_warnings', v_stok_warnings
  );
END;
$function$;


-- ── 2. koreksi_serah_terima_jahit + koreksi cutting ──────────────────
DROP FUNCTION IF EXISTS public.koreksi_serah_terima_jahit(uuid, uuid, numeric, text, uuid, text);

CREATE OR REPLACE FUNCTION public.koreksi_serah_terima_jahit(
  p_bundle_id        uuid,
  p_karyawan_id      uuid,
  p_qty              numeric,
  p_alasan           text,
  p_user_id          uuid,
  p_tenant_id        text,
  p_koreksi_cutting  boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_bundle               RECORD;
  v_jahit                JSONB;
  v_karyawan_lama        UUID;
  v_qty_lama             NUMERIC;
  v_qty_maks             NUMERIC;
  v_delta                NUMERIC;
  v_warna_id             UUID;
  v_kategori_aksesori_id UUID;
  v_aksesori             RECORD;
  v_jumlah               NUMERIC;
  v_sisa                 NUMERIC;
  v_ambil                NUMERIC;
  v_batch                RECORD;
  v_jurnal               RECORD;
  v_ada_pemakaian        BOOLEAN;
  v_consume_result       JSONB;
  v_stok_warnings        JSONB := '[]'::JSONB;
  v_dimuka               RECORD;
  v_nama_dimuka          TEXT;
  -- koreksi cutting
  v_cut_lama             NUMERIC;
  v_cut_delta            NUMERIC := 0;
  v_root_id              UUID;
  v_root_barcode         TEXT;
  v_root_cutting         JSONB;
  v_root_total_lama      NUMERIC;
  v_root_total_baru      NUMERIC;
  v_root_status_baru     TEXT;
  v_tarif_cutting        NUMERIC;
  v_upah_cutting         RECORD;
  v_upah_tambah          NUMERIC := 0;
  v_upah_aksi            TEXT := NULL;
BEGIN
  SELECT b.id, b.barcode, b.po_item_id, b.status_tahap, b.parent_bundle_id,
         pi.po_id, pi.warna, pi.qty_per_bundle, pi.produk_id, produk.model_id
  INTO v_bundle
  FROM bundle b
  JOIN po_item pi ON pi.id = b.po_item_id
  JOIN produk     ON produk.id = pi.produk_id
  WHERE b.id = p_bundle_id AND b.tenant_id = p_tenant_id
  FOR UPDATE OF b;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bundle tidak ditemukan';
  END IF;

  v_jahit := v_bundle.status_tahap -> 'jahit';
  IF (v_jahit ->> 'status') IS DISTINCT FROM 'terima' THEN
    RAISE EXCEPTION 'Bundle % tidak sedang dikerjakan di tahap Jahit — hanya bundle di Sedang Proses yang bisa dikoreksi', v_bundle.barcode;
  END IF;

  -- Upah jahit sudah dibayar dimuka → tolak
  SELECT gl.karyawan_id, gl.total INTO v_dimuka
  FROM gaji_ledger gl
  WHERE gl.tenant_id = p_tenant_id
    AND gl.sumber_id = v_bundle.id::text
    AND gl.keterangan LIKE 'Upah jahit - %'
    AND gl.status <> 'cancelled'
  LIMIT 1;

  IF FOUND THEN
    SELECT nama INTO v_nama_dimuka FROM karyawan WHERE id = v_dimuka.karyawan_id;
    RAISE EXCEPTION 'Upah jahit bundle % sudah dibayar dimuka ke % (Rp%). Batalkan dulu entri upahnya di Penggajian sebelum mengoreksi.',
      v_bundle.barcode, COALESCE(v_nama_dimuka, '-'), to_char(v_dimuka.total, 'FM999G999G999');
  END IF;

  IF p_karyawan_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM karyawan WHERE id = p_karyawan_id AND tenant_id = p_tenant_id AND aktif = TRUE
  ) THEN
    RAISE EXCEPTION 'Penjahit tidak ditemukan atau tidak aktif';
  END IF;

  v_karyawan_lama := NULLIF(v_jahit ->> 'karyawan_id', '')::uuid;
  v_qty_lama      := COALESCE((v_jahit ->> 'qty_terima')::numeric, 0);
  v_cut_lama      := (v_bundle.status_tahap -> 'cutting' ->> 'qty_aktual')::numeric;
  v_qty_maks      := COALESCE(v_cut_lama, v_bundle.qty_per_bundle);

  IF p_qty IS NULL OR p_qty < 1 OR p_qty <> trunc(p_qty) THEN
    RAISE EXCEPTION 'Qty harus bilangan bulat minimal 1';
  END IF;

  -- ── Koreksi cutting (qty jahit yang benar > hasil cutting tercatat) ──
  IF p_koreksi_cutting THEN
    IF v_cut_lama IS NULL OR p_qty <= v_cut_lama THEN
      RAISE EXCEPTION 'Koreksi cutting hanya untuk qty yang melebihi hasil cutting (% pcs)', COALESCE(v_cut_lama, 0);
    END IF;

    -- Bundle pemilik upah cutting: bundle hasil Split ('h') → induknya;
    -- selain itu (termasuk bundle susulan 'c') → bundle ini sendiri.
    SELECT p.id, p.barcode INTO v_root_id, v_root_barcode
    FROM bundle p
    WHERE p.id = v_bundle.parent_bundle_id
      AND v_bundle.barcode LIKE p.barcode || 'h%'
    FOR UPDATE;
    IF v_root_id IS NULL THEN
      v_root_id      := v_bundle.id;
      v_root_barcode := v_bundle.barcode;
    END IF;

    IF EXISTS (
      SELECT 1 FROM bundle c
      WHERE c.parent_bundle_id = v_root_id AND c.barcode LIKE v_root_barcode || 'c%'
    ) THEN
      RAISE EXCEPTION 'Bundle % punya potongan susulan (Lanjut Cutting) — koreksi cutting tidak bisa otomatis, hubungi admin', v_root_barcode;
    END IF;

    v_cut_delta := p_qty - v_cut_lama;

    -- qty_aktual bundle ini
    UPDATE bundle
    SET status_tahap = jsonb_set(status_tahap, '{cutting,qty_aktual}', to_jsonb(p_qty))
    WHERE id = v_bundle.id;

    -- Total dipotong & status di bundle pemilik upah (dibaca SETELAH update
    -- di atas, supaya kalau pemiliknya bundle ini sendiri, qty_aktual sudah baru)
    SELECT status_tahap -> 'cutting' INTO v_root_cutting FROM bundle WHERE id = v_root_id;

    IF v_root_id <> v_bundle.id OR (v_root_cutting ? 'qty_dipotong') THEN
      v_root_total_lama := COALESCE((v_root_cutting->>'qty_dipotong')::numeric,
                                    (v_root_cutting->>'qty_aktual')::numeric, 0);
      v_root_total_baru := v_root_total_lama + v_cut_delta;
    ELSE
      v_root_total_lama := v_cut_lama;
      v_root_total_baru := p_qty;
    END IF;

    v_root_status_baru := v_root_cutting->>'status';
    IF v_root_status_baru = 'partial' AND v_root_total_baru >= v_bundle.qty_per_bundle THEN
      v_root_status_baru := 'selesai';
    END IF;

    UPDATE bundle
    SET status_tahap = jsonb_set(status_tahap, '{cutting}',
          (status_tahap->'cutting') || jsonb_build_object('status', v_root_status_baru)
          || CASE WHEN v_root_id <> v_bundle.id OR (status_tahap->'cutting' ? 'qty_dipotong')
                  THEN jsonb_build_object('qty_dipotong', v_root_total_baru)
                  ELSE '{}'::jsonb END)
    WHERE id = v_root_id;

    -- Upah cutting
    SELECT hi.harga_satuan INTO v_tarif_cutting
    FROM hpp_item hi
    JOIN hpp_komponen hk ON hk.id = hi.komponen_id
    WHERE hi.produk_id = v_bundle.produk_id AND hk.tahap_produksi = 'cutting'
      AND hi.tenant_id = p_tenant_id
    LIMIT 1;

    SELECT gl.id, gl.karyawan_id, gl.status INTO v_upah_cutting
    FROM gaji_ledger gl
    WHERE gl.tenant_id = p_tenant_id AND gl.sumber_id = v_root_id::text
      AND gl.keterangan LIKE 'Upah cutting - %' AND gl.status <> 'cancelled'
    ORDER BY gl.created_at
    LIMIT 1;

    IF FOUND AND COALESCE(v_tarif_cutting, 0) > 0 THEN
      v_upah_tambah := v_tarif_cutting * v_cut_delta;
      IF v_upah_cutting.status = 'belum_lunas' THEN
        UPDATE gaji_ledger SET total = total + v_upah_tambah WHERE id = v_upah_cutting.id;
        v_upah_aksi := 'ditambah';
      ELSE
        INSERT INTO gaji_ledger (
          karyawan_id, tipe, total, tanggal, sumber_id,
          keterangan, status, tenant_id, created_by
        ) VALUES (
          v_upah_cutting.karyawan_id, 'selesai'::gaji_ledger_tipe, v_upah_tambah, CURRENT_DATE,
          v_root_id::text,
          'Upah cutting - ' || v_root_barcode || ' (koreksi +' || v_cut_delta || ' pcs)',
          'belum_lunas'::gaji_status, p_tenant_id, p_user_id
        );
        v_upah_aksi := 'entri_baru';
      END IF;
    END IF;

    v_qty_maks := p_qty;
  END IF;

  IF v_qty_maks IS NOT NULL AND p_qty > v_qty_maks THEN
    RAISE EXCEPTION 'Qty tidak boleh melebihi hasil cutting (% pcs). Kalau hasil cutting yang salah input, centang koreksi cutting.', v_qty_maks;
  END IF;

  IF p_karyawan_id IS NOT DISTINCT FROM v_karyawan_lama AND p_qty = v_qty_lama THEN
    RAISE EXCEPTION 'Tidak ada perubahan';
  END IF;

  v_delta := p_qty - v_qty_lama;

  -- ── Sesuaikan aksesori tahap jahit ─────────────────────────────
  IF v_delta <> 0 THEN
    SELECT id INTO v_kategori_aksesori_id
    FROM kategori_trx
    WHERE nama = 'Pembelian Aksesori' AND jenis = 'direct_bahan'
      AND aktif = TRUE AND tenant_id = p_tenant_id
    LIMIT 1;

    SELECT id INTO v_warna_id
    FROM warna
    WHERE LOWER(nama) = LOWER(v_bundle.warna) AND tenant_id = p_tenant_id
    LIMIT 1;

    FOR v_aksesori IN
      SELECT ma.inventory_item_id, ma.qty_per_pcs
      FROM model_aksesori ma
      WHERE ma.model_id = v_bundle.model_id AND ma.tenant_id = p_tenant_id
        AND ma.tahap_pakai = 'jahit'
        AND (ma.warna_id IS NULL OR ma.warna_id = v_warna_id)
      UNION ALL
      SELECT wa.inventory_item_id, wa.qty_per_pcs
      FROM warna_aksesori wa
      WHERE v_warna_id IS NOT NULL AND wa.warna_id = v_warna_id
        AND wa.tenant_id = p_tenant_id AND wa.tahap_pakai = 'jahit'
    LOOP
      v_jumlah := v_aksesori.qty_per_pcs * abs(v_delta);
      CONTINUE WHEN v_jumlah <= 0;

      IF v_delta > 0 THEN
        SELECT EXISTS (
          SELECT 1 FROM pemakaian_aksesori
          WHERE bundle_id = v_bundle.id AND inventory_item_id = v_aksesori.inventory_item_id
            AND tahap = 'jahit'
        ) INTO v_ada_pemakaian;

        v_consume_result := consume_fifo_atomic(
          v_aksesori.inventory_item_id, v_jumlah, v_bundle.po_item_id,
          v_bundle.id, v_aksesori.qty_per_pcs, p_user_id, p_tenant_id,
          v_kategori_aksesori_id, 'jahit'
        );

        IF v_ada_pemakaian THEN
          UPDATE pemakaian_aksesori
          SET qty_pakai = qty_pakai + v_jumlah
          WHERE bundle_id = v_bundle.id AND inventory_item_id = v_aksesori.inventory_item_id
            AND tahap = 'jahit';
        END IF;

        IF v_consume_result ->> 'status' = 'stok_kurang' THEN
          v_stok_warnings := v_stok_warnings || jsonb_build_object(
            'item_nama',  v_consume_result ->> 'item_nama',
            'qty_kurang', v_consume_result -> 'qty_kurang',
            'sisa_stok',  v_consume_result -> 'sisa_stok'
          );
        END IF;

      ELSE
        UPDATE inventory_item
        SET stok_aktual = stok_aktual + v_jumlah
        WHERE id = v_aksesori.inventory_item_id AND tenant_id = p_tenant_id;

        v_sisa := v_jumlah;
        FOR v_batch IN
          SELECT id, qty_awal, qty_sisa
          FROM inventory_batch
          WHERE inventory_item_id = v_aksesori.inventory_item_id
            AND tenant_id = p_tenant_id AND qty_sisa < qty_awal
          ORDER BY tanggal_masuk DESC, created_at DESC
          FOR UPDATE
        LOOP
          EXIT WHEN v_sisa <= 0;
          v_ambil := LEAST(v_batch.qty_awal - v_batch.qty_sisa, v_sisa);
          UPDATE inventory_batch SET qty_sisa = qty_sisa + v_ambil WHERE id = v_batch.id;
          v_sisa := v_sisa - v_ambil;
        END LOOP;

        v_sisa := v_jumlah;
        FOR v_jurnal IN
          SELECT id, qty, nominal
          FROM jurnal_entry
          WHERE tenant_id = p_tenant_id AND jenis = 'direct_bahan'
            AND inventory_item_id = v_aksesori.inventory_item_id
            AND tag_po_ids @> jsonb_build_array(v_bundle.po_id::text)
            AND qty > 0
          ORDER BY created_at DESC
          FOR UPDATE
        LOOP
          EXIT WHEN v_sisa <= 0;
          v_ambil := LEAST(v_jurnal.qty, v_sisa);
          IF v_ambil >= v_jurnal.qty THEN
            DELETE FROM jurnal_entry WHERE id = v_jurnal.id;
          ELSE
            UPDATE jurnal_entry
            SET qty     = qty - v_ambil,
                nominal = GREATEST(round(nominal - nominal * v_ambil / v_jurnal.qty, 2), 0)
            WHERE id = v_jurnal.id;
          END IF;
          v_sisa := v_sisa - v_ambil;
        END LOOP;

        UPDATE pemakaian_aksesori
        SET qty_pakai = GREATEST(qty_pakai - v_jumlah, 0)
        WHERE bundle_id = v_bundle.id AND inventory_item_id = v_aksesori.inventory_item_id
          AND tahap = 'jahit';
      END IF;
    END LOOP;
  END IF;

  -- ── Update status bundle & scan_log terima ─────────────────────
  UPDATE bundle
  SET status_tahap = jsonb_set(
        status_tahap, '{jahit}',
        (status_tahap -> 'jahit')
          || jsonb_build_object('karyawan_id', p_karyawan_id, 'qty_terima', p_qty)
      )
  WHERE id = v_bundle.id;

  UPDATE scan_log
  SET karyawan_id = p_karyawan_id,
      qty         = p_qty::int,
      catatan     = concat_ws(' | ', NULLIF(catatan, ''),
                      'Dikoreksi ' || to_char(now() AT TIME ZONE 'Asia/Jakarta', 'DD/MM HH24:MI'))
  WHERE id = (
    SELECT id FROM scan_log
    WHERE bundle_id = v_bundle.id AND tahap = 'jahit' AND tipe = 'terima'
      AND tenant_id = p_tenant_id
    ORDER BY created_at DESC
    LIMIT 1
  );

  INSERT INTO audit_log (user_id, modul, aksi, target, metadata, tenant_id)
  VALUES (
    p_user_id, 'produksi', 'Koreksi Serah Terima Jahit', v_bundle.barcode,
    jsonb_build_object(
      'bundle_id',          v_bundle.id,
      'karyawan_id_lama',   v_karyawan_lama,
      'karyawan_id_baru',   p_karyawan_id,
      'qty_lama',           v_qty_lama,
      'qty_baru',           p_qty,
      'alasan',             NULLIF(trim(COALESCE(p_alasan, '')), ''),
      'stok_warnings',      v_stok_warnings,
      'koreksi_cutting',    CASE WHEN p_koreksi_cutting THEN jsonb_build_object(
                              'bundle_upah',      v_root_barcode,
                              'qty_cutting_lama', v_cut_lama,
                              'qty_cutting_baru', p_qty,
                              'total_dipotong',   v_root_total_baru,
                              'status_cutting',   v_root_status_baru,
                              'upah_tambah',      v_upah_tambah,
                              'upah_aksi',        v_upah_aksi
                            ) END
    ),
    p_tenant_id
  );

  RETURN jsonb_build_object(
    'qty_lama',            v_qty_lama,
    'qty_baru',            p_qty,
    'stok_warnings',       v_stok_warnings,
    'cutting_dikoreksi',   p_koreksi_cutting,
    'upah_cutting_tambah', v_upah_tambah,
    'upah_cutting_aksi',   v_upah_aksi
  );
END;
$function$;
