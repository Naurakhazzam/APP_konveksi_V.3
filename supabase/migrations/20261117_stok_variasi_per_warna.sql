-- Stok potongan variasi per warna Drill (17 Nov 2026, keputusan user)
-- Masuk  : Potong Variasi (yard Drill yang dipotong mandiri).
-- Keluar : Zubair/Arslan selesai jahit → 0,10 yard/pcs dari Drill warna KEDUA artikel ("Brown x Black" → Hitam).
--          "Grey" = Light grey. Bila stok potongan warna itu kosong → tidak dipotong (variasi dari celah
--          pola celana; jatah tetap jadi penghematan di saldo Variasi). Hitung sejak PO-0099 (periode baru).
-- Hanya catatan yard per warna; nilai rupiah tetap di saldo bahan pembantu "Variasi".

CREATE TABLE IF NOT EXISTS public.variasi_warna_drill (
  tenant_id         text NOT NULL DEFAULT 'STX-001',
  warna             text NOT NULL,           -- warna kedua artikel, huruf kecil tanpa spasi (mis. 'darkgrey')
  inventory_item_id uuid NOT NULL REFERENCES public.inventory_item(id),
  PRIMARY KEY (tenant_id, warna)
);
ALTER TABLE public.variasi_warna_drill ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS variasi_warna_drill_select ON public.variasi_warna_drill;
CREATE POLICY variasi_warna_drill_select ON public.variasi_warna_drill FOR SELECT TO authenticated USING (true);

INSERT INTO public.variasi_warna_drill (tenant_id, warna, inventory_item_id)
SELECT 'STX-001', v.warna, i.id
FROM (VALUES ('black', 'Drill Hitam'), ('hitam', 'Drill Hitam'),
             ('grey', 'Drill Light grey'), ('lightgrey', 'Drill Light grey'),
             ('darkgrey', 'Drill Dark grey'), ('navy', 'Drill navy'), ('mustard', 'Drill Mustard')) v(warna, item)
JOIN public.inventory_item i ON i.nama = v.item AND i.tenant_id = 'STX-001'
ON CONFLICT (tenant_id, warna) DO NOTHING;

-- Model yang memakai variasi Drill + patokan yard per pcs
CREATE TABLE IF NOT EXISTS public.variasi_model_drill (
  tenant_id   text NOT NULL DEFAULT 'STX-001',
  model_id    uuid NOT NULL REFERENCES public.model_produk(id),
  yard_per_pcs numeric NOT NULL DEFAULT 0.10 CHECK (yard_per_pcs >= 0),
  PRIMARY KEY (tenant_id, model_id)
);
ALTER TABLE public.variasi_model_drill ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS variasi_model_drill_select ON public.variasi_model_drill;
CREATE POLICY variasi_model_drill_select ON public.variasi_model_drill FOR SELECT TO authenticated USING (true);

INSERT INTO public.variasi_model_drill (tenant_id, model_id, yard_per_pcs)
SELECT 'STX-001', m.id, 0.10 FROM public.model_produk m
WHERE m.nama IN ('Zubair', 'Arslan') AND m.tenant_id = 'STX-001'
ON CONFLICT (tenant_id, model_id) DO NOTHING;

-- Warna kedua artikel "A x B" → kunci warna (huruf kecil, tanpa spasi). Artikel satu warna → warna itu.
CREATE OR REPLACE FUNCTION public._warna_variasi_kunci(p_warna text)
 RETURNS text LANGUAGE sql IMMUTABLE AS $f$
  SELECT lower(regexp_replace(trim(
    CASE WHEN p_warna ~* '\sx\s' THEN (regexp_split_to_array(p_warna, '\s+[xX]\s+'))[2] ELSE p_warna END
  ), '[\s_-]+', '', 'g'))
$f$;

-- Mutasi stok potongan variasi per warna Drill (berurutan waktu, tidak pernah minus)
CREATE OR REPLACE FUNCTION public.get_stok_variasi(p_tenant_id text, p_mulai integer DEFAULT 99)
 RETURNS TABLE(inventory_item_id uuid, waktu timestamptz, tipe text, ref text, pcs numeric,
               yard numeric, terpakai numeric, dari_celah numeric, sisa numeric)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE
  r record; v_item uuid; v_pool numeric := 0; v_pakai numeric;
BEGIN
  -- Semua potongan masuk jadi satu pool per warna (yang dipotong belakangan juga menutup jahitan
  -- sebelumnya, seperti saldo bahan pembantu); jahitan paling awal dipotong dulu.
  FOR r IN
    WITH masuk AS (
      SELECT v.bahan_item_id AS item, v.created_at AS t, 'potong'::text AS tp,
             COALESCE(v.untuk_model, 'Potong variasi') AS ref, NULL::numeric AS q, v.qty_pakai AS y
      FROM potong_variasi v WHERE v.tenant_id = p_tenant_id AND v.dibatalkan_at IS NULL
    ), keluar AS (
      SELECT vw.inventory_item_id AS item, sl.created_at AS t, 'jahit'::text AS tp,
             po.no_po || ' · ' || m.nama || ' ' || pi.warna || ' ' || pi.size AS ref,
             sl.qty::numeric AS q, sl.qty * vm.yard_per_pcs AS y
      FROM scan_log sl
      JOIN bundle b ON b.id = sl.bundle_id
      JOIN po_item pi ON pi.id = b.po_item_id
      JOIN po ON po.id = pi.po_id
      JOIN produk p ON p.id = pi.produk_id
      JOIN model_produk m ON m.id = p.model_id
      JOIN variasi_model_drill vm ON vm.model_id = p.model_id AND vm.tenant_id = p_tenant_id
      JOIN variasi_warna_drill vw ON vw.tenant_id = p_tenant_id AND vw.warna = _warna_variasi_kunci(pi.warna)
      WHERE sl.tenant_id = p_tenant_id AND sl.tahap = 'jahit' AND sl.tipe = 'selesai'
        AND (po_nomor(po.no_po) >= p_mulai OR b.id IN (SELECT bundle_id FROM periode_baru_bundle_khusus))
    )
    SELECT x.*, SUM(CASE WHEN x.tp = 'potong' THEN x.y ELSE 0 END) OVER (PARTITION BY x.item) AS total_masuk
    FROM (SELECT * FROM masuk UNION ALL SELECT * FROM keluar) x
    ORDER BY x.item, x.t, CASE WHEN x.tp = 'potong' THEN 0 ELSE 1 END
  LOOP
    IF v_item IS DISTINCT FROM r.item THEN v_item := r.item; v_pool := r.total_masuk; END IF;
    inventory_item_id := r.item; waktu := r.t; tipe := r.tp; ref := r.ref; pcs := r.q; yard := r.y;
    IF r.tp = 'potong' THEN
      terpakai := 0; dari_celah := 0;
    ELSE
      v_pakai := LEAST(v_pool, r.y);
      terpakai := v_pakai; dari_celah := r.y - v_pakai; v_pool := v_pool - v_pakai;
    END IF;
    sisa := v_pool;  -- sisa potongan (seluruh potongan masuk − terpakai s.d. baris ini)
    RETURN NEXT;
  END LOOP;
END
$function$;

REVOKE ALL ON FUNCTION public.get_stok_variasi(text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_stok_variasi(text, integer) TO authenticated, service_role;
