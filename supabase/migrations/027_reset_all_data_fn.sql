-- =============================================================================
-- MIGRATION: 027_reset_all_data_fn.sql
-- Fungsi: reset_all_data(p_tenant_id TEXT)
-- Menghapus semua data transaksi, menjaga data master, reset stok & sequence.
-- Dibuat: 28 April 2026
-- =============================================================================

CREATE OR REPLACE FUNCTION reset_all_data(p_tenant_id TEXT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN

  -- =========================================================================
  -- STEP 1: Hapus tabel paling child terlebih dahulu (ikuti urutan FK)
  -- =========================================================================

  -- 1a. invoice_pembayaran → child of: invoice
  DELETE FROM invoice_pembayaran WHERE tenant_id = p_tenant_id;

  -- 1b. koreksi_qty → child of: bundle
  DELETE FROM koreksi_qty WHERE tenant_id = p_tenant_id;

  -- 1c. surat_jalan_item → child of: bundle, surat_jalan
  DELETE FROM surat_jalan_item WHERE tenant_id = p_tenant_id;

  -- 1d. qty_approval_request → child of: bundle, scan_log
  DELETE FROM qty_approval_request WHERE tenant_id = p_tenant_id;

  -- 1e. reject_karyawan → child of: reject_log
  DELETE FROM reject_karyawan WHERE tenant_id = p_tenant_id;

  -- =========================================================================
  -- STEP 2: Hapus tabel level menengah
  -- =========================================================================

  -- 2a. reject_log → child of: bundle, invoice, surat_jalan
  DELETE FROM reject_log WHERE tenant_id = p_tenant_id;

  -- 2b. pemakaian_aksesori → child of: bundle
  DELETE FROM pemakaian_aksesori WHERE tenant_id = p_tenant_id;

  -- 2c. hpp_item → child of: hpp_komponen (master, tetap), produk (master, tetap)
  DELETE FROM hpp_item WHERE tenant_id = p_tenant_id;

  -- 2d. scan_log → child of: bundle (harus setelah qty_approval_request dihapus)
  DELETE FROM scan_log WHERE tenant_id = p_tenant_id;

  -- 2e. pemakaian_bahan → child of: bundle, inventory_batch, po_item
  DELETE FROM pemakaian_bahan WHERE tenant_id = p_tenant_id;

  -- 2f. invoice → child of: surat_jalan
  DELETE FROM invoice WHERE tenant_id = p_tenant_id;

  -- =========================================================================
  -- STEP 3: Hapus bundle (banyak yang FK ke sini, sudah bersih di step 1 & 2)
  -- =========================================================================

  -- bundle → child of: po, po_item, surat_jalan
  DELETE FROM bundle WHERE tenant_id = p_tenant_id;

  -- =========================================================================
  -- STEP 4: Hapus tabel yang hanya FK ke master data
  -- =========================================================================

  DELETE FROM buku_kas         WHERE tenant_id = p_tenant_id;
  DELETE FROM gaji_ledger      WHERE tenant_id = p_tenant_id;
  DELETE FROM gaji_payment     WHERE tenant_id = p_tenant_id;
  DELETE FROM kasbon           WHERE tenant_id = p_tenant_id;
  DELETE FROM overhead_period  WHERE tenant_id = p_tenant_id;
  DELETE FROM audit_log        WHERE tenant_id = p_tenant_id;

  -- =========================================================================
  -- STEP 5: inventory_batch → child of: jurnal_entry
  -- Harus dihapus sebelum jurnal_entry
  -- =========================================================================

  DELETE FROM inventory_batch WHERE tenant_id = p_tenant_id;

  -- =========================================================================
  -- STEP 6: Tabel transaksi level atas
  -- =========================================================================

  -- surat_jalan → setelah surat_jalan_item, invoice, reject_log, bundle dihapus
  DELETE FROM surat_jalan WHERE tenant_id = p_tenant_id;

  -- jurnal_entry → setelah inventory_batch dihapus
  DELETE FROM jurnal_entry WHERE tenant_id = p_tenant_id;

  -- po_item → setelah pemakaian_bahan, bundle, pemakaian_aksesori dihapus
  DELETE FROM po_item WHERE tenant_id = p_tenant_id;

  -- po → setelah semua child-nya dihapus
  DELETE FROM po WHERE tenant_id = p_tenant_id;

  -- =========================================================================
  -- STEP 7: Reset stok inventory (nama item tetap, harga tetap, stok = 0)
  -- =========================================================================

  UPDATE inventory_item
  SET stok_aktual = 0
  WHERE tenant_id = p_tenant_id;

  -- =========================================================================
  -- STEP 8: Reset sequence counters
  -- =========================================================================

  -- no_urut_global untuk po_item (mulai dari 1 lagi setelah reset)
  UPDATE po_item_sequence
  SET last_sequence = 0
  WHERE tenant_id = p_tenant_id;

  -- nomor barcode bundle (mulai dari 1 lagi)
  UPDATE bundle_sequence
  SET last_sequence = 0
  WHERE tenant_id = p_tenant_id;

END;
$$;
