-- =============================================================================
-- MIGRATION: 20261119_jurnal_pembantu_reject_produksi.sql
-- Dibuat : 19 November 2026
--
-- 1. Jurnal Produksi (get_jurnal_produksi) konsisten dengan Kinerja Keuangan:
--    - Bahan pembantu = jatah HPP yang terpakai dari saldo (get_mutasi_saldo_pembantu
--      tipe 'jatah'), per tanggal & jenis. Jatah tak tertutup saldo = penghematan (Rp 0).
--    - Belanja Bahan Pembantu bertanda jenis = jenis 'belanja_pembantu' (informasi, masuk saldo).
--      Bahan Pembantu tanpa jenis & Biaya Peralatan = overhead (seperti Kinerja).
--    - 'lainnya' (Biaya Operasional, Lainnya) dipisah dari Total Biaya Produksi di aplikasi.
-- 2. Reject produksi (menu Produksi → Reject), belum pernah dipakai (reject_log 0 baris):
--    - konfirmasi_reject: potongan disimpan POSITIF (dulu negatif → laporan yang
--      mengurangkan reject_potong malah MENAMBAH upah), sumber_id = bundle (dulu
--      reject_log.id → hilang dari laporan periode baru & tak tertaut PO), upah dicari
--      per tahap karyawan, boleh upah yang sudah lunas (memotong gaji berikutnya).
--    - selesai_rework: dulu selalu gagal (kolom ar.alasan_nama tak ada & tipe
--      'rework_selesai' tak ada di enum). Pengembalian kini tertaut bundle.
--    - 'rework_selesai' ikut dihitung sebagai upah di get_biaya_upah_*, overview/riwayat
--      pekerja; dikeluarkan dari hitungan beda tarif. upah_belum_lunas overview kini
--      mengurangkan potongan.
--    - record_reject (026) = kode mati tanpa pemanggil UI, tidak diubah.
-- =============================================================================

ALTER TYPE gaji_ledger_tipe ADD VALUE IF NOT EXISTS 'rework_selesai';
-- (ADD VALUE harus di-commit sebelum fungsi di bawah dibuat bila dijalankan dalam satu transaksi)

-- ─── 1. Jurnal Produksi: bahan pembantu = jatah HPP; belanja pembantu = informasi ───
CREATE OR REPLACE FUNCTION public.get_jurnal_produksi(p_tenant_id text, p_dari date, p_sampai date, p_po_mulai integer DEFAULT NULL::integer)
 RETURNS TABLE(tanggal date, jenis text, kategori text, keterangan text, no_po text, qty numeric, satuan text, nominal numeric, waktu timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT CASE WHEN p_po_mulai IS NULL THEN (pb.created_at AT TIME ZONE 'Asia/Jakarta')::date ELSE GREATEST((pb.created_at AT TIME ZONE 'Asia/Jakarta')::date, tanggal_awal_periode()) END, 'kain', ii.nama,
         b.barcode || CASE WHEN pb.dari_sisa THEN ' (kain sisa)' ELSE '' END,
         po.no_po, pb.qty_pakai, ii.satuan,
         ROUND(COALESCE(NULLIF(pb.harga_pakai, 0), pb.qty_pakai * COALESCE(ib.harga_satuan, ii.harga_referensi, 0)), 2),
         pb.created_at
  FROM pemakaian_bahan pb
  JOIN bundle b ON b.id = pb.bundle_id
  JOIN inventory_item ii ON ii.id = pb.inventory_item_id
  LEFT JOIN inventory_batch ib ON ib.id = pb.inventory_batch_id
  JOIN po_item pi ON pi.id = pb.po_item_id JOIN po ON po.id = pi.po_id
  WHERE pb.tenant_id = p_tenant_id
    AND CASE WHEN p_po_mulai IS NULL THEN (pb.created_at AT TIME ZONE 'Asia/Jakarta')::date ELSE GREATEST((pb.created_at AT TIME ZONE 'Asia/Jakarta')::date, tanggal_awal_periode()) END BETWEEN p_dari AND p_sampai
    AND (p_po_mulai IS NULL OR po_nomor(po.no_po) >= p_po_mulai
         OR pb.bundle_id IN (SELECT bundle_id FROM periode_baru_bundle_khusus))
  UNION ALL
  SELECT CASE WHEN p_po_mulai IS NULL THEN (pa.created_at AT TIME ZONE 'Asia/Jakarta')::date ELSE GREATEST((pa.created_at AT TIME ZONE 'Asia/Jakarta')::date, tanggal_awal_periode()) END, 'aksesori', ii.nama,
         b.barcode || ' · ' || COALESCE(pa.tahap::text, '-'),
         po.no_po, pa.qty_pakai, ii.satuan,
         ROUND(COALESCE(pa.harga_pakai, pa.qty_pakai * ii.harga_referensi, 0), 2),
         pa.created_at
  FROM pemakaian_aksesori pa
  JOIN inventory_item ii ON ii.id = pa.inventory_item_id
  JOIN bundle b ON b.id = pa.bundle_id JOIN po_item pi ON pi.id = b.po_item_id JOIN po ON po.id = pi.po_id
  WHERE pa.tenant_id = p_tenant_id
    AND CASE WHEN p_po_mulai IS NULL THEN (pa.created_at AT TIME ZONE 'Asia/Jakarta')::date ELSE GREATEST((pa.created_at AT TIME ZONE 'Asia/Jakarta')::date, tanggal_awal_periode()) END BETWEEN p_dari AND p_sampai
    AND (p_po_mulai IS NULL OR po_nomor(po.no_po) >= p_po_mulai
         OR b.id IN (SELECT bundle_id FROM periode_baru_bundle_khusus))
  UNION ALL
  -- Bahan pembantu: jatah HPP per pcs selesai jahit, yang tertutup saldo (sama dengan Kinerja Keuangan).
  -- Jatah yang tidak tertutup saldo = penghematan (nominal 0, disebut di keterangan).
  SELECT CASE WHEN p_po_mulai IS NULL THEN m.tanggal ELSE GREATEST(m.tanggal, tanggal_awal_periode()) END,
         'pembantu', COALESCE(pj.nama, 'Bahan Pembantu'),
         'Jatah HPP ' || replace(to_char(m.pcs, 'FM999G999G999'), ',', '.') || ' pcs selesai jahit'
           || CASE WHEN m.ke_hemat > 0.005 THEN ' · jatah Rp ' || replace(to_char(ROUND(m.nominal), 'FM999G999G999'), ',', '.')
                   || ', Rp ' || replace(to_char(ROUND(m.ke_hemat), 'FM999G999G999'), ',', '.') || ' tidak tertutup saldo (penghematan)'
                   ELSE '' END,
         NULL, m.pcs, 'pcs', ROUND(-m.ke_saldo, 2), NULL
  FROM get_mutasi_saldo_pembantu(p_tenant_id, COALESCE(p_po_mulai, 99)) m
  LEFT JOIN pembantu_jenis pj ON pj.id = m.jenis_id
  WHERE m.tipe = 'jatah'
    AND CASE WHEN p_po_mulai IS NULL THEN m.tanggal ELSE GREATEST(m.tanggal, tanggal_awal_periode()) END BETWEEN p_dari AND p_sampai
  UNION ALL
  SELECT CASE WHEN p_po_mulai IS NULL THEN gl.tanggal ELSE GREATEST(gl.tanggal, tanggal_awal_periode()) END, 'upah', COALESCE(kr.nama, '-'), gl.keterangan, po.no_po, NULL, NULL,
         CASE WHEN gl.tipe::text = 'reject_potong' THEN -gl.total ELSE gl.total END,
         gl.created_at
  FROM gaji_ledger gl
  LEFT JOIN karyawan kr ON kr.id = gl.karyawan_id
  LEFT JOIN bundle b ON b.id::text = gl.sumber_id
  LEFT JOIN po_item pi ON pi.id = b.po_item_id LEFT JOIN po ON po.id = pi.po_id
  WHERE gl.tenant_id = p_tenant_id AND gl.status::text IN ('belum_lunas', 'lunas')
    AND CASE WHEN p_po_mulai IS NULL THEN gl.tanggal ELSE GREATEST(gl.tanggal, tanggal_awal_periode()) END BETWEEN p_dari AND p_sampai
    AND (p_po_mulai IS NULL OR gl.sumber_id IN (
          SELECT x::text FROM bundle_ids_periode_baru(p_tenant_id, p_po_mulai) x))
  UNION ALL
  SELECT k.tanggal,
         CASE WHEN k.kategori IN ('Biaya Overhead', 'Biaya Peralatan') THEN 'overhead'
              WHEN k.kategori = 'Bahan Pembantu' AND k.pembantu_jenis_id IS NULL THEN 'overhead'
              -- Belanja bahan pembantu bertanda jenis: masuk saldo, biayanya = jatah HPP saat dipakai.
              -- Sebelum periode baru (tanpa sistem saldo) tetap dicatat sebagai biaya saat dibeli.
              WHEN k.kategori = 'Bahan Pembantu' AND k.tanggal < tanggal_awal_periode() THEN 'pembantu'
              WHEN k.kategori = 'Bahan Pembantu' THEN 'belanja_pembantu'
              WHEN k.kategori = 'Pembelian Bahan' THEN 'pembelian'
              ELSE 'lainnya' END,
         CASE WHEN k.kategori = 'Biaya Overhead' THEN COALESCE(s.nama, 'Tanpa sub-kelompok')
              WHEN k.kategori = 'Bahan Pembantu' THEN COALESCE(pj.nama, 'Bahan Pembantu (tanpa jenis)')
              ELSE k.kategori END,
         concat_ws(' · ', NULLIF(k.keterangan, ''), NULLIF(k.no_referensi, '')),
         po.no_po, k.qty, k.satuan, k.nominal, k.created_at
  FROM buku_kas k
  LEFT JOIN overhead_sub s ON s.id = k.overhead_sub_id
  LEFT JOIN pembantu_jenis pj ON pj.id = k.pembantu_jenis_id
  LEFT JOIN po ON po.id = k.po_id
  WHERE k.tenant_id = p_tenant_id AND k.tipe = 'keluar'
    AND k.kategori IN ('Biaya Overhead', 'Biaya Peralatan', 'Biaya Operasional', 'Lainnya', 'Bahan Pembantu', 'Pembelian Bahan')
    AND k.tanggal BETWEEN p_dari AND p_sampai
    AND (p_po_mulai IS NULL OR k.tanggal >= tanggal_awal_periode())
    AND (p_po_mulai IS NULL OR k.po_id IS NULL OR po_nomor(po.no_po) >= p_po_mulai)
    AND NOT (k.kategori = 'Biaya Overhead' AND k.overhead_sub_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM biaya_tetap bt WHERE bt.overhead_sub_id = k.overhead_sub_id AND bt.tenant_id = p_tenant_id))
  UNION ALL
  SELECT MAX(d.hari)::date, 'biaya_tetap', s.nama,
         bt.nama || ' — ' || COUNT(*) || ' hari × Rp ' ||
           to_char(ROUND(bt.nominal / (bt.tanggal_selesai - bt.tanggal_mulai + 1)), 'FM999G999G999'),
         NULL, COUNT(*), 'hari',
         ROUND(SUM(bt.nominal / (bt.tanggal_selesai - bt.tanggal_mulai + 1)), 2), NULL
  FROM biaya_tetap bt
  JOIN overhead_sub s ON s.id = bt.overhead_sub_id
  CROSS JOIN LATERAL generate_series(
    GREATEST(bt.tanggal_mulai, p_dari,
             CASE WHEN p_po_mulai IS NULL THEN p_dari ELSE tanggal_awal_periode() END),
    -- biaya tetap hanya sampai hari ini (sama dengan Kinerja Keuangan), bukan hari yang belum lewat
    LEAST(bt.tanggal_selesai, p_sampai, (now() AT TIME ZONE 'Asia/Jakarta')::date), interval '1 day') AS d(hari)
  WHERE bt.tenant_id = p_tenant_id
  GROUP BY bt.id, bt.nama, bt.nominal, bt.tanggal_mulai, bt.tanggal_selesai, s.nama, to_char(d.hari, 'YYYY-MM')
$function$;

-- ─── 2. Reject produksi: potongan POSITIF, tertaut bundle, per tahap ───
CREATE OR REPLACE FUNCTION public.konfirmasi_reject(p_reject_log_id uuid, p_responsible_ids uuid[], p_user_id uuid DEFAULT NULL::uuid, p_tenant_id text DEFAULT 'STX-001'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_reject          RECORD;
  v_rk              RECORD;
  v_gaji            RECORD;
  v_potongan        NUMERIC;
  v_new_status      TEXT;
  v_gaji_ledger_id  UUID;
  v_count_potong    INTEGER := 0;
BEGIN
  SELECT rl.*, ar.bisa_diperbaiki, ar.persen_potongan, ar.nama AS alasan_nama
  INTO v_reject
  FROM reject_log rl
  JOIN alasan_reject ar ON ar.id = rl.alasan_reject_id
  WHERE rl.id = p_reject_log_id
    AND rl.tenant_id = p_tenant_id
    AND rl.status = 'menunggu_konfirmasi';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reject tidak ditemukan atau sudah dikonfirmasi';
  END IF;

  UPDATE reject_karyawan
  SET is_responsible = (id = ANY(p_responsible_ids))
  WHERE reject_log_id = p_reject_log_id
    AND tenant_id = p_tenant_id;

  FOR v_rk IN
    SELECT * FROM reject_karyawan
    WHERE reject_log_id  = p_reject_log_id
      AND is_responsible = true
      AND tenant_id      = p_tenant_id
  LOOP
    -- Upah karyawan ini untuk bundle & tahap yang sama (boleh sudah dibayar:
    -- potongannya lalu memotong pembayaran gaji berikutnya)
    SELECT id, total INTO v_gaji
    FROM gaji_ledger
    WHERE karyawan_id = v_rk.karyawan_id
      AND sumber_id   = v_reject.bundle_id::TEXT
      AND tenant_id   = p_tenant_id
      AND tipe        = 'selesai'
      AND keterangan LIKE 'Upah ' || v_rk.tahap || ' - %'
      AND status      IN ('belum_lunas', 'lunas', 'escrow')
    ORDER BY created_at DESC
    LIMIT 1;

    IF FOUND THEN
      v_potongan := ROUND(v_gaji.total * v_rk.persen_potongan / 100.0, 0);

      -- Potongan disimpan POSITIF (semua laporan mengurangkan tipe reject_potong)
      -- dan sumber_id = bundle, supaya ikut filter periode & tertaut ke PO.
      INSERT INTO gaji_ledger (
        karyawan_id, tipe, total, tanggal,
        sumber_id, keterangan, status,
        tenant_id, created_by
      )
      VALUES (
        v_rk.karyawan_id,
        'reject_potong',
        v_potongan,
        (now() AT TIME ZONE 'Asia/Jakarta')::date,
        v_reject.bundle_id::TEXT,
        'Potongan reject ' || v_rk.tahap || ' ' || v_rk.persen_potongan || '% — ' ||
          v_reject.alasan_nama || ' [' || v_reject.nomor_reject || ']' ||
          CASE WHEN v_reject.bisa_diperbaiki THEN ' (ditahan sampai rework selesai)' ELSE '' END,
        'belum_lunas',
        p_tenant_id,
        p_user_id
      )
      RETURNING id INTO v_gaji_ledger_id;

      UPDATE reject_karyawan
      SET gaji_ledger_id = v_gaji_ledger_id
      WHERE id = v_rk.id;

      v_count_potong := v_count_potong + 1;
    END IF;
  END LOOP;

  v_new_status := CASE WHEN v_reject.bisa_diperbaiki THEN 'rework' ELSE 'selesai' END;

  UPDATE reject_log
  SET status = v_new_status
  WHERE id = p_reject_log_id;

  RETURN jsonb_build_object(
    'success',       true,
    'reject_log_id', p_reject_log_id,
    'status_baru',   v_new_status,
    'count_potong',  v_count_potong
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.selesai_rework(p_reject_log_id uuid, p_user_id uuid DEFAULT NULL::uuid, p_tenant_id text DEFAULT 'STX-001'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_reject          RECORD;
  v_rk              RECORD;
  v_gaji            RECORD;
  v_kembali_id      UUID;
  v_count_kembali   INTEGER := 0;
BEGIN
  SELECT rl.*, ar.nama AS alasan_nama
  INTO v_reject
  FROM reject_log rl
  JOIN alasan_reject ar ON ar.id = rl.alasan_reject_id
  WHERE rl.id        = p_reject_log_id
    AND rl.tenant_id = p_tenant_id
    AND rl.status    = 'rework';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reject tidak ditemukan atau bukan status rework';
  END IF;

  FOR v_rk IN
    SELECT * FROM reject_karyawan
    WHERE reject_log_id  = p_reject_log_id
      AND is_responsible = true
      AND gaji_ledger_id IS NOT NULL
      AND gaji_kembali_id IS NULL
      AND tenant_id      = p_tenant_id
  LOOP
    SELECT total, status INTO v_gaji
    FROM gaji_ledger
    WHERE id = v_rk.gaji_ledger_id;

    IF FOUND THEN
      -- Pengembalian (positif), tertaut bundle yang sama dengan potongannya
      INSERT INTO gaji_ledger (
        karyawan_id, tipe, total, tanggal,
        sumber_id, keterangan, status,
        tenant_id, created_by
      )
      VALUES (
        v_rk.karyawan_id,
        'rework_selesai',
        ABS(v_gaji.total),
        (now() AT TIME ZONE 'Asia/Jakarta')::date,
        v_reject.bundle_id::TEXT,
        'Pengembalian potongan reject ' || v_rk.tahap || ' — rework selesai [' || v_reject.nomor_reject || ']',
        'belum_lunas',
        p_tenant_id,
        p_user_id
      )
      RETURNING id INTO v_kembali_id;

      UPDATE reject_karyawan
      SET gaji_kembali_id = v_kembali_id
      WHERE id = v_rk.id;

      v_count_kembali := v_count_kembali + 1;
    END IF;
  END LOOP;

  UPDATE reject_log
  SET status = 'selesai'
  WHERE id = p_reject_log_id;

  RETURN jsonb_build_object(
    'success',        true,
    'reject_log_id',  p_reject_log_id,
    'status_baru',    'selesai',
    'count_kembali',  v_count_kembali
  );
END;
$function$;

-- record_reject (026) = kode mati tanpa pemanggil UI, sengaja tidak diubah.
CREATE OR REPLACE FUNCTION public.get_biaya_upah_per_po(p_tenant_id text)
 RETURNS TABLE(po_id uuid, biaya_upah numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
  SELECT
    pi.po_id,
    SUM(
      CASE
        WHEN gl.tipe IN ('selesai', 'rework', 'rework_selesai') THEN  gl.total
        WHEN gl.tipe = 'reject_potong'        THEN -gl.total
        ELSE 0
      END
    )::NUMERIC AS biaya_upah
  FROM gaji_ledger gl
  JOIN bundle  b  ON b.id  = gl.sumber_id::UUID  AND b.tenant_id = p_tenant_id
  JOIN po_item pi ON pi.id = b.po_item_id
  WHERE gl.tenant_id = p_tenant_id
    AND gl.tipe IN ('selesai', 'rework', 'rework_selesai', 'reject_potong')
    AND gl.status != 'cancelled'
    AND gl.sumber_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  GROUP BY pi.po_id
$function$;

CREATE OR REPLACE FUNCTION public.get_biaya_upah_detail_po(p_po_id uuid, p_tenant_id text)
 RETURNS TABLE(karyawan_nama text, tanggal date, keterangan text, qty_bundle numeric, total numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
  SELECT
    k.nama                                         AS karyawan_nama,
    gl.tanggal::DATE                               AS tanggal,
    gl.keterangan                                  AS keterangan,
    COALESCE(pi.qty_per_bundle, 0)::NUMERIC        AS qty_bundle,
    CASE
      WHEN gl.tipe IN ('selesai', 'rework', 'rework_selesai') THEN  gl.total
      WHEN gl.tipe = 'reject_potong'        THEN -gl.total
      ELSE 0
    END                                            AS total
  FROM gaji_ledger gl
  JOIN karyawan k  ON k.id  = gl.karyawan_id       AND k.tenant_id  = p_tenant_id
  JOIN bundle   b  ON b.id  = gl.sumber_id::UUID   AND b.tenant_id  = p_tenant_id
  JOIN po_item  pi ON pi.id = b.po_item_id          AND pi.po_id     = p_po_id
  WHERE gl.tenant_id = p_tenant_id
    AND gl.tipe IN ('selesai', 'rework', 'rework_selesai', 'reject_potong')
    AND gl.status != 'cancelled'
    AND gl.sumber_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ORDER BY gl.tanggal, k.nama
$function$;

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
         (COALESCE(SUM(o.upah) FILTER (WHERE o.tipe IN ('selesai','rework','rework_selesai')),0)
          - COALESCE(SUM(o.upah) FILTER (WHERE o.tipe='reject_potong'),0))::numeric AS total_upah,
         0::numeric                   AS upah_lunas,
         (COALESCE(SUM(o.upah) FILTER (WHERE o.tipe<>'reject_potong'),0)
          - COALESCE(SUM(o.upah) FILTER (WHERE o.tipe='reject_potong'),0))::numeric AS upah_belum_lunas,
         COALESCE(SUM(o.upah) FILTER (WHERE o.keadaan='sedang_dikerjakan'),0)::numeric AS upah_perkiraan,
         COALESCE(SUM(o.upah) FILTER (WHERE o.tipe='reject_potong'),0)::numeric AS total_potongan,
         COUNT(*) FILTER (WHERE o.keadaan='belum_dibayar')::int     AS jml_belum_dibayar,
         COUNT(*) FILTER (WHERE o.keadaan='sedang_dikerjakan')::int AS jml_sedang_dikerjakan,
         ARRAY_REMOVE(ARRAY_AGG(DISTINCT o.tahap) FILTER (WHERE o.tipe IN ('selesai','rework')), NULL)::text[]    AS daftar_tahap,
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
         (COALESCE(SUM(d.upah) FILTER (WHERE d.tipe IN ('selesai','rework','rework_selesai')), 0)
          - COALESCE(SUM(d.upah) FILTER (WHERE d.tipe = 'reject_potong'), 0))::numeric AS total_upah,
         MAX(d.tanggal_bayar)::date   AS tanggal_bayar_terakhir,
         ARRAY_REMOVE(ARRAY_AGG(DISTINCT d.tahap) FILTER (WHERE d.tipe IN ('selesai','rework')), NULL)::text[] AS daftar_tahap,
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

CREATE OR REPLACE FUNCTION public.get_laporan_po_beda_tarif(p_tenant_id text, p_po_mulai integer DEFAULT NULL::integer)
 RETURNS TABLE(po_id uuid, tahap text, beda numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH b AS (
    SELECT b.id, pi.po_id, pi.produk_id
    FROM bundle b
    JOIN po_item pi ON pi.id = b.po_item_id
    JOIN po ON po.id = pi.po_id
    WHERE b.tenant_id = p_tenant_id
      AND b.status_tahap->'cutting'->>'status' IN ('selesai', 'partial')
      AND (p_po_mulai IS NULL OR po_nomor(po.no_po) >= p_po_mulai
           OR b.id IN (SELECT bundle_id FROM periode_baru_bundle_khusus))
  ),
  g AS (
    SELECT b.po_id, b.produk_id,
           substring(lower(gl.keterangan) from '(cutting|jahit|buang_benang|lubang_kancing|steam|packing|qc|pengiriman)') AS tahap,
           CASE WHEN gl.tipe::text = 'reject_potong' THEN -gl.total ELSE gl.total END AS total,
           gl.created_at
    FROM b JOIN gaji_ledger gl ON gl.sumber_id = b.id::text AND gl.tenant_id = p_tenant_id
    WHERE gl.status::text IN ('lunas', 'belum_lunas')
      AND gl.tipe::text NOT IN ('reject_potong', 'rework_selesai') -- potongan/pengembalian reject bukan beda tarif
  ),
  t AS (
    SELECT g.po_id, g.tahap, SUM(g.total) total, g.produk_id,
           tarif_tahap_pada(g.produk_id, g.tahap, g.created_at) dulu,
           tarif_tahap_pada(g.produk_id, g.tahap, 'infinity'::timestamptz) kini
    FROM g WHERE g.tahap IS NOT NULL
    GROUP BY g.po_id, g.tahap, g.produk_id, g.created_at
  )
  SELECT po_id, tahap,
         ROUND(SUM(CASE WHEN dulu > 0 AND dulu <> kini THEN total * (1 - kini / dulu) ELSE 0 END), 2)
  FROM t
  GROUP BY 1, 2
  HAVING ROUND(SUM(CASE WHEN dulu > 0 AND dulu <> kini THEN total * (1 - kini / dulu) ELSE 0 END), 2) <> 0
$function$;

