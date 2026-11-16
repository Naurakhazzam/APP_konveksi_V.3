-- Detail satu PO untuk pop-up di menu Proyeksi Surplus (permintaan user 16 Nov 2026):
-- per artikel (po_item) × tahap → pcs selesai / sedang dikerjakan / belum.
-- Bundle yang dihitung sama dengan get_proyeksi_surplus_po (sudah dipotong, periode baru / bundle khusus).
-- Tahap per produk = cutting + tahap yang punya upah di HPP (Jacket dsb. otomatis tanpa LK/Steam).

CREATE OR REPLACE FUNCTION public.get_proyeksi_po_detail(p_tenant_id text, p_po_id uuid, p_po_mulai integer DEFAULT NULL::integer)
 RETURNS TABLE(po_item_id uuid, model text, warna text, size text, qty_order numeric,
               pcs_potong numeric, pcs_kirim numeric, tahap text, urutan integer,
               pcs_selesai numeric, pcs_proses numeric, pcs_belum numeric)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  WITH b AS (
    SELECT b.id, b.po_item_id, pi.produk_id, b.status_tahap AS st,
           COALESCE((b.status_tahap->'cutting'->>'qty_aktual')::numeric, 0) AS pcs
    FROM bundle b
    JOIN po_item pi ON pi.id = b.po_item_id
    JOIN po ON po.id = pi.po_id
    WHERE b.tenant_id = p_tenant_id AND pi.po_id = p_po_id
      AND b.status_tahap->'cutting'->>'status' IN ('selesai', 'partial')
      AND (p_po_mulai IS NULL OR po_nomor(po.no_po) >= p_po_mulai
           OR b.id IN (SELECT bundle_id FROM periode_baru_bundle_khusus))
  ),
  kirim AS (
    SELECT b.po_item_id, SUM(sji.qty_kirim) q
    FROM b
    JOIN surat_jalan_item sji ON sji.bundle_id = b.id
    JOIN surat_jalan sj ON sj.id = sji.sj_id
    WHERE sj.status::text <> 'draft' AND COALESCE(sj.jenis, 'normal') <> 'kirim_ulang'
    GROUP BY 1
  ),
  item AS (
    SELECT b.po_item_id, b.produk_id, SUM(b.pcs) pcs FROM b GROUP BY 1, 2
  ),
  tahap AS (
    SELECT DISTINCT i.po_item_id, t.tahap
    FROM item i
    CROSS JOIN LATERAL (
      SELECT 'cutting'::text AS tahap
      UNION
      SELECT hk.tahap_produksi::text FROM hpp_item hi JOIN hpp_komponen hk ON hk.id = hi.komponen_id
      WHERE hi.produk_id = i.produk_id AND hk.tahap_produksi IS NOT NULL
    ) t
  ),
  hitung AS (
    SELECT t.po_item_id, t.tahap,
           SUM(CASE WHEN b.st->t.tahap->>'status' = 'selesai' THEN b.pcs ELSE 0 END) selesai,
           SUM(CASE WHEN b.st->t.tahap->>'status' IN ('terima', 'progress', 'partial') THEN b.pcs ELSE 0 END) proses,
           SUM(CASE WHEN COALESCE(b.st->t.tahap->>'status', '') NOT IN ('selesai', 'terima', 'progress', 'partial')
                    THEN b.pcs ELSE 0 END) belum
    FROM tahap t JOIN b ON b.po_item_id = t.po_item_id
    GROUP BY 1, 2
  )
  SELECT i.po_item_id, COALESCE(m.nama, pr.nama), pi.warna, pi.size, pi.qty_order::numeric,
         i.pcs, COALESCE(k.q, 0), h.tahap,
         COALESCE(array_position(ARRAY['cutting','jahit','lubang_kancing','buang_benang','qc','steam','packing'], h.tahap), 99),
         h.selesai, h.proses, h.belum
  FROM item i
  JOIN po_item pi ON pi.id = i.po_item_id
  JOIN produk pr ON pr.id = i.produk_id
  LEFT JOIN model_produk m ON m.id = pr.model_id
  LEFT JOIN size sz ON sz.id = pr.size_id
  LEFT JOIN kirim k ON k.po_item_id = i.po_item_id
  JOIN hitung h ON h.po_item_id = i.po_item_id
  ORDER BY 2, 3, sz.urutan NULLS LAST, 4, 9
$function$;

GRANT EXECUTE ON FUNCTION public.get_proyeksi_po_detail(text, uuid, integer) TO authenticated;
