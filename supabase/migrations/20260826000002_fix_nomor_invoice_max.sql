-- ================================================================
-- MIGRATION: Perbaiki penomoran invoice — COUNT(*) -> MAX + 1
--
-- BUG: generate_nomor_invoice() menomori invoice pakai COUNT(*) + 1
-- dari invoice pada bulan yang sama. Ini rapuh — begitu ada satu saja
-- invoice terhapus (atau nomornya melompat karena sebab apapun),
-- COUNT menghasilkan angka yang SUDAH TERPAKAI, sehingga nomor
-- invoice jadi kembar.
--
-- Sebelum ada unique index invoice_nomor_unik_per_tenant, duplikat ini
-- masuk diam-diam tanpa error sama sekali. Sesudah index dipasang,
-- kondisi ini langsung terdeteksi dan memblokir pembuatan surat jalan
-- (trigger auto_create_invoice_on_sj gagal) — itulah yang terjadi.
--
-- Fix: ambil nomor urut TERTINGGI yang sudah ada di bulan tsb, lalu +1.
-- Tahan terhadap penghapusan maupun lompatan nomor.
-- ================================================================

CREATE OR REPLACE FUNCTION public.generate_nomor_invoice(p_tenant_id text, p_tanggal date)
RETURNS text
LANGUAGE plpgsql
AS $function$
DECLARE
  v_year  TEXT := TO_CHAR(p_tanggal, 'YYYY');
  v_month TEXT := TO_CHAR(p_tanggal, 'MM');
  v_next  INT;
  v_nomor TEXT;
BEGIN
  -- Ambil urutan tertinggi yang sudah dipakai pada tenant + bulan ini,
  -- berdasarkan 4 digit terakhir nomor invoice, lalu tambah 1.
  SELECT COALESCE(MAX((SUBSTRING(nomor_invoice FROM '(\d+)$'))::INT), 0) + 1
  INTO v_next
  FROM invoice
  WHERE tenant_id = p_tenant_id
    AND nomor_invoice LIKE 'INV/' || v_year || '/' || v_month || '/%'
    AND nomor_invoice ~ '\d+$';

  v_nomor := 'INV/' || v_year || '/' || v_month || '/' || LPAD(v_next::TEXT, 4, '0');
  RETURN v_nomor;
END;
$function$;
