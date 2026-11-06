-- ================================================================
-- MIGRATION: Koreksi penjahit PO-0097-00676-bdl01 (Khalid Brown L)
--
-- Sisa 5 pcs bundle induk (setelah split; pecahan h1 dijahit Toto)
-- diserahterimakan 4 Nov 20:59 ke Toto — salah pilih. Penjahit yang
-- benar: Ade. Bundle sudah selesai jahit sehingga koreksi_serah_terima_
-- jahit (hanya untuk yang sedang dikerjakan) tidak bisa dipakai.
--
-- Dipindah ke Ade: status_tahap.jahit.karyawan_id, scan_log jahit
-- (terima & selesai), dan upah jahit (masih belum lunas). Dicatat di
-- audit_log sebagai Koreksi Serah Terima Jahit (tampil di Lacak Barcode).
-- ================================================================

DO $$
DECLARE
  v_bundle  uuid := '9b2a4a47-dab6-409d-9f84-2c67820c653c';
  v_toto    uuid := 'b3f07a63-6fe3-4fc5-ac50-20eb9d47a4f8';
  v_ade     uuid := '819429c5-08d3-45bf-a79e-c76cc61077af';
  v_upah    RECORD;
BEGIN
  IF (SELECT status_tahap->'jahit'->>'karyawan_id' FROM bundle WHERE id = v_bundle) <> v_toto::text THEN
    RAISE EXCEPTION 'Penjahit bundle sudah bukan Toto — koreksi dibatalkan';
  END IF;

  SELECT id, total, status INTO v_upah
  FROM gaji_ledger
  WHERE sumber_id = v_bundle::text AND keterangan LIKE 'Upah jahit - %' AND status <> 'cancelled';

  IF v_upah.status IS DISTINCT FROM 'belum_lunas' THEN
    RAISE EXCEPTION 'Upah jahit bundle ini sudah tidak berstatus belum lunas (%) — koreksi dibatalkan', v_upah.status;
  END IF;

  UPDATE bundle
  SET status_tahap = jsonb_set(status_tahap, '{jahit,karyawan_id}', to_jsonb(v_ade::text))
  WHERE id = v_bundle;

  UPDATE scan_log
  SET karyawan_id = v_ade,
      catatan = concat_ws(' | ', NULLIF(catatan, ''), 'Dikoreksi 06/11: penjahit Toto → Ade')
  WHERE bundle_id = v_bundle AND tahap = 'jahit' AND karyawan_id = v_toto;

  UPDATE gaji_ledger SET karyawan_id = v_ade WHERE id = v_upah.id;

  INSERT INTO audit_log (user_id, modul, aksi, target, metadata, tenant_id)
  VALUES ('71fb0890-5306-47be-a9c0-c5cce41cca95', 'produksi', 'Koreksi Serah Terima Jahit',
          'PO-0097-00676-bdl01',
          jsonb_build_object('bundle_id', v_bundle,
                             'karyawan_id_lama', v_toto, 'karyawan_id_baru', v_ade,
                             'qty_lama', 5, 'qty_baru', 5,
                             'upah_dipindah', v_upah.total,
                             'alasan', 'Salah pilih penjahit saat serah terima 4 Nov — yang menjahit Ade'),
          'STX-001');
END $$;
