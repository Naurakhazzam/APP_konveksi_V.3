-- Saldo awal bahan pembantu = barang lama milik pemilik (setoran modal berupa barang).
-- Tidak lewat Buku Kas (tidak ada uang keluar/masuk). Nilai = qty × harga perkiraan.
-- Di saldo pembantu: dihabiskan jatah HPP LEBIH DULU (barang lama dipakai duluan), baru belanja.
-- Di Kinerja Keuangan: sisa = aset "Persediaan bahan pembantu (barang lama)"; yang terpakai
-- jadi overhead produksi di bulan pemakaiannya.

CREATE TABLE IF NOT EXISTS public.pembantu_saldo_awal (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    text NOT NULL,
  jenis_id     uuid NOT NULL REFERENCES public.pembantu_jenis(id),
  tanggal      date NOT NULL DEFAULT '2026-11-14',
  nama_barang  text,
  qty          numeric NOT NULL CHECK (qty > 0),
  satuan       text,
  harga_satuan numeric NOT NULL CHECK (harga_satuan > 0),
  nominal      numeric NOT NULL CHECK (nominal > 0),
  keterangan   text,
  created_by   uuid,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pembantu_saldo_awal_jenis_idx ON public.pembantu_saldo_awal (tenant_id, jenis_id);
ALTER TABLE public.pembantu_saldo_awal ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pembantu_saldo_awal_tenant_isolation ON public.pembantu_saldo_awal;
CREATE POLICY pembantu_saldo_awal_tenant_isolation ON public.pembantu_saldo_awal
  FOR ALL TO authenticated USING (tenant_id = 'STX-001') WITH CHECK (tenant_id = 'STX-001');

-- Tipe kembalian berubah (tambah ke_modal, saldo_modal) → harus DROP dulu.
DROP FUNCTION IF EXISTS public.get_mutasi_saldo_pembantu(text, integer, date);

CREATE FUNCTION public.get_mutasi_saldo_pembantu(p_tenant_id text, p_mulai integer DEFAULT 99, p_tanggal_mulai date DEFAULT '2026-11-14'::date)
 RETURNS TABLE(jenis_id uuid, tanggal date, tipe text, nominal numeric, pcs numeric, ke_saldo numeric, ke_hemat numeric,
               saldo numeric, hemat_kumulatif numeric, ke_modal numeric, saldo_modal numeric)
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
    )
    -- Saldo awal (barang lama) selalu diproses paling dulu per jenis, apa pun tanggalnya:
    -- barangnya sudah ada sebelum periode baru dimulai.
    SELECT x.j, x.tgl, x.tp, x.nom, x.q FROM (
      SELECT j, tgl, 'modal'::text AS tp, nom, q, 0 AS grp, 0 AS ord FROM modal
      UNION ALL
      SELECT j, tgl, 'beli'::text, nom, q, 1, 0 FROM beli
      UNION ALL
      SELECT j, tgl, 'jatah'::text, nom, q, 1, 1 FROM jatah
    ) x ORDER BY x.j, x.grp, x.tgl, x.ord
  LOOP
    IF v_jenis IS DISTINCT FROM r.j THEN
      v_jenis := r.j; v_saldo := 0; v_modal := 0; v_hemat := 0;
    END IF;
    jenis_id := r.j; tanggal := r.tgl; tipe := r.tp; nominal := r.nom; pcs := r.q;
    IF r.tp = 'modal' THEN
      ke_saldo := r.nom; ke_hemat := 0; ke_modal := r.nom;
      v_saldo := v_saldo + r.nom; v_modal := v_modal + r.nom;
    ELSIF r.tp = 'beli' THEN
      ke_saldo := r.nom; ke_hemat := 0; ke_modal := 0; v_saldo := v_saldo + r.nom;
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
