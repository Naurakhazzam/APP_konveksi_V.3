-- Variasi punya belanja (bahan variasi) -> jadi jenis saldo sendiri (keputusan user 15 Nov 2026).
-- Sleting Saku Noir (Rp 4.000 di HPP) = biaya variasi -> masuk saldo Variasi.
-- Saldo mulai menghitung belanja dari 14 Nov 2026.

INSERT INTO public.pembantu_jenis (nama, urutan, satuan_default, tanpa_barang)
VALUES ('Variasi', 11, NULL, false)
ON CONFLICT (tenant_id, nama) DO NOTHING;

UPDATE public.pembantu_aturan a
SET jenis_id = (SELECT id FROM public.pembantu_jenis WHERE nama = 'Variasi' AND tenant_id = 'STX-001'),
    catatan = CASE WHEN a.model_id IS NULL THEN NULL ELSE 'Noir: HPP Sleting Saku sebenarnya biaya variasi' END
WHERE a.tenant_id = 'STX-001'
  AND (
    (a.model_id IS NULL AND a.komponen_id = (SELECT id FROM public.hpp_komponen WHERE nama = 'Variasi' AND tenant_id = 'STX-001'))
    OR (a.model_id = (SELECT id FROM public.model_produk WHERE nama = 'Noir' AND tenant_id = 'STX-001')
        AND a.komponen_id = (SELECT id FROM public.hpp_komponen WHERE nama = 'Sleting Saku' AND tenant_id = 'STX-001'))
  );

-- "Margin HPP tanpa barang" tidak punya aturan lagi -> sembunyikan
UPDATE public.pembantu_jenis SET aktif = false
WHERE nama = 'Margin HPP tanpa barang' AND tenant_id = 'STX-001'
  AND NOT EXISTS (SELECT 1 FROM public.pembantu_aturan a WHERE a.jenis_id = pembantu_jenis.id);

-- Tanggal mulai belanja: 14 Nov 2026
CREATE OR REPLACE FUNCTION public.get_mutasi_saldo_pembantu(
  p_tenant_id text, p_mulai int DEFAULT 100, p_tanggal_mulai date DEFAULT DATE '2026-11-14')
RETURNS TABLE(jenis_id uuid, tanggal date, tipe text, nominal numeric, pcs numeric,
              ke_saldo numeric, ke_hemat numeric, saldo numeric, hemat_kumulatif numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
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
        AND po_nomor(po.no_po) >= p_mulai
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
