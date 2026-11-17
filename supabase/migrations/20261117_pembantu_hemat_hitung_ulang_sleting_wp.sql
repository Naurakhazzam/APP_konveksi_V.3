-- 17 Nov 2026
-- (1) Sleting Roll dipisah: WP (Airflow, Neck) vs Coil (model lain).
-- (2) Penghematan dihitung ulang: belanja / barang lama yang masuk BELAKANGAN menutup dulu
--     "penghematan" yang sudah tercatat (jatah yang dulu tidak tertutup saldo), baru sisanya jadi saldo.
--     Saldo tetap tidak pernah minus. Hasil akhir per jenis selalu:
--       penghematan = MAX(0, jatah − (barang lama + belanja)),  saldo = MAX(0, (barang lama + belanja) − jatah)

-- ── (1) Sleting WP / Coil ──
UPDATE public.pembantu_jenis SET nama = 'Sleting Roll Coil'
WHERE id = '86f7b82b-5a6e-4ab2-8ad8-6b48442aa609';

INSERT INTO public.pembantu_jenis (id, tenant_id, nama, aktif, urutan, tanpa_barang, satuan_default)
VALUES ('5b1f0c3e-7a2d-4e8b-9c41-2f6d8a0e3b71', 'STX-001', 'Sleting Roll WP', true, 2, false, 'roll')
ON CONFLICT (id) DO NOTHING;

-- Aturan per model menimpa default (Sleting Saku / Topi → Coil)
INSERT INTO public.pembantu_aturan (tenant_id, komponen_id, model_id, jenis_id, catatan) VALUES
  ('STX-001', 'c703c49d-2f83-467f-aa98-7820222a02fc', '4c3f8ff9-d207-4a4a-92fd-21ff955f5f96',
   '5b1f0c3e-7a2d-4e8b-9c41-2f6d8a0e3b71', 'Airflow pakai sleting roll WP'),
  ('STX-001', '972f253d-b53f-4ded-8724-a6d2f6094d4c', 'eec892e7-b530-4c74-a9cc-f992b591a538',
   '5b1f0c3e-7a2d-4e8b-9c41-2f6d8a0e3b71', 'Neck (sleting topi) pakai sleting roll WP');

-- Barang lama "sleting roll WP" pindah ke jenis WP
UPDATE public.pembantu_saldo_awal SET jenis_id = '5b1f0c3e-7a2d-4e8b-9c41-2f6d8a0e3b71'
WHERE id = '22fa395a-ed01-43cf-b1fa-e3901718a8a5';

-- ── (2) RPC saldo dengan hitung ulang penghematan ──
DROP FUNCTION IF EXISTS public.get_mutasi_saldo_pembantu(text, integer, date);

CREATE FUNCTION public.get_mutasi_saldo_pembantu(p_tenant_id text, p_mulai integer DEFAULT 99, p_tanggal_mulai date DEFAULT '2026-11-14'::date)
 RETURNS TABLE(jenis_id uuid, tanggal date, tipe text, nominal numeric, pcs numeric, ke_saldo numeric, ke_hemat numeric,
               saldo numeric, hemat_kumulatif numeric, ke_modal numeric, saldo_modal numeric, hemat_final numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE
  r record; v_jenis uuid; v_saldo numeric := 0; v_modal numeric := 0; v_hemat numeric := 0;
  v_pakai numeric; v_dari_modal numeric; v_tutup numeric;
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
    ), modal AS (
      SELECT a.jenis_id AS j, a.tanggal AS tgl, SUM(a.nominal) AS nom, NULL::numeric AS q
      FROM pembantu_saldo_awal a
      WHERE a.tenant_id = p_tenant_id
      GROUP BY 1, 2
    ), semua AS (
      SELECT j, tgl, 'modal'::text AS tp, nom, q, 0 AS grp, 0 AS ord FROM modal
      UNION ALL
      SELECT j, tgl, 'beli'::text, nom, q, 1, 0 FROM beli
      UNION ALL
      SELECT j, tgl, 'jatah'::text, nom, q, 1, 1 FROM jatah
    ), urut AS (
      SELECT s.*,
        -- total barang masuk sepanjang waktu (barang lama + belanja) per jenis
        SUM(CASE WHEN s.tp <> 'jatah' THEN s.nom ELSE 0 END) OVER (PARTITION BY s.j) AS pool,
        -- jatah kumulatif SEBELUM baris ini (urut tanggal)
        COALESCE(SUM(CASE WHEN s.tp = 'jatah' THEN s.nom ELSE 0 END)
          OVER (PARTITION BY s.j ORDER BY s.grp, s.tgl, s.ord ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0) AS jatah_sebelum
      FROM semua s
    )
    -- Saldo awal (barang lama) selalu diproses paling dulu per jenis, apa pun tanggalnya.
    SELECT u.j, u.tgl, u.tp, u.nom, u.q,
      -- Penghematan final baris jatah: bagian jatah yang tidak tertutup SELURUH barang masuk
      -- (termasuk belanja sesudahnya). Jatah paling awal tertutup lebih dulu.
      CASE WHEN u.tp = 'jatah'
        THEN u.nom - GREATEST(0, LEAST(u.nom, u.pool - u.jatah_sebelum)) ELSE 0 END AS hf
    FROM urut u
    ORDER BY u.j, u.grp, u.tgl, u.ord
  LOOP
    IF v_jenis IS DISTINCT FROM r.j THEN
      v_jenis := r.j; v_saldo := 0; v_modal := 0; v_hemat := 0;
    END IF;
    jenis_id := r.j; tanggal := r.tgl; tipe := r.tp; nominal := r.nom; pcs := r.q; hemat_final := r.hf;
    IF r.tp = 'modal' THEN
      v_tutup := LEAST(v_hemat, r.nom);
      ke_hemat := -v_tutup; ke_saldo := r.nom - v_tutup; ke_modal := r.nom - v_tutup;
      v_saldo := v_saldo + ke_saldo; v_modal := v_modal + ke_modal; v_hemat := v_hemat - v_tutup;
    ELSIF r.tp = 'beli' THEN
      -- Belanja menutup dulu penghematan yang sudah tercatat (jatah lalu ternyata dari barang ini)
      v_tutup := LEAST(v_hemat, r.nom);
      ke_hemat := -v_tutup; ke_saldo := r.nom - v_tutup; ke_modal := 0;
      v_saldo := v_saldo + ke_saldo; v_hemat := v_hemat - v_tutup;
    ELSE
      v_pakai := LEAST(v_saldo, r.nom);
      v_dari_modal := LEAST(v_modal, v_pakai);   -- barang lama habis duluan
      ke_saldo := -v_pakai; ke_hemat := r.nom - v_pakai; ke_modal := -v_dari_modal;
      v_saldo := v_saldo - v_pakai; v_modal := v_modal - v_dari_modal; v_hemat := v_hemat + ke_hemat;
    END IF;
    saldo := v_saldo; hemat_kumulatif := v_hemat; saldo_modal := v_modal;
    RETURN NEXT;
  END LOOP;
END
$function$;

REVOKE ALL ON FUNCTION public.get_mutasi_saldo_pembantu(text, integer, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_mutasi_saldo_pembantu(text, integer, date) TO authenticated;
