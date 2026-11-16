-- Pengecualian khusus: bundle dari PO lama (di bawah PO_AWAL_PERIODE) yang tetap
-- dihitung sebagai periode baru di menu Keuangan.
-- Kasus 16 Nov 2026: PO-0097 Khalid Black L 5 pcs & XXXL 5 pcs dipotong dari kain
-- stok periode baru (sisa Toyobo Hitam). Kasus satu kali, tidak untuk dipakai rutin.

CREATE TABLE IF NOT EXISTS public.periode_baru_bundle_khusus (
  bundle_id  uuid PRIMARY KEY REFERENCES public.bundle(id) ON DELETE CASCADE,
  tenant_id  text NOT NULL,
  alasan     text,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- Hanya dibaca lewat fungsi SECURITY DEFINER di bawah
ALTER TABLE public.periode_baru_bundle_khusus ENABLE ROW LEVEL SECURITY;

INSERT INTO public.periode_baru_bundle_khusus (bundle_id, tenant_id, alasan)
SELECT id, tenant_id, 'Dipotong dari sisa Toyobo Hitam stok periode baru (16 Nov 2026)'
FROM public.bundle
WHERE tenant_id = 'STX-001' AND barcode IN ('PO-0097-00680-bdl01', 'PO-0097-00682-bdl01')
ON CONFLICT (bundle_id) DO NOTHING;

-- Upah, reject, invoice: daftar bundle periode baru + pengecualian
CREATE OR REPLACE FUNCTION public.bundle_ids_periode_baru(p_tenant_id text, p_mulai integer DEFAULT 99)
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT b.id FROM bundle b JOIN po_item pi ON pi.id = b.po_item_id JOIN po ON po.id = pi.po_id
  WHERE b.tenant_id = p_tenant_id AND po_nomor(po.no_po) >= p_mulai
  UNION
  SELECT k.bundle_id FROM periode_baru_bundle_khusus k WHERE k.tenant_id = p_tenant_id
$function$;

CREATE OR REPLACE FUNCTION public.po_ids_periode_baru(p_tenant_id text, p_mulai integer DEFAULT 99)
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT id FROM po WHERE tenant_id = p_tenant_id AND po_nomor(no_po) >= p_mulai
$function$;

-- Biaya kain & aksesori per bulan
CREATE OR REPLACE FUNCTION public.get_biaya_bahan_bulanan(p_dari date, p_sampai date, p_tenant_id text, p_po_mulai integer DEFAULT NULL::integer)
 RETURNS TABLE(bulan text, biaya_kain numeric, biaya_aksesori numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH k AS (
    SELECT to_char((pb.created_at AT TIME ZONE 'Asia/Jakarta')::date, 'YYYY-MM') bulan,
           SUM(COALESCE(NULLIF(pb.harga_pakai, 0), pb.qty_pakai * COALESCE(ib.harga_satuan, ii.harga_referensi, 0))) total
    FROM pemakaian_bahan pb
    LEFT JOIN inventory_batch ib ON ib.id = pb.inventory_batch_id
    JOIN inventory_item ii ON ii.id = pb.inventory_item_id
    JOIN po_item pi ON pi.id = pb.po_item_id JOIN po ON po.id = pi.po_id
    WHERE pb.tenant_id = p_tenant_id
      AND (pb.created_at AT TIME ZONE 'Asia/Jakarta')::date BETWEEN p_dari AND p_sampai
      AND (p_po_mulai IS NULL OR po_nomor(po.no_po) >= p_po_mulai
           OR pb.bundle_id IN (SELECT bundle_id FROM periode_baru_bundle_khusus))
    GROUP BY 1),
  a AS (
    SELECT to_char((pa.created_at AT TIME ZONE 'Asia/Jakarta')::date, 'YYYY-MM') bulan,
           SUM(COALESCE(pa.harga_pakai, pa.qty_pakai * ii.harga_referensi, 0)) total
    FROM pemakaian_aksesori pa JOIN inventory_item ii ON ii.id = pa.inventory_item_id
    JOIN bundle b ON b.id = pa.bundle_id JOIN po_item pi ON pi.id = b.po_item_id JOIN po ON po.id = pi.po_id
    WHERE pa.tenant_id = p_tenant_id
      AND (pa.created_at AT TIME ZONE 'Asia/Jakarta')::date BETWEEN p_dari AND p_sampai
      AND (p_po_mulai IS NULL OR po_nomor(po.no_po) >= p_po_mulai
           OR b.id IN (SELECT bundle_id FROM periode_baru_bundle_khusus))
    GROUP BY 1)
  SELECT COALESCE(k.bulan, a.bulan), COALESCE(k.total, 0), COALESCE(a.total, 0)
  FROM k FULL JOIN a ON a.bulan = k.bulan;
$function$;

-- Saldo bahan pembantu: jatah jahit bundle pengecualian ikut dihitung
CREATE OR REPLACE FUNCTION public.get_mutasi_saldo_pembantu(p_tenant_id text, p_mulai integer DEFAULT 99, p_tanggal_mulai date DEFAULT '2026-11-14'::date)
 RETURNS TABLE(jenis_id uuid, tanggal date, tipe text, nominal numeric, pcs numeric, ke_saldo numeric, ke_hemat numeric, saldo numeric, hemat_kumulatif numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE
  r record; v_jenis uuid; v_saldo numeric := 0; v_hemat numeric := 0; v_pakai numeric;
BEGIN
  FOR r IN
    WITH jatah AS (
      SELECT t.jenis_id AS j, (sl.created_at AT TIME ZONE 'Asia/Jakarta')::date AS tgl,
             SUM(sl.qty * t.tarif) AS nom, SUM(sl.qty)::numeric AS q
      FROM scan_log sl
      JOIN bundle b ON b.id = sl.bundle_id
      JOIN po_item pi ON pi.id = b.po_item_id
      JOIN po ON po.id = pi.po_id
      JOIN v_pembantu_tarif_produk t ON t.produk_id = pi.produk_id
      WHERE sl.tenant_id = p_tenant_id AND sl.tahap = 'jahit' AND sl.tipe = 'selesai'
        AND (po_nomor(po.no_po) >= p_mulai OR b.id IN (SELECT bundle_id FROM periode_baru_bundle_khusus))
      GROUP BY 1, 2
    ), beli AS (
      SELECT k.pembantu_jenis_id AS j, k.tanggal AS tgl, SUM(k.nominal) AS nom, NULL::numeric AS q
      FROM buku_kas k
      WHERE k.tenant_id = p_tenant_id AND k.tipe = 'keluar' AND k.kategori = 'Bahan Pembantu'
        AND k.pembantu_jenis_id IS NOT NULL AND k.tanggal >= p_tanggal_mulai
      GROUP BY 1, 2
    )
    SELECT x.j, x.tgl, x.tp, x.nom, x.q FROM (
      SELECT j, tgl, 'beli'::text AS tp, nom, q, 0 AS ord FROM beli
      UNION ALL
      SELECT j, tgl, 'jatah'::text, nom, q, 1 FROM jatah
    ) x ORDER BY x.j, x.tgl, x.ord
  LOOP
    IF v_jenis IS DISTINCT FROM r.j THEN
      v_jenis := r.j; v_saldo := 0; v_hemat := 0;
    END IF;
    jenis_id := r.j; tanggal := r.tgl; tipe := r.tp; nominal := r.nom; pcs := r.q;
    IF r.tp = 'beli' THEN
      ke_saldo := r.nom; ke_hemat := 0; v_saldo := v_saldo + r.nom;
    ELSE
      v_pakai := LEAST(v_saldo, r.nom);
      ke_saldo := -v_pakai; ke_hemat := r.nom - v_pakai;
      v_saldo := v_saldo - v_pakai; v_hemat := v_hemat + ke_hemat;
    END IF;
    saldo := v_saldo; hemat_kumulatif := v_hemat;
    RETURN NEXT;
  END LOOP;
END
$function$;
