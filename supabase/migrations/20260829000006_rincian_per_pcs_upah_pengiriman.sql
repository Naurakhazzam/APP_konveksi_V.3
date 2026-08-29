-- ================================================================
-- MIGRATION: Rincian per pcs untuk upah finishing per-pengiriman (Hengky)
--
-- Sebagian upah Hengky (SJ/2026/00060 dan SJ/2026/00073) dicatat sebagai
-- satu baris lump-sum per tahap per surat jalan — misalnya "123 pcs kirim"
-- — karena entri normalnya sempat hilang untuk pengiriman itu dan
-- diperbaiki manual dengan total per-SJ. Akibatnya "Harga/Pcs" yang
-- ditampilkan adalah rata-rata blend dari banyak artikel berbeda dengan
-- tarif berbeda-beda, bukan angka yang benar per artikel.
--
-- Baris seperti ini sekarang DIPECAH saat ditampilkan: satu baris per
-- item surat jalan (artikel/warna/size), dengan qty dan tarif HPP asli
-- untuk tahap itu — sudah diverifikasi bahwa SUM(qty x tarif per item)
-- persis sama dengan lump-sum yang tersimpan, jadi tidak ada uang yang
-- berubah, hanya cara menampilkannya. Item dengan tarif 0 (komponen itu
-- tidak berlaku untuk artikel itu) tidak ditampilkan karena tidak
-- menyumbang upah apa pun.
--
-- Baris normal (bersumber dari satu bundle) tidak berubah. Baris yang
-- tidak cocok bundle maupun pecahan SJ (mis. SJ yang seluruh itemnya
-- bertarif 0, atau entri manual lain) tetap tampil lewat dasar_fallback
-- supaya tidak ada baris yang diam-diam hilang dari rincian walau upahnya
-- tetap terhitung di total kartu.
-- ================================================================

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
),
-- Baris bersumber satu bundle (kasus umum) — tidak berubah dari sebelumnya.
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
-- Baris bersumber satu surat jalan (upah lump-sum finishing per-pengiriman)
-- dipecah per item — satu baris per artikel dengan tarif HPP aslinya.
dasar_sj_raw AS (
  SELECT e.id AS orig_id, e.id || '-' || b2.id::text AS id, e.tanggal, e.tahap, e.tipe,
         e.status, e.tanggal_bayar,
         (sji.qty_kirim * hi2.harga_satuan)::numeric AS upah, e.keadaan,
         sji.qty_kirim AS qty,
         b2.barcode AS barcode,
         po2.no_po  AS no_po,
         COALESCE(mp2.nama, '-') AS model_nama,
         COALESCE(pr2.nama, '-') AS produk_nama,
         COALESCE(pi2.warna, '-') AS warna,
         COALESCE(pi2.size, '-')  AS size,
         COALESCE(kl2.nama, '-') AS klien_nama
  FROM baris e
  JOIN surat_jalan sjh       ON sjh.id = e.sumber_uuid
  JOIN surat_jalan_item sji  ON sji.sj_id = sjh.id
  JOIN bundle b2             ON b2.id = sji.bundle_id
  JOIN po_item pi2           ON pi2.id = b2.po_item_id
  JOIN hpp_item hi2          ON hi2.produk_id = pi2.produk_id AND hi2.tenant_id = p_tenant_id
  JOIN hpp_komponen hk2      ON hk2.id = hi2.komponen_id AND hk2.tahap_produksi::text = e.tahap
  LEFT JOIN po po2           ON po2.id = b2.po_id
  LEFT JOIN klien kl2        ON kl2.id = po2.klien_id
  LEFT JOIN produk pr2       ON pr2.id = pi2.produk_id
  LEFT JOIN model_produk mp2 ON mp2.id = pr2.model_id
  WHERE hi2.harga_satuan > 0
),
-- Jaring pengaman: baris yang tidak cocok bundle maupun menghasilkan
-- pecahan SJ (semua itemnya bertarif 0, atau sumber_id lain) tetap tampil
-- satu baris seperti sebelumnya, supaya upahnya tidak diam-diam hilang
-- dari rincian walau tetap terhitung di total kartu.
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
    AND NOT EXISTS (SELECT 1 FROM dasar_sj_raw r WHERE r.orig_id = e.id)
),
dasar AS (
  SELECT id, tanggal, tahap, tipe, status, tanggal_bayar, upah, keadaan, qty,
         barcode, no_po, model_nama, produk_nama, warna, size, klien_nama
  FROM dasar_bundle
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
