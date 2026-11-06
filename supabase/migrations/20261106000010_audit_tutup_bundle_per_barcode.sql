-- ================================================================
-- MIGRATION: Catatan tutup bundle per barcode (untuk Lacak Barcode)
--
-- Riwayat di Lacak Barcode mencocokkan audit_log.target = barcode.
-- tutup_bundle_data_lama sebelumnya menulis SATU catatan untuk banyak
-- bundle (target berisi daftar barcode), sehingga kejadian "ditutup"
-- tidak muncul di riwayat bundle masing-masing. Sekarang satu catatan
-- per bundle, dan 16 bundle yang sudah ditutup dilengkapi catatannya.
-- ================================================================

CREATE OR REPLACE FUNCTION public.tutup_bundle_data_lama(
  p_bundle_ids uuid[], p_alasan text, p_user_id uuid, p_tenant_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_b      RECORD;
  v_jumlah INT := 0;
  v_barcode text[] := ARRAY[]::text[];
BEGIN
  IF p_alasan IS NULL OR TRIM(p_alasan) = '' THEN
    RAISE EXCEPTION '[ALASAN KOSONG] Alasan menutup bundle wajib diisi.';
  END IF;
  IF p_bundle_ids IS NULL OR array_length(p_bundle_ids, 1) IS NULL THEN
    RAISE EXCEPTION '[TIDAK ADA BUNDLE] Pilih minimal satu bundle.';
  END IF;

  FOR v_b IN
    SELECT b.id, b.barcode, b.ditutup_at, b.surat_jalan_id
    FROM bundle b
    WHERE b.id = ANY(p_bundle_ids) AND b.tenant_id = p_tenant_id
    FOR UPDATE
  LOOP
    IF v_b.ditutup_at IS NOT NULL THEN
      CONTINUE;
    END IF;
    IF v_b.surat_jalan_id IS NOT NULL THEN
      RAISE EXCEPTION '[SUDAH TERKIRIM] Bundle % sudah terkirim penuh lewat surat jalan — tidak perlu ditutup.', v_b.barcode;
    END IF;

    UPDATE bundle
    SET ditutup_at = now(), ditutup_alasan = TRIM(p_alasan), ditutup_oleh = p_user_id
    WHERE id = v_b.id;

    INSERT INTO audit_log (user_id, modul, aksi, target, metadata, tenant_id)
    VALUES (p_user_id, 'produksi', 'Tutup Bundle Data Lama', v_b.barcode,
            jsonb_build_object('bundle_id', v_b.id, 'alasan', TRIM(p_alasan)),
            p_tenant_id);

    v_jumlah  := v_jumlah + 1;
    v_barcode := array_append(v_barcode, v_b.barcode);
  END LOOP;

  IF v_jumlah = 0 THEN
    RAISE EXCEPTION '[TIDAK ADA YANG DITUTUP] Bundle yang dipilih tidak ditemukan atau sudah ditutup.';
  END IF;

  RETURN jsonb_build_object('jumlah', v_jumlah, 'barcode', v_barcode);
END;
$function$;

-- Lengkapi catatan per barcode untuk bundle yang sudah ditutup sebelum
-- perubahan ini (waktu & pelaku diambil dari kolom bundle).
INSERT INTO audit_log (user_id, modul, aksi, target, metadata, tenant_id, created_at)
SELECT b.ditutup_oleh, 'produksi', 'Tutup Bundle Data Lama', b.barcode,
       jsonb_build_object('bundle_id', b.id, 'alasan', b.ditutup_alasan),
       b.tenant_id, b.ditutup_at
FROM bundle b
WHERE b.ditutup_at IS NOT NULL
  AND b.ditutup_oleh IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM audit_log a
    WHERE a.target = b.barcode AND a.aksi = 'Tutup Bundle Data Lama'
  );
