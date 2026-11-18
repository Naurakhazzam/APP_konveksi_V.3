-- =============================================================================
-- F3 Laporan Per PO: "tanggal kejadian" untuk Selesai Cutting & Selesai Packing
-- =============================================================================
-- Admin sering menginput belakangan. Tanggal kejadian (boleh mundur maks 7 hari)
-- disimpan di status_tahap.<tahap>:
--   tanggal_kejadian      'YYYY-MM-DD'
--   tanggal_kejadian_utk  salinan waktu_selesai saat tanggal itu dipasang
-- Tanggal kejadian hanya berlaku bila tanggal_kejadian_utk = waktu_selesai
-- sekarang — jadi bila tahap dibatalkan lalu diselesaikan ulang, sisa tanggal
-- lama otomatis tidak terpakai. Dipakai mesin overhead pcs-hari (F4) lewat
-- tanggal_selesai_efektif(). Setiap tanggal mundur dicatat di audit_log.
-- waktu_selesai (jam sistem) TIDAK diubah: upah, stok & riwayat tetap apa adanya.
-- =============================================================================

CREATE OR REPLACE FUNCTION tanggal_selesai_efektif(p_status_tahap jsonb, p_tahap text)
RETURNS date
LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN p_status_tahap -> p_tahap ->> 'waktu_selesai' IS NULL THEN NULL
    WHEN p_status_tahap -> p_tahap ->> 'tanggal_kejadian' IS NOT NULL
     AND p_status_tahap -> p_tahap ->> 'tanggal_kejadian_utk'
         = p_status_tahap -> p_tahap ->> 'waktu_selesai'
      THEN (p_status_tahap -> p_tahap ->> 'tanggal_kejadian')::date
    ELSE ((p_status_tahap -> p_tahap ->> 'waktu_selesai')::timestamptz
          AT TIME ZONE 'Asia/Jakarta')::date
  END
$$;

CREATE OR REPLACE FUNCTION set_tanggal_kejadian_tahap(
  p_bundle_ids uuid[],
  p_tahap      text,
  p_tanggal    date,
  p_user_id    uuid,
  p_tenant_id  text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_hari_ini date := (now() AT TIME ZONE 'Asia/Jakarta')::date;
  v_b        record;
  v_t        jsonb;
  v_tgl_sys  date;
  v_tgl_cut  date;
  v_jumlah   int := 0;
BEGIN
  IF p_tahap NOT IN ('cutting', 'packing') THEN
    RAISE EXCEPTION 'Tanggal kejadian hanya untuk tahap cutting & packing';
  END IF;
  IF p_tanggal IS NULL THEN RAISE EXCEPTION 'Tanggal kejadian wajib diisi'; END IF;
  IF p_tanggal > v_hari_ini THEN
    RAISE EXCEPTION 'Tanggal kejadian tidak boleh melebihi hari ini';
  END IF;
  IF p_tanggal < v_hari_ini - 7 THEN
    RAISE EXCEPTION 'Tanggal kejadian paling lama mundur 7 hari (mulai %)', to_char(v_hari_ini - 7, 'DD-MM-YYYY');
  END IF;

  FOR v_b IN
    SELECT id, barcode, status_tahap FROM bundle
    WHERE id = ANY(p_bundle_ids) AND tenant_id = p_tenant_id
    FOR UPDATE
  LOOP
    v_t := v_b.status_tahap -> p_tahap;
    IF v_t IS NULL OR v_t ->> 'waktu_selesai' IS NULL
       OR COALESCE(v_t ->> 'status', '') NOT IN ('selesai', 'partial') THEN
      CONTINUE;  -- mis. bundle qty 0 yang kembali ke antrian: tidak ada tanggal
    END IF;
    v_tgl_sys := ((v_t ->> 'waktu_selesai')::timestamptz AT TIME ZONE 'Asia/Jakarta')::date;
    IF p_tanggal > v_tgl_sys THEN
      RAISE EXCEPTION 'Tanggal kejadian bundle % tidak boleh setelah tanggal input', v_b.barcode;
    END IF;
    IF p_tahap = 'packing' THEN
      v_tgl_cut := tanggal_selesai_efektif(v_b.status_tahap, 'cutting');
      IF v_tgl_cut IS NOT NULL AND p_tanggal < v_tgl_cut THEN
        RAISE EXCEPTION 'Tanggal packing bundle % (%) lebih awal dari selesai cutting (%)',
          v_b.barcode, to_char(p_tanggal, 'DD-MM-YYYY'), to_char(v_tgl_cut, 'DD-MM-YYYY');
      END IF;
    END IF;

    IF p_tanggal = v_tgl_sys THEN
      -- Sama dengan tanggal input → cukup pakai waktu sistem.
      v_t := v_t - 'tanggal_kejadian' - 'tanggal_kejadian_utk';
    ELSE
      v_t := v_t || jsonb_build_object(
        'tanggal_kejadian', to_char(p_tanggal, 'YYYY-MM-DD'),
        'tanggal_kejadian_utk', v_t -> 'waktu_selesai');
      INSERT INTO audit_log (user_id, modul, aksi, target, metadata, tenant_id)
      VALUES (p_user_id, 'produksi', 'tanggal_kejadian', v_b.barcode,
        jsonb_build_object('bundle_id', v_b.id, 'tahap', p_tahap,
          'tanggal_kejadian', p_tanggal, 'tanggal_input', v_tgl_sys,
          'mundur_hari', v_tgl_sys - p_tanggal),
        p_tenant_id);
    END IF;

    UPDATE bundle SET status_tahap = jsonb_set(status_tahap, ARRAY[p_tahap], v_t)
    WHERE id = v_b.id;
    v_jumlah := v_jumlah + 1;
  END LOOP;

  RETURN jsonb_build_object('jumlah', v_jumlah);
END $$;

GRANT EXECUTE ON FUNCTION tanggal_selesai_efektif(jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION set_tanggal_kejadian_tahap(uuid[], text, date, uuid, text) TO authenticated;
