-- =============================================================================
-- Perbaikan data (sudah diterapkan 9 Nov 2026): riwayat pemakaian bahan cutting
-- yang dulu tercatat ke bundle PERTAMA dalam satu kali Selesai Cutting dipindah
-- ke artikel yang benar: warna bahan cocok, selesai di transaksi yang sama
-- (waktu_selesai identik), qty artikel = qty_pakai / rate. Stok tidak berubah.
-- Hasil: 24 baris dipindah, tercatat di audit_log aksi 'Perbaiki Atribusi Bahan Cutting'.
-- 2 baris dibiarkan (PO-0034-00235-bdl01, PO-0080-00492-bdl01 — JN Navy tanpa
-- artikel Navy di transaksi yang sama: kemungkinan memang salah pilih bahan).
-- =============================================================================
WITH rows AS (
  SELECT pb.id pb_id, pb.bundle_id, pb.po_item_id, pb.inventory_item_id, pb.qty_pakai, pb.rate_per_pcs,
         b.po_id, b.barcode, b.status_tahap->'cutting'->>'waktu_selesai' ws, lower(pi.warna) wp, lower(wi.nama) wb
  FROM pemakaian_bahan pb JOIN bundle b ON b.id=pb.bundle_id JOIN po_item pi ON pi.id=pb.po_item_id
  JOIN inventory_item ii ON ii.id=pb.inventory_item_id LEFT JOIN warna wi ON wi.id=ii.warna_id
  WHERE pb.tenant_id='STX-001'
), salah AS (
  SELECT * FROM rows r WHERE NOT (r.wb = r.wp OR (r.wp LIKE '% x %' AND EXISTS (
     SELECT 1 FROM unnest(string_to_array(r.wp,' x ')) part WHERE r.wb=trim(part) OR r.wb LIKE '%'||trim(part) OR (trim(part)='darkgrey' AND r.wb='dark grey'))))
), kand AS (
  SELECT s.pb_id, b2.po_item_id, min(b2.barcode) first_barcode,
         sum((b2.status_tahap->'cutting'->>'qty_aktual')::numeric) qty_artikel
  FROM salah s JOIN bundle b2 ON b2.po_id=s.po_id AND b2.status_tahap->'cutting'->>'waktu_selesai' = s.ws
  JOIN po_item pi2 ON pi2.id=b2.po_item_id
  WHERE lower(pi2.warna)=s.wb OR (pi2.warna ILIKE '% x %' AND EXISTS (SELECT 1 FROM unnest(string_to_array(lower(pi2.warna),' x ')) part WHERE s.wb=trim(part) OR s.wb LIKE '%'||trim(part)))
  GROUP BY 1,2
), pilih AS (
  SELECT DISTINCT ON (s.pb_id) s.pb_id, s.barcode lama, k.po_item_id baru_item, k.first_barcode
  FROM salah s JOIN kand k ON k.pb_id=s.pb_id
  ORDER BY s.pb_id, (abs(k.qty_artikel - s.qty_pakai/NULLIF(s.rate_per_pcs,0)) < 0.01) DESC, k.first_barcode
), pindah AS (
  UPDATE pemakaian_bahan pb SET bundle_id = nb.id, po_item_id = p.baru_item
  FROM pilih p JOIN bundle nb ON nb.barcode = p.first_barcode
  WHERE pb.id = p.pb_id
  RETURNING pb.id, p.lama, p.first_barcode, pb.inventory_item_id
)
INSERT INTO audit_log (user_id, modul, aksi, target, metadata, tenant_id)
SELECT '71fb0890-5306-47be-a9c0-c5cce41cca95', 'produksi', 'Perbaiki Atribusi Bahan Cutting', pindah.first_barcode,
       jsonb_build_object('pemakaian_bahan_id', pindah.id, 'dari_bundle', pindah.lama, 'ke_bundle', pindah.first_barcode,
                          'inventory_item_id', pindah.inventory_item_id,
                          'alasan', 'Bug lama: semua bahan dicatat ke bundle pertama per Selesai Cutting'),
       'STX-001'
FROM pindah;
