-- Kembalikan bundle dari Antrian Jahit ke "Sedang Dipotong" (salah klik
-- Selesai Cutting). Membalik semua yang dicatat selesai_cutting_v2:
-- upah tukang potong, pemakaian bahan + stok kain (per batch), bundle sisa
-- yang dibuat otomatis (digabung kembali bila belum dipotong).
CREATE OR REPLACE FUNCTION public.batal_selesai_cutting(
  p_bundle_ids uuid[], p_alasan text, p_user_id uuid, p_tenant_id text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_b       RECORD;
  v_c       jsonb;
  v_pb      RECORD;
  v_batch   RECORD;
  v_sisa    numeric;
  v_ambil   numeric;
  v_gabung  int;
  v_hapus   text[];
  v_upah    jsonb;
  v_bahan   jsonb;
  v_n       int := 0;
BEGIN
  IF p_alasan IS NULL OR trim(p_alasan) = '' THEN RAISE EXCEPTION 'Alasan wajib diisi'; END IF;
  IF COALESCE(array_length(p_bundle_ids, 1), 0) = 0 THEN RAISE EXCEPTION 'Tidak ada bundle dipilih'; END IF;

  FOR v_b IN
    SELECT b.id, b.barcode, b.status_tahap, b.qty_rencana, b.ditutup_at, b.parent_bundle_id
    FROM bundle b
    WHERE b.id = ANY(p_bundle_ids) AND b.tenant_id = p_tenant_id
    ORDER BY b.barcode FOR UPDATE OF b
  LOOP
    v_c := v_b.status_tahap -> 'cutting';

    -- ── Pengaman ────────────────────────────────────────────────────
    IF v_b.ditutup_at IS NOT NULL THEN
      RAISE EXCEPTION 'Bundle % sudah ditutup (data lama)', v_b.barcode;
    END IF;
    IF COALESCE(v_c ->> 'status', '') <> 'selesai' THEN
      RAISE EXCEPTION 'Bundle % tidak berstatus selesai cutting — muat ulang halaman', v_b.barcode;
    END IF;
    IF v_b.status_tahap ? 'jahit' THEN
      RAISE EXCEPTION 'Bundle % sudah diserahkan ke penjahit — batalkan serah terima dulu', v_b.barcode;
    END IF;
    IF v_b.parent_bundle_id IS NOT NULL THEN
      RAISE EXCEPTION 'Bundle % adalah pecahan Split — tidak bisa dikembalikan ke Cutting', v_b.barcode;
    END IF;
    IF EXISTS (SELECT 1 FROM bundle c WHERE c.parent_bundle_id = v_b.id AND c.tenant_id = p_tenant_id) THEN
      RAISE EXCEPTION 'Bundle % sudah pernah di-Split — tidak bisa dikembalikan ke Cutting', v_b.barcode;
    END IF;
    IF EXISTS (
      SELECT 1 FROM gaji_ledger gl
      WHERE gl.tenant_id = p_tenant_id AND gl.sumber_id = v_b.id::text
        AND gl.keterangan LIKE 'Upah cutting - %' AND gl.status IN ('lunas', 'escrow')) THEN
      RAISE EXCEPTION 'Upah cutting bundle % sudah dibayar — tidak bisa dikembalikan', v_b.barcode;
    END IF;

    -- ── Upah tukang potong ──────────────────────────────────────────
    SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, 'total', total, 'keterangan', keterangan)), '[]'::jsonb)
    INTO v_upah
    FROM gaji_ledger
    WHERE tenant_id = p_tenant_id AND sumber_id = v_b.id::text
      AND keterangan LIKE 'Upah cutting - %' AND status <> 'cancelled';
    UPDATE gaji_ledger SET status = 'cancelled'
    WHERE tenant_id = p_tenant_id AND sumber_id = v_b.id::text
      AND keterangan LIKE 'Upah cutting - %' AND status <> 'cancelled';

    -- ── Bahan: kembalikan stok & batch, hapus riwayat pemakaian ────
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'inventory_item_id', inventory_item_id, 'qty_pakai', qty_pakai,
             'rate_per_pcs', rate_per_pcs, 'harga_pakai', harga_pakai)), '[]'::jsonb)
    INTO v_bahan FROM pemakaian_bahan WHERE bundle_id = v_b.id;

    FOR v_pb IN
      SELECT id, inventory_item_id, qty_pakai FROM pemakaian_bahan
      WHERE bundle_id = v_b.id FOR UPDATE
    LOOP
      IF COALESCE(v_pb.qty_pakai, 0) > 0 THEN
        UPDATE inventory_item SET stok_aktual = stok_aktual + v_pb.qty_pakai
        WHERE id = v_pb.inventory_item_id AND tenant_id = p_tenant_id;

        -- Batch hanya diisi sebanyak yang dulu benar-benar diambil dari
        -- batch. Bila waktu itu stok batch habis (stok jadi minus), bagian
        -- itu tidak pernah memotong batch → jumlah batch tidak boleh
        -- melebihi stok_aktual setelah dikembalikan.
        SELECT LEAST(v_pb.qty_pakai, GREATEST(0, i.stok_aktual - COALESCE(
                 (SELECT SUM(qty_sisa) FROM inventory_batch
                  WHERE inventory_item_id = v_pb.inventory_item_id AND tenant_id = p_tenant_id), 0)))
        INTO v_sisa
        FROM inventory_item i WHERE i.id = v_pb.inventory_item_id;

        -- FIFO memakai batch terlama dulu → kembalikan mulai batch
        -- terbaru yang sudah terpakai (kebalikan urutan pemakaian).
        FOR v_batch IN
          SELECT id, qty_awal, qty_sisa FROM inventory_batch
          WHERE inventory_item_id = v_pb.inventory_item_id AND tenant_id = p_tenant_id
            AND qty_sisa < qty_awal
          ORDER BY tanggal_masuk DESC, created_at DESC
          FOR UPDATE
        LOOP
          EXIT WHEN v_sisa <= 0;
          v_ambil := LEAST(v_batch.qty_awal - v_batch.qty_sisa, v_sisa);
          UPDATE inventory_batch SET qty_sisa = qty_sisa + v_ambil WHERE id = v_batch.id;
          v_sisa := v_sisa - v_ambil;
        END LOOP;
      END IF;
      DELETE FROM pemakaian_bahan WHERE id = v_pb.id;
    END LOOP;

    -- ── Bundle sisa otomatis: gabung kembali bila belum dipotong ───
    SELECT COALESCE(SUM(qty_rencana), 0)::int, array_agg(barcode)
    INTO v_gabung, v_hapus
    FROM bundle
    WHERE sisa_dari_bundle_id = v_b.id AND tenant_id = p_tenant_id
      AND status_tahap -> 'cutting' IS NULL AND ditutup_at IS NULL;
    DELETE FROM bundle
    WHERE sisa_dari_bundle_id = v_b.id AND tenant_id = p_tenant_id
      AND status_tahap -> 'cutting' IS NULL AND ditutup_at IS NULL;

    -- ── Status: kembali ke Sedang Dipotong ─────────────────────────
    UPDATE bundle
    SET qty_rencana  = COALESCE(qty_rencana, 0) + v_gabung,
        status_tahap = jsonb_set(status_tahap, '{cutting}', jsonb_build_object(
          'status',     'progress',
          'start_time', COALESCE(v_c -> 'start_time', to_jsonb(now())),
          'updated_by', p_user_id,
          'qty_mulai',  COALESCE(v_b.qty_rencana, 0) + v_gabung))
    WHERE id = v_b.id;

    INSERT INTO audit_log (user_id, modul, aksi, target, metadata, tenant_id)
    VALUES (p_user_id, 'produksi', 'Batal Selesai Cutting', v_b.barcode,
      jsonb_build_object(
        'bundle_id', v_b.id, 'cutting_lama', v_c,
        'upah_dibatalkan', v_upah, 'bahan_dikembalikan', v_bahan,
        'sisa_digabung', v_gabung, 'bundle_sisa_dihapus', v_hapus,
        'alasan', trim(p_alasan)),
      p_tenant_id);

    v_n := v_n + 1;
  END LOOP;

  IF v_n <> array_length(p_bundle_ids, 1) THEN RAISE EXCEPTION 'Sebagian bundle tidak ditemukan'; END IF;
  RETURN jsonb_build_object('jumlah', v_n);
END;
$$;
