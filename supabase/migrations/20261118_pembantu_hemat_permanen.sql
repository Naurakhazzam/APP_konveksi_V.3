-- F2 Laporan Per PO: penghematan bahan pembantu PERMANEN + peringatan belanja + atribusi per PO.
--
-- 1. get_mutasi_saldo_pembantu: belanja / potong variasi TIDAK lagi menutup penghematan lalu.
--    Seluruh barang masuk menambah saldo; jatah yang tidak tertutup saldo = penghematan final saat itu juga.
--    (Saldo awal barang lama selalu diproses paling dulu per jenis, jadi memang tak pernah menutup apa pun.)
--    Kolom baru:
--      jatah_2minggu = jatah HPP 14 hari sebelum tanggal belanja (hanya baris 'beli')
--      peringatan    = belanja padahal saldo sebelum belanja > jatah 2 minggu terakhir
--                      → tanda tarif HPP kemurahan / belanja terlalu dini.
--    hemat_final dipertahankan (= ke_hemat baris jatah) supaya kode lama tetap cocok.
-- 2. get_pembantu_per_po: jatah per PO × jenis dibagi jadi "terpakai dari saldo" (biaya aktual)
--    dan "penghematan" secara proporsional per (jenis, tanggal) — dipakai Laporan Per PO (F5).

DROP FUNCTION IF EXISTS public.get_mutasi_saldo_pembantu(text, integer, date);

CREATE FUNCTION public.get_mutasi_saldo_pembantu(p_tenant_id text, p_mulai integer DEFAULT 99, p_tanggal_mulai date DEFAULT '2026-11-14'::date)
 RETURNS TABLE(jenis_id uuid, tanggal date, tipe text, nominal numeric, pcs numeric, ke_saldo numeric, ke_hemat numeric,
               saldo numeric, hemat_kumulatif numeric, ke_modal numeric, saldo_modal numeric, hemat_final numeric,
               jatah_2minggu numeric, peringatan boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE
  r record; v_jenis uuid; v_saldo numeric := 0; v_modal numeric := 0; v_hemat numeric := 0;
  v_pakai numeric; v_dari_modal numeric;
BEGIN
  FOR r IN
    WITH jatah AS (
      SELECT t.jenis_id AS j, (sl.created_at AT TIME ZONE 'Asia/Jakarta')::date AS tgl,
             SUM(sl.qty * t.tarif) AS nom, SUM(sl.qty)::numeric AS q
      FROM scan_log sl JOIN bundle b ON b.id = sl.bundle_id JOIN po_item pi ON pi.id = b.po_item_id
      JOIN po ON po.id = pi.po_id JOIN v_pembantu_tarif_produk t ON t.produk_id = pi.produk_id
      WHERE sl.tenant_id = p_tenant_id AND sl.tahap = 'jahit' AND sl.tipe = 'selesai'
        AND (po_nomor(po.no_po) >= p_mulai OR b.id IN (SELECT bundle_id FROM periode_baru_bundle_khusus))
      GROUP BY 1, 2
    ), beli AS (
      SELECT k.pembantu_jenis_id AS j, k.tanggal AS tgl, SUM(k.nominal) AS nom, NULL::numeric AS q
      FROM buku_kas k WHERE k.tenant_id = p_tenant_id AND k.tipe = 'keluar' AND k.kategori = 'Bahan Pembantu'
        AND k.pembantu_jenis_id IS NOT NULL AND k.tanggal >= p_tanggal_mulai GROUP BY 1, 2
    ), potong AS (
      SELECT v.jenis_id AS j, v.tanggal AS tgl, SUM(v.biaya_total) AS nom, SUM(v.qty_pakai) AS q
      FROM potong_variasi v WHERE v.tenant_id = p_tenant_id AND v.dibatalkan_at IS NULL GROUP BY 1, 2
    ), modal AS (
      SELECT a.jenis_id AS j, a.tanggal AS tgl, SUM(a.nominal) AS nom, NULL::numeric AS q
      FROM pembantu_saldo_awal a WHERE a.tenant_id = p_tenant_id GROUP BY 1, 2
    ), semua AS (
      SELECT j, tgl, 'modal'::text AS tp, nom, q, 0 AS grp, 0 AS ord FROM modal
      UNION ALL SELECT j, tgl, 'beli'::text, nom, q, 1, 0 FROM beli
      UNION ALL SELECT j, tgl, 'potong'::text, nom, q, 1, 0 FROM potong
      UNION ALL SELECT j, tgl, 'jatah'::text, nom, q, 1, 1 FROM jatah
    )
    SELECT s.j, s.tgl, s.tp, s.nom, s.q,
      CASE WHEN s.tp = 'beli' THEN COALESCE((
        SELECT SUM(x.nom) FROM jatah x WHERE x.j = s.j AND x.tgl >= s.tgl - 14 AND x.tgl < s.tgl), 0) END AS j2
    FROM semua s ORDER BY s.j, s.grp, s.tgl, s.ord
  LOOP
    IF v_jenis IS DISTINCT FROM r.j THEN v_jenis := r.j; v_saldo := 0; v_modal := 0; v_hemat := 0; END IF;
    jenis_id := r.j; tanggal := r.tgl; tipe := r.tp; nominal := r.nom; pcs := r.q;
    jatah_2minggu := r.j2; peringatan := (r.tp = 'beli' AND v_saldo > r.j2);
    IF r.tp = 'jatah' THEN
      v_pakai := LEAST(v_saldo, r.nom); v_dari_modal := LEAST(v_modal, v_pakai);
      ke_saldo := -v_pakai; ke_hemat := r.nom - v_pakai; ke_modal := -v_dari_modal;
      v_saldo := v_saldo - v_pakai; v_modal := v_modal - v_dari_modal; v_hemat := v_hemat + ke_hemat;
      hemat_final := ke_hemat;
    ELSE
      -- modal / beli / potong: seluruhnya menambah saldo, penghematan lalu tetap (permanen)
      ke_hemat := 0; ke_saldo := r.nom; ke_modal := CASE WHEN r.tp = 'modal' THEN r.nom ELSE 0 END;
      v_saldo := v_saldo + r.nom; v_modal := v_modal + ke_modal;
      hemat_final := 0;
    END IF;
    saldo := v_saldo; hemat_kumulatif := v_hemat; saldo_modal := v_modal;
    RETURN NEXT;
  END LOOP;
END
$function$;

GRANT EXECUTE ON FUNCTION public.get_mutasi_saldo_pembantu(text, integer, date) TO authenticated, service_role;

-- Atribusi bahan pembantu per PO × jenis.
--   jatah      = tarif HPP × pcs selesai jahit (perkiraan)
--   pakai      = bagian jatah yang tertutup saldo (barang benar-benar keluar dari rak) = biaya aktual
--   pakai_lama = bagian "pakai" yang berasal dari barang lama (saldo awal / setoran modal barang)
--   hemat      = jatah − pakai (penghematan permanen, margin)
-- Per (jenis, tanggal) jatah beberapa PO dibagi proporsional terhadap nominal jatahnya.
CREATE OR REPLACE FUNCTION public.get_pembantu_per_po(p_tenant_id text, p_mulai integer DEFAULT 99)
RETURNS TABLE(po_id uuid, no_po text, jenis_id uuid, pcs numeric, jatah numeric, pakai numeric, pakai_lama numeric, hemat numeric)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH per_po AS (
    SELECT po.id AS po_id, po.no_po, t.jenis_id, (sl.created_at AT TIME ZONE 'Asia/Jakarta')::date AS tgl,
           SUM(sl.qty)::numeric AS q, SUM(sl.qty * t.tarif) AS nom
    FROM scan_log sl JOIN bundle b ON b.id = sl.bundle_id JOIN po_item pi ON pi.id = b.po_item_id
    JOIN po ON po.id = pi.po_id JOIN v_pembantu_tarif_produk t ON t.produk_id = pi.produk_id
    WHERE sl.tenant_id = p_tenant_id AND sl.tahap = 'jahit' AND sl.tipe = 'selesai'
      AND (po_nomor(po.no_po) >= p_mulai OR b.id IN (SELECT bundle_id FROM periode_baru_bundle_khusus))
    GROUP BY 1, 2, 3, 4
  ), hari AS (
    SELECT m.jenis_id, m.tanggal, m.nominal, -m.ke_saldo AS pakai, -m.ke_modal AS pakai_lama
    FROM get_mutasi_saldo_pembantu(p_tenant_id, p_mulai) m WHERE m.tipe = 'jatah'
  )
  SELECT p.po_id, p.no_po, p.jenis_id, SUM(p.q), SUM(p.nom),
         SUM(CASE WHEN h.nominal > 0 THEN p.nom * h.pakai / h.nominal ELSE 0 END),
         SUM(CASE WHEN h.nominal > 0 THEN p.nom * h.pakai_lama / h.nominal ELSE 0 END),
         SUM(p.nom) - SUM(CASE WHEN h.nominal > 0 THEN p.nom * h.pakai / h.nominal ELSE 0 END)
  FROM per_po p JOIN hari h ON h.jenis_id = p.jenis_id AND h.tanggal = p.tgl
  GROUP BY p.po_id, p.no_po, p.jenis_id
  ORDER BY p.no_po, p.jenis_id;
$function$;

GRANT EXECUTE ON FUNCTION public.get_pembantu_per_po(text, integer) TO authenticated, service_role;
