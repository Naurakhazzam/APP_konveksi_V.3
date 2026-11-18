-- Laporan Per PO: kesimpulan margin (18 Nov 2026)
--   F2: riwayat tarif upah HPP → pisahkan "beda tarif" dari hemat/boros upah
--   F3: qty pesan vs dipotong vs dikirim per artikel × warna × size

-- ─── F2: riwayat tarif komponen upah (komponen HPP bertahap) ───
-- nilai = qty × harga_satuan per pcs yang berlaku SEBELUM berlaku_sampai.
-- Tarif pada waktu t = baris riwayat paling awal dengan berlaku_sampai > t, selain itu tarif sekarang.
CREATE TABLE IF NOT EXISTS public.hpp_tarif_riwayat (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL,
  produk_id uuid NOT NULL,
  komponen_id uuid NOT NULL,
  nilai numeric NOT NULL,
  berlaku_sampai timestamptz NOT NULL,
  sumber text NOT NULL DEFAULT 'trigger',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS hpp_tarif_riwayat_cari ON public.hpp_tarif_riwayat (produk_id, komponen_id, berlaku_sampai);
ALTER TABLE public.hpp_tarif_riwayat ENABLE ROW LEVEL SECURITY;

-- Isi awal dari cadangan sebelum sinkron sheet 15 Nov (tarif yang berbeda / komponen yang hilang)
INSERT INTO public.hpp_tarif_riwayat (tenant_id, produk_id, komponen_id, nilai, berlaku_sampai, sumber)
SELECT bk.tenant_id, bk.produk_id, bk.komponen_id, bk.qty * bk.harga_satuan,
       '2026-11-15 04:07:45.952+00'::timestamptz, 'backup_20261115'
FROM public.hpp_item_backup_20261115 bk
JOIN public.hpp_komponen hk ON hk.id = bk.komponen_id AND hk.tahap_produksi IS NOT NULL
LEFT JOIN public.hpp_item hi ON hi.produk_id = bk.produk_id AND hi.komponen_id = bk.komponen_id
WHERE (hi.id IS NULL OR hi.qty * hi.harga_satuan IS DISTINCT FROM bk.qty * bk.harga_satuan)
  AND NOT EXISTS (SELECT 1 FROM public.hpp_tarif_riwayat r WHERE r.sumber = 'backup_20261115'
                  AND r.produk_id = bk.produk_id AND r.komponen_id = bk.komponen_id);

CREATE OR REPLACE FUNCTION public._catat_riwayat_tarif_hpp()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.produk_id = NEW.produk_id AND OLD.komponen_id = NEW.komponen_id
     AND (OLD.qty * OLD.harga_satuan) IS NOT DISTINCT FROM (NEW.qty * NEW.harga_satuan) THEN
    RETURN NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM hpp_komponen WHERE id = OLD.komponen_id AND tahap_produksi IS NOT NULL) THEN
    INSERT INTO hpp_tarif_riwayat (tenant_id, produk_id, komponen_id, nilai, berlaku_sampai)
    VALUES (OLD.tenant_id, OLD.produk_id, OLD.komponen_id, OLD.qty * OLD.harga_satuan, now());
  END IF;
  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS trg_riwayat_tarif_hpp ON public.hpp_item;
CREATE TRIGGER trg_riwayat_tarif_hpp AFTER UPDATE OR DELETE ON public.hpp_item
  FOR EACH ROW EXECUTE FUNCTION public._catat_riwayat_tarif_hpp();

-- Tarif upah per pcs satu tahap untuk produk pada waktu tertentu
CREATE OR REPLACE FUNCTION public.tarif_tahap_pada(p_produk uuid, p_tahap text, p_waktu timestamptz)
 RETURNS numeric
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH k AS (
    SELECT komponen_id, SUM(nilai) nilai_kini FROM (
      SELECT hi.komponen_id, hi.qty * hi.harga_satuan nilai
      FROM hpp_item hi JOIN hpp_komponen hk ON hk.id = hi.komponen_id
      WHERE hi.produk_id = p_produk AND hk.tahap_produksi::text = p_tahap
      UNION ALL
      SELECT DISTINCT r.komponen_id, 0
      FROM hpp_tarif_riwayat r JOIN hpp_komponen hk ON hk.id = r.komponen_id
      WHERE r.produk_id = p_produk AND hk.tahap_produksi::text = p_tahap
    ) x GROUP BY 1
  )
  SELECT COALESCE(SUM(COALESCE(
    (SELECT r.nilai FROM hpp_tarif_riwayat r
     WHERE r.produk_id = p_produk AND r.komponen_id = k.komponen_id AND r.berlaku_sampai > p_waktu
     ORDER BY r.berlaku_sampai LIMIT 1),
    k.nilai_kini)), 0)
  FROM k
$function$;

-- Beda tarif per PO × tahap: aktual − (aktual bila dihitung dengan tarif HPP sekarang)
--   = Σ total × (1 − tarif_kini / tarif_saat_dicatat). Negatif = aktual lebih murah karena tarif lama.
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

-- ─── F3: qty pesan vs dipotong vs dikirim per po_item ───
-- belum_potong = bundle aktif (belum ditutup) yang cutting-nya belum selesai → selisih belum final.
CREATE OR REPLACE FUNCTION public.get_laporan_po_qty(p_tenant_id text, p_po_mulai integer DEFAULT NULL::integer, p_po_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(po_id uuid, po_item_id uuid, artikel text, warna text, size text, harga_jual numeric,
               qty_pesan numeric, pcs_potong numeric, pcs_kirim numeric, bundle_belum_potong integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH pi AS (
    SELECT pi.id, pi.po_id, pi.warna, pi.size, pi.qty_order, pr.harga_jual,
           COALESCE(mp.nama, pr.nama) AS artikel
    FROM po_item pi
    JOIN po ON po.id = pi.po_id
    JOIN produk pr ON pr.id = pi.produk_id
    LEFT JOIN model_produk mp ON mp.id = pr.model_id
    WHERE po.tenant_id = p_tenant_id
      AND (p_po_id IS NULL OR po.id = p_po_id)
      AND (p_po_mulai IS NULL OR po_nomor(po.no_po) >= p_po_mulai)
  ),
  b AS (
    SELECT b.po_item_id,
           SUM(CASE WHEN b.status_tahap->'cutting'->>'status' IN ('selesai', 'partial')
                    THEN COALESCE((b.status_tahap->'cutting'->>'qty_aktual')::numeric, 0) ELSE 0 END) potong,
           COUNT(*) FILTER (WHERE b.ditutup_at IS NULL
                    AND COALESCE(b.status_tahap->'cutting'->>'status', '') NOT IN ('selesai', 'partial'))::int belum
    FROM bundle b WHERE b.po_item_id IN (SELECT id FROM pi) AND b.tenant_id = p_tenant_id
    GROUP BY 1
  ),
  k AS (
    SELECT b.po_item_id, SUM(sji.qty_kirim)::numeric q
    FROM bundle b
    JOIN surat_jalan_item sji ON sji.bundle_id = b.id
    JOIN surat_jalan sj ON sj.id = sji.sj_id
    WHERE b.po_item_id IN (SELECT id FROM pi)
      AND sj.status::text <> 'draft' AND COALESCE(sj.jenis, 'normal') <> 'kirim_ulang'
    GROUP BY 1
  )
  SELECT pi.po_id, pi.id, pi.artikel, pi.warna, pi.size, COALESCE(pi.harga_jual, 0),
         pi.qty_order::numeric, COALESCE(b.potong, 0), COALESCE(k.q, 0), COALESCE(b.belum, 0)
  FROM pi LEFT JOIN b ON b.po_item_id = pi.id LEFT JOIN k ON k.po_item_id = pi.id
$function$;

GRANT EXECUTE ON FUNCTION public.get_laporan_po_beda_tarif(text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_laporan_po_qty(text, integer, uuid) TO authenticated;
