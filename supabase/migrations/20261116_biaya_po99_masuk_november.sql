-- 16 Nov 2026: user — "semua biaya PO-0099 masukan di November, agar jelas".
-- Mode periode baru (p_po_mulai diisi): pemakaian kain/aksesori & upah PO periode baru yang terjadi
-- sebelum tanggal_awal_periode() dilaporkan pada tanggal_awal_periode() (14 Nov). Data asli tidak diubah.

CREATE OR REPLACE FUNCTION public.get_jurnal_produksi(p_tenant_id text, p_dari date, p_sampai date, p_po_mulai integer DEFAULT NULL::integer)
 RETURNS TABLE(tanggal date, jenis text, kategori text, keterangan text, no_po text, qty numeric, satuan text, nominal numeric, waktu timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT CASE WHEN p_po_mulai IS NULL THEN (pb.created_at AT TIME ZONE 'Asia/Jakarta')::date ELSE GREATEST((pb.created_at AT TIME ZONE 'Asia/Jakarta')::date, tanggal_awal_periode()) END, 'kain', ii.nama,
         b.barcode || CASE WHEN pb.dari_sisa THEN ' (kain sisa)' ELSE '' END,
         po.no_po, pb.qty_pakai, ii.satuan,
         ROUND(COALESCE(NULLIF(pb.harga_pakai, 0), pb.qty_pakai * COALESCE(ib.harga_satuan, ii.harga_referensi, 0)), 2),
         pb.created_at
  FROM pemakaian_bahan pb
  JOIN bundle b ON b.id = pb.bundle_id
  JOIN inventory_item ii ON ii.id = pb.inventory_item_id
  LEFT JOIN inventory_batch ib ON ib.id = pb.inventory_batch_id
  JOIN po_item pi ON pi.id = pb.po_item_id JOIN po ON po.id = pi.po_id
  WHERE pb.tenant_id = p_tenant_id
    AND CASE WHEN p_po_mulai IS NULL THEN (pb.created_at AT TIME ZONE 'Asia/Jakarta')::date ELSE GREATEST((pb.created_at AT TIME ZONE 'Asia/Jakarta')::date, tanggal_awal_periode()) END BETWEEN p_dari AND p_sampai
    AND (p_po_mulai IS NULL OR po_nomor(po.no_po) >= p_po_mulai
         OR pb.bundle_id IN (SELECT bundle_id FROM periode_baru_bundle_khusus))

  UNION ALL
  SELECT CASE WHEN p_po_mulai IS NULL THEN (pa.created_at AT TIME ZONE 'Asia/Jakarta')::date ELSE GREATEST((pa.created_at AT TIME ZONE 'Asia/Jakarta')::date, tanggal_awal_periode()) END, 'aksesori', ii.nama,
         b.barcode || ' · ' || COALESCE(pa.tahap::text, '-'),
         po.no_po, pa.qty_pakai, ii.satuan,
         ROUND(COALESCE(pa.harga_pakai, pa.qty_pakai * ii.harga_referensi, 0), 2),
         pa.created_at
  FROM pemakaian_aksesori pa
  JOIN inventory_item ii ON ii.id = pa.inventory_item_id
  JOIN bundle b ON b.id = pa.bundle_id JOIN po_item pi ON pi.id = b.po_item_id JOIN po ON po.id = pi.po_id
  WHERE pa.tenant_id = p_tenant_id
    AND CASE WHEN p_po_mulai IS NULL THEN (pa.created_at AT TIME ZONE 'Asia/Jakarta')::date ELSE GREATEST((pa.created_at AT TIME ZONE 'Asia/Jakarta')::date, tanggal_awal_periode()) END BETWEEN p_dari AND p_sampai
    AND (p_po_mulai IS NULL OR po_nomor(po.no_po) >= p_po_mulai
         OR b.id IN (SELECT bundle_id FROM periode_baru_bundle_khusus))

  UNION ALL
  SELECT CASE WHEN p_po_mulai IS NULL THEN gl.tanggal ELSE GREATEST(gl.tanggal, tanggal_awal_periode()) END, 'upah', COALESCE(kr.nama, '-'), gl.keterangan, po.no_po, NULL, NULL,
         CASE WHEN gl.tipe::text = 'reject_potong' THEN -gl.total ELSE gl.total END,
         gl.created_at
  FROM gaji_ledger gl
  LEFT JOIN karyawan kr ON kr.id = gl.karyawan_id
  LEFT JOIN bundle b ON b.id::text = gl.sumber_id
  LEFT JOIN po_item pi ON pi.id = b.po_item_id LEFT JOIN po ON po.id = pi.po_id
  WHERE gl.tenant_id = p_tenant_id AND gl.status::text IN ('belum_lunas', 'lunas')
    AND CASE WHEN p_po_mulai IS NULL THEN gl.tanggal ELSE GREATEST(gl.tanggal, tanggal_awal_periode()) END BETWEEN p_dari AND p_sampai
    AND (p_po_mulai IS NULL OR gl.sumber_id IN (
          SELECT x::text FROM bundle_ids_periode_baru(p_tenant_id, p_po_mulai) x))

  UNION ALL
  SELECT k.tanggal,
         CASE k.kategori WHEN 'Biaya Overhead' THEN 'overhead'
                         WHEN 'Bahan Pembantu' THEN 'pembantu'
                         WHEN 'Pembelian Bahan' THEN 'pembelian'
                         ELSE 'lainnya' END,
         CASE WHEN k.kategori = 'Biaya Overhead' THEN COALESCE(s.nama, 'Tanpa sub-kelompok')
              WHEN k.kategori = 'Bahan Pembantu' THEN COALESCE(pj.nama, 'Bahan Pembantu')
              ELSE k.kategori END,
         concat_ws(' · ', NULLIF(k.keterangan, ''), NULLIF(k.no_referensi, '')),
         po.no_po, k.qty, k.satuan, k.nominal, k.created_at
  FROM buku_kas k
  LEFT JOIN overhead_sub s ON s.id = k.overhead_sub_id
  LEFT JOIN pembantu_jenis pj ON pj.id = k.pembantu_jenis_id
  LEFT JOIN po ON po.id = k.po_id
  WHERE k.tenant_id = p_tenant_id AND k.tipe = 'keluar'
    AND k.kategori IN ('Biaya Overhead', 'Biaya Operasional', 'Lainnya', 'Bahan Pembantu', 'Pembelian Bahan')
    AND k.tanggal BETWEEN p_dari AND p_sampai
    AND (p_po_mulai IS NULL OR k.tanggal >= tanggal_awal_periode())
    AND (p_po_mulai IS NULL OR k.po_id IS NULL OR po_nomor(po.no_po) >= p_po_mulai)
    AND NOT (k.kategori = 'Biaya Overhead' AND k.overhead_sub_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM biaya_tetap bt WHERE bt.overhead_sub_id = k.overhead_sub_id AND bt.tenant_id = p_tenant_id))

  UNION ALL
  SELECT MAX(d.hari)::date, 'biaya_tetap', s.nama,
         bt.nama || ' — ' || COUNT(*) || ' hari × Rp ' ||
           to_char(ROUND(bt.nominal / (bt.tanggal_selesai - bt.tanggal_mulai + 1)), 'FM999G999G999'),
         NULL, COUNT(*), 'hari',
         ROUND(SUM(bt.nominal / (bt.tanggal_selesai - bt.tanggal_mulai + 1)), 2), NULL
  FROM biaya_tetap bt
  JOIN overhead_sub s ON s.id = bt.overhead_sub_id
  CROSS JOIN LATERAL generate_series(
    GREATEST(bt.tanggal_mulai, p_dari,
             CASE WHEN p_po_mulai IS NULL THEN p_dari ELSE date_trunc('month', tanggal_awal_periode())::date END),
    LEAST(bt.tanggal_selesai, p_sampai), interval '1 day') AS d(hari)
  WHERE bt.tenant_id = p_tenant_id
  GROUP BY bt.id, bt.nama, bt.nominal, bt.tanggal_mulai, bt.tanggal_selesai, s.nama, to_char(d.hari, 'YYYY-MM')
$function$;

CREATE OR REPLACE FUNCTION public.get_biaya_bahan_bulanan(p_dari date, p_sampai date, p_tenant_id text, p_po_mulai integer DEFAULT NULL::integer)
 RETURNS TABLE(bulan text, biaya_kain numeric, biaya_aksesori numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH k AS (
    SELECT to_char(CASE WHEN p_po_mulai IS NULL THEN (pb.created_at AT TIME ZONE 'Asia/Jakarta')::date ELSE GREATEST((pb.created_at AT TIME ZONE 'Asia/Jakarta')::date, tanggal_awal_periode()) END, 'YYYY-MM') bulan,
           SUM(COALESCE(NULLIF(pb.harga_pakai, 0), pb.qty_pakai * COALESCE(ib.harga_satuan, ii.harga_referensi, 0))) total
    FROM pemakaian_bahan pb
    LEFT JOIN inventory_batch ib ON ib.id = pb.inventory_batch_id
    JOIN inventory_item ii ON ii.id = pb.inventory_item_id
    JOIN po_item pi ON pi.id = pb.po_item_id JOIN po ON po.id = pi.po_id
    WHERE pb.tenant_id = p_tenant_id
      AND CASE WHEN p_po_mulai IS NULL THEN (pb.created_at AT TIME ZONE 'Asia/Jakarta')::date ELSE GREATEST((pb.created_at AT TIME ZONE 'Asia/Jakarta')::date, tanggal_awal_periode()) END BETWEEN p_dari AND p_sampai
      AND (p_po_mulai IS NULL OR po_nomor(po.no_po) >= p_po_mulai
           OR pb.bundle_id IN (SELECT bundle_id FROM periode_baru_bundle_khusus))
    GROUP BY 1),
  a AS (
    SELECT to_char(CASE WHEN p_po_mulai IS NULL THEN (pa.created_at AT TIME ZONE 'Asia/Jakarta')::date ELSE GREATEST((pa.created_at AT TIME ZONE 'Asia/Jakarta')::date, tanggal_awal_periode()) END, 'YYYY-MM') bulan,
           SUM(COALESCE(pa.harga_pakai, pa.qty_pakai * ii.harga_referensi, 0)) total
    FROM pemakaian_aksesori pa JOIN inventory_item ii ON ii.id = pa.inventory_item_id
    JOIN bundle b ON b.id = pa.bundle_id JOIN po_item pi ON pi.id = b.po_item_id JOIN po ON po.id = pi.po_id
    WHERE pa.tenant_id = p_tenant_id
      AND CASE WHEN p_po_mulai IS NULL THEN (pa.created_at AT TIME ZONE 'Asia/Jakarta')::date ELSE GREATEST((pa.created_at AT TIME ZONE 'Asia/Jakarta')::date, tanggal_awal_periode()) END BETWEEN p_dari AND p_sampai
      AND (p_po_mulai IS NULL OR po_nomor(po.no_po) >= p_po_mulai
           OR b.id IN (SELECT bundle_id FROM periode_baru_bundle_khusus))
    GROUP BY 1)
  SELECT COALESCE(k.bulan, a.bulan), COALESCE(k.total, 0), COALESCE(a.total, 0)
  FROM k FULL JOIN a ON a.bulan = k.bulan;
$function$;
