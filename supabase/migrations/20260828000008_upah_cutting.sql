-- ================================================================
-- MIGRATION: Upah cutting — tukang potong dicatat, upahnya terhitung
--
-- Sampai sekarang cutting TIDAK PERNAH menghasilkan upah sama sekali:
-- gaji_ledger nol entri untuk tahap ini, padahal 724 dari 784 produk
-- sudah punya tarif cutting di HPP (Rp1.500–3.000/pcs). Nilai pekerjaan
-- yang tidak pernah tercatat itu sekitar Rp9,8 juta untuk 4.280 pcs.
--
-- Akarnya bukan sekadar lupa menghitung: proses cutting TIDAK PERNAH
-- MENANYAKAN SIAPA yang mengerjakan. Tahap cutting hanya menyimpan qty,
-- waktu, dan siapa yang mengoperasikan aplikasi — bukan tukang potongnya.
-- Jadi sekalipun upah dihitung, sistem tidak tahu itu milik siapa.
--
-- Perbaikan:
-- 1. selesai_cutting_batch menerima p_karyawan_id, menyimpannya di
--    status_tahap.cutting.karyawan_id, lalu membuat entri upah dari tarif
--    HPP tahap cutting.
-- 2. lanjut_cutting_partial ikut membuat upah untuk potongan susulan.
--
-- Upah hanya dibuat kalau tarif > 0 DAN karyawan terisi — mengikuti
-- pengaman yang sama di scan_selesai, supaya tidak ada baris gaji nol
-- atau gaji tanpa pemilik.
--
-- Parameter karyawan dibuat opsional (DEFAULT NULL) supaya pemanggilan
-- lama yang belum mengirim tukang potong tetap jalan — hanya saja tidak
-- menghasilkan upah, persis seperti perilaku sekarang.
-- ================================================================

CREATE OR REPLACE FUNCTION public.selesai_cutting_batch(
    p_bundle_qty jsonb, p_pemakaian jsonb, p_user_id uuid, p_tenant_id text,
    p_karyawan_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
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
    v_batch           record;
    v_qty_remaining   numeric;
    v_qty_from_batch  numeric;
    v_first_batch_id  uuid;
    v_barcode_dup     text;
    v_status_dup      text;
    v_barcode         text;
    v_produk_id       uuid;
    v_tarif_cutting   numeric;
    v_total_upah      numeric := 0;
BEGIN
    SELECT b.barcode, (b.status_tahap->'cutting'->>'status')
    INTO v_barcode_dup, v_status_dup
    FROM bundle b
    WHERE b.id IN (
      SELECT (elem->>'bundle_id')::uuid FROM jsonb_array_elements(p_bundle_qty) elem
    )
    AND b.tenant_id = p_tenant_id
    AND (b.status_tahap->'cutting'->>'status') IN ('selesai', 'partial')
    LIMIT 1;

    IF v_barcode_dup IS NOT NULL THEN
      IF v_status_dup = 'partial' THEN
        RAISE EXCEPTION 'Bundle % sudah dipotong sebagian — catat potongan susulannya lewat tab Pending, jangan diproses ulang dari sini', v_barcode_dup;
      ELSE
        RAISE EXCEPTION 'Bundle % sudah berstatus Selesai — tidak bisa diproses ulang', v_barcode_dup;
      END IF;
    END IF;

    IF jsonb_array_length(p_bundle_qty) > 0 THEN
        v_first_bundle_id := (p_bundle_qty->0->>'bundle_id')::uuid;
        SELECT b.po_item_id INTO v_po_item_id
        FROM bundle b
        WHERE b.id = v_first_bundle_id AND b.tenant_id = p_tenant_id;
    END IF;

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_bundle_qty)
    LOOP
        v_b_id       := (v_item->>'bundle_id')::uuid;
        v_qty_aktual := (v_item->>'qty_aktual')::int;

        SELECT pi.qty_per_bundle, pi.produk_id, b.barcode
        INTO v_qty_order, v_produk_id, v_barcode
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
                'waktu_selesai', now(),
                'updated_by',    p_user_id,
                'karyawan_id',   p_karyawan_id
            )
        )
        WHERE id = v_b_id AND tenant_id = p_tenant_id;

        -- Upah cutting: hanya kalau tukang potong terisi dan tarifnya ada
        IF p_karyawan_id IS NOT NULL AND v_qty_aktual > 0 THEN
            SELECT hi.harga_satuan INTO v_tarif_cutting
            FROM hpp_item hi
            JOIN hpp_komponen hk ON hk.id = hi.komponen_id
            WHERE hi.produk_id = v_produk_id
              AND hk.tahap_produksi = 'cutting'
              AND hi.tenant_id = p_tenant_id
            LIMIT 1;

            IF v_tarif_cutting IS NOT NULL AND v_tarif_cutting > 0 THEN
                INSERT INTO gaji_ledger (
                    karyawan_id, tipe, total, tanggal, sumber_id,
                    keterangan, status, tenant_id, created_by
                ) VALUES (
                    p_karyawan_id, 'selesai'::gaji_ledger_tipe,
                    v_tarif_cutting * v_qty_aktual, CURRENT_DATE, v_b_id::text,
                    'Upah cutting - ' || v_barcode,
                    'belum_lunas'::gaji_status, p_tenant_id, p_user_id
                );
                v_total_upah := v_total_upah + (v_tarif_cutting * v_qty_aktual);
            END IF;
        END IF;
    END LOOP;

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
            IF v_first_batch_id IS NULL THEN v_first_batch_id := v_batch.id; END IF;
            v_qty_from_batch := LEAST(v_qty_remaining, v_batch.qty_sisa);
            v_qty_remaining  := v_qty_remaining - v_qty_from_batch;
            UPDATE inventory_batch SET qty_sisa = qty_sisa - v_qty_from_batch
            WHERE id = v_batch.id;
        END LOOP;

        IF v_first_batch_id IS NULL OR v_qty_remaining > 0 THEN
            SELECT id INTO v_batch
            FROM inventory_batch
            WHERE inventory_item_id = v_inv_item.id AND tenant_id = p_tenant_id
            ORDER BY tanggal_masuk DESC LIMIT 1;
            IF FOUND THEN v_first_batch_id := COALESCE(v_first_batch_id, v_batch.id); END IF;
        END IF;

        UPDATE inventory_item SET stok_aktual = stok_aktual - v_total_deduction
        WHERE id = v_inv_item.id;

        IF (v_inv_item.stok_aktual - v_total_deduction) < 0 THEN
            v_stok_warnings := v_stok_warnings || jsonb_build_object(
                'item_nama', v_inv_item.nama,
                'qty_kurang', abs(v_inv_item.stok_aktual - v_total_deduction),
                'sisa_stok',  v_inv_item.stok_aktual - v_total_deduction
            );
        END IF;

        IF v_first_bundle_id IS NOT NULL AND v_first_batch_id IS NOT NULL THEN
            INSERT INTO pemakaian_bahan (
                bundle_id, po_item_id, inventory_item_id, inventory_batch_id,
                qty_pakai, rate_per_pcs, tenant_id, created_by
            ) VALUES (
                v_first_bundle_id, v_po_item_id, v_inv_item.id, v_first_batch_id,
                v_total_deduction, v_rate_per_pcs, p_tenant_id, p_user_id
            )
            ON CONFLICT (bundle_id, inventory_item_id) DO NOTHING;
        END IF;
    END LOOP;

    RETURN jsonb_build_object(
        'success',       true,
        'total_qty',     v_total_qty,
        'partial_count', v_partial_count,
        'total_upah',    v_total_upah,
        'stok_warnings', v_stok_warnings
    );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.selesai_cutting_batch(jsonb, jsonb, uuid, text, uuid) TO authenticated;
