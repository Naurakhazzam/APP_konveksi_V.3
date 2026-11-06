-- ================================================================
-- MIGRATION: Tutup 16 bundle data lama di Antrian Jahit
--
-- Bundle no. 1–16 di Antrian Jahit (PO-0071, PO-0076, PO-0078, dan
-- PO-0089-00523-bdl01 / PO-0086) sudah beres di lapangan tapi tertinggal
-- di sistem (cutting selesai, tidak pernah diserahterimakan ke jahit).
-- Ditutup lewat tutup_bundle_data_lama — tidak membuat upah, bisa dibuka
-- lagi dari tombol "Data Ditutup".
--
-- Sekalian: pesan penolakan trigger disamakan dengan nama tombol di layar.
-- ================================================================

CREATE OR REPLACE FUNCTION public._kunci_bundle_ditutup()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF OLD.ditutup_at IS NOT NULL AND NEW.ditutup_at IS NOT NULL
     AND NEW.status_tahap IS DISTINCT FROM OLD.status_tahap THEN
    RAISE EXCEPTION '[BUNDLE DITUTUP] Bundle % sudah ditutup sebagai data lama (alasan: %). Buka dulu lewat tombol "Data Ditutup" (Antrian Jahit / Buat Surat Jalan) kalau memang mau diproses lagi.',
      NEW.barcode, COALESCE(OLD.ditutup_alasan, '-');
  END IF;
  RETURN NEW;
END;
$function$;

SELECT public.tutup_bundle_data_lama(
  ARRAY(
    SELECT id FROM bundle
    WHERE tenant_id = 'STX-001' AND barcode IN (
      'PO-0071-00365-bdl01', 'PO-0071-00366-bdl01', 'PO-0071-00368-bdl01',
      'PO-0076-00411-bdl01', 'PO-0076-00412-bdl01', 'PO-0076-00413-bdl01',
      'PO-0078-00429-bdl01', 'PO-0078-00431-bdl01', 'PO-0078-00437-bdl01',
      'PO-0078-00439-bdl01', 'PO-0078-00442-bdl01', 'PO-0078-00448-bdl01',
      'PO-0078-00449-bdl01', 'PO-0078-00450-bdl01', 'PO-0078-00456-bdl01',
      'PO-0089-00523-bdl01'
    )
  ),
  'Data lama — sudah beres/terkirim di lapangan, tertinggal di Antrian Jahit',
  '71fb0890-5306-47be-a9c0-c5cce41cca95',
  'STX-001'
);
