-- ================================================================
-- MIGRATION: Lunaskan & hapus upah per entri (bukan per pekerja utuh)
--
-- Overview Pekerja sebelumnya cuma bisa "Tandai Lunas" seluruh upah
-- satu pekerja sekaligus. Kalau ada kesalahan pembayaran (mis. satu
-- baris salah artikel/qty/rate), tidak ada cara memperbaiki satu
-- baris saja — harus lunaskan semua lalu urus manual di luar sistem.
--
-- Dua RPC baru, keduanya cuma menyentuh baris gaji_ledger ASLI (baris
-- "sedang_dikerjakan" dari bundle yang belum discan selesai belum
-- punya entri ledger, jadi tidak relevan di sini):
--
--   1. lunaskan_entri_upah   — tandai lunas beberapa entri spesifik.
--   2. hapus_entri_upah      — batalkan (status 'cancelled') beberapa
--      entri spesifik karena salah catat. Bukan DELETE fisik — gaji_ledger
--      didesain immutable (lihat 004_payroll_pengiriman_tables.sql),
--      jadi jejaknya tetap ada di audit_log dan bisa ditelusuri kalau
--      perlu dikoreksi lagi.
-- ================================================================

CREATE OR REPLACE FUNCTION public.lunaskan_entri_upah(
  p_entri_ids uuid[], p_user_id uuid, p_tenant_id text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_jml   INT;
  v_total NUMERIC;
  v_nama  TEXT;
BEGIN
  IF p_entri_ids IS NULL OR array_length(p_entri_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'Tidak ada entri dipilih';
  END IF;

  SELECT COUNT(*), COALESCE(SUM(total), 0)
    INTO v_jml, v_total
  FROM gaji_ledger
  WHERE id = ANY(p_entri_ids) AND tenant_id = p_tenant_id AND status = 'belum_lunas';

  IF v_jml = 0 THEN
    RAISE EXCEPTION 'Entri tidak ditemukan atau sudah tidak berstatus belum lunas';
  END IF;

  UPDATE gaji_ledger
  SET status = 'lunas', tanggal_bayar = CURRENT_DATE
  WHERE id = ANY(p_entri_ids) AND tenant_id = p_tenant_id AND status = 'belum_lunas';

  SELECT string_agg(DISTINCT k.nama, ', ')
    INTO v_nama
  FROM gaji_ledger g JOIN karyawan k ON k.id = g.karyawan_id
  WHERE g.id = ANY(p_entri_ids) AND g.tenant_id = p_tenant_id;

  INSERT INTO audit_log (user_id, modul, aksi, target, metadata, tenant_id)
  VALUES (p_user_id, 'penggajian', 'Lunaskan Entri Upah', COALESCE(v_nama, '-'),
          jsonb_build_object('entri_ids', p_entri_ids, 'jumlah_entri', v_jml, 'total', v_total),
          p_tenant_id);

  RETURN jsonb_build_object('success', true, 'jumlah_entri', v_jml, 'total', v_total, 'nama', v_nama);
END;
$function$;

CREATE OR REPLACE FUNCTION public.hapus_entri_upah(
  p_entri_ids uuid[], p_alasan text, p_user_id uuid, p_tenant_id text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_jml   INT;
  v_total NUMERIC;
  v_nama  TEXT;
BEGIN
  IF p_entri_ids IS NULL OR array_length(p_entri_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'Tidak ada entri dipilih';
  END IF;
  IF p_alasan IS NULL OR trim(p_alasan) = '' THEN
    RAISE EXCEPTION 'Alasan penghapusan wajib diisi';
  END IF;

  -- Boleh membatalkan entri yang sudah 'lunas' juga — kesalahan pembayaran
  -- kadang baru ketahuan setelah entrinya terlanjur ditandai lunas.
  SELECT COUNT(*), COALESCE(SUM(total), 0)
    INTO v_jml, v_total
  FROM gaji_ledger
  WHERE id = ANY(p_entri_ids) AND tenant_id = p_tenant_id AND status IN ('belum_lunas', 'lunas');

  IF v_jml = 0 THEN
    RAISE EXCEPTION 'Entri tidak ditemukan atau sudah dibatalkan sebelumnya';
  END IF;

  UPDATE gaji_ledger
  SET status = 'cancelled',
      keterangan = keterangan || ' [Dibatalkan: ' || trim(p_alasan) || ']'
  WHERE id = ANY(p_entri_ids) AND tenant_id = p_tenant_id AND status IN ('belum_lunas', 'lunas');

  SELECT string_agg(DISTINCT k.nama, ', ')
    INTO v_nama
  FROM gaji_ledger g JOIN karyawan k ON k.id = g.karyawan_id
  WHERE g.id = ANY(p_entri_ids) AND g.tenant_id = p_tenant_id;

  INSERT INTO audit_log (user_id, modul, aksi, target, metadata, tenant_id)
  VALUES (p_user_id, 'penggajian', 'Hapus Entri Upah', COALESCE(v_nama, '-'),
          jsonb_build_object('entri_ids', p_entri_ids, 'jumlah_entri', v_jml, 'total', v_total, 'alasan', p_alasan),
          p_tenant_id);

  RETURN jsonb_build_object('success', true, 'jumlah_entri', v_jml, 'total', v_total, 'nama', v_nama);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.lunaskan_entri_upah(uuid[], uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hapus_entri_upah(uuid[], text, uuid, text) TO authenticated;
