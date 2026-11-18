-- Laporan Per PO: Perkiraan (HPP × pcs dipotong) vs Aktual per komponen (18 Nov 2026) — Fase 5
-- Basis bundle sama dengan get_proyeksi_surplus_po (cutting selesai/partial, PO periode baru
-- + periode_baru_bundle_khusus), supaya total aktual = angka Kinerja Keuangan.

-- ─── Perkiraan per PO × komponen HPP ───
-- jenis_id: jenis bahan pembantu yang menanggung komponen ini untuk produk tsb
--           (aturan per model menang atas aturan umum, sama dengan v_pembantu_tarif_produk).
-- sisa    : bagian perkiraan untuk pcs yang biayanya belum tercatat:
--           komponen upah bertahap → pcs yang tahapnya belum selesai;
--           bahan pembantu (dijatah saat selesai jahit) → pcs yang jahitnya belum selesai;
--           aksesori lain (puring, sleting badan, …) → pcs yang belum punya pemakaian aksesori;
--           kain & overhead → 0.
CREATE OR REPLACE FUNCTION public.get_laporan_po_perkiraan(p_tenant_id text, p_po_mulai integer DEFAULT NULL::integer)
 RETURNS TABLE(po_id uuid, komponen_id uuid, nama text, kategori text, tahap text, jenis_id uuid,
               pcs numeric, perkiraan numeric, sisa numeric, pcs_belum numeric)
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
         SUM(CASE WHEN belum THEN pcs ELSE 0 END)
  FROM r
  GROUP BY 1, 2, 3, 4, 5, 6
  HAVING SUM(nilai) <> 0
$function$;

-- ─── Aktual per PO: kain per item, aksesori per item (+ qty menunggu harga), upah per tahap ───
-- nominal kain/aksesori = rumus yang sama dengan get_proyeksi_surplus_po.
-- Upah: tahap dibaca dari keterangan gaji_ledger ("Upah <tahap> - ..."); reject_potong mengurangi.
CREATE OR REPLACE FUNCTION public.get_laporan_po_aktual(p_tenant_id text, p_po_mulai integer DEFAULT NULL::integer)
 RETURNS TABLE(po_id uuid, sumber text, kunci text, qty numeric, qty_tunggu numeric, nominal numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH b AS (
    SELECT b.id, pi.po_id
    FROM bundle b
    JOIN po_item pi ON pi.id = b.po_item_id
    JOIN po ON po.id = pi.po_id
    WHERE b.tenant_id = p_tenant_id
      AND b.status_tahap->'cutting'->>'status' IN ('selesai', 'partial')
      AND (p_po_mulai IS NULL OR po_nomor(po.no_po) >= p_po_mulai
           OR b.id IN (SELECT bundle_id FROM periode_baru_bundle_khusus))
  ),
  tunggu AS (
    SELECT t.bundle_id, t.inventory_item_id, SUM(t.qty_sisa) q
    FROM aksesori_tunggu_harga t
    WHERE t.tenant_id = p_tenant_id AND t.qty_sisa > 0
    GROUP BY 1, 2
  ),
  aks AS (
    SELECT b.po_id, pa.bundle_id, pa.inventory_item_id, ii.nama,
           SUM(pa.qty_pakai) q, SUM(COALESCE(pa.harga_pakai, pa.qty_pakai * ii.harga_referensi, 0)) n
    FROM b JOIN pemakaian_aksesori pa ON pa.bundle_id = b.id
    JOIN inventory_item ii ON ii.id = pa.inventory_item_id
    GROUP BY 1, 2, 3, 4
  )
  SELECT b.po_id, 'kain'::text, ii.nama, SUM(pb.qty_pakai), 0::numeric,
         ROUND(SUM(COALESCE(NULLIF(pb.harga_pakai, 0),
                            pb.qty_pakai * COALESCE(ib.harga_satuan, ii.harga_referensi, 0))), 2)
  FROM b JOIN pemakaian_bahan pb ON pb.bundle_id = b.id
  JOIN inventory_item ii ON ii.id = pb.inventory_item_id
  LEFT JOIN inventory_batch ib ON ib.id = pb.inventory_batch_id
  GROUP BY 1, 2, 3

  UNION ALL

  SELECT a.po_id, 'aksesori'::text, a.nama, SUM(a.q), COALESCE(SUM(t.q), 0), ROUND(SUM(a.n), 2)
  FROM aks a LEFT JOIN tunggu t ON t.bundle_id = a.bundle_id AND t.inventory_item_id = a.inventory_item_id
  GROUP BY 1, 2, 3

  UNION ALL

  SELECT b.po_id, 'upah'::text,
         COALESCE(substring(lower(gl.keterangan) from '(cutting|jahit|buang_benang|lubang_kancing|steam|packing|qc|pengiriman)'), 'lainnya'),
         0::numeric, 0::numeric,
         SUM(CASE WHEN gl.tipe::text = 'reject_potong' THEN -gl.total ELSE gl.total END)
  FROM b JOIN gaji_ledger gl ON gl.sumber_id = b.id::text AND gl.tenant_id = p_tenant_id
  WHERE gl.status::text IN ('lunas', 'belum_lunas')
  GROUP BY 1, 2, 3
$function$;

GRANT EXECUTE ON FUNCTION public.get_laporan_po_perkiraan(text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_laporan_po_aktual(text, integer) TO authenticated;
