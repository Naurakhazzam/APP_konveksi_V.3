-- =============================================================================
-- MIGRATION: 20260714000001_performance_indexes.sql
-- Tujuan: Tambah index di semua tabel yang sering di-query
-- untuk menghilangkan full table scan penyebab loading 10-15 detik.
-- =============================================================================

-- =============================================================================
-- 1. TABEL CORE (001_core_tables.sql)
-- =============================================================================

-- user_profile: dicari by role (DashboardLayout, permission check)
CREATE INDEX IF NOT EXISTS idx_user_profile_tenant_id
  ON user_profile(tenant_id);

CREATE INDEX IF NOT EXISTS idx_user_profile_tenant_aktif
  ON user_profile(tenant_id, aktif);

-- karyawan: sering di-query untuk daftar karyawan aktif
CREATE INDEX IF NOT EXISTS idx_karyawan_tenant_id
  ON karyawan(tenant_id);

CREATE INDEX IF NOT EXISTS idx_karyawan_tenant_aktif
  ON karyawan(tenant_id, aktif);

-- klien: sering di-query untuk dropdown dan daftar klien
CREATE INDEX IF NOT EXISTS idx_klien_tenant_id
  ON klien(tenant_id);

-- kategori_trx: dipakai di form keuangan
CREATE INDEX IF NOT EXISTS idx_kategori_trx_tenant_id
  ON kategori_trx(tenant_id);

CREATE INDEX IF NOT EXISTS idx_kategori_trx_tenant_aktif
  ON kategori_trx(tenant_id, aktif);


-- =============================================================================
-- 2. TABEL PRODUKSI (002_produksi_tables.sql)
-- =============================================================================

-- po: query paling berat — filter by tenant + status setiap buka halaman produksi
CREATE INDEX IF NOT EXISTS idx_po_tenant_id
  ON po(tenant_id);

CREATE INDEX IF NOT EXISTS idx_po_tenant_status
  ON po(tenant_id, status);

CREATE INDEX IF NOT EXISTS idx_po_tenant_klien
  ON po(tenant_id, klien_id);

CREATE INDEX IF NOT EXISTS idx_po_created_at
  ON po(created_at DESC);

-- po_item: join dengan po dan bundle
CREATE INDEX IF NOT EXISTS idx_po_item_tenant_id
  ON po_item(tenant_id);

CREATE INDEX IF NOT EXISTS idx_po_item_produk_id
  ON po_item(produk_id);

-- bundle: dipakai di monitoring, antrian cutting, scan
CREATE INDEX IF NOT EXISTS idx_bundle_tenant_id
  ON bundle(tenant_id);

CREATE INDEX IF NOT EXISTS idx_bundle_tenant_po
  ON bundle(tenant_id, po_id);

CREATE INDEX IF NOT EXISTS idx_bundle_po_item_id
  ON bundle(po_item_id);

CREATE INDEX IF NOT EXISTS idx_bundle_surat_jalan_id
  ON bundle(surat_jalan_id);

-- scan_log: tabel terbesar, paling sering di-query di monitoring & dashboard
CREATE INDEX IF NOT EXISTS idx_scan_log_tenant_id
  ON scan_log(tenant_id);

CREATE INDEX IF NOT EXISTS idx_scan_log_tenant_tahap_tipe
  ON scan_log(tenant_id, tahap, tipe);

CREATE INDEX IF NOT EXISTS idx_scan_log_created_at
  ON scan_log(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_scan_log_tenant_created
  ON scan_log(tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_scan_log_karyawan_id
  ON scan_log(karyawan_id);


-- =============================================================================
-- 3. TABEL INVENTORY & KEUANGAN (003_inventory_jurnal_tables.sql)
-- =============================================================================

-- inventory_item: daftar semua item
CREATE INDEX IF NOT EXISTS idx_inventory_item_tenant_id
  ON inventory_item(tenant_id);

-- inventory_batch: FIFO query — paling sering untuk cek stok sisa
CREATE INDEX IF NOT EXISTS idx_inventory_batch_tenant_id
  ON inventory_batch(tenant_id);

CREATE INDEX IF NOT EXISTS idx_inventory_batch_tenant_item_sisa
  ON inventory_batch(tenant_id, inventory_item_id, qty_sisa);

-- pemakaian_bahan: riwayat transaksi keluar bahan
CREATE INDEX IF NOT EXISTS idx_pemakaian_bahan_tenant_id
  ON pemakaian_bahan(tenant_id);

CREATE INDEX IF NOT EXISTS idx_pemakaian_bahan_tenant_created
  ON pemakaian_bahan(tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_pemakaian_bahan_item_id
  ON pemakaian_bahan(inventory_item_id);

-- pemakaian_aksesori
CREATE INDEX IF NOT EXISTS idx_pemakaian_aksesori_tenant_id
  ON pemakaian_aksesori(tenant_id);

CREATE INDEX IF NOT EXISTS idx_pemakaian_aksesori_tenant_created
  ON pemakaian_aksesori(tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_pemakaian_aksesori_item_id
  ON pemakaian_aksesori(inventory_item_id);

-- jurnal_entry: laporan keuangan
CREATE INDEX IF NOT EXISTS idx_jurnal_entry_tenant_id
  ON jurnal_entry(tenant_id);

CREATE INDEX IF NOT EXISTS idx_jurnal_entry_tenant_created
  ON jurnal_entry(tenant_id, created_at DESC);


-- =============================================================================
-- 4. TABEL PAYROLL & PENGIRIMAN (004_payroll_pengiriman_tables.sql)
-- =============================================================================

-- surat_jalan
CREATE INDEX IF NOT EXISTS idx_surat_jalan_tenant_id
  ON surat_jalan(tenant_id);

CREATE INDEX IF NOT EXISTS idx_surat_jalan_tenant_created
  ON surat_jalan(tenant_id, created_at DESC);

-- gaji_ledger: rekap gaji karyawan
CREATE INDEX IF NOT EXISTS idx_gaji_ledger_tenant_id
  ON gaji_ledger(tenant_id);

-- kasbon
CREATE INDEX IF NOT EXISTS idx_kasbon_tenant_id
  ON kasbon(tenant_id);


-- =============================================================================
-- 5. TABEL MASTER TAMBAHAN (007_master_tambahan.sql)
-- =============================================================================

-- kategori_produk
CREATE INDEX IF NOT EXISTS idx_kategori_produk_tenant_id
  ON kategori_produk(tenant_id);

-- model_produk: join dengan kategori_produk
CREATE INDEX IF NOT EXISTS idx_model_produk_tenant_id
  ON model_produk(tenant_id);

CREATE INDEX IF NOT EXISTS idx_model_produk_tenant_kategori
  ON model_produk(tenant_id, kategori_id);

-- size
CREATE INDEX IF NOT EXISTS idx_size_tenant_id
  ON size(tenant_id);

-- warna
CREATE INDEX IF NOT EXISTS idx_warna_tenant_id
  ON warna(tenant_id);

-- produk: sering di-filter by model, aktif
CREATE INDEX IF NOT EXISTS idx_produk_tenant_id
  ON produk(tenant_id);

CREATE INDEX IF NOT EXISTS idx_produk_tenant_aktif
  ON produk(tenant_id, aktif);

CREATE INDEX IF NOT EXISTS idx_produk_tenant_model
  ON produk(tenant_id, model_id);

-- satuan
CREATE INDEX IF NOT EXISTS idx_satuan_tenant_id
  ON satuan(tenant_id);

-- hpp_komponen: filter by aktif
CREATE INDEX IF NOT EXISTS idx_hpp_komponen_tenant_id
  ON hpp_komponen(tenant_id);

CREATE INDEX IF NOT EXISTS idx_hpp_komponen_tenant_aktif
  ON hpp_komponen(tenant_id, aktif);

-- hpp_item: join dengan produk
CREATE INDEX IF NOT EXISTS idx_hpp_item_tenant_id
  ON hpp_item(tenant_id);

CREATE INDEX IF NOT EXISTS idx_hpp_item_tenant_produk
  ON hpp_item(tenant_id, produk_id);

-- jenis_reject & alasan_reject
CREATE INDEX IF NOT EXISTS idx_jenis_reject_tenant_id
  ON jenis_reject(tenant_id);

CREATE INDEX IF NOT EXISTS idx_alasan_reject_tenant_id
  ON alasan_reject(tenant_id);


-- =============================================================================
-- 6. TABEL PERMISSION (role_permissions)
-- Dipakai di setiap navigasi untuk cek akses user
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_role_permissions_tenant_role
  ON role_permissions(tenant_id, role);

CREATE INDEX IF NOT EXISTS idx_role_permissions_tenant_role_view
  ON role_permissions(tenant_id, role, can_view);


-- =============================================================================
-- 7. TABEL JABATAN (009_jabatan_table.sql)
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_jabatan_tenant_id
  ON jabatan(tenant_id);
