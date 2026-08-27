-- ================================================================
-- MIGRATION: Kunci bundle partial dari proses cutting ulang,
--            + RPC untuk mencatat hasil cutting susulan
--
-- BUG 1 (BERISIKO STOK): pengaman anti-potong-ganda di
-- selesai_cutting_batch hanya menolak bundle berstatus 'selesai':
--
--     AND (b.status_tahap->'cutting'->>'status') = 'selesai'
--
-- Bundle 'partial' lolos. Padahal di bagian pemakaian bahan,
-- pengurangan stok dijalankan tanpa syarat:
--
--     UPDATE inventory_item SET stok_aktual = stok_aktual - v_total_deduction
--
-- Jadi bundle partial yang diproses ulang memotong stok kain DUA KALI —
-- persis bug yang dulu diperbaiki untuk status 'selesai', hanya saja
-- 'partial' menyelinap lewat celah yang sama. Nyata terjadi pada
-- PO-0080 Storma Navy XXL & XXXL (partial 8 dari rencana 12).
--
-- BUG 2: selesai_cutting_batch MENIMPA qty_aktual, bukan menambah.
-- Bundle partial yang diproses ulang dengan qty sisa (4) jadi tercatat
-- 4 pcs — bukan 8+4=12 — sehingga 8 pcs yang sudah dipotong hilang.
--
-- ALUR YANG DIPAKAI (rencana 12, terpotong 8, sisa 4):
--   - Yang 8 pcs langsung jalan ke Antrian Jahit (sudah ada barangnya).
--   - Sisa 4 pcs nongkrong di tab Pending dengan dua pilihan:
--       * Close Bundle       -> sisa 4 batal, bundle ditutup di 8 pcs.
--       * Lanjut Cutting     -> 4 pcs dicatat sebagai BUNDLE BARU yang
--                               masuk Antrian Jahit sendiri.
--
-- Kenapa bundle baru, bukan menambah qty bundle lama? Karena yang 8 pcs
-- sudah (atau sedang) dipegang penjahit. Mengubah qty-nya di belakang
-- layar membuat catatan upah dan hasil jahit tidak cocok. Dengan bundle
-- terpisah, yang 8 tidak tersentuh dan sisa 4 bebas dikerjakan penjahit
-- lain. Konvensinya sama seperti Split: parent_bundle_id + akhiran
-- barcode ('c' = cutting susulan).
-- ================================================================

-- ── 1. Pengaman anti-potong-ganda: 'partial' ikut ditolak ────────
CREATE OR REPLACE FUNCTION public.selesai_cutting_batch(
    p_bundle_qty jsonb, p_pemakaian jsonb, p_user_id uuid, p_tenant_id text
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
BEGIN
    -- Tolak kalau ada bundle yang cutting-nya sudah pernah diselesaikan —
    -- baik 'selesai' maupun 'partial'. Keduanya sudah memotong stok bahan;
    -- memprosesnya lagi lewat jalur ini akan memotong stok dua kali DAN
    -- menimpa qty_aktual yang sudah tercatat.
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
                'waktu_selesai', now(),
                'updated_by',    p_user_id
            )
        )
        WHERE id = v_b_id AND tenant_id = p_tenant_id;
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

            IF v_first_batch_id IS NULL THEN
                v_first_batch_id := v_batch.id;
            END IF;

            v_qty_from_batch := LEAST(v_qty_remaining, v_batch.qty_sisa);
            v_qty_remaining  := v_qty_remaining - v_qty_from_batch;

            UPDATE inventory_batch
            SET qty_sisa = qty_sisa - v_qty_from_batch
            WHERE id = v_batch.id;
        END LOOP;

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

        UPDATE inventory_item
        SET stok_aktual = stok_aktual - v_total_deduction
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
        'stok_warnings', v_stok_warnings
    );
END;
$function$;


-- ── 2. Lanjut cutting: sisa dicatat sebagai BUNDLE BARU ──────────
CREATE OR REPLACE FUNCTION public.lanjut_cutting_partial(
    p_bundle_id uuid, p_qty_tambahan int, p_pemakaian jsonb,
    p_user_id uuid, p_tenant_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
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
BEGIN
    SELECT b.id, b.po_id, b.po_item_id, b.barcode, b.no_urut_po,
           b.status_tahap, pi.qty_per_bundle
    INTO v_bundle
    FROM bundle b
    JOIN po_item pi ON pi.id = b.po_item_id
    WHERE b.id = p_bundle_id AND b.tenant_id = p_tenant_id
    FOR UPDATE OF b;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Bundle tidak ditemukan';
    END IF;

    IF (v_bundle.status_tahap->'cutting'->>'status') IS DISTINCT FROM 'partial' THEN
        RAISE EXCEPTION 'Bundle % bukan bundle partial — hanya bundle yang dipotong sebagian yang bisa dilanjutkan', v_bundle.barcode;
    END IF;

    v_qty_rencana := v_bundle.qty_per_bundle;

    -- Total yang sudah terpotong = qty bundle ini + semua susulan sebelumnya.
    -- qty_aktual bundle induk TIDAK pernah diubah — angka itu yang sedang
    -- dikerjakan penjahit.
    SELECT COALESCE((v_bundle.status_tahap->'cutting'->>'qty_aktual')::int, 0)
         + COALESCE((
             SELECT SUM(COALESCE((c.status_tahap->'cutting'->>'qty_aktual')::int, 0))
             FROM bundle c
             WHERE c.parent_bundle_id = p_bundle_id
               AND c.tenant_id = p_tenant_id
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

    -- Bundle baru untuk hasil potongan susulan
    SELECT COUNT(*) INTO v_susulan_count
    FROM bundle
    WHERE barcode LIKE v_bundle.barcode || 'c%' AND tenant_id = p_tenant_id;

    v_new_barcode := v_bundle.barcode || 'c' || (v_susulan_count + 1)::TEXT;

    SELECT COALESCE(MAX(no_urut), 0) + 1 INTO v_new_no_urut
    FROM bundle WHERE po_id = v_bundle.po_id AND tenant_id = p_tenant_id;

    INSERT INTO bundle (
        barcode, po_id, po_item_id, no_urut, no_urut_po,
        parent_bundle_id, status_tahap, tenant_id, created_by
    )
    VALUES (
        v_new_barcode, v_bundle.po_id, v_bundle.po_item_id, v_new_no_urut,
        v_bundle.no_urut_po, p_bundle_id,
        jsonb_build_object('cutting', jsonb_build_object(
            'status',        'selesai',
            'qty_aktual',    p_qty_tambahan,
            'waktu_selesai', now(),
            'updated_by',    p_user_id,
            'susulan_dari',  v_bundle.barcode
        )),
        p_tenant_id, p_user_id
    )
    RETURNING id INTO v_new_bundle_id;

    -- Kalau seluruh sisa sudah terpotong, bundle induk ditutup supaya keluar
    -- dari tab Pending. Qty-nya tetap seperti semula.
    v_sisa_baru := v_sisa - p_qty_tambahan;
    IF v_sisa_baru <= 0 THEN
        v_parent_status := 'selesai';
        UPDATE bundle
        SET status_tahap = jsonb_set(
            status_tahap, '{cutting}',
            (status_tahap->'cutting') || jsonb_build_object(
                'status',    'selesai',
                'closed_at', now(),
                'closed_by', p_user_id
            )
        )
        WHERE id = p_bundle_id AND tenant_id = p_tenant_id;
    ELSE
        v_parent_status := 'partial';
    END IF;

    -- Potong stok HANYA untuk qty susulan, dicatat atas nama bundle baru
    FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_pemakaian, '[]'::jsonb))
    LOOP
        v_rate_per_pcs    := (v_item->>'rate_per_pcs')::numeric;
        v_total_deduction := v_rate_per_pcs * p_qty_tambahan;

        IF v_total_deduction <= 0 THEN CONTINUE; END IF;

        SELECT id, nama, stok_aktual INTO v_inv_item
        FROM inventory_item
        WHERE id = (v_item->>'inventory_item_id')::uuid
          AND tenant_id = p_tenant_id;

        IF NOT FOUND THEN CONTINUE; END IF;

        v_qty_remaining  := v_total_deduction;
        v_first_batch_id := NULL;

        FOR v_batch IN
            SELECT id, qty_sisa
            FROM inventory_batch
            WHERE inventory_item_id = v_inv_item.id
              AND tenant_id = p_tenant_id
              AND qty_sisa > 0
            ORDER BY tanggal_masuk ASC
        LOOP
            EXIT WHEN v_qty_remaining <= 0;
            IF v_first_batch_id IS NULL THEN
                v_first_batch_id := v_batch.id;
            END IF;
            v_qty_from_batch := LEAST(v_qty_remaining, v_batch.qty_sisa);
            v_qty_remaining  := v_qty_remaining - v_qty_from_batch;
            UPDATE inventory_batch
            SET qty_sisa = qty_sisa - v_qty_from_batch
            WHERE id = v_batch.id;
        END LOOP;

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

        UPDATE inventory_item
        SET stok_aktual = stok_aktual - v_total_deduction
        WHERE id = v_inv_item.id;

        IF (v_inv_item.stok_aktual - v_total_deduction) < 0 THEN
            v_stok_warnings := v_stok_warnings || jsonb_build_object(
                'item_nama',  v_inv_item.nama,
                'qty_kurang', abs(v_inv_item.stok_aktual - v_total_deduction),
                'sisa_stok',  v_inv_item.stok_aktual - v_total_deduction
            );
        END IF;

        IF v_first_batch_id IS NOT NULL THEN
            INSERT INTO pemakaian_bahan (
                bundle_id, po_item_id, inventory_item_id, inventory_batch_id,
                qty_pakai, rate_per_pcs, tenant_id, created_by
            ) VALUES (
                v_new_bundle_id, v_bundle.po_item_id, v_inv_item.id, v_first_batch_id,
                v_total_deduction, v_rate_per_pcs, p_tenant_id, p_user_id
            )
            ON CONFLICT (bundle_id, inventory_item_id) DO NOTHING;
        END IF;
    END LOOP;

    RETURN jsonb_build_object(
        'success',           true,
        'new_bundle_id',     v_new_bundle_id,
        'new_bundle_barcode', v_new_barcode,
        'qty_tambahan',      p_qty_tambahan,
        'qty_terpotong',     v_qty_terpotong + p_qty_tambahan,
        'qty_rencana',       v_qty_rencana,
        'sisa_baru',         GREATEST(v_sisa_baru, 0),
        'parent_status',     v_parent_status,
        'stok_warnings',     v_stok_warnings
    );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.lanjut_cutting_partial(uuid, int, jsonb, uuid, text) TO authenticated;

-- Rancangan sebelumnya (menambah qty ke bundle induk) dibatalkan: bentrok
-- dengan bundle yang sudah dipegang penjahit.
DROP FUNCTION IF EXISTS public.tambah_hasil_cutting(uuid, int, jsonb, uuid, text);
