-- ================================================================
-- MIGRATION: Koreksi serah terima jahit (ganti penjahit / koreksi qty)
--
-- Konteks: setelah bundle diserahterimakan ke penjahit (status jahit
-- 'terima'), tidak ada jalan keluar kalau salah pilih penjahit atau
-- salah isi qty. Fungsi ini mengoreksi keduanya di tempat — bundle
-- tetap di tab Sedang Proses.
--
-- Efek koreksi qty pada aksesori tahap jahit (mengikuti rumus yang sama
-- dengan scan_jahit_terima: qty_per_pcs x qty, dari model_aksesori dan
-- warna_aksesori):
--   - Qty naik  → selisihnya dipotong lewat consume_fifo_atomic (stok,
--                 batch FIFO, jurnal direct_bahan), lalu pemakaian_aksesori
--                 bundle ini ditambah.
--   - Qty turun → selisihnya dikembalikan: stok_aktual naik, qty_sisa
--                 dikembalikan ke batch terbaru yang pernah terpakai,
--                 jurnal direct_bahan PO ini dikurangi (dari entri terbaru,
--                 nominal proporsional), pemakaian_aksesori dikurangi.
--
-- Ditolak kalau upah jahit bundle ini sudah dibayar dimuka (ada entri
-- gaji_ledger "Upah jahit - <barcode>" yang tidak cancelled) — harus
-- dibereskan dulu di penggajian supaya uang tidak salah orang/nominal.
--
-- Semua koreksi dicatat di audit_log (sebelum/sesudah + alasan), dan
-- baris scan_log 'terima' jahit bundle ini ikut diperbarui supaya
-- monitoring/kroscek membaca penjahit & qty yang benar.
-- ================================================================

CREATE OR REPLACE FUNCTION public.koreksi_serah_terima_jahit(
  p_bundle_id   uuid,
  p_karyawan_id uuid,
  p_qty         numeric,
  p_alasan      text,
  p_user_id     uuid,
  p_tenant_id   text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_bundle               RECORD;
  v_jahit                JSONB;
  v_karyawan_lama        UUID;
  v_qty_lama             NUMERIC;
  v_qty_maks             NUMERIC;
  v_delta                NUMERIC;
  v_warna_id             UUID;
  v_kategori_aksesori_id UUID;
  v_aksesori             RECORD;
  v_jumlah               NUMERIC;
  v_sisa                 NUMERIC;
  v_ambil                NUMERIC;
  v_batch                RECORD;
  v_jurnal               RECORD;
  v_ada_pemakaian        BOOLEAN;
  v_consume_result       JSONB;
  v_stok_warnings        JSONB := '[]'::JSONB;
  v_dimuka               RECORD;
  v_nama_dimuka          TEXT;
BEGIN
  SELECT b.id, b.barcode, b.po_item_id, b.status_tahap,
         pi.po_id, pi.warna, pi.qty_per_bundle, produk.model_id
  INTO v_bundle
  FROM bundle b
  JOIN po_item pi ON pi.id = b.po_item_id
  JOIN produk     ON produk.id = pi.produk_id
  WHERE b.id = p_bundle_id AND b.tenant_id = p_tenant_id
  FOR UPDATE OF b;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bundle tidak ditemukan';
  END IF;

  v_jahit := v_bundle.status_tahap -> 'jahit';
  IF (v_jahit ->> 'status') IS DISTINCT FROM 'terima' THEN
    RAISE EXCEPTION 'Bundle % tidak sedang dikerjakan di tahap Jahit — hanya bundle di Sedang Proses yang bisa dikoreksi', v_bundle.barcode;
  END IF;

  -- Upah sudah dibayar dimuka → tolak
  SELECT gl.karyawan_id, gl.total INTO v_dimuka
  FROM gaji_ledger gl
  WHERE gl.tenant_id = p_tenant_id
    AND gl.sumber_id = v_bundle.id::text
    AND gl.keterangan LIKE 'Upah jahit - %'
    AND gl.status <> 'cancelled'
  LIMIT 1;

  IF FOUND THEN
    SELECT nama INTO v_nama_dimuka FROM karyawan WHERE id = v_dimuka.karyawan_id;
    RAISE EXCEPTION 'Upah jahit bundle % sudah dibayar dimuka ke % (Rp%). Batalkan dulu entri upahnya di Penggajian sebelum mengoreksi.',
      v_bundle.barcode, COALESCE(v_nama_dimuka, '-'), to_char(v_dimuka.total, 'FM999G999G999');
  END IF;

  IF p_karyawan_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM karyawan WHERE id = p_karyawan_id AND tenant_id = p_tenant_id AND aktif = TRUE
  ) THEN
    RAISE EXCEPTION 'Penjahit tidak ditemukan atau tidak aktif';
  END IF;

  v_karyawan_lama := NULLIF(v_jahit ->> 'karyawan_id', '')::uuid;
  v_qty_lama      := COALESCE((v_jahit ->> 'qty_terima')::numeric, 0);
  v_qty_maks      := COALESCE((v_bundle.status_tahap -> 'cutting' ->> 'qty_aktual')::numeric,
                              v_bundle.qty_per_bundle);

  IF p_qty IS NULL OR p_qty < 1 OR p_qty <> trunc(p_qty) THEN
    RAISE EXCEPTION 'Qty harus bilangan bulat minimal 1';
  END IF;
  IF v_qty_maks IS NOT NULL AND p_qty > v_qty_maks THEN
    RAISE EXCEPTION 'Qty tidak boleh melebihi hasil cutting (% pcs)', v_qty_maks;
  END IF;

  IF p_karyawan_id IS NOT DISTINCT FROM v_karyawan_lama AND p_qty = v_qty_lama THEN
    RAISE EXCEPTION 'Tidak ada perubahan';
  END IF;

  v_delta := p_qty - v_qty_lama;

  -- ── Sesuaikan aksesori tahap jahit ─────────────────────────────
  IF v_delta <> 0 THEN
    SELECT id INTO v_kategori_aksesori_id
    FROM kategori_trx
    WHERE nama = 'Pembelian Aksesori' AND jenis = 'direct_bahan'
      AND aktif = TRUE AND tenant_id = p_tenant_id
    LIMIT 1;

    SELECT id INTO v_warna_id
    FROM warna
    WHERE LOWER(nama) = LOWER(v_bundle.warna) AND tenant_id = p_tenant_id
    LIMIT 1;

    FOR v_aksesori IN
      SELECT ma.inventory_item_id, ma.qty_per_pcs
      FROM model_aksesori ma
      WHERE ma.model_id = v_bundle.model_id AND ma.tenant_id = p_tenant_id
        AND ma.tahap_pakai = 'jahit'
        AND (ma.warna_id IS NULL OR ma.warna_id = v_warna_id)
      UNION ALL
      SELECT wa.inventory_item_id, wa.qty_per_pcs
      FROM warna_aksesori wa
      WHERE v_warna_id IS NOT NULL AND wa.warna_id = v_warna_id
        AND wa.tenant_id = p_tenant_id AND wa.tahap_pakai = 'jahit'
    LOOP
      v_jumlah := v_aksesori.qty_per_pcs * abs(v_delta);
      CONTINUE WHEN v_jumlah <= 0;

      IF v_delta > 0 THEN
        -- Potong tambahan. consume_fifo_atomic hanya INSERT pemakaian_aksesori
        -- (ON CONFLICT DO NOTHING), jadi kalau barisnya sudah ada, tambah manual.
        SELECT EXISTS (
          SELECT 1 FROM pemakaian_aksesori
          WHERE bundle_id = v_bundle.id AND inventory_item_id = v_aksesori.inventory_item_id
            AND tahap = 'jahit'
        ) INTO v_ada_pemakaian;

        v_consume_result := consume_fifo_atomic(
          v_aksesori.inventory_item_id, v_jumlah, v_bundle.po_item_id,
          v_bundle.id, v_aksesori.qty_per_pcs, p_user_id, p_tenant_id,
          v_kategori_aksesori_id, 'jahit'
        );

        IF v_ada_pemakaian THEN
          UPDATE pemakaian_aksesori
          SET qty_pakai = qty_pakai + v_jumlah
          WHERE bundle_id = v_bundle.id AND inventory_item_id = v_aksesori.inventory_item_id
            AND tahap = 'jahit';
        END IF;

        IF v_consume_result ->> 'status' = 'stok_kurang' THEN
          v_stok_warnings := v_stok_warnings || jsonb_build_object(
            'item_nama',  v_consume_result ->> 'item_nama',
            'qty_kurang', v_consume_result -> 'qty_kurang',
            'sisa_stok',  v_consume_result -> 'sisa_stok'
          );
        END IF;

      ELSE
        -- Kembalikan selisih ke stok
        UPDATE inventory_item
        SET stok_aktual = stok_aktual + v_jumlah
        WHERE id = v_aksesori.inventory_item_id AND tenant_id = p_tenant_id;

        -- Kebalikan FIFO: isi lagi batch terbaru yang pernah terpakai
        v_sisa := v_jumlah;
        FOR v_batch IN
          SELECT id, qty_awal, qty_sisa
          FROM inventory_batch
          WHERE inventory_item_id = v_aksesori.inventory_item_id
            AND tenant_id = p_tenant_id AND qty_sisa < qty_awal
          ORDER BY tanggal_masuk DESC, created_at DESC
          FOR UPDATE
        LOOP
          EXIT WHEN v_sisa <= 0;
          v_ambil := LEAST(v_batch.qty_awal - v_batch.qty_sisa, v_sisa);
          UPDATE inventory_batch SET qty_sisa = qty_sisa + v_ambil WHERE id = v_batch.id;
          v_sisa := v_sisa - v_ambil;
        END LOOP;

        -- Kurangi biaya bahan PO ini (entri terbaru dulu, nominal proporsional)
        v_sisa := v_jumlah;
        FOR v_jurnal IN
          SELECT id, qty, nominal
          FROM jurnal_entry
          WHERE tenant_id = p_tenant_id AND jenis = 'direct_bahan'
            AND inventory_item_id = v_aksesori.inventory_item_id
            AND tag_po_ids @> jsonb_build_array(v_bundle.po_id::text)
            AND qty > 0
          ORDER BY created_at DESC
          FOR UPDATE
        LOOP
          EXIT WHEN v_sisa <= 0;
          v_ambil := LEAST(v_jurnal.qty, v_sisa);
          IF v_ambil >= v_jurnal.qty THEN
            DELETE FROM jurnal_entry WHERE id = v_jurnal.id;
          ELSE
            UPDATE jurnal_entry
            SET qty     = qty - v_ambil,
                nominal = GREATEST(round(nominal - nominal * v_ambil / v_jurnal.qty, 2), 0)
            WHERE id = v_jurnal.id;
          END IF;
          v_sisa := v_sisa - v_ambil;
        END LOOP;

        UPDATE pemakaian_aksesori
        SET qty_pakai = GREATEST(qty_pakai - v_jumlah, 0)
        WHERE bundle_id = v_bundle.id AND inventory_item_id = v_aksesori.inventory_item_id
          AND tahap = 'jahit';
      END IF;
    END LOOP;
  END IF;

  -- ── Update status bundle & scan_log terima ─────────────────────
  UPDATE bundle
  SET status_tahap = jsonb_set(
        status_tahap, '{jahit}',
        (status_tahap -> 'jahit')
          || jsonb_build_object('karyawan_id', p_karyawan_id, 'qty_terima', p_qty)
      )
  WHERE id = v_bundle.id;

  UPDATE scan_log
  SET karyawan_id = p_karyawan_id,
      qty         = p_qty::int,
      catatan     = concat_ws(' | ', NULLIF(catatan, ''),
                      'Dikoreksi ' || to_char(now() AT TIME ZONE 'Asia/Jakarta', 'DD/MM HH24:MI'))
  WHERE id = (
    SELECT id FROM scan_log
    WHERE bundle_id = v_bundle.id AND tahap = 'jahit' AND tipe = 'terima'
      AND tenant_id = p_tenant_id
    ORDER BY created_at DESC
    LIMIT 1
  );

  INSERT INTO audit_log (user_id, modul, aksi, target, metadata, tenant_id)
  VALUES (
    p_user_id, 'produksi', 'Koreksi Serah Terima Jahit', v_bundle.barcode,
    jsonb_build_object(
      'bundle_id',          v_bundle.id,
      'karyawan_id_lama',   v_karyawan_lama,
      'karyawan_id_baru',   p_karyawan_id,
      'qty_lama',           v_qty_lama,
      'qty_baru',           p_qty,
      'alasan',             NULLIF(trim(COALESCE(p_alasan, '')), ''),
      'stok_warnings',      v_stok_warnings
    ),
    p_tenant_id
  );

  RETURN jsonb_build_object(
    'qty_lama',      v_qty_lama,
    'qty_baru',      p_qty,
    'stok_warnings', v_stok_warnings
  );
END;
$function$;
