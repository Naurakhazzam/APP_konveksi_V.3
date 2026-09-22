-- ================================================================
-- MIGRATION: Gabungkan PO-0087 (sistem) ke PO-0084 — batch ke-2
--
-- Lanjutan dari 20260922000001_fix_no_po_tertukar.sql. Isi PO-0087 di
-- sistem (Dravo Black XXXL/4XL/5XL/6XL — ely354, ely2100-2102) sudah
-- dikonfirmasi pengguna sebagai batch KEDUA dari PO-0084 klien, bukan
-- PO terpisah. Tidak bisa langsung di-rename ke "PO-0084" karena nomor
-- itu sudah dipakai PO-0084 yang ada (isi Abudzar & Arrazi, beda sama
-- sekali) — jadi po_item dan bundle-nya dipindah ke po_id PO-0084,
-- lalu row PO-0087 yang sudah kosong dihapus.
--
-- Sudah dicek dulu: 4 po_item, 4 bundle, 0 buku_kas terkait PO-0087 —
-- aman dipindah tanpa nabrak FK lain.
--
-- CATATAN: no_urut_po pada bundle yang dipindah TIDAK direnumber ulang
-- (bisa saja tumpang tindih dengan no_urut_po bundle asli PO-0084) —
-- itu cuma field urutan tampilan, tidak ada unique constraint, jadi
-- dibiarkan apa adanya untuk mengurangi risiko. Barcode fisik (mis.
-- "PO-0087-00514-bdl01") juga TIDAK diubah, sama seperti keputusan di
-- migrasi sebelumnya — sudah tercetak dan dipakai di Surat Jalan yang
-- sudah final.
-- ================================================================

DO $$
DECLARE
  v_po0084_id uuid;
  v_po0087_id uuid;
BEGIN
  SELECT id INTO v_po0084_id FROM po WHERE tenant_id = 'STX-001' AND no_po = 'PO-0084';
  SELECT id INTO v_po0087_id FROM po WHERE tenant_id = 'STX-001' AND no_po = 'PO-0087';

  IF v_po0084_id IS NULL OR v_po0087_id IS NULL THEN
    RAISE EXCEPTION 'PO-0084 atau PO-0087 tidak ditemukan — migrasi dibatalkan.';
  END IF;

  UPDATE po_item SET po_id = v_po0084_id WHERE po_id = v_po0087_id;
  UPDATE bundle   SET po_id = v_po0084_id WHERE po_id = v_po0087_id;

  DELETE FROM po WHERE id = v_po0087_id;
END $$;
