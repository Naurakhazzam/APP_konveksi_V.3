-- ================================================================
-- MIGRATION: Perkiraan upah pekerjaan berjalan + pelunasan per pekerja
--
-- 1. UPAH PERKIRAAN
--    Entri upah baru terbentuk saat bundle discan selesai, sehingga
--    pekerjaan yang masih dipegang penjahit tampil Rp0 — padahal untuk
--    administrasi angkanya sudah bisa diperkirakan: qty yang diterima
--    dikali tarif HPP tahap itu.
--
--    Angkanya SENGAJA dipisah ke kolom upah_perkiraan, tidak dijumlahkan
--    ke total_upah. total_upah adalah kewajiban yang sudah pasti dan yang
--    ikut dilunaskan; perkiraan bisa berubah kalau qty selesainya beda.
--
-- 2. PELUNASAN
--    RPC lunaskan_upah_pekerja menandai seluruh upah belum_lunas seorang
--    pekerja pada periode itu menjadi lunas. Yang sedang dikerjakan tidak
--    ikut — belum ada entri upahnya. Setelah lunas pekerjanya hilang dari
--    Overview dan Kroscek, mengikuti aturan "sudah lunas = tidak tampil".
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
  SELECT d.karyawan_id, d.tahap, d.total AS upah, 0::numeric AS perkiraan, d.tipe,
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
  UNION ALL
  -- Pekerjaan yang masih dipegang: upahnya diperkirakan dari tarif HPP.
  SELECT (b.status_tahap -> t.tahap ->> 'karyawan_id')::uuid, t.tahap,
         0::numeric,
         COALESCE((b.status_tahap -> t.tahap ->> 'qty_terima')::int, 0) * COALESCE(hi.harga_satuan, 0),
         'selesai'::gaji_ledger_tipe,
         COALESCE((b.status_tahap -> t.tahap ->> 'qty_terima')::int, 0),
         'sedang_dikerjakan'::text
  FROM bundle b
  CROSS JOIN LATERAL (VALUES
    ('jahit'),('lubang_kancing'),('buang_benang'),('qc'),('steam'),('packing')
  ) AS t(tahap)
  JOIN po_item pi ON pi.id = b.po_item_id
  LEFT JOIN hpp_item hi ON hi.produk_id = pi.produk_id AND hi.tenant_id = p_tenant_id
  LEFT JOIN hpp_komponen hk ON hk.id = hi.komponen_id AND hk.tahap_produksi::text = t.tahap
  WHERE b.tenant_id = p_tenant_id
    AND (b.status_tahap -> t.tahap ->> 'status') = 'terima'
    AND (b.status_tahap -> t.tahap ->> 'karyawan_id') IS NOT NULL
    AND (b.status_tahap -> t.tahap ->> 'waktu_terima')::timestamptz <= (p_sampai::date + 1)
    AND hk.id IS NOT NULL
)
SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.total_upah DESC), '[]'::jsonb)
FROM (
  SELECT k.id AS karyawan_id, k.nama, COALESCE(k.jabatan,'-') AS jabatan,
         COUNT(*)::int                AS jumlah_pekerjaan,
         COALESCE(SUM(o.qty),0)::int  AS total_pcs,
         (COALESCE(SUM(o.upah) FILTER (WHERE o.tipe IN ('selesai','rework')),0)
          - COALESCE(SUM(o.upah) FILTER (WHERE o.tipe='reject_potong'),0))::numeric AS total_upah,
         0::numeric                   AS upah_lunas,
         COALESCE(SUM(o.upah),0)::numeric      AS upah_belum_lunas,
         COALESCE(SUM(o.perkiraan),0)::numeric AS upah_perkiraan,
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
)
SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.tanggal DESC, x.no_po, x.model_nama), '[]'::jsonb)
FROM (
  SELECT e.id, e.tanggal, e.tahap, e.tipe, e.status, e.tanggal_bayar, e.upah, e.keadaan,
         COALESCE(
           (SELECT SUM(sji.qty_kirim) FROM surat_jalan_item sji WHERE sji.sj_id = e.sumber_uuid),
           CASE WHEN e.tahap = 'cutting'
                     THEN (b.status_tahap->'cutting'->>'qty_aktual')::int
                WHEN e.keadaan = 'sedang_dikerjakan'
                     THEN (b.status_tahap -> e.tahap ->> 'qty_terima')::int
                ELSE sl.qty END, 0) AS qty,
         COALESCE(b.barcode, sjh.nomor_sj, '-') AS barcode,
         COALESCE(po.no_po, sjh.nomor_sj, '-')  AS no_po,
         COALESCE(mp.nama,
                  CASE WHEN sjh.id IS NOT NULL THEN 'Finishing per pengiriman' END,
                  '-')                          AS model_nama,
         COALESCE(pr.nama, '-')  AS produk_nama,
         COALESCE(pi.warna, '-') AS warna,
         COALESCE(pi.size, '-')  AS size,
         COALESCE(kl.nama, klsj.nama, '-') AS klien_nama
  FROM baris e
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

-- Pelunasan satu pekerja untuk satu periode penggajian (Sabtu–Jumat).
CREATE OR REPLACE FUNCTION public.lunaskan_upah_pekerja(
  p_karyawan_id uuid, p_dari date, p_sampai date, p_user_id uuid, p_tenant_id text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_jml   INT;
  v_total NUMERIC;
  v_nama  TEXT;
BEGIN
  SELECT nama INTO v_nama FROM karyawan
  WHERE id = p_karyawan_id AND tenant_id = p_tenant_id;

  IF v_nama IS NULL THEN
    RAISE EXCEPTION 'Karyawan tidak ditemukan';
  END IF;

  SELECT COUNT(*), COALESCE(SUM(total),0) INTO v_jml, v_total
  FROM gaji_ledger
  WHERE tenant_id = p_tenant_id AND karyawan_id = p_karyawan_id
    AND status = 'belum_lunas' AND tanggal BETWEEN p_dari AND p_sampai;

  -- Yang sedang dikerjakan tidak punya entri upah, jadi tidak ada yang bisa
  -- dilunaskan — lebih baik menolak daripada diam-diam tidak melakukan apa pun.
  IF v_jml = 0 THEN
    RAISE EXCEPTION 'Tidak ada upah yang belum dibayar untuk % di periode ini', v_nama;
  END IF;

  UPDATE gaji_ledger
  SET status = 'lunas', tanggal_bayar = CURRENT_DATE
  WHERE tenant_id = p_tenant_id AND karyawan_id = p_karyawan_id
    AND status = 'belum_lunas' AND tanggal BETWEEN p_dari AND p_sampai;

  INSERT INTO audit_log (user_id, modul, aksi, target, metadata, tenant_id)
  VALUES (p_user_id, 'penggajian', 'Lunaskan Upah', v_nama,
          jsonb_build_object('karyawan', v_nama, 'periode_dari', p_dari,
                             'periode_sampai', p_sampai, 'jumlah_entri', v_jml,
                             'total', v_total),
          p_tenant_id);

  RETURN jsonb_build_object('success', true, 'nama', v_nama,
                            'jumlah_entri', v_jml, 'total', v_total);
END;
$function$;
