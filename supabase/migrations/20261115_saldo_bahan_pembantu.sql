-- Saldo bahan pembantu (keputusan user 15 Nov 2026)
-- Belanja bahan pembantu dicatat di Buku Kas (kategori 'Bahan Pembantu' + jenis).
-- Jatah = tarif HPP x pcs selesai jahit (PO >= PO-0100).
-- Jatah menghabiskan saldo belanja dulu; sisanya = penghematan. Saldo tidak pernah minus.

CREATE TABLE IF NOT EXISTS public.pembantu_jenis (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     text NOT NULL DEFAULT 'STX-001',
  nama          text NOT NULL,
  urutan        int  NOT NULL DEFAULT 0,
  satuan_default text,
  tanpa_barang  boolean NOT NULL DEFAULT false,  -- jatah tanpa barang dibeli (Variasi, margin) -> langsung penghematan
  aktif         boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, nama)
);

-- Komponen HPP -> jenis saldo. model_id NULL = berlaku semua model;
-- baris per model menimpa default. jenis_id NULL = tidak masuk saldo (mis. dipotong otomatis).
CREATE TABLE IF NOT EXISTS public.pembantu_aturan (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   text NOT NULL DEFAULT 'STX-001',
  komponen_id uuid NOT NULL REFERENCES public.hpp_komponen(id) ON DELETE CASCADE,
  model_id    uuid REFERENCES public.model_produk(id) ON DELETE CASCADE,
  jenis_id    uuid REFERENCES public.pembantu_jenis(id) ON DELETE CASCADE,
  catatan     text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT (tenant_id, komponen_id, model_id)
);

ALTER TABLE public.buku_kas ADD COLUMN IF NOT EXISTS pembantu_jenis_id uuid REFERENCES public.pembantu_jenis(id);
CREATE INDEX IF NOT EXISTS buku_kas_pembantu_jenis_idx ON public.buku_kas (pembantu_jenis_id) WHERE pembantu_jenis_id IS NOT NULL;

ALTER TABLE public.pembantu_jenis  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pembantu_aturan ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pembantu_jenis_tenant_isolation ON public.pembantu_jenis;
CREATE POLICY pembantu_jenis_tenant_isolation ON public.pembantu_jenis FOR ALL USING (tenant_id = 'STX-001');
DROP POLICY IF EXISTS pembantu_aturan_tenant_isolation ON public.pembantu_aturan;
CREATE POLICY pembantu_aturan_tenant_isolation ON public.pembantu_aturan FOR ALL USING (tenant_id = 'STX-001');

-- Data awal
INSERT INTO public.pembantu_jenis (nama, urutan, satuan_default, tanpa_barang) VALUES
  ('Benang', 1, 'lusin', false),
  ('Sleting Roll', 2, 'roll', false),
  ('Kancing', 3, 'gross', false),
  ('Karet', 4, 'kg', false),
  ('Kain Keras', 5, 'roll', false),
  ('Kain Saku', 6, 'kg', false),
  ('Mata Itik', 7, 'pack', false),
  ('Stoper', 8, 'pack', false),
  ('Tali', 9, 'pack', false),
  ('Velcro', 10, NULL, false),
  ('Margin HPP tanpa barang', 99, NULL, true)
ON CONFLICT (tenant_id, nama) DO NOTHING;

INSERT INTO public.pembantu_aturan (komponen_id, model_id, jenis_id, catatan)
SELECT k.id, NULL, j.id, NULL
FROM (VALUES
  ('Benang','Benang'), ('Kain Keras','Kain Keras'), ('Kain Saku','Kain Saku'), ('Kancing','Kancing'),
  ('Karet','Karet'), ('Mata Itik','Mata Itik'), ('Stoper','Stoper'), ('Tali','Tali'), ('Velcro','Velcro'),
  ('Sleting Saku','Sleting Roll'), ('Sleting Topi','Sleting Roll'), ('Kepala Sleting','Sleting Roll'),
  ('Variasi','Margin HPP tanpa barang')
) v(komp, jenis)
JOIN public.hpp_komponen k ON k.nama = v.komp AND k.tenant_id = 'STX-001'
JOIN public.pembantu_jenis j ON j.nama = v.jenis AND j.tenant_id = 'STX-001'
ON CONFLICT DO NOTHING;

-- Neck: sleting saku khusus dipotong otomatis (Sleting Jacket Neck) -> tidak masuk saldo
INSERT INTO public.pembantu_aturan (komponen_id, model_id, jenis_id, catatan)
SELECT k.id, m.id, NULL, 'Sleting saku khusus Neck dipotong otomatis'
FROM public.hpp_komponen k, public.model_produk m
WHERE k.nama = 'Sleting Saku' AND k.tenant_id = 'STX-001' AND m.nama = 'Neck' AND m.tenant_id = 'STX-001'
ON CONFLICT DO NOTHING;

-- Noir: sleting saku di HPP dianggap margin
INSERT INTO public.pembantu_aturan (komponen_id, model_id, jenis_id, catatan)
SELECT k.id, m.id, j.id, 'Noir tidak pakai sleting roll; HPP dianggap margin'
FROM public.hpp_komponen k, public.model_produk m, public.pembantu_jenis j
WHERE k.nama = 'Sleting Saku' AND k.tenant_id = 'STX-001' AND m.nama = 'Noir' AND m.tenant_id = 'STX-001'
  AND j.nama = 'Margin HPP tanpa barang' AND j.tenant_id = 'STX-001'
ON CONFLICT DO NOTHING;

-- Tarif jatah per produk per jenis saldo
CREATE OR REPLACE VIEW public.v_pembantu_tarif_produk WITH (security_invoker = on) AS
SELECT hi.produk_id,
       CASE WHEN am.id IS NOT NULL THEN am.jenis_id ELSE ad.jenis_id END AS jenis_id,
       SUM(hi.qty * hi.harga_satuan) AS tarif
FROM public.hpp_item hi
JOIN public.produk p ON p.id = hi.produk_id
LEFT JOIN public.pembantu_aturan am ON am.komponen_id = hi.komponen_id AND am.model_id = p.model_id AND am.tenant_id = hi.tenant_id
LEFT JOIN public.pembantu_aturan ad ON ad.komponen_id = hi.komponen_id AND ad.model_id IS NULL AND ad.tenant_id = hi.tenant_id
WHERE (am.id IS NOT NULL OR ad.id IS NOT NULL)
  AND (CASE WHEN am.id IS NOT NULL THEN am.jenis_id ELSE ad.jenis_id END) IS NOT NULL
GROUP BY 1, 2
HAVING SUM(hi.qty * hi.harga_satuan) <> 0;

-- Mutasi saldo per jenis, urut tanggal (belanja dulu, lalu jatah di hari yang sama)
CREATE OR REPLACE FUNCTION public.get_mutasi_saldo_pembantu(
  p_tenant_id text, p_mulai int DEFAULT 100, p_tanggal_mulai date DEFAULT DATE '2026-11-15')
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

-- Laporan Per PO: patokan pembantu ikut aturan saldo (Velcro, Sleting Roll, Kepala Sleting ikut terhitung)
CREATE OR REPLACE FUNCTION public.get_patokan_tidak_langsung_per_po(p_tenant_id text)
RETURNS TABLE(po_id uuid, patokan_overhead numeric, patokan_pembantu numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT pi.po_id,
    SUM(pi.qty_order * COALESCE((SELECT SUM(hi.qty * hi.harga_satuan) FROM hpp_item hi JOIN hpp_komponen hk ON hk.id = hi.komponen_id
        WHERE hi.produk_id = pi.produk_id AND hk.nama IN ('Uang Makan','Operasional Rumah','Operasional Listrik','Operasional Sehari-hari')), 0)),
    SUM(pi.qty_order * COALESCE((SELECT SUM(t.tarif) FROM v_pembantu_tarif_produk t WHERE t.produk_id = pi.produk_id), 0))
  FROM po_item pi WHERE pi.tenant_id = p_tenant_id GROUP BY pi.po_id
$function$;

GRANT SELECT ON public.pembantu_jenis, public.pembantu_aturan, public.v_pembantu_tarif_produk TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_mutasi_saldo_pembantu(text, int, date) TO authenticated;
