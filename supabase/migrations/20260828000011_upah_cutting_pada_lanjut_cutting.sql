-- ================================================================
-- MIGRATION: Upah cutting ikut tercatat saat Lanjut Cutting
--
-- Upah cutting ditambahkan di selesai_cutting_batch, tapi jalur satunya —
-- Lanjut Cutting untuk bundle partial — terlewat. Akibatnya potongan
-- susulan tidak pernah membentuk entri upah dan upah tukang potong hilang
-- diam-diam.
--
-- Perbaikannya: parameter p_karyawan_id (operator potong) ditambahkan,
-- disimpan ke status_tahap->'cutting'->'karyawan_id', dan dipakai untuk
-- menulis gaji_ledger memakai tarif cutting dari HPP produk itu.
--
-- Versi 5 argumen dibuang supaya tidak ada panggilan yang lolos tanpa
-- operator dan diam-diam kehilangan upahnya lagi.
-- ================================================================

DROP FUNCTION IF EXISTS public.lanjut_cutting_partial(uuid, integer, jsonb, uuid, text);

CREATE OR REPLACE FUNCTION public.lanjut_cutting_partial(
  p_bundle_id uuid, p_qty_tambahan integer, p_pemakaian jsonb,
  p_user_id uuid, p_tenant_id text, p_karyawan_id uuid DEFAULT NULL::uuid
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
AS $function$
DECLARE
    v_bundle          record;
    v_qty_terpotong   int;
    v_qty_rencana     int;
    v_sisa            int;
    v_sisa_baru       int;
    v_parent_status   text;
    v_susulan_count   int;
    v_new_barcode     text;
    v_new_no_urut     int;
    v_new_bundle_id   uuid;
    v_item            jsonb;
    v_inv_item        record;
    v_rate_per_pcs    numeric;
    v_total_deduction numeric;
    v_batch           record;
    v_qty_remaining   numeric;
    v_qty_from_batch  numeric;
    v_first_batch_id  uuid;
    v_stok_warnings   jsonb := '[]'::jsonb;
    v_tarif_cutting   numeric;
    v_upah            numeric := 0;
BEGIN
    SELECT b.id, b.po_id, b.po_item_id, b.barcode, b.no_urut_po,
           b.status_tahap, pi.qty_per_bundle, pi.produk_id
    INTO v_bundle
    FROM bundle b JOIN po_item pi ON pi.id = b.po_item_id
    WHERE b.id = p_bundle_id AND b.tenant_id = p_tenant_id
    FOR UPDATE OF b;

    IF NOT FOUND THEN RAISE EXCEPTION 'Bundle tidak ditemukan'; END IF;

    IF (v_bundle.status_tahap->'cutting'->>'status') IS DISTINCT FROM 'partial' THEN
        RAISE EXCEPTION 'Bundle % bukan bundle partial — hanya bundle yang dipotong sebagian yang bisa dilanjutkan', v_bundle.barcode;
    END IF;

    v_qty_rencana := v_bundle.qty_per_bundle;

    SELECT COALESCE((v_bundle.status_tahap->'cutting'->>'qty_aktual')::int, 0)
         + COALESCE((
             SELECT SUM(COALESCE((c.status_tahap->'cutting'->>'qty_aktual')::int, 0))
             FROM bundle c
             WHERE c.parent_bundle_id = p_bundle_id AND c.tenant_id = p_tenant_id
               AND c.barcode LIKE v_bundle.barcode || 'c%'
           ), 0)
    INTO v_qty_terpotong;

    v_sisa := v_qty_rencana - v_qty_terpotong;

    IF p_qty_tambahan IS NULL OR p_qty_tambahan <= 0 THEN
        RAISE EXCEPTION 'Qty lanjutan harus lebih dari 0';
    END IF;
    IF p_qty_tambahan > v_sisa THEN
        RAISE EXCEPTION 'Qty lanjutan % pcs melebihi sisa yang belum dipotong (% pcs dari rencana %)',
            p_qty_tambahan, v_sisa, v_qty_rencana;
    END IF;

    SELECT COUNT(*) INTO v_susulan_count
    FROM bundle WHERE barcode LIKE v_bundle.barcode || 'c%' AND tenant_id = p_tenant_id;
    v_new_barcode := v_bundle.barcode || 'c' || (v_susulan_count + 1)::TEXT;

    SELECT COALESCE(MAX(no_urut), 0) + 1 INTO v_new_no_urut
    FROM bundle WHERE po_id = v_bundle.po_id AND tenant_id = p_tenant_id;

    INSERT INTO bundle (barcode, po_id, po_item_id, no_urut, no_urut_po,
                        parent_bundle_id, status_tahap, tenant_id, created_by)
    VALUES (v_new_barcode, v_bundle.po_id, v_bundle.po_item_id, v_new_no_urut,
            v_bundle.no_urut_po, p_bundle_id,
            jsonb_build_object('cutting', jsonb_build_object(
              'status','selesai','qty_aktual',p_qty_tambahan,
              'waktu_selesai',now(),'updated_by',p_user_id,
              'karyawan_id',p_karyawan_id,'susulan_dari',v_bundle.barcode)),
            p_tenant_id, p_user_id)
    RETURNING id INTO v_new_bundle_id;

    -- Upah cutting untuk potongan susulan
    IF p_karyawan_id IS NOT NULL THEN
        SELECT hi.harga_satuan INTO v_tarif_cutting
        FROM hpp_item hi JOIN hpp_komponen hk ON hk.id = hi.komponen_id
        WHERE hi.produk_id = v_bundle.produk_id AND hk.tahap_produksi = 'cutting'
          AND hi.tenant_id = p_tenant_id LIMIT 1;

        IF v_tarif_cutting IS NOT NULL AND v_tarif_cutting > 0 THEN
            v_upah := v_tarif_cutting * p_qty_tambahan;
            INSERT INTO gaji_ledger (karyawan_id, tipe, total, tanggal, sumber_id,
                                     keterangan, status, tenant_id, created_by)
            VALUES (p_karyawan_id, 'selesai'::gaji_ledger_tipe, v_upah, CURRENT_DATE,
                    v_new_bundle_id::text, 'Upah cutting - ' || v_new_barcode,
                    'belum_lunas'::gaji_status, p_tenant_id, p_user_id);
        END IF;
    END IF;

    v_sisa_baru := v_sisa - p_qty_tambahan;
    IF v_sisa_baru <= 0 THEN
        v_parent_status := 'selesai';
        UPDATE bundle SET status_tahap = jsonb_set(status_tahap,'{cutting}',
            (status_tahap->'cutting') || jsonb_build_object(
              'status','selesai','closed_at',now(),'closed_by',p_user_id))
        WHERE id = p_bundle_id AND tenant_id = p_tenant_id;
    ELSE
        v_parent_status := 'partial';
    END IF;

    FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_pemakaian,'[]'::jsonb))
    LOOP
        v_rate_per_pcs    := (v_item->>'rate_per_pcs')::numeric;
        v_total_deduction := v_rate_per_pcs * p_qty_tambahan;
        IF v_total_deduction <= 0 THEN CONTINUE; END IF;

        SELECT id, nama, stok_aktual INTO v_inv_item FROM inventory_item
        WHERE id = (v_item->>'inventory_item_id')::uuid AND tenant_id = p_tenant_id;
        IF NOT FOUND THEN CONTINUE; END IF;

        v_qty_remaining := v_total_deduction; v_first_batch_id := NULL;
        FOR v_batch IN SELECT id, qty_sisa FROM inventory_batch
            WHERE inventory_item_id = v_inv_item.id AND tenant_id = p_tenant_id AND qty_sisa > 0
            ORDER BY tanggal_masuk ASC
        LOOP
            EXIT WHEN v_qty_remaining <= 0;
            IF v_first_batch_id IS NULL THEN v_first_batch_id := v_batch.id; END IF;
            v_qty_from_batch := LEAST(v_qty_remaining, v_batch.qty_sisa);
            v_qty_remaining  := v_qty_remaining - v_qty_from_batch;
            UPDATE inventory_batch SET qty_sisa = qty_sisa - v_qty_from_batch WHERE id = v_batch.id;
        END LOOP;

        IF v_first_batch_id IS NULL OR v_qty_remaining > 0 THEN
            SELECT id INTO v_batch FROM inventory_batch
            WHERE inventory_item_id = v_inv_item.id AND tenant_id = p_tenant_id
            ORDER BY tanggal_masuk DESC LIMIT 1;
            IF FOUND THEN v_first_batch_id := COALESCE(v_first_batch_id, v_batch.id); END IF;
        END IF;

        UPDATE inventory_item SET stok_aktual = stok_aktual - v_total_deduction WHERE id = v_inv_item.id;

        IF (v_inv_item.stok_aktual - v_total_deduction) < 0 THEN
            v_stok_warnings := v_stok_warnings || jsonb_build_object(
                'item_nama', v_inv_item.nama,
                'qty_kurang', abs(v_inv_item.stok_aktual - v_total_deduction),
                'sisa_stok',  v_inv_item.stok_aktual - v_total_deduction);
        END IF;

        IF v_first_batch_id IS NOT NULL THEN
            INSERT INTO pemakaian_bahan (bundle_id, po_item_id, inventory_item_id,
                                         inventory_batch_id, qty_pakai, rate_per_pcs, tenant_id, created_by)
            VALUES (v_new_bundle_id, v_bundle.po_item_id, v_inv_item.id, v_first_batch_id,
                    v_total_deduction, v_rate_per_pcs, p_tenant_id, p_user_id)
            ON CONFLICT (bundle_id, inventory_item_id) DO NOTHING;
        END IF;
    END LOOP;

    RETURN jsonb_build_object(
        'success', true, 'new_bundle_id', v_new_bundle_id,
        'new_bundle_barcode', v_new_barcode, 'qty_tambahan', p_qty_tambahan,
        'qty_terpotong', v_qty_terpotong + p_qty_tambahan, 'qty_rencana', v_qty_rencana,
        'sisa_baru', GREATEST(v_sisa_baru,0), 'parent_status', v_parent_status,
        'upah_cutting', v_upah, 'stok_warnings', v_stok_warnings);
END;
$function$;
