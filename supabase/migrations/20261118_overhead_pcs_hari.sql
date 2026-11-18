-- =============================================================================
-- F4 Laporan Per PO: data mesin overhead pcs-hari (kinerja.server.ts)
-- =============================================================================
-- Per bundle yang sudah dipotong (periode baru):
--   pcs          qty_aktual cutting
--   tgl_mulai    selesai cutting (tanggal kejadian, F3), min. awal periode
--   tgl_selesai  selesai packing (tanggal kejadian, apa adanya); bila belum packing tapi
--                sudah dikirim / ditutup → tanggal itu; NULL = masih dalam proses
--   bobot        overhead HPP per pcs produk (komponen kategori 'overhead');
--                0 bila produk belum punya HPP overhead (aplikasi memakai rata-rata)
--   kirim        [{bulan, pcs}] kiriman SJ non-draft (bukan kirim_ulang)
-- Overhead harian dibagi ke bundle yang sedang diproses hari itu, sebanding
-- pcs × bobot. Hari tanpa barang dalam proses = beban bulan (di aplikasi).
-- =============================================================================

CREATE OR REPLACE FUNCTION get_overhead_bundle(p_tenant_id text, p_po_mulai integer DEFAULT NULL)
RETURNS TABLE(bundle_id uuid, po_id uuid, pcs numeric, tgl_mulai date, tgl_selesai date, bobot numeric, kirim jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH b AS (
    SELECT b.id, pi.po_id, pi.produk_id, b.status_tahap, b.ditutup_at,
           COALESCE((b.status_tahap->'cutting'->>'qty_aktual')::numeric, 0) AS pcs
    FROM bundle b
    JOIN po_item pi ON pi.id = b.po_item_id
    JOIN po ON po.id = pi.po_id
    WHERE b.tenant_id = p_tenant_id
      AND b.status_tahap->'cutting'->>'status' IN ('selesai', 'partial')
      AND (p_po_mulai IS NULL OR po_nomor(po.no_po) >= p_po_mulai
           OR b.id IN (SELECT bundle_id FROM periode_baru_bundle_khusus))
  ),
  kirim AS (
    SELECT x.bundle_id, MIN(x.tanggal) AS tgl_pertama,
           jsonb_agg(jsonb_build_object('bulan', x.bulan, 'pcs', x.pcs)) AS kirim
    FROM (
      SELECT sji.bundle_id, sj.tanggal,
             to_char(GREATEST(sj.tanggal, tanggal_awal_periode()), 'YYYY-MM') AS bulan,
             sji.qty_kirim::numeric AS pcs
      FROM surat_jalan_item sji
      JOIN surat_jalan sj ON sj.id = sji.sj_id
      WHERE sji.bundle_id IN (SELECT id FROM b)
        AND sj.status::text <> 'draft' AND COALESCE(sj.jenis, 'normal') <> 'kirim_ulang'
    ) x
    GROUP BY x.bundle_id
  ),
  bobot AS (
    SELECT hi.produk_id, SUM(hi.qty * hi.harga_satuan) AS bobot
    FROM hpp_item hi
    JOIN hpp_komponen k ON k.id = hi.komponen_id AND k.kategori = 'overhead'
    WHERE hi.tenant_id = p_tenant_id
    GROUP BY hi.produk_id
  )
  SELECT b.id, b.po_id, b.pcs,
         GREATEST(COALESCE(tanggal_selesai_efektif(b.status_tahap, 'cutting'),
                           ((b.status_tahap->'cutting'->>'start_time')::timestamptz AT TIME ZONE 'Asia/Jakarta')::date,
                           (now() AT TIME ZONE 'Asia/Jakarta')::date),
                  tanggal_awal_periode()) AS tgl_mulai,
         -- Tidak di-GREATEST: selesai sebelum awal periode = tidak menanggung overhead periode ini
         COALESCE(tanggal_selesai_efektif(b.status_tahap, 'packing'), k.tgl_pertama,
                  (b.ditutup_at AT TIME ZONE 'Asia/Jakarta')::date) AS tgl_selesai,
         COALESCE(bo.bobot, 0),
         COALESCE(k.kirim, '[]'::jsonb)
  FROM b
  LEFT JOIN kirim k ON k.bundle_id = b.id
  LEFT JOIN bobot bo ON bo.produk_id = b.produk_id
$$;
