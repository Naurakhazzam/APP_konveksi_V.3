-- Laporan Per PO: rincian komponen (expand baris) — 19 Nov 2026
-- 1) get_laporan_po_perkiraan + kolom qty_hpp (Σ pcs × qty HPP per pcs) → rincian aksesori (qty HPP vs terpakai).
-- 2) get_laporan_po_kain: per PO × bahan → pemakaian (satuan) & nilai aktual vs patokan HPP.
--    Patokan per bundle = pcs × standar_pemakaian_bahan (sumber 'hpp' diutamakan) dan pcs × HPP Bahan,
--    dibagi ke bahan yang dipakai bundle itu sebanding qty pakai. Bundle tanpa catatan pemakaian →
--    baris bahan NULL ("belum tercatat").

DROP FUNCTION IF EXISTS public.get_laporan_po_perkiraan(text, integer);
CREATE FUNCTION public.get_laporan_po_perkiraan(p_tenant_id text, p_po_mulai integer DEFAULT NULL::integer)
 RETURNS TABLE(po_id uuid, komponen_id uuid, nama text, kategori text, tahap text, jenis_id uuid, pcs numeric, perkiraan numeric, sisa numeric, pcs_belum numeric, qty_hpp numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH b AS (
    SELECT b.id, pi.po_id, pi.produk_id, p.model_id, b.status_tahap AS st,
           COALESCE((b.status_tahap->'cutting'->>'qty_aktual')::numeric, 0) AS pcs,
           EXISTS (SELECT 1 FROM pemakaian_aksesori pa WHERE pa.bundle_id = b.id) AS ada_aks
    FROM bundle b
    JOIN po_item pi ON pi.id = b.po_item_id
    JOIN po ON po.id = pi.po_id
    JOIN produk p ON p.id = pi.produk_id
    WHERE b.tenant_id = p_tenant_id
      AND b.status_tahap->'cutting'->>'status' IN ('selesai', 'partial')
      AND (p_po_mulai IS NULL OR po_nomor(po.no_po) >= p_po_mulai
           OR b.id IN (SELECT bundle_id FROM periode_baru_bundle_khusus))
  ),
  r AS (
    SELECT b.po_id, b.pcs, hk.id AS komponen_id, hk.nama, hk.kategori, hk.tahap_produksi::text AS tahap,
           CASE WHEN am.id IS NOT NULL THEN am.jenis_id ELSE ad.jenis_id END AS jenis_id,
           b.pcs * hi.qty * hi.harga_satuan AS nilai,
           b.pcs * hi.qty AS qty_hpp,
           CASE
             WHEN hk.tahap_produksi IS NOT NULL
               THEN COALESCE(b.st -> hk.tahap_produksi::text ->> 'status', '') <> 'selesai'
             WHEN COALESCE(am.jenis_id, ad.jenis_id) IS NOT NULL
               THEN COALESCE(b.st -> 'jahit' ->> 'status', '') <> 'selesai'
             WHEN hk.kategori = 'bahan_baku' AND hk.nama <> 'HPP Bahan'
               THEN NOT b.ada_aks
             ELSE false
           END AS belum
    FROM b
    JOIN hpp_item hi ON hi.produk_id = b.produk_id
    JOIN hpp_komponen hk ON hk.id = hi.komponen_id
    LEFT JOIN pembantu_aturan am ON am.komponen_id = hi.komponen_id AND am.model_id = b.model_id AND am.tenant_id = p_tenant_id
    LEFT JOIN pembantu_aturan ad ON ad.komponen_id = hi.komponen_id AND ad.model_id IS NULL AND ad.tenant_id = p_tenant_id
    WHERE b.pcs > 0
  )
  SELECT po_id, komponen_id, nama, kategori, tahap, jenis_id,
         SUM(pcs), ROUND(SUM(nilai), 2),
         ROUND(SUM(CASE WHEN belum THEN nilai ELSE 0 END), 2),
         SUM(CASE WHEN belum THEN pcs ELSE 0 END),
         SUM(qty_hpp)
  FROM r
  GROUP BY 1, 2, 3, 4, 5, 6
  HAVING SUM(nilai) <> 0
$function$;

CREATE OR REPLACE FUNCTION public.get_laporan_po_kain(p_tenant_id text, p_po_mulai integer DEFAULT NULL::integer)
 RETURNS TABLE(po_id uuid, bahan text, satuan text, pcs numeric, qty_patokan numeric, qty_pakai numeric, nilai_hpp numeric, nilai_aktual numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH b AS (
    SELECT b.id, pi.po_id, pi.produk_id, p.model_id, pi.size,
           COALESCE((b.status_tahap->'cutting'->>'qty_aktual')::numeric, 0) AS pcs
    FROM bundle b
    JOIN po_item pi ON pi.id = b.po_item_id
    JOIN po ON po.id = pi.po_id
    JOIN produk p ON p.id = pi.produk_id
    WHERE b.tenant_id = p_tenant_id
      AND b.status_tahap->'cutting'->>'status' IN ('selesai', 'partial')
      AND (p_po_mulai IS NULL OR po_nomor(po.no_po) >= p_po_mulai
           OR b.id IN (SELECT bundle_id FROM periode_baru_bundle_khusus))
  ),
  pat AS (
    SELECT b.id, b.po_id, b.pcs,
           b.pcs * COALESCE((
             SELECT s.rate_per_pcs FROM standar_pemakaian_bahan s
             WHERE s.tenant_id = p_tenant_id AND s.model_id = b.model_id AND upper(s.size) = upper(b.size)
             ORDER BY (s.sumber = 'hpp') DESC, s.updated_at DESC LIMIT 1), 0) AS qty_patokan,
           b.pcs * COALESCE((
             SELECT SUM(hi.qty * hi.harga_satuan) FROM hpp_item hi JOIN hpp_komponen hk ON hk.id = hi.komponen_id
             WHERE hi.produk_id = b.produk_id AND hk.nama = 'HPP Bahan'), 0) AS nilai_hpp
    FROM b
  ),
  pakai AS (
    SELECT pb.bundle_id, ii.nama, ii.satuan, SUM(pb.qty_pakai) q,
           SUM(COALESCE(NULLIF(pb.harga_pakai, 0), pb.qty_pakai * COALESCE(ib.harga_satuan, ii.harga_referensi, 0))) n
    FROM pemakaian_bahan pb
    JOIN b ON b.id = pb.bundle_id
    JOIN inventory_item ii ON ii.id = pb.inventory_item_id
    LEFT JOIN inventory_batch ib ON ib.id = pb.inventory_batch_id
    GROUP BY 1, 2, 3
  ),
  tot AS (SELECT bundle_id, SUM(q) q, COUNT(*) n FROM pakai GROUP BY 1),
  gabung AS (
    -- bagian patokan per bahan: sebanding qty pakai (rata bila qty 0)
    SELECT pat.po_id, pk.nama AS bahan, pk.satuan, pat.pcs,
           CASE WHEN t.q > 0 THEN pk.q / t.q ELSE 1.0 / t.n END AS porsi,
           pat.qty_patokan, pat.nilai_hpp, pk.q, pk.n
    FROM pat JOIN pakai pk ON pk.bundle_id = pat.id JOIN tot t ON t.bundle_id = pat.id
    UNION ALL
    SELECT pat.po_id, NULL, NULL, pat.pcs, 1, pat.qty_patokan, pat.nilai_hpp, 0, 0
    FROM pat WHERE NOT EXISTS (SELECT 1 FROM pakai pk WHERE pk.bundle_id = pat.id) AND pat.pcs > 0
  )
  SELECT po_id, bahan, satuan,
         ROUND(SUM(pcs * porsi), 2), ROUND(SUM(qty_patokan * porsi), 3), ROUND(SUM(q), 3),
         ROUND(SUM(nilai_hpp * porsi), 2), ROUND(SUM(n), 2)
  FROM gabung
  GROUP BY 1, 2, 3
$function$;

GRANT EXECUTE ON FUNCTION public.get_laporan_po_perkiraan(text, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_laporan_po_kain(text, integer) TO authenticated, service_role;
