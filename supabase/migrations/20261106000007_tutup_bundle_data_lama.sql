-- ================================================================
-- MIGRATION: Tutup bundle "data lama" dari Antrian Jahit (tanpa upah)
--
-- Ada bundle yang secara fisik sudah beres/terkirim di masa lalu tapi di
-- sistem tertinggal di Antrian Jahit (cutting selesai, tidak pernah
-- diserahterimakan ke jahit) — mis. sisa bundle induk setelah split, atau
-- bundle qty 0. Bundle seperti ini mengotori antrian.
--
-- Fitur: bundle bisa DITUTUP dengan alasan. Bundle yang ditutup:
--   - hilang dari Antrian Jahit (ada tab "Ditutup" untuk melihat/membuka),
--   - TIDAK membuat upah apa pun (tidak masuk gajian),
--   - dikunci: status tahapnya tidak bisa berubah (scan, koreksi, dll.)
--     sampai dibuka lagi — mencegah scan tak sengaja.
-- Bisa dibuka lagi kapan saja (buka_bundle_ditutup). Semua tercatat di
-- audit_log.
-- ================================================================

ALTER TABLE public.bundle
  ADD COLUMN IF NOT EXISTS ditutup_at     timestamptz,
  ADD COLUMN IF NOT EXISTS ditutup_alasan text,
  ADD COLUMN IF NOT EXISTS ditutup_oleh   uuid;

COMMENT ON COLUMN public.bundle.ditutup_at IS
  'Diisi kalau bundle ditutup manual sebagai data lama (sudah beres di lapangan). Bundle tertutup tidak tampil di antrian & tidak bisa discan sampai dibuka lagi.';


-- Kunci: bundle yang ditutup tidak boleh berubah status tahapnya.
CREATE OR REPLACE FUNCTION public._kunci_bundle_ditutup()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF OLD.ditutup_at IS NOT NULL AND NEW.ditutup_at IS NOT NULL
     AND NEW.status_tahap IS DISTINCT FROM OLD.status_tahap THEN
    RAISE EXCEPTION '[BUNDLE DITUTUP] Bundle % sudah ditutup sebagai data lama (alasan: %). Buka dulu lewat Antrian Jahit → tab Ditutup kalau memang mau diproses lagi.',
      NEW.barcode, COALESCE(OLD.ditutup_alasan, '-');
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_kunci_bundle_ditutup ON public.bundle;
CREATE TRIGGER trg_kunci_bundle_ditutup
  BEFORE UPDATE ON public.bundle
  FOR EACH ROW EXECUTE FUNCTION public._kunci_bundle_ditutup();


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
    SELECT b.id, b.barcode, b.ditutup_at, b.status_tahap
    FROM bundle b
    WHERE b.id = ANY(p_bundle_ids) AND b.tenant_id = p_tenant_id
    FOR UPDATE
  LOOP
    IF v_b.ditutup_at IS NOT NULL THEN
      CONTINUE;
    END IF;
    IF (v_b.status_tahap -> 'jahit' ->> 'status') = 'selesai' THEN
      RAISE EXCEPTION '[SUDAH SELESAI JAHIT] Bundle % sudah selesai jahit — bukan data gantung di Antrian Jahit.', v_b.barcode;
    END IF;
    IF EXISTS (SELECT 1 FROM surat_jalan_item s WHERE s.bundle_id = v_b.id) THEN
      RAISE EXCEPTION '[SUDAH ADA SURAT JALAN] Bundle % sudah tercatat di surat jalan — tidak perlu ditutup.', v_b.barcode;
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


CREATE OR REPLACE FUNCTION public.buka_bundle_ditutup(
  p_bundle_id uuid, p_user_id uuid, p_tenant_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_b RECORD;
BEGIN
  SELECT id, barcode, ditutup_at, ditutup_alasan INTO v_b
  FROM bundle WHERE id = p_bundle_id AND tenant_id = p_tenant_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '[BUNDLE TIDAK DITEMUKAN] Bundle tidak ada di sistem.';
  END IF;
  IF v_b.ditutup_at IS NULL THEN
    RAISE EXCEPTION '[TIDAK DITUTUP] Bundle % tidak dalam keadaan ditutup.', v_b.barcode;
  END IF;

  UPDATE bundle SET ditutup_at = NULL, ditutup_alasan = NULL, ditutup_oleh = NULL
  WHERE id = p_bundle_id;

  INSERT INTO audit_log (user_id, modul, aksi, target, metadata, tenant_id)
  VALUES (p_user_id, 'produksi', 'Buka Bundle Ditutup', v_b.barcode,
          jsonb_build_object('alasan_tutup_sebelumnya', v_b.ditutup_alasan,
                             'ditutup_at_sebelumnya', v_b.ditutup_at),
          p_tenant_id);

  RETURN jsonb_build_object('barcode', v_b.barcode);
END;
$function$;

REVOKE ALL ON FUNCTION public.tutup_bundle_data_lama(uuid[], text, uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.buka_bundle_ditutup(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tutup_bundle_data_lama(uuid[], text, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.buka_bundle_ditutup(uuid, uuid, text) TO authenticated;
