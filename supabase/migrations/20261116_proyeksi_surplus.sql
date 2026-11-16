-- Proyeksi surplus per PO bila semua hasil potong terkirim & dibayar (permintaan user 16 Nov 2026).
--   pendapatan  = pcs hasil cutting × harga jual (DP klien nanti dipotong dari tagihan, jadi sudah termasuk)
--   kain/aksesori = catatan pemakaian (modal FIFO)
--   upah_tercatat = gaji_ledger bundle PO itu (lunas + belum lunas, reject_potong mengurangi)
--   upah_sisa     = perkiraan: tarif HPP tahap × pcs hasil potong untuk tahap yang belum 'selesai'
-- Overhead & bahan pembantu tidak per PO di sini — dibagi per pcs di aplikasi dari uang Buku Kas.

CREATE OR REPLACE FUNCTION public.get_proyeksi_surplus_po(p_tenant_id text, p_po_mulai integer DEFAULT NULL)
RETURNS TABLE(po_id uuid, no_po text, klien text, pcs_potong numeric, nilai_jual numeric,
              biaya_kain numeric, biaya_aksesori numeric,
              upah_lunas numeric, upah_belum_lunas numeric, upah_sisa numeric)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH b AS (
    SELECT b.id, pi.po_id, pi.produk_id, b.status_tahap AS st,
           COALESCE((b.status_tahap->'cutting'->>'qty_aktual')::numeric, 0) AS pcs
    FROM bundle b
    JOIN po_item pi ON pi.id = b.po_item_id
    JOIN po ON po.id = pi.po_id
    WHERE b.tenant_id = p_tenant_id
      AND b.status_tahap->'cutting'->>'status' IN ('selesai', 'partial')
      AND (p_po_mulai IS NULL OR po_nomor(po.no_po) >= p_po_mulai
           OR b.id IN (SELECT bundle_id FROM periode_baru_bundle_khusus))
  ),
  jual AS (
    SELECT b.po_id, SUM(b.pcs) pcs, SUM(b.pcs * COALESCE(pr.harga_jual, 0)) nilai
    FROM b JOIN produk pr ON pr.id = b.produk_id GROUP BY 1
  ),
  kain AS (
    SELECT b.po_id, SUM(COALESCE(NULLIF(pb.harga_pakai, 0),
                                 pb.qty_pakai * COALESCE(ib.harga_satuan, ii.harga_referensi, 0))) n
    FROM b JOIN pemakaian_bahan pb ON pb.bundle_id = b.id
    JOIN inventory_item ii ON ii.id = pb.inventory_item_id
    LEFT JOIN inventory_batch ib ON ib.id = pb.inventory_batch_id
    GROUP BY 1
  ),
  aks AS (
    SELECT b.po_id, SUM(COALESCE(pa.harga_pakai, pa.qty_pakai * ii.harga_referensi, 0)) n
    FROM b JOIN pemakaian_aksesori pa ON pa.bundle_id = b.id
    JOIN inventory_item ii ON ii.id = pa.inventory_item_id
    GROUP BY 1
  ),
  upah AS (
    SELECT b.po_id,
           SUM(CASE WHEN gl.status::text = 'lunas' THEN
                 CASE WHEN gl.tipe::text = 'reject_potong' THEN -gl.total ELSE gl.total END END) lunas,
           SUM(CASE WHEN gl.status::text = 'belum_lunas' THEN
                 CASE WHEN gl.tipe::text = 'reject_potong' THEN -gl.total ELSE gl.total END END) belum
    FROM b JOIN gaji_ledger gl ON gl.sumber_id = b.id::text AND gl.tenant_id = p_tenant_id
    WHERE gl.status::text IN ('lunas', 'belum_lunas')
    GROUP BY 1
  ),
  sisa AS (
    SELECT b.po_id, SUM(b.pcs * hi.qty * hi.harga_satuan) n
    FROM b
    JOIN hpp_item hi ON hi.produk_id = b.produk_id
    JOIN hpp_komponen hk ON hk.id = hi.komponen_id
    WHERE hk.tahap_produksi IS NOT NULL
      AND COALESCE(b.st -> hk.tahap_produksi::text ->> 'status', '') <> 'selesai'
    GROUP BY 1
  )
  SELECT po.id, po.no_po, k.nama,
         COALESCE(j.pcs, 0), COALESCE(j.nilai, 0),
         ROUND(COALESCE(kn.n, 0), 2), ROUND(COALESCE(a.n, 0), 2),
         COALESCE(u.lunas, 0), COALESCE(u.belum, 0), ROUND(COALESCE(s.n, 0), 2)
  FROM jual j
  JOIN po ON po.id = j.po_id
  LEFT JOIN klien k ON k.id = po.klien_id
  LEFT JOIN kain kn ON kn.po_id = j.po_id
  LEFT JOIN aks a ON a.po_id = j.po_id
  LEFT JOIN upah u ON u.po_id = j.po_id
  LEFT JOIN sisa s ON s.po_id = j.po_id
  ORDER BY po_nomor(po.no_po)
$function$;

REVOKE ALL ON FUNCTION public.get_proyeksi_surplus_po(text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_proyeksi_surplus_po(text, integer) TO authenticated;
