-- 1. UPDATE function mulai_cutting_batch
DROP FUNCTION IF EXISTS mulai_cutting_batch(uuid[], uuid, text);

CREATE OR REPLACE FUNCTION mulai_cutting_batch(
    p_bundle_ids uuid[],
    p_user_id uuid,
    p_tenant_id text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_updated_count int;
BEGIN
    UPDATE bundle
    SET status_tahap = jsonb_set(
        COALESCE(status_tahap, '{}'::jsonb),
        '{cutting}',
        COALESCE(status_tahap->'cutting', '{}'::jsonb) || jsonb_build_object(
            'status', 'progress',
            'start_time', (now() AT TIME ZONE 'utc')::text,
            'updated_by', p_user_id
        )
    )
    WHERE id = ANY(p_bundle_ids)
      AND tenant_id = p_tenant_id;

    GET DIAGNOSTICS v_updated_count = ROW_COUNT;

    RETURN jsonb_build_object('jumlah_bundle', v_updated_count);
END;
$$;

-- 2. UPDATE function selesai_cutting_batch
DROP FUNCTION IF EXISTS selesai_cutting_batch(uuid[], text, uuid, text);
DROP FUNCTION IF EXISTS selesai_cutting_batch(uuid[], jsonb, uuid, text);

CREATE OR REPLACE FUNCTION selesai_cutting_batch(
    p_bundle_qty jsonb,
    p_pemakaian jsonb,
    p_user_id uuid,
    p_tenant_id text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_item jsonb;
    v_b_id uuid;
    v_qty_aktual int;
    v_qty_order int;
    v_new_status text;
    v_total_qty int := 0;
    v_partial_count int := 0;
    v_stok_warnings jsonb := '[]'::jsonb;
    v_inv_item record;
    v_first_bundle_id uuid;
    v_total_deduction numeric;
BEGIN
    -- 1. Get the first bundle_id for pemakaian_bahan reference
    IF jsonb_array_length(p_bundle_qty) > 0 THEN
        v_first_bundle_id := (p_bundle_qty->0->>'bundle_id')::uuid;
    END IF;

    -- 2. Process each bundle
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_bundle_qty)
    LOOP
        v_b_id := (v_item->>'bundle_id')::uuid;
        v_qty_aktual := (v_item->>'qty_aktual')::int;

        -- Get target qty from po_item
        SELECT pi.qty_per_bundle INTO v_qty_order
        FROM bundle b
        JOIN po_item pi ON b.po_item_id = pi.id
        WHERE b.id = v_b_id AND b.tenant_id = p_tenant_id;

        IF v_qty_aktual < v_qty_order THEN
            v_new_status := 'partial';
            v_partial_count := v_partial_count + 1;
        ELSE
            v_new_status := 'selesai';
            v_total_qty := v_total_qty + v_qty_aktual;
        END IF;

        -- Update bundle status_tahap
        UPDATE bundle
        SET status_tahap = jsonb_set(
            COALESCE(status_tahap, '{}'::jsonb),
            '{cutting}',
            COALESCE(status_tahap->'cutting', '{}'::jsonb) || jsonb_build_object(
                'status', v_new_status,
                'qty_aktual', v_qty_aktual,
                'waktu_selesai', (now() AT TIME ZONE 'utc')::text,
                'updated_by', p_user_id
            )
        )
        WHERE id = v_b_id AND tenant_id = p_tenant_id;
    END LOOP;

    -- 3. Process pemakaian bahan
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_pemakaian)
    LOOP
        v_total_deduction := (v_item->>'rate_per_pcs')::numeric * (v_item->>'total_qty_artikel')::numeric;
        
        -- Get current stock
        SELECT id, nama, stok_aktual INTO v_inv_item
        FROM inventory_item
        WHERE id = (v_item->>'inventory_item_id')::uuid AND tenant_id = p_tenant_id;

        IF FOUND AND v_total_deduction > 0 THEN
            -- Update stock
            UPDATE inventory_item
            SET stok_aktual = stok_aktual - v_total_deduction
            WHERE id = v_inv_item.id;

            -- Check warning
            IF (v_inv_item.stok_aktual - v_total_deduction) < 0 THEN
                v_stok_warnings := v_stok_warnings || jsonb_build_object(
                    'item_nama', v_inv_item.nama,
                    'qty_kurang', abs(v_inv_item.stok_aktual - v_total_deduction),
                    'sisa_stok', v_inv_item.stok_aktual - v_total_deduction
                );
            END IF;

            -- Insert to pemakaian_bahan
            IF v_first_bundle_id IS NOT NULL THEN
                INSERT INTO pemakaian_bahan (
                    tenant_id,
                    inventory_item_id,
                    bundle_id,
                    tahap_produksi,
                    qty_pakai,
                    created_by
                ) VALUES (
                    p_tenant_id,
                    v_inv_item.id,
                    v_first_bundle_id,
                    'cutting'::tahap_produksi,
                    v_total_deduction,
                    p_user_id
                );
            END IF;
        END IF;
    END LOOP;

    RETURN jsonb_build_object(
        'success', true,
        'total_qty', v_total_qty,
        'partial_count', v_partial_count,
        'stok_warnings', v_stok_warnings
    );
END;
$$;

-- 3. BUAT function baru close_bundle_cutting
CREATE OR REPLACE FUNCTION close_bundle_cutting(
    p_bundle_id uuid,
    p_user_id uuid,
    p_tenant_id text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    UPDATE bundle
    SET status_tahap = jsonb_set(
        status_tahap,
        '{cutting}',
        status_tahap->'cutting' || jsonb_build_object(
            'status', 'selesai',
            'closed_at', (now() AT TIME ZONE 'utc')::text,
            'closed_by', p_user_id
        )
    )
    WHERE id = p_bundle_id 
      AND tenant_id = p_tenant_id 
      AND status_tahap->'cutting'->>'status' = 'partial';

    RETURN jsonb_build_object('success', true);
END;
$$;
