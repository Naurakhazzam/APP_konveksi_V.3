-- ================================================================
-- MIGRATION 037: selesai_cutting_batch — tambah jurnal_entry bahan
--
-- Masalah: selesai_cutting_batch menyimpan pemakaian_bahan tapi
-- TIDAK membuat jurnal_entry direct_bahan. Akibatnya biaya kain
-- tidak muncul di Jurnal Produksi maupun Ringkasan Keuangan.
--
-- Fix: Setelah INSERT pemakaian_bahan, INSERT juga ke jurnal_entry
-- dengan jenis='direct_bahan', nominal = qty × harga_per_unit,
-- dan tag_po_ids dari PO bundle bersangkutan.
-- ================================================================

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
    v_item              jsonb;
    v_b_id              uuid;
    v_qty_aktual        int;
    v_qty_order         int;
    v_new_status        text;
    v_total_qty         int     := 0;
    v_partial_count     int     := 0;
    v_stok_warnings     jsonb   := '[]'::jsonb;
    v_inv_item          record;
    v_first_bundle_id   uuid;
    v_po_item_id        uuid;
    v_po_id             uuid;
    v_kategori_id       uuid;
    v_total_deduction   numeric;
    v_rate_per_pcs      numeric;
    v_harga_per_unit    numeric;
    v_harga_pakai_total numeric;
    -- FIFO variables
    v_batch             record;
    v_qty_remaining     numeric;
    v_qty_from_batch    numeric;
    v_first_batch_id    uuid;
    v_first_batch_harga numeric;
BEGIN
    -- ── 1. Ambil first bundle_id + po_item_id + po_id ────────────────────────
    IF jsonb_array_length(p_bundle_qty) > 0 THEN
        v_first_bundle_id := (p_bundle_qty->0->>'bundle_id')::uuid;

        SELECT b.po_item_id, pi.po_id
        INTO   v_po_item_id, v_po_id
        FROM   bundle   b
        JOIN   po_item  pi ON pi.id = b.po_item_id
        WHERE  b.id = v_first_bundle_id AND b.tenant_id = p_tenant_id;
    END IF;

    -- ── 2. Ambil kategori_trx untuk direct_bahan ─────────────────────────────
    -- Prioritas: "Pembelian Kain" — fallback ke direct_bahan aktif pertama
    SELECT id INTO v_kategori_id
    FROM   kategori_trx
    WHERE  jenis     = 'direct_bahan'
      AND  aktif     = TRUE
      AND  tenant_id = p_tenant_id
      AND  nama      ILIKE '%kain%'
    LIMIT  1;

    IF v_kategori_id IS NULL THEN
        SELECT id INTO v_kategori_id
        FROM   kategori_trx
        WHERE  jenis     = 'direct_bahan'
          AND  aktif     = TRUE
          AND  tenant_id = p_tenant_id
        LIMIT  1;
    END IF;

    -- ── 3. Update status cutting setiap bundle ───────────────────────────────
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_bundle_qty)
    LOOP
        v_b_id       := (v_item->>'bundle_id')::uuid;
        v_qty_aktual := (v_item->>'qty_aktual')::int;

        SELECT pi.qty_per_bundle INTO v_qty_order
        FROM   bundle   b
        JOIN   po_item  pi ON b.po_item_id = pi.id
        WHERE  b.id = v_b_id AND b.tenant_id = p_tenant_id;

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

    -- ── 4. Proses pemakaian bahan: FIFO + jurnal ─────────────────────────────
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_pemakaian)
    LOOP
        v_rate_per_pcs    := (v_item->>'rate_per_pcs')::numeric;
        v_total_deduction := v_rate_per_pcs * (v_item->>'total_qty_artikel')::numeric;

        IF v_total_deduction <= 0 THEN CONTINUE; END IF;

        SELECT id, nama, stok_aktual, harga_referensi
        INTO   v_inv_item
        FROM   inventory_item
        WHERE  id         = (v_item->>'inventory_item_id')::uuid
          AND  tenant_id  = p_tenant_id;

        IF NOT FOUND THEN CONTINUE; END IF;

        -- a. FIFO deduction
        v_qty_remaining     := v_total_deduction;
        v_first_batch_id    := NULL;
        v_first_batch_harga := NULL;

        FOR v_batch IN
            SELECT id, qty_sisa, harga_satuan
            FROM   inventory_batch
            WHERE  inventory_item_id = v_inv_item.id
              AND  tenant_id         = p_tenant_id
              AND  qty_sisa          > 0
            ORDER  BY tanggal_masuk ASC
        LOOP
            EXIT WHEN v_qty_remaining <= 0;

            IF v_first_batch_id IS NULL THEN
                v_first_batch_id    := v_batch.id;
                v_first_batch_harga := v_batch.harga_satuan;
            END IF;

            v_qty_from_batch := LEAST(v_qty_remaining, v_batch.qty_sisa);
            v_qty_remaining  := v_qty_remaining - v_qty_from_batch;

            UPDATE inventory_batch
            SET    qty_sisa = qty_sisa - v_qty_from_batch
            WHERE  id = v_batch.id;
        END LOOP;

        -- Fallback batch_id jika stok habis sebelum terpenuhi
        IF v_first_batch_id IS NULL OR v_qty_remaining > 0 THEN
            SELECT id, harga_satuan INTO v_batch
            FROM   inventory_batch
            WHERE  inventory_item_id = v_inv_item.id
              AND  tenant_id         = p_tenant_id
            ORDER  BY tanggal_masuk DESC LIMIT 1;
            IF FOUND THEN
                v_first_batch_id    := COALESCE(v_first_batch_id, v_batch.id);
                v_first_batch_harga := COALESCE(v_first_batch_harga, v_batch.harga_satuan);
            END IF;
        END IF;

        -- b. Harga per unit: batch (FIFO) atau fallback harga_referensi
        v_harga_per_unit    := COALESCE(v_first_batch_harga, v_inv_item.harga_referensi, 0);
        v_harga_pakai_total := v_total_deduction * v_harga_per_unit;

        -- c. Update stok_aktual (boleh minus)
        UPDATE inventory_item
        SET    stok_aktual = stok_aktual - v_total_deduction
        WHERE  id = v_inv_item.id;

        -- d. Warning jika stok minus
        IF (v_inv_item.stok_aktual - v_total_deduction) < 0 THEN
            v_stok_warnings := v_stok_warnings || jsonb_build_object(
                'item_nama', v_inv_item.nama,
                'qty_kurang', abs(v_inv_item.stok_aktual - v_total_deduction),
                'sisa_stok',  v_inv_item.stok_aktual - v_total_deduction
            );
        END IF;

        -- e. INSERT pemakaian_bahan
        IF v_first_bundle_id IS NOT NULL THEN
            INSERT INTO pemakaian_bahan (
                bundle_id, po_item_id, inventory_item_id,
                inventory_batch_id, qty_pakai, rate_per_pcs,
                harga_pakai, tenant_id, created_by
            ) VALUES (
                v_first_bundle_id, v_po_item_id, v_inv_item.id,
                v_first_batch_id, v_total_deduction, v_rate_per_pcs,
                v_harga_pakai_total, p_tenant_id, p_user_id
            )
            ON CONFLICT (bundle_id, inventory_item_id) DO UPDATE
                SET harga_pakai = EXCLUDED.harga_pakai;
        END IF;

        -- f. INSERT jurnal_entry direct_bahan (jika ada nominal)
        IF v_harga_pakai_total > 0 AND v_kategori_id IS NOT NULL THEN
            INSERT INTO jurnal_entry (
                kategori_trx_id,
                jenis,
                nominal,
                tanggal,
                no_faktur,
                keterangan,
                qty,
                inventory_item_id,
                tag_po_ids,
                tenant_id,
                created_by
            ) VALUES (
                v_kategori_id,
                'direct_bahan',
                v_harga_pakai_total,
                CURRENT_DATE,
                'AUTO-BAHAN-' || to_char(CURRENT_DATE, 'YYYYMMDD'),
                'Pemakaian bahan cutting: ' || v_inv_item.nama,
                v_total_deduction,
                v_inv_item.id,
                CASE WHEN v_po_id IS NOT NULL
                     THEN jsonb_build_array(v_po_id::TEXT)
                     ELSE '[]'::jsonb
                END,
                p_tenant_id,
                p_user_id
            );
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
