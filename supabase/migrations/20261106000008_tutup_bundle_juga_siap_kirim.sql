-- ================================================================
-- MIGRATION: Tutup bundle data lama — juga untuk barang "tinggal kirim"
--
-- Perluasan 20261106000007. Selain bundle yang menggantung di Antrian
-- Jahit, bundle yang sudah selesai packing tapi tidak pernah dibuatkan
-- Surat Jalan (lupa / kesalahan admin lama) juga bisa ditutup, supaya
-- tidak terus muncul di Buat Surat Jalan.
--
-- - Syarat tutup: bundle belum terkirim penuh (surat_jalan_id kosong).
--   Bundle yang sudah dikirim sebagian boleh ditutup — sisanya dianggap
--   beres dan tidak muncul lagi di Buat Surat Jalan.
-- - Upah yang SUDAH tercatat (pekerjaan yang benar-benar dikerjakan)
--   tidak disentuh. Menutup bundle tidak pernah membuat upah baru.
-- - Bundle yang ditutup tidak bisa dimasukkan ke Surat Jalan.
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

    v_jumlah  := v_jumlah + 1;
    v_barcode := array_append(v_barcode, v_b.barcode);
  END LOOP;

  IF v_jumlah = 0 THEN
    RAISE EXCEPTION '[TIDAK ADA YANG DITUTUP] Bundle yang dipilih tidak ditemukan atau sudah ditutup.';
  END IF;

  INSERT INTO audit_log (user_id, modul, aksi, target, metadata, tenant_id)
  VALUES (p_user_id, 'produksi', 'Tutup Bundle Data Lama', array_to_string(v_barcode, ', '),
          jsonb_build_object('jumlah', v_jumlah, 'barcode', v_barcode, 'alasan', TRIM(p_alasan)),
          p_tenant_id);

  RETURN jsonb_build_object('jumlah', v_jumlah, 'barcode', v_barcode);
END;
$function$;


-- Bundle yang ditutup tidak boleh masuk surat jalan.
CREATE OR REPLACE FUNCTION public._tolak_sj_bundle_ditutup()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  v_barcode text;
BEGIN
  SELECT barcode INTO v_barcode FROM bundle
  WHERE id = NEW.bundle_id AND ditutup_at IS NOT NULL;
  IF FOUND THEN
    RAISE EXCEPTION '[BUNDLE DITUTUP] Bundle % sudah ditutup sebagai data lama — buka dulu kalau memang mau dikirim.', v_barcode;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_tolak_sj_bundle_ditutup ON public.surat_jalan_item;
CREATE TRIGGER trg_tolak_sj_bundle_ditutup
  BEFORE INSERT ON public.surat_jalan_item
  FOR EACH ROW EXECUTE FUNCTION public._tolak_sj_bundle_ditutup();
