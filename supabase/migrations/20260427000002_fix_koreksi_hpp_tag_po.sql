-- ============================================================
-- Fix Tag PO pada koreksi HPP jurnal entries
-- Masalah: Entry diinsert manual tanpa tag_po_ids → tampil kosong di UI
-- Solusi: Tag semua PO aktif tenant ke correction entries
-- ============================================================

-- Lihat dulu entry mana yang akan di-update
-- SELECT id, keterangan, nominal, tag_po_ids
-- FROM jurnal_entry
-- WHERE tenant_id = 'STX-001'
--   AND tag_po_ids = '[]'::jsonb
--   AND keterangan ILIKE '%koreksi%';

-- Update: isi tag_po_ids dengan semua PO yang ada
UPDATE jurnal_entry
SET tag_po_ids = (
    SELECT COALESCE(jsonb_agg(id::text ORDER BY no_po), '[]'::jsonb)
    FROM po
    WHERE tenant_id = 'STX-001'
)
WHERE tenant_id = 'STX-001'
  AND tag_po_ids = '[]'::jsonb
  AND keterangan ILIKE '%koreksi%';

-- Verifikasi
-- SELECT id, keterangan, nominal, jsonb_array_length(tag_po_ids) AS jumlah_po
-- FROM jurnal_entry
-- WHERE tenant_id = 'STX-001'
--   AND keterangan ILIKE '%koreksi%';
