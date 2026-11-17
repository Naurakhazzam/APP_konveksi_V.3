-- Potong Variasi (17 Nov 2026)
-- Drill variasi Zubair/Arslan biasanya diambil dari celah pola Celana Arslan (sudah termasuk
-- pemakaian celana → jatah variasi HPP jadi penghematan/margin). Kadang Drill harus dipotong
-- MANDIRI: stok Drill (bahan utama) berkurang FIFO dan nilainya masuk saldo bahan pembantu
-- "Variasi" sebagai barang masuk (tanpa Buku Kas — Drill sudah dibayar saat Stok Masuk).

CREATE TABLE IF NOT EXISTS public.potong_variasi (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tanggal           date NOT NULL DEFAULT CURRENT_DATE,
  bahan_item_id     uuid NOT NULL REFERENCES public.inventory_item(id),
  jenis_id          uuid NOT NULL REFERENCES public.pembantu_jenis(id),
  qty_pakai         numeric NOT NULL CHECK (qty_pakai > 0),
  biaya_total       numeric NOT NULL DEFAULT 0,
  habis_roll        boolean NOT NULL DEFAULT false,
  untuk_model       text,
  per_size          jsonb,            -- jumlah potongan variasi per ukuran, mis. {"S":10,"M":20}
  catatan           text,
  dibatalkan_at     timestamptz,
  dibatalkan_alasan text,
  tenant_id         text NOT NULL DEFAULT 'STX-001',
  created_by        uuid,
  created_at        timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.potong_variasi ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS potong_variasi_select ON public.potong_variasi;
CREATE POLICY potong_variasi_select ON public.potong_variasi FOR SELECT TO authenticated USING (true);
CREATE INDEX IF NOT EXISTS potong_variasi_tenant_idx ON public.potong_variasi (tenant_id, tanggal);

-- Helper: ambil hanya ukuran dengan jumlah > 0 (bulat); NULL bila kosong
CREATE OR REPLACE FUNCTION public._bersihkan_per_size(p jsonb)
 RETURNS jsonb LANGUAGE sql IMMUTABLE AS $f$
  SELECT NULLIF(COALESCE(jsonb_object_agg(e.key, ROUND(e.value::text::numeric)), '{}'::jsonb), '{}'::jsonb)
  FROM jsonb_each(CASE WHEN jsonb_typeof(p) = 'object' THEN p ELSE '{}'::jsonb END) e
  WHERE jsonb_typeof(e.value) = 'number' AND e.value::text::numeric > 0
$f$;

-- RPC potong variasi
CREATE OR REPLACE FUNCTION public.potong_variasi(
  p_bahan_item_id uuid, p_qty numeric, p_habis_roll boolean, p_untuk_model text,
  p_per_size jsonb, p_catatan text, p_user_id uuid, p_tenant_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_bahan RECORD;
  v_ambil RECORD;
  v_jenis uuid;
  v_id    uuid;
BEGIN
  IF COALESCE(p_qty, 0) <= 0 THEN RAISE EXCEPTION 'Jumlah bahan yang dipotong harus lebih dari 0'; END IF;

  SELECT id, nama, satuan, stok_aktual, jenis INTO v_bahan FROM inventory_item
  WHERE id = p_bahan_item_id AND tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Bahan tidak ditemukan'; END IF;
  IF v_bahan.jenis = 'pembantu' THEN RAISE EXCEPTION '% adalah bahan pembantu, bukan bahan utama', v_bahan.nama; END IF;
  IF p_qty > v_bahan.stok_aktual + 0.0005 THEN
    RAISE EXCEPTION 'Stok % hanya % % — input belanja (Stok Masuk) dulu', v_bahan.nama, v_bahan.stok_aktual, v_bahan.satuan;
  END IF;

  SELECT id INTO v_jenis FROM pembantu_jenis WHERE nama = 'Variasi' AND tenant_id = p_tenant_id;
  IF v_jenis IS NULL THEN RAISE EXCEPTION 'Jenis bahan pembantu "Variasi" tidak ditemukan'; END IF;

  -- Kurangi stok FIFO, biaya asli dari harga beli LOT
  SELECT * INTO v_ambil FROM _ambil_stok_bahan_fifo(p_bahan_item_id, p_qty, p_tenant_id);

  INSERT INTO potong_variasi (bahan_item_id, jenis_id, qty_pakai, biaya_total, habis_roll, untuk_model, per_size, catatan, tenant_id, created_by)
  VALUES (p_bahan_item_id, v_jenis, p_qty, ROUND(COALESCE(v_ambil.harga, 0), 2), COALESCE(p_habis_roll, false),
          NULLIF(trim(COALESCE(p_untuk_model, '')), ''), _bersihkan_per_size(p_per_size),
          NULLIF(trim(COALESCE(p_catatan, '')), ''), p_tenant_id, p_user_id)
  RETURNING id INTO v_id;

  INSERT INTO audit_log (user_id, modul, aksi, target, metadata, tenant_id)
  VALUES (p_user_id, 'produksi', 'Potong Variasi', v_bahan.nama,
    jsonb_build_object('potong_variasi_id', v_id, 'qty', p_qty, 'biaya', v_ambil.harga, 'untuk', p_untuk_model), p_tenant_id);

  RETURN jsonb_build_object('id', v_id, 'biaya_total', ROUND(COALESCE(v_ambil.harga, 0), 2));
END; $function$;

-- RPC batal (salah input): bahan kembali ke stok, baris saldo Variasi hilang
CREATE OR REPLACE FUNCTION public.batal_potong_variasi(p_id uuid, p_alasan text, p_user_id uuid, p_tenant_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_pv RECORD;
BEGIN
  IF p_alasan IS NULL OR trim(p_alasan) = '' THEN RAISE EXCEPTION 'Alasan wajib diisi'; END IF;
  SELECT * INTO v_pv FROM potong_variasi WHERE id = p_id AND tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Data potong variasi tidak ditemukan'; END IF;
  IF v_pv.dibatalkan_at IS NOT NULL THEN RAISE EXCEPTION 'Sudah dibatalkan'; END IF;

  PERFORM _kembalikan_stok_bahan(v_pv.bahan_item_id, v_pv.qty_pakai, p_tenant_id);
  UPDATE potong_variasi SET dibatalkan_at = now(), dibatalkan_alasan = trim(p_alasan) WHERE id = p_id;

  INSERT INTO audit_log (user_id, modul, aksi, target, metadata, tenant_id)
  VALUES (p_user_id, 'produksi', 'Batal Potong Variasi', 'Variasi',
    jsonb_build_object('potong_variasi_id', p_id, 'qty', v_pv.qty_pakai, 'alasan', trim(p_alasan)), p_tenant_id);
  RETURN jsonb_build_object('success', true);
END; $function$;

REVOKE ALL ON FUNCTION public.potong_variasi(uuid, numeric, boolean, text, jsonb, text, uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.batal_potong_variasi(uuid, text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.potong_variasi(uuid, numeric, boolean, text, jsonb, text, uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.batal_potong_variasi(uuid, text, uuid, text) TO authenticated, service_role;

-- Potong Puring: rincian lembar per ukuran (opsional; data lama dibiarkan NULL)
ALTER TABLE public.potong_puring ADD COLUMN IF NOT EXISTS per_size jsonb;
CREATE OR REPLACE FUNCTION public.set_per_size_potong_puring(p_id uuid, p_per_size jsonb, p_tenant_id text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE potong_puring SET per_size = _bersihkan_per_size(p_per_size)
  WHERE id = p_id AND tenant_id = p_tenant_id AND dibatalkan_at IS NULL;
END; $function$;
REVOKE ALL ON FUNCTION public.set_per_size_potong_puring(uuid, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_per_size_potong_puring(uuid, jsonb, text) TO authenticated, service_role;

-- Saldo pembantu: potong variasi = barang masuk (tipe 'potong'), diperlakukan sama seperti belanja
CREATE OR REPLACE FUNCTION public.get_mutasi_saldo_pembantu(p_tenant_id text, p_mulai integer DEFAULT 99, p_tanggal_mulai date DEFAULT '2026-11-14'::date)
 RETURNS TABLE(jenis_id uuid, tanggal date, tipe text, nominal numeric, pcs numeric, ke_saldo numeric, ke_hemat numeric, saldo numeric, hemat_kumulatif numeric, ke_modal numeric, saldo_modal numeric, hemat_final numeric)
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
    ), urut AS (
      SELECT s.*,
        SUM(CASE WHEN s.tp <> 'jatah' THEN s.nom ELSE 0 END) OVER (PARTITION BY s.j) AS pool,
        COALESCE(SUM(CASE WHEN s.tp = 'jatah' THEN s.nom ELSE 0 END)
          OVER (PARTITION BY s.j ORDER BY s.grp, s.tgl, s.ord ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0) AS jatah_sebelum
      FROM semua s
    )
    SELECT u.j, u.tgl, u.tp, u.nom, u.q,
      CASE WHEN u.tp = 'jatah' THEN u.nom - GREATEST(0, LEAST(u.nom, u.pool - u.jatah_sebelum)) ELSE 0 END AS hf
    FROM urut u ORDER BY u.j, u.grp, u.tgl, u.ord
  LOOP
    IF v_jenis IS DISTINCT FROM r.j THEN v_jenis := r.j; v_saldo := 0; v_modal := 0; v_hemat := 0; END IF;
    jenis_id := r.j; tanggal := r.tgl; tipe := r.tp; nominal := r.nom; pcs := r.q; hemat_final := r.hf;
    IF r.tp = 'modal' THEN
      v_tutup := LEAST(v_hemat, r.nom);
      ke_hemat := -v_tutup; ke_saldo := r.nom - v_tutup; ke_modal := r.nom - v_tutup;
      v_saldo := v_saldo + ke_saldo; v_modal := v_modal + ke_modal; v_hemat := v_hemat - v_tutup;
    ELSIF r.tp IN ('beli', 'potong') THEN
      v_tutup := LEAST(v_hemat, r.nom);
      ke_hemat := -v_tutup; ke_saldo := r.nom - v_tutup; ke_modal := 0;
      v_saldo := v_saldo + ke_saldo; v_hemat := v_hemat - v_tutup;
    ELSE
      v_pakai := LEAST(v_saldo, r.nom); v_dari_modal := LEAST(v_modal, v_pakai);
      ke_saldo := -v_pakai; ke_hemat := r.nom - v_pakai; ke_modal := -v_dari_modal;
      v_saldo := v_saldo - v_pakai; v_modal := v_modal - v_dari_modal; v_hemat := v_hemat + ke_hemat;
    END IF;
    saldo := v_saldo; hemat_kumulatif := v_hemat; saldo_modal := v_modal;
    RETURN NEXT;
  END LOOP;
END
$function$;
