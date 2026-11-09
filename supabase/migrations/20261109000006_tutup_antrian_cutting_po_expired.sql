-- =============================================================================
-- (Sudah dijalankan 9 Nov 2026, atas permintaan owner) Tutup sisa antrian
-- cutting PO expired: PO-0066 s/d PO-0093 kecuali PO-0091.
-- Hanya bundle Menunggu / Sedang Dipotong. Hasil: 58 bundle (416 pcs) ditutup.
-- Bisa dibuka lagi per bundle lewat tombol "Data Ditutup".
-- =============================================================================
SELECT tutup_bundle_data_lama(
  (SELECT array_agg(b.id) FROM bundle b JOIN po ON po.id = b.po_id
   WHERE b.tenant_id = 'STX-001' AND b.ditutup_at IS NULL
     AND po.no_po BETWEEN 'PO-0066' AND 'PO-0093' AND po.no_po <> 'PO-0091'
     AND (b.status_tahap->'cutting' IS NULL OR b.status_tahap->'cutting'->>'status' IN ('progress', 'terima'))),
  'PO expired — sisa antrian cutting ditutup (PO-0066 s/d PO-0093 kecuali PO-0091)',
  '71fb0890-5306-47be-a9c0-c5cce41cca95', 'STX-001');
