-- Buku Kas: keterangan otomatis tidak lagi menulis qty/harga (sudah ada kolom Qty, Harga Satuan, Total).
-- Format: "<nama barang>[ — <catatan>]". Setoran modal barang & stock opname kini ikut mengisi qty/satuan.
-- Data lama (November) dirapikan di bagian bawah.

CREATE OR REPLACE FUNCTION public.stok_masuk(p_inventory_item_id uuid, p_qty numeric, p_harga_satuan numeric, p_tanggal_masuk date, p_no_faktur text, p_kategori_trx_id uuid, p_keterangan text, p_user_id uuid, p_tenant_id text, p_qty_beli numeric DEFAULT NULL::numeric, p_harga_beli numeric DEFAULT NULL::numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_item       RECORD;
  v_jurnal_id  UUID;
  v_batch_id   UUID;
  v_kas_id     UUID;
  v_qty        NUMERIC;
  v_harga      NUMERIC;
  v_nominal    NUMERIC;
  v_total_lot  NUMERIC;
  v_hutang     NUMERIC;
  v_lunas      NUMERIC;
  v_lunas_tg   NUMERIC := 0;
  v_ket_qty    TEXT;
BEGIN
  SELECT id, nama, satuan, stok_aktual, satuan_beli, faktor_konversi INTO v_item
  FROM inventory_item
  WHERE id = p_inventory_item_id AND tenant_id = p_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'Item inventory tidak ditemukan'; END IF;

  IF p_qty_beli IS NOT NULL THEN
    IF v_item.satuan_beli IS NULL OR COALESCE(v_item.faktor_konversi, 0) <= 0 THEN
      RAISE EXCEPTION '% tidak punya konversi satuan beli', v_item.nama;
    END IF;
    IF p_qty_beli <= 0 THEN RAISE EXCEPTION 'Qty beli harus lebih dari 0'; END IF;
    IF COALESCE(p_harga_beli, -1) < 0 THEN RAISE EXCEPTION 'Harga beli tidak valid'; END IF;
    v_qty     := p_qty_beli * v_item.faktor_konversi;
    v_nominal := round(p_qty_beli * p_harga_beli, 2);
    v_harga   := round(v_nominal / v_qty, 2);
    -- qty & satuan stok sudah ada di kolom Buku Kas; keterangan cukup info satuan beli
    v_ket_qty := ' — ' || replace(trim_scale(p_qty_beli)::text, '.', ',') || ' ' || v_item.satuan_beli
      || ' @ Rp ' || replace(to_char(p_harga_beli, 'FM999G999G999G990'), ',', '.') || '/' || v_item.satuan_beli;
  ELSE
    v_qty     := p_qty;
    v_harga   := p_harga_satuan;
    v_nominal := p_qty * p_harga_satuan;
    v_ket_qty := '';
  END IF;

  IF COALESCE(v_qty, 0) <= 0 THEN RAISE EXCEPTION 'Qty harus lebih dari 0'; END IF;

  SELECT COALESCE(SUM(qty_sisa), 0) INTO v_total_lot
  FROM inventory_batch WHERE inventory_item_id = p_inventory_item_id AND tenant_id = p_tenant_id;
  v_hutang := GREATEST(v_total_lot - v_item.stok_aktual, 0);
  v_lunas  := LEAST(v_hutang, v_qty);

  INSERT INTO jurnal_entry (
    kategori_trx_id, jenis, nominal, tanggal,
    no_faktur, keterangan, qty, inventory_item_id,
    tag_po_ids, tenant_id, created_by
  ) VALUES (
    p_kategori_trx_id, 'pembelian_bahan', v_nominal, p_tanggal_masuk,
    p_no_faktur,
    COALESCE(p_keterangan, 'Stok masuk: ' || v_item.nama),
    v_qty, p_inventory_item_id,
    '[]'::JSONB, p_tenant_id, p_user_id
  ) RETURNING id INTO v_jurnal_id;

  INSERT INTO inventory_batch (
    inventory_item_id, qty_awal, qty_sisa,
    harga_satuan, tanggal_masuk, jurnal_entry_id, tenant_id
  ) VALUES (
    p_inventory_item_id, v_qty, v_qty - v_lunas,
    v_harga, p_tanggal_masuk, v_jurnal_id, p_tenant_id
  ) RETURNING id INTO v_batch_id;

  IF v_lunas > 0 THEN
    v_lunas_tg := _lunasi_tunggu_harga(p_inventory_item_id, v_batch_id, v_lunas, v_harga, p_user_id, p_tenant_id);
  END IF;

  IF v_nominal > 0 THEN
    INSERT INTO buku_kas (
      tenant_id, tanggal, tipe, kategori, nominal, keterangan,
      no_referensi, qty, satuan, inventory_batch_id, created_by
    ) VALUES (
      p_tenant_id, p_tanggal_masuk, 'keluar', 'Pembelian Bahan', v_nominal,
      v_item.nama || v_ket_qty
        || CASE WHEN NULLIF(trim(COALESCE(p_keterangan, '')), '') IS NOT NULL THEN ' — ' || trim(p_keterangan) ELSE '' END,
      p_no_faktur, v_qty, v_item.satuan, v_batch_id, p_user_id
    ) RETURNING id INTO v_kas_id;
  END IF;

  UPDATE inventory_item
  SET stok_aktual = stok_aktual + v_qty
  WHERE id = p_inventory_item_id;

  RETURN jsonb_build_object(
    'batch_id',  v_batch_id,
    'jurnal_id', v_jurnal_id,
    'buku_kas_id', v_kas_id,
    'stok_baru', v_item.stok_aktual + v_qty,
    'qty_lunasi_minus', v_lunas,
    'qty_lunasi_tunggu', v_lunas_tg,
    'nominal', v_nominal
  );
END; $function$;

CREATE OR REPLACE FUNCTION public.setoran_modal_sisa_bahan(p_inventory_item_id uuid, p_harga_satuan numeric, p_tanggal date, p_kategori_trx_id uuid, p_user_id uuid, p_tenant_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_item    record;
  v_qty     numeric;
  v_nominal numeric;
  v_res     jsonb;
  v_kas_id  uuid;
BEGIN
  IF p_tanggal IS NULL THEN RAISE EXCEPTION 'Tanggal tidak boleh kosong'; END IF;
  IF COALESCE(p_harga_satuan, 0) <= 0 THEN RAISE EXCEPTION 'Harga harus lebih dari 0'; END IF;

  SELECT id, nama, satuan, stok_aktual, jenis INTO v_item
  FROM inventory_item
  WHERE id = p_inventory_item_id AND tenant_id = p_tenant_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Item inventory tidak ditemukan'; END IF;
  IF v_item.jenis = 'pembantu' THEN
    RAISE EXCEPTION 'Bahan pembantu dihitung lewat stock opname, bukan setoran modal';
  END IF;
  IF v_item.stok_aktual >= 0 THEN
    RAISE EXCEPTION 'Stok % tidak minus — tidak ada yang dijadikan setoran modal', v_item.nama;
  END IF;

  v_qty     := -v_item.stok_aktual;
  v_nominal := round(v_qty * p_harga_satuan, 2);

  v_res := stok_masuk(
    p_inventory_item_id, v_qty, p_harga_satuan, p_tanggal, 'MODAL-SISA', p_kategori_trx_id,
    'Sisa bahan lama', p_user_id, p_tenant_id);

  INSERT INTO buku_kas (tenant_id, tanggal, tipe, kategori, nominal, keterangan, no_referensi, qty, satuan, created_by)
  VALUES (p_tenant_id, p_tanggal, 'masuk', 'Setoran Modal', v_nominal,
    'Setoran modal sisa bahan lama — ' || v_item.nama,
    'MODAL-SISA', v_qty, v_item.satuan, p_user_id)
  RETURNING id INTO v_kas_id;

  RETURN v_res || jsonb_build_object('qty', v_qty, 'nominal', v_nominal, 'setoran_kas_id', v_kas_id);
END $function$;

CREATE OR REPLACE FUNCTION public.simpan_stock_opname(p_items jsonb, p_tanggal date, p_catatan text, p_user_id uuid, p_tenant_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_it RECORD; v_inv RECORD; v_selisih numeric; v_nilai numeric; v_ambil RECORD; v_harga numeric;
  v_n int := 0; v_total numeric := 0;
BEGIN
  IF jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN RAISE EXCEPTION 'Tidak ada barang yang diisi'; END IF;
  FOR v_it IN SELECT (e->>'inventory_item_id')::uuid item_id, (e->>'stok_fisik')::numeric fisik,
                     NULLIF(e->>'harga', '')::numeric harga
              FROM jsonb_array_elements(p_items) e LOOP
    IF v_it.fisik IS NULL OR v_it.fisik < 0 THEN RAISE EXCEPTION 'Stok fisik tidak valid'; END IF;
    IF v_it.harga IS NOT NULL AND v_it.harga < 0 THEN RAISE EXCEPTION 'Harga tidak valid'; END IF;
    SELECT id, nama, satuan, stok_aktual, harga_referensi INTO v_inv FROM inventory_item
    WHERE id = v_it.item_id AND tenant_id = p_tenant_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Barang tidak ditemukan'; END IF;
    v_selisih := ROUND(v_it.fisik - v_inv.stok_aktual, 3);
    v_nilai := 0;
    IF v_selisih < 0 THEN
      IF EXISTS (SELECT 1 FROM inventory_batch WHERE inventory_item_id = v_inv.id AND tenant_id = p_tenant_id) THEN
        SELECT * INTO v_ambil FROM _ambil_stok_bahan_fifo(v_inv.id, -v_selisih, p_tenant_id);
        v_nilai := -COALESCE(v_ambil.harga, 0);
      ELSE
        UPDATE inventory_item SET stok_aktual = stok_aktual + v_selisih WHERE id = v_inv.id;
        v_nilai := v_selisih * COALESCE(v_inv.harga_referensi, 0);
      END IF;
    ELSIF v_selisih > 0 THEN
      v_harga := NULLIF(v_it.harga, 0);
      IF v_harga IS NULL THEN
        SELECT NULLIF(harga_satuan, 0) INTO v_harga FROM inventory_batch
        WHERE inventory_item_id = v_inv.id AND tenant_id = p_tenant_id
        ORDER BY tanggal_masuk DESC, created_at DESC LIMIT 1;
      END IF;
      v_harga := COALESCE(v_harga, NULLIF(v_inv.harga_referensi, 0));
      IF v_harga IS NULL THEN
        RAISE EXCEPTION 'Isi harga beli untuk % (stok lebih %, belum ada harga)', v_inv.nama, v_selisih;
      END IF;
      INSERT INTO inventory_batch (inventory_item_id, qty_awal, qty_sisa, harga_satuan, tanggal_masuk, jurnal_entry_id, tenant_id)
      VALUES (v_inv.id, v_selisih, v_selisih, v_harga, p_tanggal, NULL, p_tenant_id);
      UPDATE inventory_item SET stok_aktual = stok_aktual + v_selisih,
        harga_referensi = CASE WHEN COALESCE(harga_referensi, 0) = 0 THEN v_harga ELSE harga_referensi END
      WHERE id = v_inv.id;
      v_nilai := v_selisih * v_harga;
      INSERT INTO buku_kas (tenant_id, tanggal, tipe, kategori, nominal, keterangan, no_referensi, qty, satuan, created_by)
      VALUES (p_tenant_id, p_tanggal, 'masuk', 'Setoran Modal', ROUND(v_nilai, 2),
        'Setoran modal sisa bahan lama — ' || v_inv.nama || ' (stock opname)',
        'MODAL-SISA', v_selisih, v_inv.satuan, p_user_id);
      INSERT INTO buku_kas (tenant_id, tanggal, tipe, kategori, nominal, keterangan, no_referensi, qty, satuan, created_by)
      VALUES (p_tenant_id, p_tanggal, 'keluar', 'Pembelian Bahan', ROUND(v_nilai, 2),
        v_inv.nama || ' — Sisa bahan lama (stock opname)',
        'MODAL-SISA', v_selisih, v_inv.satuan, p_user_id);
    END IF;
    INSERT INTO stock_opname (tanggal, inventory_item_id, stok_sistem, stok_fisik, selisih, nilai_selisih, catatan, tenant_id, created_by)
    VALUES (p_tanggal, v_inv.id, v_inv.stok_aktual, v_it.fisik, v_selisih, ROUND(v_nilai, 2), NULLIF(trim(COALESCE(p_catatan,'')),''), p_tenant_id, p_user_id);
    v_n := v_n + 1; v_total := v_total + v_nilai;
  END LOOP;
  INSERT INTO audit_log (user_id, modul, aksi, target, metadata, tenant_id)
  VALUES (p_user_id, 'inventory', 'Stock Opname', p_tanggal::text, jsonb_build_object('jumlah_barang', v_n, 'nilai_selisih', ROUND(v_total, 2)), p_tenant_id);
  RETURN jsonb_build_object('jumlah', v_n, 'nilai_selisih', ROUND(v_total, 2));
END; $function$;

-- ─── Data lama (Nov 2026): buang qty/harga dari keterangan, isi qty yang kosong, tandai pasangan modal Lakos 18 Nov ───
UPDATE buku_kas SET keterangan='Bahan JN Navy', qty=100, satuan='yard', no_referensi=NULL WHERE id='d8bdb6a5-69c0-46bb-8718-369b9f0ada7a';
UPDATE buku_kas SET keterangan='Bahan Puring', qty=25.6, satuan='kg', no_referensi=NULL WHERE id='0111b4a4-a4c9-48a8-a258-391c0c47fa8e';
UPDATE buku_kas SET keterangan='Toyobo Hitam', qty=160, satuan='yard', no_referensi=NULL WHERE id='b0ea3579-0abd-45cf-9cde-be9cab1f58c1';
UPDATE buku_kas SET keterangan='Toyobo Light grey', qty=43, satuan='yard', no_referensi=NULL WHERE id='34d88f89-e0dd-4597-9779-0cf2ba1316ae';
UPDATE buku_kas SET keterangan='Toyobo Navy', qty=120, satuan='yard', no_referensi=NULL WHERE id='bffc7a87-49ba-450e-96ac-90708d1d4e57';
UPDATE buku_kas SET keterangan='Toyobo Dark grey', qty=150, satuan='yard', no_referensi=NULL WHERE id='db7020df-252f-4ffd-900f-73e773500f85';
UPDATE buku_kas SET keterangan='Setoran modal sisa bahan lama — Toyobo brown 2,72, Toyobo Dark grey 0,18, Toyobo Hitam 15,62, Toyobo Navy 1,46, Toyobo White 5,44 yd', qty=NULL, satuan=NULL, no_referensi='MODAL-SISA' WHERE id='dae900db-e4ad-4336-9c46-d8d5fc8d2313';
UPDATE buku_kas SET keterangan='Toyobo Hitam — Sisa bahan lama', qty=15.620, satuan='yard', no_referensi='MODAL-SISA' WHERE id='f933caad-e083-4926-9408-20c08cf2241a';
UPDATE buku_kas SET keterangan='Toyobo brown — Sisa bahan lama', qty=2.720, satuan='yard', no_referensi='MODAL-SISA' WHERE id='7b3056b5-3df8-41a3-a6cc-e542558af4e9';
UPDATE buku_kas SET keterangan='Toyobo Navy — Sisa bahan lama', qty=1.460, satuan='yard', no_referensi='MODAL-SISA' WHERE id='78cc3999-c52b-4ac6-88a6-af9abd1a53bf';
UPDATE buku_kas SET keterangan='Toyobo White — Sisa bahan lama', qty=5.440, satuan='yard', no_referensi='MODAL-SISA' WHERE id='4c1e50c3-af09-4db8-bd82-f2255b548c76';
UPDATE buku_kas SET keterangan='Toyobo Dark grey — Sisa bahan lama', qty=0.180, satuan='yard', no_referensi='MODAL-SISA' WHERE id='86311bb0-f1c5-4aa6-8c1b-ad297dbe3a3f';
UPDATE buku_kas SET keterangan='Toyobo Navy — Sisa bahan lama', qty=4.080, satuan='yard', no_referensi='MODAL-SISA' WHERE id='028ff18f-5794-43d0-833d-62e77536bfdb';
UPDATE buku_kas SET keterangan='Toyobo brown — Sisa bahan lama', qty=6.120, satuan='yard', no_referensi='MODAL-SISA' WHERE id='b078cee6-f92c-4888-949b-47352f984614';
UPDATE buku_kas SET keterangan='Toyobo Hitam — Sisa bahan lama', qty=5.920, satuan='yard', no_referensi='MODAL-SISA' WHERE id='c699a276-a153-47d0-8212-d06fd5b11496';
UPDATE buku_kas SET keterangan='Toyobo White — Sisa bahan lama', qty=2.040, satuan='yard', no_referensi='MODAL-SISA' WHERE id='9f7e8d1d-4e78-4d0f-ad58-3acd467eaabe';
UPDATE buku_kas SET keterangan='Setoran modal sisa bahan lama — Toyobo brown 6,12, Toyobo Hitam 5,92, Toyobo Navy 4,08, Toyobo White 2,04 yd', qty=NULL, satuan=NULL, no_referensi='MODAL-SISA' WHERE id='0b3e74a4-b424-4048-87a1-3bcd873ac373';
UPDATE buku_kas SET keterangan='Sleting Koil — 6 lusin @ Rp 40.000/lusin', qty=72, satuan='pcs', no_referensi=NULL WHERE id='92a7902e-50c0-4f0d-9ed6-a17f3168be2e';
UPDATE buku_kas SET keterangan='Tali', qty=2, satuan='pack', no_referensi=NULL WHERE id='39d67997-6c94-438f-b005-c91bf675fc3b';
UPDATE buku_kas SET keterangan='Drill Hitam', qty=40, satuan='meter', no_referensi=NULL WHERE id='35e48e7e-bf84-432e-ae2e-badc61bfe091';
UPDATE buku_kas SET keterangan='Setoran modal sisa bahan lama — Kerah Lakos (stock opname)', qty=32.8, satuan='kg', no_referensi='MODAL-SISA' WHERE id='58e7474c-b971-4e66-9563-7b90c3f3c323';
UPDATE buku_kas SET keterangan='Kerah Lakos — Sisa bahan lama (stock opname)', qty=32.8, satuan='kg', no_referensi='MODAL-SISA' WHERE id='cc4fdd9e-8fb6-4594-9355-d14158a74d1a';
UPDATE buku_kas SET keterangan='Chinos Hitam — Sisa bahan lama (stock opname)', qty=120, satuan='yard', no_referensi='MODAL-SISA' WHERE id='e94a848d-fd25-407b-9a16-15f8f36129af';
UPDATE buku_kas SET keterangan='Setoran modal sisa bahan lama — Chinos Hitam (stock opname)', qty=120, satuan='yard', no_referensi='MODAL-SISA' WHERE id='c7ce45e6-b15f-4872-b1f9-d79d25b6bb38';
UPDATE buku_kas SET keterangan='Bahan JN Navy — Sisa bahan lama', qty=3.240, satuan='yard', no_referensi='MODAL-SISA' WHERE id='6ec249cb-5a5a-4dbd-8d49-624dbd3c94bc';
UPDATE buku_kas SET keterangan='Setoran modal sisa bahan lama — Bahan JN Navy', qty=3.24, satuan='yard', no_referensi='MODAL-SISA' WHERE id='6f48c99a-6f7e-46a9-81c4-cae1f8f2822a';
UPDATE buku_kas SET keterangan='Lakos Dark grey — Sisa bahan lama', qty=7.45, satuan='kg', no_referensi='MODAL-SISA' WHERE id='8a58c774-db2f-48b0-9aa8-57bf2040a03e';
UPDATE buku_kas SET keterangan='Setoran modal sisa bahan lama — Lakos Dark grey', qty=7.45, satuan='kg', no_referensi='MODAL-SISA' WHERE id='598161b3-55a7-4326-9533-0293d82b4e6b';
UPDATE buku_kas SET keterangan='Sleting Koil — 1 lusin @ Rp 40.000/lusin', qty=12.0000, satuan='pcs', no_referensi=NULL WHERE id='f336eeef-43f7-4b9c-828a-80fea63868c3';
