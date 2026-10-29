-- ================================================================
-- MIGRATION: Koreksi hasil cutting untuk bundle di Antrian Jahit
--
-- Konteks: salah input qty hasil cutting sering baru ketahuan saat bundle
-- sudah antre di tahap jahit (belum diserahterimakan). Fungsi ini
-- membetulkan qty cutting bundle tersebut — naik maupun turun — tanpa
-- menyentuh tahap jahit (belum ada penjahit/aksesori jahit terpotong).
--
-- Efek:
--   - status_tahap.cutting.qty_aktual bundle = qty baru. Kalau bundle ini
--     induk hasil Split, qty_dipotong (dasar upah) ikut bergeser selisihnya.
--   - Status cutting: 'selesai' kalau total dipotong >= rencana PO atau
--     bundle sudah pernah di-Close (closed_at); selain itu 'partial'
--     (muncul di tab Pending Cutting dengan sisa yang benar).
--   - Upah cutting (gaji_ledger "Upah cutting - <barcode>"):
--       naik  → belum lunas: nominal ditambah; sudah lunas: entri baru
--               "(koreksi +N pcs)" berstatus belum lunas.
--       turun → belum lunas: nominal dikurangi; sudah lunas: DITOLAK
--               (kelebihan bayar harus dibereskan manual di penggajian).
--   - Dicatat di audit_log.
--
-- Ditolak kalau bundle sudah diserahterimakan ke jahit (pakai Edit di
-- Sedang Proses) atau punya potongan susulan (Lanjut Cutting).
-- ================================================================

CREATE OR REPLACE FUNCTION public.koreksi_hasil_cutting(
  p_bundle_id uuid,
  p_qty       numeric,
  p_alasan    text,
  p_user_id   uuid,
  p_tenant_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_bundle        RECORD;
  v_cutting       JSONB;
  v_qty_lama      NUMERIC;
  v_delta         NUMERIC;
  v_pakai_dipotong BOOLEAN;
  v_total_lama    NUMERIC;
  v_total_baru    NUMERIC;
  v_status_lama   TEXT;
  v_status_baru   TEXT;
  v_tarif         NUMERIC;
  v_upah          RECORD;
  v_upah_selisih  NUMERIC := 0;
  v_upah_aksi     TEXT := NULL;
BEGIN
  SELECT b.id, b.barcode, b.status_tahap, pi.qty_per_bundle, pi.produk_id
  INTO v_bundle
  FROM bundle b
  JOIN po_item pi ON pi.id = b.po_item_id
  WHERE b.id = p_bundle_id AND b.tenant_id = p_tenant_id
  FOR UPDATE OF b;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bundle tidak ditemukan';
  END IF;

  v_cutting := v_bundle.status_tahap -> 'cutting';
  v_status_lama := v_cutting ->> 'status';

  IF v_status_lama IS NULL OR v_status_lama NOT IN ('selesai', 'partial') THEN
    RAISE EXCEPTION 'Bundle % belum selesai cutting', v_bundle.barcode;
  END IF;

  IF (v_bundle.status_tahap -> 'jahit' ->> 'status') IS NOT NULL THEN
    RAISE EXCEPTION 'Bundle % sudah diserahterimakan ke penjahit — koreksi lewat tombol Edit di tab Sedang Proses', v_bundle.barcode;
  END IF;

  IF EXISTS (
    SELECT 1 FROM bundle c
    WHERE c.parent_bundle_id = v_bundle.id AND c.barcode LIKE v_bundle.barcode || 'c%'
  ) THEN
    RAISE EXCEPTION 'Bundle % punya potongan susulan (Lanjut Cutting) — koreksi cutting tidak bisa otomatis, hubungi admin', v_bundle.barcode;
  END IF;

  IF p_qty IS NULL OR p_qty < 1 OR p_qty <> trunc(p_qty) THEN
    RAISE EXCEPTION 'Qty harus bilangan bulat minimal 1';
  END IF;

  v_qty_lama := COALESCE((v_cutting ->> 'qty_aktual')::numeric, 0);
  IF p_qty = v_qty_lama THEN
    RAISE EXCEPTION 'Tidak ada perubahan';
  END IF;
  v_delta := p_qty - v_qty_lama;

  -- Total dipotong (dasar upah & status): qty_dipotong kalau induk hasil Split
  v_pakai_dipotong := v_cutting ? 'qty_dipotong';
  v_total_lama := CASE WHEN v_pakai_dipotong
                       THEN (v_cutting ->> 'qty_dipotong')::numeric
                       ELSE v_qty_lama END;
  v_total_baru := v_total_lama + v_delta;

  v_status_baru := CASE
    WHEN v_total_baru >= v_bundle.qty_per_bundle OR (v_cutting ? 'closed_at') THEN 'selesai'
    ELSE 'partial'
  END;

  -- ── Upah cutting ───────────────────────────────────────────────
  SELECT hi.harga_satuan INTO v_tarif
  FROM hpp_item hi
  JOIN hpp_komponen hk ON hk.id = hi.komponen_id
  WHERE hi.produk_id = v_bundle.produk_id AND hk.tahap_produksi = 'cutting'
    AND hi.tenant_id = p_tenant_id
  LIMIT 1;

  SELECT gl.id, gl.karyawan_id, gl.status, gl.total INTO v_upah
  FROM gaji_ledger gl
  WHERE gl.tenant_id = p_tenant_id AND gl.sumber_id = v_bundle.id::text
    AND gl.keterangan LIKE 'Upah cutting - %' AND gl.status <> 'cancelled'
  ORDER BY gl.created_at
  LIMIT 1;

  IF FOUND AND COALESCE(v_tarif, 0) > 0 THEN
    v_upah_selisih := v_tarif * v_delta;

    IF v_upah.status = 'belum_lunas' THEN
      IF v_upah.total + v_upah_selisih < 0 THEN
        RAISE EXCEPTION 'Upah cutting bundle % tidak cukup untuk dikurangi Rp% — cek di Penggajian',
          v_bundle.barcode, to_char(abs(v_upah_selisih), 'FM999G999G999');
      END IF;
      UPDATE gaji_ledger SET total = total + v_upah_selisih WHERE id = v_upah.id;
      v_upah_aksi := CASE WHEN v_delta > 0 THEN 'ditambah' ELSE 'dikurangi' END;

    ELSIF v_delta > 0 THEN
      INSERT INTO gaji_ledger (
        karyawan_id, tipe, total, tanggal, sumber_id,
        keterangan, status, tenant_id, created_by
      ) VALUES (
        v_upah.karyawan_id, 'selesai'::gaji_ledger_tipe, v_upah_selisih, CURRENT_DATE,
        v_bundle.id::text,
        'Upah cutting - ' || v_bundle.barcode || ' (koreksi +' || v_delta || ' pcs)',
        'belum_lunas'::gaji_status, p_tenant_id, p_user_id
      );
      v_upah_aksi := 'entri_baru';

    ELSE
      RAISE EXCEPTION 'Upah cutting bundle % sudah dibayar — kelebihan bayar Rp% untuk % pcs harus dibereskan dulu di Penggajian',
        v_bundle.barcode, to_char(abs(v_upah_selisih), 'FM999G999G999'), abs(v_delta);
    END IF;
  END IF;

  -- ── Update bundle ──────────────────────────────────────────────
  UPDATE bundle
  SET status_tahap = jsonb_set(status_tahap, '{cutting}',
        (status_tahap -> 'cutting')
        || jsonb_build_object('qty_aktual', p_qty, 'status', v_status_baru)
        || CASE WHEN v_pakai_dipotong
                THEN jsonb_build_object('qty_dipotong', v_total_baru)
                ELSE '{}'::jsonb END)
  WHERE id = v_bundle.id;

  INSERT INTO audit_log (user_id, modul, aksi, target, metadata, tenant_id)
  VALUES (
    p_user_id, 'produksi', 'Koreksi Hasil Cutting', v_bundle.barcode,
    jsonb_build_object(
      'bundle_id',      v_bundle.id,
      'qty_lama',       v_qty_lama,
      'qty_baru',       p_qty,
      'total_dipotong', v_total_baru,
      'status_lama',    v_status_lama,
      'status_baru',    v_status_baru,
      'upah_selisih',   v_upah_selisih,
      'upah_aksi',      v_upah_aksi,
      'alasan',         NULLIF(trim(COALESCE(p_alasan, '')), '')
    ),
    p_tenant_id
  );

  RETURN jsonb_build_object(
    'qty_lama',     v_qty_lama,
    'qty_baru',     p_qty,
    'status_baru',  v_status_baru,
    'upah_selisih', v_upah_selisih,
    'upah_aksi',    v_upah_aksi
  );
END;
$function$;
