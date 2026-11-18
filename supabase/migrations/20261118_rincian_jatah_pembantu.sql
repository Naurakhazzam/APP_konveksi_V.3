-- Rincian jatah bahan pembantu per artikel (model) dan tarif HPP per pcs.
-- Filter periode sama persis dengan get_mutasi_saldo_pembantu (jatah = pcs selesai jahit × tarif),
-- jadi Σ pcs / Σ nominal per jenis = angka "Pcs Dijahit" / "Jatah HPP" di menu Saldo Bahan Pembantu.
CREATE OR REPLACE FUNCTION public.get_rincian_jatah_pembantu(p_tenant_id text, p_mulai integer DEFAULT 99)
RETURNS TABLE(jenis_id uuid, artikel text, tarif numeric, pcs numeric, nominal numeric, ukuran text)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH dasar AS (
    SELECT t.jenis_id, COALESCE(m.nama, pr.nama) AS artikel, t.tarif, pi.size, SUM(sl.qty)::numeric AS q
    FROM scan_log sl
    JOIN bundle b   ON b.id = sl.bundle_id
    JOIN po_item pi ON pi.id = b.po_item_id
    JOIN po         ON po.id = pi.po_id
    JOIN produk pr  ON pr.id = pi.produk_id
    LEFT JOIN model_produk m ON m.id = pr.model_id
    JOIN v_pembantu_tarif_produk t ON t.produk_id = pi.produk_id
    WHERE sl.tenant_id = p_tenant_id AND sl.tahap = 'jahit' AND sl.tipe = 'selesai'
      AND (po_nomor(po.no_po) >= p_mulai OR b.id IN (SELECT bundle_id FROM periode_baru_bundle_khusus))
    GROUP BY 1, 2, 3, 4
  )
  SELECT d.jenis_id, d.artikel, d.tarif, SUM(d.q), SUM(d.q * d.tarif),
         string_agg(COALESCE(d.size, '-') || ' ' || d.q::int, ', '
           ORDER BY COALESCE(array_position(ARRAY['XS','S','M','L','XL','XXL','XXXL','4XL','5XL'], upper(d.size)), 99), d.size)
  FROM dasar d
  GROUP BY d.jenis_id, d.artikel, d.tarif
  ORDER BY d.jenis_id, SUM(d.q) DESC;
$function$;
