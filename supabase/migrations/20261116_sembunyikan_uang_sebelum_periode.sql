-- 16 Nov 2026: user minta semua angka uang sebelum periode baru disembunyikan
-- (pencatatan sebelum 14 Nov tidak disiplin). Saat p_po_mulai diisi (mode periode baru):
--   • Buku Kas sebelum tanggal_awal_periode() diabaikan
--   • alokasi biaya tetap (sewa) dihitung sejak awal bulan periode (sama dengan Laporan L/R)
-- Samakan dengan TANGGAL_AWAL_PERIODE di src/lib/keuangan/periode-po.ts.

CREATE OR REPLACE FUNCTION public.tanggal_awal_periode()
RETURNS date LANGUAGE sql IMMUTABLE AS $$ SELECT DATE '2026-11-14' $$;

CREATE OR REPLACE FUNCTION public.get_biaya_overhead(p_tenant_id text, p_dari date, p_sampai date, p_po_mulai integer DEFAULT NULL::integer)
 RETURNS TABLE(bulan text, jenis text, komponen_id uuid, komponen_nama text, sub_id uuid, sub_nama text, kategori text, nominal numeric, pcs numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT to_char(k.tanggal, 'YYYY-MM'), 'realisasi',
         COALESCE(s.hpp_komponen_id, k.komponen_id), hk.nama,
         k.overhead_sub_id, s.nama,
         k.kategori, SUM(k.nominal), NULL::numeric
  FROM buku_kas k
  LEFT JOIN overhead_sub s ON s.id = k.overhead_sub_id
  LEFT JOIN hpp_komponen hk ON hk.id = COALESCE(s.hpp_komponen_id, k.komponen_id)
  LEFT JOIN po ON po.id = k.po_id
  WHERE k.tenant_id = p_tenant_id AND k.tipe = 'keluar' AND k.kategori = 'Biaya Overhead'
    AND k.tanggal BETWEEN p_dari AND p_sampai
    AND (p_po_mulai IS NULL OR k.tanggal >= tanggal_awal_periode())
    AND (p_po_mulai IS NULL OR k.po_id IS NULL OR po_nomor(po.no_po) >= p_po_mulai)
    AND (k.overhead_sub_id IS NULL OR NOT EXISTS (
          SELECT 1 FROM biaya_tetap bt WHERE bt.overhead_sub_id = k.overhead_sub_id AND bt.tenant_id = p_tenant_id))
  GROUP BY 1, 3, 4, 5, 6, 7

  UNION ALL
  SELECT to_char(d.hari, 'YYYY-MM'), 'realisasi',
         s.hpp_komponen_id, hk.nama, s.id, s.nama,
         'Biaya Tetap', SUM(bt.nominal / (bt.tanggal_selesai - bt.tanggal_mulai + 1)), NULL
  FROM biaya_tetap bt
  JOIN overhead_sub s ON s.id = bt.overhead_sub_id
  LEFT JOIN hpp_komponen hk ON hk.id = s.hpp_komponen_id
  CROSS JOIN LATERAL generate_series(
    GREATEST(bt.tanggal_mulai, p_dari,
             CASE WHEN p_po_mulai IS NULL THEN p_dari ELSE date_trunc('month', tanggal_awal_periode())::date END),
    LEAST(bt.tanggal_selesai, p_sampai), interval '1 day') AS d(hari)
  WHERE bt.tenant_id = p_tenant_id
  GROUP BY 1, 3, 4, 5, 6

  UNION ALL
  SELECT to_char(k.tanggal, 'YYYY-MM'), 'lain', NULL, NULL, NULL, NULL,
         k.kategori, SUM(k.nominal), NULL
  FROM buku_kas k
  LEFT JOIN po ON po.id = k.po_id
  WHERE k.tenant_id = p_tenant_id AND k.tipe = 'keluar' AND k.kategori IN ('Biaya Operasional', 'Lainnya')
    AND k.tanggal BETWEEN p_dari AND p_sampai
    AND (p_po_mulai IS NULL OR k.tanggal >= tanggal_awal_periode())
    AND (p_po_mulai IS NULL OR k.po_id IS NULL OR po_nomor(po.no_po) >= p_po_mulai)
  GROUP BY 1, 7

  UNION ALL
  SELECT to_char(sj.tanggal, 'YYYY-MM'), 'patokan', hk.id, hk.nama, NULL, NULL, NULL,
         SUM(si.qty_kirim * hi.qty * hi.harga_satuan), SUM(si.qty_kirim)
  FROM surat_jalan sj
  JOIN surat_jalan_item si ON si.sj_id = sj.id
  JOIN bundle b ON b.id = si.bundle_id
  JOIN po_item pi ON pi.id = b.po_item_id
  JOIN po ON po.id = pi.po_id
  JOIN hpp_item hi ON hi.produk_id = pi.produk_id
  JOIN hpp_komponen hk ON hk.id = hi.komponen_id AND hk.kategori = 'overhead'
  WHERE sj.tenant_id = p_tenant_id AND sj.status <> 'draft' AND COALESCE(sj.jenis, 'normal') <> 'kirim_ulang'
    AND sj.tanggal BETWEEN p_dari AND p_sampai
    AND (p_po_mulai IS NULL OR po_nomor(po.no_po) >= p_po_mulai
         OR b.id IN (SELECT bundle_id FROM periode_baru_bundle_khusus))
  GROUP BY 1, 3, 4

  UNION ALL
  SELECT to_char(sj.tanggal, 'YYYY-MM'), 'pcs', NULL, NULL, NULL, NULL, NULL, NULL, SUM(si.qty_kirim)
  FROM surat_jalan sj
  JOIN surat_jalan_item si ON si.sj_id = sj.id
  JOIN bundle b ON b.id = si.bundle_id
  JOIN po_item pi ON pi.id = b.po_item_id
  JOIN po ON po.id = pi.po_id
  WHERE sj.tenant_id = p_tenant_id AND sj.status <> 'draft' AND COALESCE(sj.jenis, 'normal') <> 'kirim_ulang'
    AND sj.tanggal BETWEEN p_dari AND p_sampai
    AND (p_po_mulai IS NULL OR po_nomor(po.no_po) >= p_po_mulai
         OR b.id IN (SELECT bundle_id FROM periode_baru_bundle_khusus))
  GROUP BY 1
$function$;

CREATE OR REPLACE FUNCTION public.get_jurnal_produksi(p_tenant_id text, p_dari date, p_sampai date, p_po_mulai integer DEFAULT NULL::integer)
 RETURNS TABLE(tanggal date, jenis text, kategori text, keterangan text, no_po text, qty numeric, satuan text, nominal numeric, waktu timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT (pb.created_at AT TIME ZONE 'Asia/Jakarta')::date, 'kain', ii.nama,
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
    AND (pb.created_at AT TIME ZONE 'Asia/Jakarta')::date BETWEEN p_dari AND p_sampai
    AND (p_po_mulai IS NULL OR po_nomor(po.no_po) >= p_po_mulai
         OR pb.bundle_id IN (SELECT bundle_id FROM periode_baru_bundle_khusus))

  UNION ALL
  SELECT (pa.created_at AT TIME ZONE 'Asia/Jakarta')::date, 'aksesori', ii.nama,
         b.barcode || ' · ' || COALESCE(pa.tahap::text, '-'),
         po.no_po, pa.qty_pakai, ii.satuan,
         ROUND(COALESCE(pa.harga_pakai, pa.qty_pakai * ii.harga_referensi, 0), 2),
         pa.created_at
  FROM pemakaian_aksesori pa
  JOIN inventory_item ii ON ii.id = pa.inventory_item_id
  JOIN bundle b ON b.id = pa.bundle_id JOIN po_item pi ON pi.id = b.po_item_id JOIN po ON po.id = pi.po_id
  WHERE pa.tenant_id = p_tenant_id
    AND (pa.created_at AT TIME ZONE 'Asia/Jakarta')::date BETWEEN p_dari AND p_sampai
    AND (p_po_mulai IS NULL OR po_nomor(po.no_po) >= p_po_mulai
         OR b.id IN (SELECT bundle_id FROM periode_baru_bundle_khusus))

  UNION ALL
  SELECT gl.tanggal, 'upah', COALESCE(kr.nama, '-'), gl.keterangan, po.no_po, NULL, NULL,
         CASE WHEN gl.tipe::text = 'reject_potong' THEN -gl.total ELSE gl.total END,
         gl.created_at
  FROM gaji_ledger gl
  LEFT JOIN karyawan kr ON kr.id = gl.karyawan_id
  LEFT JOIN bundle b ON b.id::text = gl.sumber_id
  LEFT JOIN po_item pi ON pi.id = b.po_item_id LEFT JOIN po ON po.id = pi.po_id
  WHERE gl.tenant_id = p_tenant_id AND gl.status::text IN ('belum_lunas', 'lunas')
    AND gl.tanggal BETWEEN p_dari AND p_sampai
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
