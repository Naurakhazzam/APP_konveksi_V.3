-- Cutting dari SISA BAHAN (15 Nov 2026)
-- Saat selesai cutting, operator bisa menandai "pakai sisa bahan". Sistem lalu
-- membuat LOT sisa bahan sebanyak pemakaian (harga = harga_referensi, tanpa
-- jurnal pembelian) dan langsung memakainya — stok bersih tidak berubah, tapi
-- pemakaian & biaya bahan per bundle tetap tercatat.
-- Batal / koreksi pemakaian sisa bahan TIDAK mengembalikan stok ke gudang.

ALTER TABLE pemakaian_bahan ADD COLUMN IF NOT EXISTS dari_sisa boolean NOT NULL DEFAULT false;
ALTER TABLE inventory_batch ADD COLUMN IF NOT EXISTS dari_sisa boolean NOT NULL DEFAULT false;

DROP FUNCTION IF EXISTS public.selesai_cutting_v2(jsonb, jsonb, boolean, uuid, text, uuid);

CREATE OR REPLACE FUNCTION public.selesai_cutting_v2(p_bundles jsonb, p_pemakaian jsonb, p_kurangi_sisa boolean, p_user_id uuid, p_tenant_id text, p_karyawan_id uuid DEFAULT NULL::uuid, p_dari_sisa boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_item JSONB; v_b RECORD; v_qty INT; v_rencana INT; v_lebih INT; v_kurangi INT; v_w RECORD;
  v_total_qty INT := 0; v_count INT := 0; v_kembali INT := 0; v_sisa JSONB; v_sisa_all JSONB := '[]'::jsonb;
  v_lebih_all JSONB := '[]'::jsonb; v_tarif NUMERIC; v_total_upah NUMERIC := 0; v_pk RECORD; v_inv RECORD; v_batch RECORD;
  v_butuh NUMERIC; v_sisa_butuh NUMERIC; v_ambil NUMERIC; v_harga NUMERIC; v_first_batch UUID;
  v_stok_warnings JSONB := '[]'::jsonb; v_hasil JSONB := '[]'::jsonb;
BEGIN
  IF p_bundles IS NULL OR jsonb_array_length(p_bundles) = 0 THEN RAISE EXCEPTION 'Tidak ada bundle dipilih'; END IF;
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_bundles) LOOP
    SELECT b.id, b.barcode, b.po_item_id, b.status_tahap, b.ditutup_at, COALESCE(b.qty_rencana, pi.qty_per_bundle) AS rencana, pi.produk_id
    INTO v_b FROM bundle b JOIN po_item pi ON pi.id = b.po_item_id
    WHERE b.id = (v_item->>'bundle_id')::UUID AND b.tenant_id = p_tenant_id FOR UPDATE OF b;
    IF NOT FOUND THEN RAISE EXCEPTION 'Bundle tidak ditemukan'; END IF;
    IF v_b.ditutup_at IS NOT NULL THEN RAISE EXCEPTION 'Bundle % sudah ditutup sebagai data lama', v_b.barcode; END IF;
    IF COALESCE(v_b.status_tahap->'cutting'->>'status', '') NOT IN ('progress', 'terima') THEN
      RAISE EXCEPTION 'Bundle % tidak sedang dipotong — muat ulang halaman', v_b.barcode; END IF;
    v_qty := (v_item->>'qty_aktual')::INT; v_rencana := v_b.rencana;
    IF v_qty IS NULL OR v_qty < 0 THEN RAISE EXCEPTION 'Hasil cutting bundle % tidak valid', v_b.barcode; END IF;
    IF v_qty = 0 THEN
      UPDATE bundle SET status_tahap = status_tahap - 'cutting' WHERE id = v_b.id;
      v_kembali := v_kembali + 1; CONTINUE;
    END IF;
    v_lebih := GREATEST(v_qty - v_rencana, 0);
    IF v_qty < v_rencana THEN
      v_sisa := _buat_bundle_sisa(v_b.id, v_rencana - v_qty, p_user_id, p_tenant_id);
      v_sisa_all := v_sisa_all || jsonb_build_object('dari', v_b.barcode, 'barcode', v_sisa->>'barcode', 'qty', v_rencana - v_qty);
    END IF;
    UPDATE bundle SET qty_rencana = LEAST(v_qty, v_rencana),
      status_tahap = jsonb_set(status_tahap, '{cutting}', (status_tahap->'cutting') || jsonb_build_object(
        'status','selesai','qty_aktual',v_qty,'qty_rencana',v_rencana,'qty_lebih',v_lebih,
        'waktu_selesai',now(),'updated_by',p_user_id,'karyawan_id',p_karyawan_id,
        'dari_sisa', COALESCE(p_dari_sisa, false)))
    WHERE id = v_b.id;
    IF v_lebih > 0 THEN
      v_kurangi := 0;
      IF COALESCE(p_kurangi_sisa, FALSE) THEN
        FOR v_w IN SELECT id, barcode, qty_rencana FROM bundle
          WHERE po_item_id = v_b.po_item_id AND tenant_id = p_tenant_id AND status_tahap->'cutting' IS NULL
            AND ditutup_at IS NULL AND id <> v_b.id ORDER BY no_urut DESC FOR UPDATE
        LOOP
          EXIT WHEN v_kurangi >= v_lebih;
          IF v_w.qty_rencana <= (v_lebih - v_kurangi) THEN
            v_kurangi := v_kurangi + v_w.qty_rencana; DELETE FROM bundle WHERE id = v_w.id;
          ELSE
            UPDATE bundle SET qty_rencana = qty_rencana - (v_lebih - v_kurangi) WHERE id = v_w.id; v_kurangi := v_lebih;
          END IF;
        END LOOP;
      END IF;
      v_lebih_all := v_lebih_all || jsonb_build_object('barcode', v_b.barcode, 'lebih', v_lebih, 'sisa_dikurangi', v_kurangi);
    END IF;
    IF p_karyawan_id IS NOT NULL THEN
      SELECT hi.harga_satuan INTO v_tarif FROM hpp_item hi JOIN hpp_komponen hk ON hk.id = hi.komponen_id
      WHERE hi.produk_id = v_b.produk_id AND hk.tahap_produksi = 'cutting' AND hi.tenant_id = p_tenant_id LIMIT 1;
      IF v_tarif IS NOT NULL AND v_tarif > 0 THEN
        INSERT INTO gaji_ledger (karyawan_id, tipe, total, tanggal, sumber_id, keterangan, status, tenant_id, created_by)
        VALUES (p_karyawan_id, 'selesai'::gaji_ledger_tipe, v_tarif * v_qty, CURRENT_DATE, v_b.id::text,
                'Upah cutting - ' || v_b.barcode, 'belum_lunas'::gaji_status, p_tenant_id, p_user_id);
        v_total_upah := v_total_upah + v_tarif * v_qty;
      END IF;
    END IF;
    v_hasil := v_hasil || jsonb_build_object('bundle_id', v_b.id, 'po_item_id', v_b.po_item_id, 'qty', v_qty);
    v_total_qty := v_total_qty + v_qty; v_count := v_count + 1;
  END LOOP;
  FOR v_pk IN
    SELECT h.bundle_id, h.po_item_id, h.qty, p.inventory_item_id, p.rate
    FROM jsonb_to_recordset(v_hasil) AS h(bundle_id UUID, po_item_id UUID, qty INT)
    JOIN (SELECT (e->>'po_item_id')::UUID AS po_item_id, (e->>'inventory_item_id')::UUID AS inventory_item_id,
                 SUM((e->>'rate_per_pcs')::NUMERIC) AS rate
          FROM jsonb_array_elements(COALESCE(p_pemakaian, '[]'::jsonb)) e GROUP BY 1, 2) p ON p.po_item_id = h.po_item_id
    WHERE p.rate > 0
  LOOP
    SELECT id, nama, stok_aktual, harga_referensi INTO v_inv FROM inventory_item
    WHERE id = v_pk.inventory_item_id AND tenant_id = p_tenant_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Bahan tidak ditemukan di inventory'; END IF;
    v_butuh := v_pk.rate * v_pk.qty;

    IF COALESCE(p_dari_sisa, false) THEN
      -- Sisa bahan: masuk stok sebanyak pemakaian lalu langsung terpakai habis.
      INSERT INTO inventory_batch (inventory_item_id, qty_awal, qty_sisa, harga_satuan, tanggal_masuk, jurnal_entry_id, tenant_id, dari_sisa)
      VALUES (v_inv.id, v_butuh, 0, COALESCE(v_inv.harga_referensi, 0), CURRENT_DATE, NULL, p_tenant_id, true)
      RETURNING id INTO v_first_batch;
      INSERT INTO pemakaian_bahan (bundle_id, po_item_id, inventory_item_id, inventory_batch_id, qty_pakai, rate_per_pcs, harga_pakai, tenant_id, created_by, dari_sisa)
      VALUES (v_pk.bundle_id, v_pk.po_item_id, v_inv.id, v_first_batch, v_butuh, v_pk.rate,
              ROUND(v_butuh * COALESCE(v_inv.harga_referensi, 0), 2), p_tenant_id, p_user_id, true);
      CONTINUE;
    END IF;

    v_sisa_butuh := v_butuh; v_harga := 0; v_first_batch := NULL;
    FOR v_batch IN SELECT id, qty_sisa, harga_satuan FROM inventory_batch
      WHERE inventory_item_id = v_inv.id AND tenant_id = p_tenant_id AND qty_sisa > 0 ORDER BY tanggal_masuk ASC FOR UPDATE
    LOOP
      EXIT WHEN v_sisa_butuh <= 0;
      v_ambil := LEAST(v_batch.qty_sisa, v_sisa_butuh);
      UPDATE inventory_batch SET qty_sisa = qty_sisa - v_ambil WHERE id = v_batch.id;
      v_harga := v_harga + v_ambil * COALESCE(v_batch.harga_satuan, 0);
      v_sisa_butuh := v_sisa_butuh - v_ambil;
      IF v_first_batch IS NULL THEN v_first_batch := v_batch.id; END IF;
    END LOOP;
    IF v_sisa_butuh > 0 THEN
      v_harga := v_harga + v_sisa_butuh * COALESCE(v_inv.harga_referensi, 0);
      IF v_first_batch IS NULL THEN
        SELECT id INTO v_first_batch FROM inventory_batch WHERE inventory_item_id = v_inv.id AND tenant_id = p_tenant_id ORDER BY tanggal_masuk DESC LIMIT 1;
      END IF;
      v_stok_warnings := v_stok_warnings || jsonb_build_object('item_nama', v_inv.nama, 'qty_kurang', v_sisa_butuh, 'sisa_stok', v_inv.stok_aktual - v_butuh);
    END IF;
    UPDATE inventory_item SET stok_aktual = stok_aktual - v_butuh WHERE id = v_inv.id;
    INSERT INTO pemakaian_bahan (bundle_id, po_item_id, inventory_item_id, inventory_batch_id, qty_pakai, rate_per_pcs, harga_pakai, tenant_id, created_by)
    VALUES (v_pk.bundle_id, v_pk.po_item_id, v_inv.id, v_first_batch, v_butuh, v_pk.rate, ROUND(v_harga, 2), p_tenant_id, p_user_id);
  END LOOP;
  RETURN jsonb_build_object('success', true, 'jumlah_bundle', v_count, 'total_qty', v_total_qty, 'kembali_antri', v_kembali,
    'sisa', v_sisa_all, 'lebih', v_lebih_all, 'total_upah', v_total_upah, 'stok_warnings', v_stok_warnings);
END; $function$;

-- ─── Batal selesai cutting: pemakaian sisa bahan tidak dikembalikan ke stok ───
CREATE OR REPLACE FUNCTION public.batal_selesai_cutting(p_bundle_ids uuid[], p_alasan text, p_user_id uuid, p_tenant_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_b RECORD; v_c jsonb; v_pb RECORD; v_batch RECORD; v_sisa numeric; v_ambil numeric;
  v_gabung int; v_hapus text[]; v_upah jsonb; v_bahan jsonb; v_n int := 0;
BEGIN
  IF p_alasan IS NULL OR trim(p_alasan) = '' THEN RAISE EXCEPTION 'Alasan wajib diisi'; END IF;
  IF COALESCE(array_length(p_bundle_ids, 1), 0) = 0 THEN RAISE EXCEPTION 'Tidak ada bundle dipilih'; END IF;
  FOR v_b IN
    SELECT b.id, b.barcode, b.status_tahap, b.qty_rencana, b.ditutup_at, b.parent_bundle_id
    FROM bundle b WHERE b.id = ANY(p_bundle_ids) AND b.tenant_id = p_tenant_id
    ORDER BY b.barcode FOR UPDATE OF b
  LOOP
    v_c := v_b.status_tahap -> 'cutting';
    IF v_b.ditutup_at IS NOT NULL THEN RAISE EXCEPTION 'Bundle % sudah ditutup (data lama)', v_b.barcode; END IF;
    IF COALESCE(v_c ->> 'status', '') <> 'selesai' THEN RAISE EXCEPTION 'Bundle % tidak berstatus selesai cutting — muat ulang halaman', v_b.barcode; END IF;
    IF v_b.status_tahap ? 'jahit' THEN RAISE EXCEPTION 'Bundle % sudah diserahkan ke penjahit — batalkan serah terima dulu', v_b.barcode; END IF;
    IF v_b.parent_bundle_id IS NOT NULL THEN RAISE EXCEPTION 'Bundle % adalah pecahan Split — tidak bisa dikembalikan ke Cutting', v_b.barcode; END IF;
    IF EXISTS (SELECT 1 FROM bundle c WHERE c.parent_bundle_id = v_b.id AND c.tenant_id = p_tenant_id) THEN
      RAISE EXCEPTION 'Bundle % sudah pernah di-Split — tidak bisa dikembalikan ke Cutting', v_b.barcode; END IF;
    IF EXISTS (SELECT 1 FROM gaji_ledger gl WHERE gl.tenant_id = p_tenant_id AND gl.sumber_id = v_b.id::text
        AND gl.keterangan LIKE 'Upah cutting - %' AND gl.status IN ('lunas', 'escrow')) THEN
      RAISE EXCEPTION 'Upah cutting bundle % sudah dibayar — tidak bisa dikembalikan', v_b.barcode; END IF;

    SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, 'total', total, 'keterangan', keterangan)), '[]'::jsonb) INTO v_upah
    FROM gaji_ledger WHERE tenant_id = p_tenant_id AND sumber_id = v_b.id::text AND keterangan LIKE 'Upah cutting - %' AND status <> 'cancelled';
    UPDATE gaji_ledger SET status = 'cancelled'
    WHERE tenant_id = p_tenant_id AND sumber_id = v_b.id::text AND keterangan LIKE 'Upah cutting - %' AND status <> 'cancelled';

    SELECT COALESCE(jsonb_agg(jsonb_build_object('inventory_item_id', inventory_item_id, 'qty_pakai', qty_pakai,
             'rate_per_pcs', rate_per_pcs, 'harga_pakai', harga_pakai, 'dari_sisa', dari_sisa)), '[]'::jsonb)
    INTO v_bahan FROM pemakaian_bahan WHERE bundle_id = v_b.id;
    FOR v_pb IN SELECT id, inventory_item_id, inventory_batch_id, qty_pakai, dari_sisa FROM pemakaian_bahan WHERE bundle_id = v_b.id FOR UPDATE LOOP
      IF v_pb.dari_sisa THEN
        -- Sisa bahan: hapus catatan & LOT sisanya, stok tidak berubah.
        DELETE FROM pemakaian_bahan WHERE id = v_pb.id;
        DELETE FROM inventory_batch WHERE id = v_pb.inventory_batch_id AND dari_sisa
          AND NOT EXISTS (SELECT 1 FROM pemakaian_bahan x WHERE x.inventory_batch_id = v_pb.inventory_batch_id);
        CONTINUE;
      END IF;
      IF COALESCE(v_pb.qty_pakai, 0) > 0 THEN
        UPDATE inventory_item SET stok_aktual = stok_aktual + v_pb.qty_pakai WHERE id = v_pb.inventory_item_id AND tenant_id = p_tenant_id;
        -- Batch hanya diisi sebanyak yang dulu benar-benar diambil dari batch
        -- (bila stok batch habis, stok jadi minus tanpa memotong batch).
        SELECT LEAST(v_pb.qty_pakai, GREATEST(0, i.stok_aktual - COALESCE(
                 (SELECT SUM(qty_sisa) FROM inventory_batch
                  WHERE inventory_item_id = v_pb.inventory_item_id AND tenant_id = p_tenant_id), 0)))
        INTO v_sisa FROM inventory_item i WHERE i.id = v_pb.inventory_item_id;
        FOR v_batch IN SELECT id, qty_awal, qty_sisa FROM inventory_batch
          WHERE inventory_item_id = v_pb.inventory_item_id AND tenant_id = p_tenant_id AND qty_sisa < qty_awal AND NOT dari_sisa
          ORDER BY tanggal_masuk DESC, created_at DESC FOR UPDATE
        LOOP
          EXIT WHEN v_sisa <= 0;
          v_ambil := LEAST(v_batch.qty_awal - v_batch.qty_sisa, v_sisa);
          UPDATE inventory_batch SET qty_sisa = qty_sisa + v_ambil WHERE id = v_batch.id;
          v_sisa := v_sisa - v_ambil;
        END LOOP;
      END IF;
      DELETE FROM pemakaian_bahan WHERE id = v_pb.id;
    END LOOP;

    SELECT COALESCE(SUM(qty_rencana), 0)::int, array_agg(barcode) INTO v_gabung, v_hapus
    FROM bundle WHERE sisa_dari_bundle_id = v_b.id AND tenant_id = p_tenant_id AND status_tahap -> 'cutting' IS NULL AND ditutup_at IS NULL;
    DELETE FROM bundle WHERE sisa_dari_bundle_id = v_b.id AND tenant_id = p_tenant_id AND status_tahap -> 'cutting' IS NULL AND ditutup_at IS NULL;

    UPDATE bundle SET qty_rencana = COALESCE(qty_rencana, 0) + v_gabung,
        status_tahap = jsonb_set(status_tahap, '{cutting}', jsonb_build_object(
          'status', 'progress', 'start_time', COALESCE(v_c -> 'start_time', to_jsonb(now())),
          'updated_by', p_user_id, 'qty_mulai', COALESCE(v_b.qty_rencana, 0) + v_gabung))
    WHERE id = v_b.id;

    INSERT INTO audit_log (user_id, modul, aksi, target, metadata, tenant_id)
    VALUES (p_user_id, 'produksi', 'Batal Selesai Cutting', v_b.barcode,
      jsonb_build_object('bundle_id', v_b.id, 'cutting_lama', v_c, 'upah_dibatalkan', v_upah, 'bahan_dikembalikan', v_bahan,
        'sisa_digabung', v_gabung, 'bundle_sisa_dihapus', v_hapus, 'alasan', trim(p_alasan)), p_tenant_id);
    v_n := v_n + 1;
  END LOOP;
  IF v_n <> array_length(p_bundle_ids, 1) THEN RAISE EXCEPTION 'Sebagian bundle tidak ditemukan'; END IF;
  RETURN jsonb_build_object('jumlah', v_n);
END;
$function$;

-- ─── Koreksi pemakaian: catatan sisa bahan tidak menggerakkan stok gudang ───
CREATE OR REPLACE FUNCTION public.koreksi_pemakaian_bahan(p_items jsonb, p_alasan text, p_user_id uuid, p_tenant_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_it      RECORD;
  v_pb      RECORD;
  v_qty_pcs numeric;
  v_baru    numeric;
  v_delta   numeric;
  v_ambil   RECORD;
  v_harga   numeric;
  v_batch   uuid;
  v_hsat    numeric;
  v_n       int := 0;
  v_hapus   int := 0;
BEGIN
  IF auth.uid() IS NOT NULL AND get_current_user_role() <> 'owner' THEN
    RAISE EXCEPTION 'Hanya owner yang boleh mengoreksi pemakaian bahan';
  END IF;
  IF p_alasan IS NULL OR trim(p_alasan) = '' THEN RAISE EXCEPTION 'Alasan koreksi wajib diisi'; END IF;
  IF jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Tidak ada perubahan';
  END IF;

  FOR v_it IN
    SELECT (e->>'id')::uuid AS id,
           (e->>'inventory_item_id')::uuid AS item_id,
           ROUND((e->>'rate_per_pcs')::numeric, 4) AS rate
    FROM jsonb_array_elements(p_items) e
  LOOP
    SELECT pb.*, b.barcode,
           COALESCE((b.status_tahap->'cutting'->>'qty_aktual')::numeric, b.qty_rencana, 0) AS qty_pcs,
           ii.nama AS item_nama
    INTO v_pb
    FROM pemakaian_bahan pb
    JOIN bundle b ON b.id = pb.bundle_id
    JOIN inventory_item ii ON ii.id = pb.inventory_item_id
    WHERE pb.id = v_it.id AND pb.tenant_id = p_tenant_id
    FOR UPDATE OF pb;
    IF NOT FOUND THEN RAISE EXCEPTION 'Catatan pemakaian tidak ditemukan — muat ulang halaman'; END IF;

    IF v_it.rate IS NULL OR v_it.rate < 0 THEN
      RAISE EXCEPTION 'Pemakaian bundle % tidak valid', v_pb.barcode;
    END IF;
    IF v_it.rate > 3 THEN
      RAISE EXCEPTION 'Pemakaian bundle % melebihi batas 3 per pcs — periksa lagi', v_pb.barcode;
    END IF;

    v_qty_pcs := v_pb.qty_pcs;
    v_baru    := ROUND(v_it.rate * v_qty_pcs, 3);

    CONTINUE WHEN v_it.item_id = v_pb.inventory_item_id
              AND v_it.rate = ROUND(COALESCE(v_pb.rate_per_pcs, 0), 4)
              AND v_baru = v_pb.qty_pakai;

    IF v_pb.dari_sisa THEN
      -- Sisa bahan: hanya catatan & LOT sisanya yang ikut berubah, stok gudang tetap.
      IF v_it.rate = 0 THEN
        DELETE FROM pemakaian_bahan WHERE id = v_pb.id;
        DELETE FROM inventory_batch WHERE id = v_pb.inventory_batch_id AND dari_sisa
          AND NOT EXISTS (SELECT 1 FROM pemakaian_bahan x WHERE x.inventory_batch_id = v_pb.inventory_batch_id);
        v_harga := 0;
        v_hapus := v_hapus + 1;
      ELSE
        IF v_it.item_id <> v_pb.inventory_item_id AND EXISTS (SELECT 1 FROM pemakaian_bahan
                   WHERE bundle_id = v_pb.bundle_id AND inventory_item_id = v_it.item_id AND id <> v_pb.id) THEN
          RAISE EXCEPTION 'Bundle % sudah punya catatan untuk bahan itu — ubah baris yang ada saja', v_pb.barcode;
        END IF;
        SELECT COALESCE(harga_referensi, 0) INTO v_hsat FROM inventory_item WHERE id = v_it.item_id AND tenant_id = p_tenant_id;
        IF v_it.item_id = v_pb.inventory_item_id THEN
          SELECT harga_satuan INTO v_hsat FROM inventory_batch WHERE id = v_pb.inventory_batch_id;
        END IF;
        v_harga := v_baru * COALESCE(v_hsat, 0);
        UPDATE inventory_batch SET inventory_item_id = v_it.item_id, qty_awal = v_baru, harga_satuan = COALESCE(v_hsat, 0)
        WHERE id = v_pb.inventory_batch_id AND dari_sisa;
        UPDATE pemakaian_bahan
        SET inventory_item_id = v_it.item_id, qty_pakai = v_baru, rate_per_pcs = v_it.rate, harga_pakai = ROUND(v_harga, 2)
        WHERE id = v_pb.id;
      END IF;

    ELSIF v_it.rate = 0 THEN
      PERFORM _kembalikan_stok_bahan(v_pb.inventory_item_id, v_pb.qty_pakai, p_tenant_id);
      DELETE FROM pemakaian_bahan WHERE id = v_pb.id;
      v_harga := 0;
      v_hapus := v_hapus + 1;

    ELSIF v_it.item_id = v_pb.inventory_item_id THEN
      v_delta := v_baru - v_pb.qty_pakai;
      v_batch := v_pb.inventory_batch_id;
      IF v_delta > 0 THEN
        SELECT * INTO v_ambil FROM _ambil_stok_bahan_fifo(v_pb.inventory_item_id, v_delta, p_tenant_id);
        v_harga := COALESCE(v_pb.harga_pakai, 0) + v_ambil.harga;
      ELSE
        PERFORM _kembalikan_stok_bahan(v_pb.inventory_item_id, -v_delta, p_tenant_id);
        v_harga := CASE WHEN v_pb.qty_pakai > 0
                        THEN COALESCE(v_pb.harga_pakai, 0) * v_baru / v_pb.qty_pakai ELSE 0 END;
      END IF;
      UPDATE pemakaian_bahan
      SET qty_pakai = v_baru, rate_per_pcs = v_it.rate, harga_pakai = ROUND(v_harga, 2)
      WHERE id = v_pb.id;

    ELSE
      IF EXISTS (SELECT 1 FROM pemakaian_bahan
                 WHERE bundle_id = v_pb.bundle_id AND inventory_item_id = v_it.item_id AND id <> v_pb.id) THEN
        RAISE EXCEPTION 'Bundle % sudah punya catatan untuk bahan itu — ubah baris yang ada saja', v_pb.barcode;
      END IF;
      PERFORM _kembalikan_stok_bahan(v_pb.inventory_item_id, v_pb.qty_pakai, p_tenant_id);
      SELECT * INTO v_ambil FROM _ambil_stok_bahan_fifo(v_it.item_id, v_baru, p_tenant_id);
      v_harga := v_ambil.harga;
      UPDATE pemakaian_bahan
      SET inventory_item_id = v_it.item_id, inventory_batch_id = v_ambil.batch_id,
          qty_pakai = v_baru, rate_per_pcs = v_it.rate, harga_pakai = ROUND(v_harga, 2)
      WHERE id = v_pb.id;
    END IF;

    INSERT INTO audit_log (user_id, modul, aksi, target, metadata, tenant_id)
    VALUES (p_user_id, 'produksi', 'Koreksi Pemakaian Bahan', v_pb.barcode,
      jsonb_build_object(
        'pemakaian_id', v_pb.id, 'bundle_id', v_pb.bundle_id, 'dari_sisa', v_pb.dari_sisa,
        'lama', jsonb_build_object('inventory_item_id', v_pb.inventory_item_id, 'bahan', v_pb.item_nama,
                                   'rate_per_pcs', v_pb.rate_per_pcs, 'qty_pakai', v_pb.qty_pakai,
                                   'harga_pakai', v_pb.harga_pakai),
        'baru', jsonb_build_object('inventory_item_id', v_it.item_id, 'rate_per_pcs', v_it.rate,
                                   'qty_pakai', v_baru, 'harga_pakai', ROUND(v_harga, 2),
                                   'dihapus', v_it.rate = 0),
        'alasan', trim(p_alasan)),
      p_tenant_id);

    v_n := v_n + 1;
  END LOOP;

  RETURN jsonb_build_object('diubah', v_n - v_hapus, 'dihapus', v_hapus);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.selesai_cutting_v2(jsonb, jsonb, boolean, uuid, text, uuid, boolean) TO anon, authenticated, service_role;
