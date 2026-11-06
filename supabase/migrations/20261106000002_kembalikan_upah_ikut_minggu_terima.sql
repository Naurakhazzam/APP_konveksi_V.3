-- ================================================================
-- MIGRATION: KEMBALIKAN aturan upah ikut minggu bundle DITERIMA
--
-- Membatalkan 20261106000001. Praktik di lapangan: setiap Sabtu SEMUA
-- upah minggu sebelumnya dibayar tunai, termasuk jahit yang masih
-- sedang dikerjakan. Jadi bundle yang diterima minggu lalu dan baru
-- selesai minggu ini SUDAH dibayar — kalau upahnya dicatat di minggu
-- selesai, akan terbayar dua kali. Aturan 20260829000007 (tanggal upah
-- = tanggal terima bila beda minggu) adalah yang benar.
-- ================================================================

CREATE OR REPLACE FUNCTION public.scan_selesai(
  p_barcode text, p_tahap tahap_produksi, p_karyawan_id uuid, p_qty integer,
  p_catatan text, p_alasan_qty_id uuid, p_user_id uuid, p_tenant_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_bundle              RECORD;
  v_tahap_status        TEXT;
  v_qty_terima          INT;
  v_resolved_karyawan   UUID;
  v_scan_log_id         UUID;
  v_gaji_entry_id       UUID := NULL;
  v_upah                NUMERIC := 0;
  v_rate                NUMERIC;
  v_tahap_text          TEXT := p_tahap::TEXT;
  v_approval_request_id UUID := NULL;
  v_is_qty_lebih        BOOLEAN := false;
  v_sudah_dibayar_dimuka BOOLEAN := false;
  v_waktu_terima        date;
  v_tanggal_upah        date;
BEGIN
  SELECT b.id, b.po_item_id, b.status_tahap, b.barcode, pi.produk_id
  INTO v_bundle
  FROM bundle b
  JOIN po_item pi ON pi.id = b.po_item_id
  WHERE b.barcode = p_barcode
    AND b.tenant_id = p_tenant_id
  FOR UPDATE OF b;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Barcode tidak ditemukan: %', p_barcode;
  END IF;

  v_tahap_status := v_bundle.status_tahap -> v_tahap_text ->> 'status';
  v_qty_terima   := (v_bundle.status_tahap -> v_tahap_text ->> 'qty_terima')::INT;
  v_waktu_terima := (v_bundle.status_tahap -> v_tahap_text ->> 'waktu_terima')::date;

  IF v_tahap_status IS NULL THEN
    RAISE EXCEPTION 'Bundle belum diterima di tahap ini: %', v_tahap_text;
  END IF;
  IF v_tahap_status = 'selesai' THEN
    RAISE EXCEPTION 'Bundle sudah selesai di tahap ini: %', v_tahap_text;
  END IF;
  IF p_qty < v_qty_terima AND p_alasan_qty_id IS NULL THEN
    RAISE EXCEPTION 'Qty kurang dari yang diterima. Wajib pilih alasan.';
  END IF;
  IF p_qty > v_qty_terima THEN
    v_is_qty_lebih := true;
  END IF;

  -- Upah masuk ke minggu penggajian saat bundle DITERIMA. Setiap Sabtu
  -- semua pekerjaan minggu sebelumnya (termasuk yang masih sedang
  -- dikerjakan) sudah dibayar tunai, jadi bundle yang diterima minggu
  -- lalu dan selesai minggu ini sudah terbayar — jangan masuk minggu ini.
  IF v_waktu_terima IS NOT NULL
     AND awal_minggu_gaji(CURRENT_DATE) <> awal_minggu_gaji(v_waktu_terima) THEN
    v_tanggal_upah := v_waktu_terima;
  ELSE
    v_tanggal_upah := CURRENT_DATE;
  END IF;

  IF v_tahap_text = 'cutting' OR v_tahap_text = 'jahit' THEN
    v_resolved_karyawan := p_karyawan_id;
  ELSE
    SELECT default_karyawan_borongan_id
    INTO v_resolved_karyawan
    FROM settings
    WHERE tenant_id = p_tenant_id
    LIMIT 1;
  END IF;

  INSERT INTO scan_log (
    bundle_id, tahap, tipe, qty, karyawan_id,
    catatan, alasan_qty_id, is_qty_lebih,
    user_id, tenant_id
  )
  VALUES (
    v_bundle.id, p_tahap, 'selesai'::scan_tipe, p_qty, v_resolved_karyawan,
    p_catatan, p_alasan_qty_id, v_is_qty_lebih,
    p_user_id, p_tenant_id
  )
  RETURNING id INTO v_scan_log_id;

  UPDATE bundle
  SET status_tahap = jsonb_set(
    status_tahap,
    ARRAY[v_tahap_text],
    jsonb_set(
      jsonb_set(
        jsonb_set(
          status_tahap -> v_tahap_text,
          '{status}',      '"selesai"'
        ),
        '{qty_selesai}', to_jsonb(p_qty)
      ),
      '{waktu_selesai}', to_jsonb(now())
    )
  )
  WHERE id = v_bundle.id;

  -- Upah cuma dibuat di sini untuk cutting & jahit. Tahap borongan
  -- finishing (lubang_kancing, buang_benang, qc, steam, packing) upahnya
  -- baru terbentuk saat bundle ini dikirim lewat Surat Jalan.
  IF v_tahap_text IN ('cutting', 'jahit') THEN
    SELECT EXISTS (
      SELECT 1 FROM gaji_ledger gl
      WHERE gl.tenant_id = p_tenant_id AND gl.sumber_id = v_bundle.id::text
        AND gl.keterangan LIKE ('Upah ' || v_tahap_text || ' - %')
        AND gl.status <> 'cancelled'
    ) INTO v_sudah_dibayar_dimuka;

    IF NOT v_sudah_dibayar_dimuka THEN
      SELECT hi.harga_satuan INTO v_rate
      FROM hpp_item hi
      JOIN hpp_komponen hk ON hi.komponen_id = hk.id
      WHERE hi.produk_id = v_bundle.produk_id
        AND hk.tahap_produksi = p_tahap
        AND hi.tenant_id = p_tenant_id;

      IF v_rate IS NOT NULL AND v_rate > 0 AND v_resolved_karyawan IS NOT NULL THEN
        v_upah := v_rate * p_qty;
        INSERT INTO gaji_ledger (
          karyawan_id, tipe, total, tanggal,
          sumber_id, keterangan, status,
          tenant_id, created_by
        )
        VALUES (
          v_resolved_karyawan,
          'selesai'::gaji_ledger_tipe,
          v_upah,
          v_tanggal_upah,
          v_bundle.id::text,
          'Upah ' || v_tahap_text || ' - ' || v_bundle.barcode,
          'belum_lunas'::gaji_status,
          p_tenant_id,
          p_user_id
        )
        RETURNING id INTO v_gaji_entry_id;
      END IF;
    END IF;
  END IF;

  IF v_is_qty_lebih THEN
    INSERT INTO qty_approval_request (
      scan_log_id, bundle_id, tahap,
      qty_diajukan, qty_default,
      tenant_id, created_by
    )
    VALUES (
      v_scan_log_id, v_bundle.id, p_tahap,
      p_qty, v_qty_terima,
      p_tenant_id, p_user_id
    )
    RETURNING id INTO v_approval_request_id;
  END IF;

  RETURN jsonb_build_object(
    'scan_log_id',          v_scan_log_id,
    'gaji_entry_id',        v_gaji_entry_id,
    'upah_nominal',         v_upah,
    'is_qty_lebih',         v_is_qty_lebih,
    'approval_request_id',  v_approval_request_id,
    'sudah_dibayar_dimuka', v_sudah_dibayar_dimuka
  );
END;
$function$;
