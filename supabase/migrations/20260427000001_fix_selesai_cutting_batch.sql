-- ============================================================
-- Migration: Fix selesai_cutting_batch
-- 1. Proper FIFO deduction from inventory_batch (track first_batch_id)
-- 2. Correct INSERT into pemakaian_bahan:
--    - Includes inventory_batch_id (NOT NULL column)
--    - Removes tahap_produksi (column does not exist on pemakaian_bahan)
--    - Adds ON CONFLICT DO NOTHING (UNIQUE bundle_id, inventory_item_id)
-- ============================================================

DROP FUNCTION IF EXISTS selesai_cutting_batch(jsonb, jsonb, uuid, text);

CREATE OR REPLACE FUNCTION selesai_cutting_batch(
    p_bundle_qty  jsonb,
    p_pemakaian   jsonb,
    p_user_id     uuid,
    p_tenant_id   text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_item            jsonb;
    v_b_id            uuid;
    v_qty_aktual      int;
    v_qty_order       int;
    v_new_status      text;
    v_total_qty       int     := 0;
    v_partial_count   int     := 0;
    v_stok_warnings   jsonb   := '[]'::jsonb;
    v_inv_item        record;
    v_first_bundle_id uuid;
    v_po_item_id      uuid;
    v_total_deduction numeric;
    v_rate_per_pcs    numeric;
    -- FIFO variables
    v_batch           record;
    v_qty_remaining   numeric;
    v_qty_from_batch  numeric;
    v_first_batch_id  uuid;
BEGIN
    -- 1. Get first bundle_id + po_item_id sebagai referensi pemakaian_bahan
    IF jsonb_array_length(p_bundle_qty) > 0 THEN
        v_first_bundle_id := (p_bundle_qty->0->>'bundle_id')::uuid;
        SELECT b.po_item_id INTO v_po_item_id
        FROM bundle b
        WHERE b.id = v_first_bundle_id AND b.tenant_id = p_tenant_id;
    END IF;

    -- 2. Update status cutting setiap bundle
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_bundle_qty)
    LOOP
        v_b_id       := (v_item->>'bundle_id')::uuid;
        v_qty_aktual := (v_item->>'qty_aktual')::int;

        SELECT pi.qty_per_bundle INTO v_qty_order
        FROM bundle b
        JOIN po_item pi ON b.po_item_id = pi.id
        WHERE b.id = v_b_id AND b.tenant_id = p_tenant_id;

        IF v_qty_aktual < v_qty_order THEN
            v_new_status    := 'partial';
            v_partial_count := v_partial_count + 1;
        ELSE
            v_new_status := 'selesai';
            v_total_qty  := v_total_qty + v_qty_aktual;
        END IF;

        UPDATE bundle
        SET status_tahap = jsonb_set(
            COALESCE(status_tahap, '{}'::jsonb),
            '{cutting}',
            COALESCE(status_tahap->'cutting', '{}'::jsonb) || jsonb_build_object(
                'status',        v_new_status,
                'qty_aktual',    v_qty_aktual,
                'waktu_selesai', (now() AT TIME ZONE 'utc')::text,
                'updated_by',    p_user_id
            )
        )
        WHERE id = v_b_id AND tenant_id = p_tenant_id;
    END LOOP;

    -- 3. Proses pemakaian bahan dengan FIFO
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_pemakaian)
    LOOP
        v_rate_per_pcs    := (v_item->>'rate_per_pcs')::numeric;
        v_total_deduction := v_rate_per_pcs * (v_item->>'total_qty_artikel')::numeric;

        IF v_total_deduction <= 0 THEN CONTINUE; END IF;

        SELECT id, nama, stok_aktual INTO v_inv_item
        FROM inventory_item
        WHERE id = (v_item->>'inventory_item_id')::uuid
          AND tenant_id = p_tenant_id;

        IF NOT FOUND THEN CONTINUE; END IF;

        -- a. FIFO deduction dari inventory_batch, catat first_batch_id
        v_qty_remaining  := v_total_deduction;
        v_first_batch_id := NULL;

        FOR v_batch IN
            SELECT id, qty_sisa, harga_satuan
            FROM inventory_batch
            WHERE inventory_item_id = v_inv_item.id
              AND tenant_id = p_tenant_id
              AND qty_sisa > 0
            ORDER BY tanggal_masuk ASC
        LOOP
            EXIT WHEN v_qty_remaining <= 0;

            -- Simpan batch pertama yang dipakai
            IF v_first_batch_id IS NULL THEN
                v_first_batch_id := v_batch.id;
            END IF;

            v_qty_from_batch := LEAST(v_qty_remaining, v_batch.qty_sisa);
            v_qty_remaining  := v_qty_remaining - v_qty_from_batch;

            UPDATE inventory_batch
            SET qty_sisa = qty_sisa - v_qty_from_batch
            WHERE id = v_batch.id;
        END LOOP;

        -- Fallback: jika stok habis sebelum deduction selesai,
        -- ambil batch terakhir sebagai referensi inventory_batch_id
        IF v_first_batch_id IS NULL OR v_qty_remaining > 0 THEN
            SELECT id INTO v_batch
            FROM inventory_batch
            WHERE inventory_item_id = v_inv_item.id
              AND tenant_id = p_tenant_id
            ORDER BY tanggal_masuk DESC LIMIT 1;
            IF FOUND THEN
                v_first_batch_id := COALESCE(v_first_batch_id, v_batch.id);
            END IF;
        END IF;

        -- b. Update stok_aktual (boleh jadi negatif)
        UPDATE inventory_item
        SET stok_aktual = stok_aktual - v_total_deduction
        WHERE id = v_inv_item.id;

        -- c. Warning jika stok jadi negatif
        IF (v_inv_item.stok_aktual - v_total_deduction) < 0 THEN
            v_stok_warnings := v_stok_warnings || jsonb_build_object(
                'item_nama', v_inv_item.nama,
                'qty_kurang', abs(v_inv_item.stok_aktual - v_total_deduction),
                'sisa_stok',  v_inv_item.stok_aktual - v_total_deduction
            );
        END IF;

        -- d. INSERT pemakaian_bahan (ON CONFLICT karena UNIQUE bundle_id + inventory_item_id)
        IF v_first_bundle_id IS NOT NULL AND v_first_batch_id IS NOT NULL THEN
            INSERT INTO pemakaian_bahan (
                bundle_id,
                po_item_id,
                inventory_item_id,
                inventory_batch_id,
                qty_pakai,
                rate_per_pcs,
                tenant_id,
                created_by
            ) VALUES (
                v_first_bundle_id,
                v_po_item_id,
                v_inv_item.id,
                v_first_batch_id,
                v_total_deduction,
                v_rate_per_pcs,
                p_tenant_id,
                p_user_id
            )
            ON CONFLICT (bundle_id, inventory_item_id) DO NOTHING;
        END IF;

    END LOOP;

    RETURN jsonb_build_object(
        'success',       true,
        'total_qty',     v_total_qty,
        'partial_count', v_partial_count,
        'stok_warnings', v_stok_warnings
    );
END;
$$;

GRANT EXECUTE ON FUNCTION selesai_cutting_batch(jsonb, jsonb, uuid, text) TO authenticated;
