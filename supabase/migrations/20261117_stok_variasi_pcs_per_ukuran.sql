-- Stok potongan variasi dalam PCS per ukuran (17 Nov 2026, koreksi user)
-- Potong Variasi: kain Drill habis jadi potongan (mis. 13,52 m → 86 pcs: S20 M33 L20 XXXL13).
-- Stok yang dilacak = pcs potongan per warna Drill per ukuran, BUKAN yard.
-- Zubair/Arslan selesai jahit memakai 1 potongan per pcs, warna kedua artikel ("Brown x Black" → Hitam),
-- ukuran yang sama. Potongan untuk satu model hanya dipakai model itu; "Zubair & Arslan" dipakai keduanya
-- (model sendiri dipakai dulu). Potongan habis → dianggap dari celah pola celana (tidak minus).
-- Semua potongan jadi satu pool (yang dipotong belakangan ikut menutup jahitan sebelumnya).

DROP FUNCTION IF EXISTS public.get_stok_variasi(text, integer);

CREATE FUNCTION public.get_stok_variasi(p_tenant_id text, p_mulai integer DEFAULT 99)
 RETURNS TABLE(inventory_item_id uuid, size text, waktu timestamptz, tipe text, ref text, untuk text,
               pcs numeric, terpakai numeric, dari_celah numeric)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE
  r record; v_pool jsonb := '{}'::jsonb; v_key text; v_ada numeric; v_ambil numeric; v_butuh numeric;
  v_grup text;
BEGIN
  -- Pool awal: total potongan per (warna drill, ukuran, untuk)
  SELECT COALESCE(jsonb_object_agg(k, n), '{}'::jsonb) INTO v_pool FROM (
    SELECT v.bahan_item_id::text || '|' || e.key || '|' || COALESCE(v.untuk_model, 'Zubair & Arslan') AS k,
           SUM(e.value::text::numeric) AS n
    FROM potong_variasi v, jsonb_each(COALESCE(v.per_size, '{}'::jsonb)) e
    WHERE v.tenant_id = p_tenant_id AND v.dibatalkan_at IS NULL
    GROUP BY 1
  ) x;

  FOR r IN
    WITH masuk AS (
      SELECT v.bahan_item_id AS item, e.key AS sz, v.created_at AS t, 'potong'::text AS tp,
             'Potong variasi'::text AS ref, COALESCE(v.untuk_model, 'Zubair & Arslan') AS utk,
             e.value::text::numeric AS q, NULL::text AS model
      FROM potong_variasi v, jsonb_each(COALESCE(v.per_size, '{}'::jsonb)) e
      WHERE v.tenant_id = p_tenant_id AND v.dibatalkan_at IS NULL
    ), keluar AS (
      SELECT vw.inventory_item_id AS item, pi.size AS sz, sl.created_at AS t, 'jahit'::text AS tp,
             po.no_po || ' · ' || m.nama || ' ' || pi.warna AS ref, m.nama AS utk,
             sl.qty::numeric AS q, m.nama AS model
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
    SELECT * FROM (SELECT * FROM masuk UNION ALL SELECT * FROM keluar) x
    ORDER BY x.item, x.sz, x.t, CASE WHEN x.tp = 'potong' THEN 0 ELSE 1 END
  LOOP
    inventory_item_id := r.item; size := r.sz; waktu := r.t; tipe := r.tp; ref := r.ref; untuk := r.utk; pcs := r.q;
    IF r.tp = 'potong' THEN
      terpakai := 0; dari_celah := 0;
    ELSE
      v_butuh := r.q; terpakai := 0;
      FOREACH v_grup IN ARRAY ARRAY[r.model, 'Zubair & Arslan'] LOOP
        EXIT WHEN v_butuh <= 0;
        v_key := r.item::text || '|' || r.sz || '|' || v_grup;
        v_ada := COALESCE((v_pool ->> v_key)::numeric, 0);
        v_ambil := LEAST(v_ada, v_butuh);
        IF v_ambil > 0 THEN
          v_pool := jsonb_set(v_pool, ARRAY[v_key], to_jsonb(v_ada - v_ambil));
          v_butuh := v_butuh - v_ambil; terpakai := terpakai + v_ambil;
        END IF;
      END LOOP;
      dari_celah := v_butuh;
    END IF;
    RETURN NEXT;
  END LOOP;
END
$function$;

REVOKE ALL ON FUNCTION public.get_stok_variasi(text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_stok_variasi(text, integer) TO authenticated, service_role;
