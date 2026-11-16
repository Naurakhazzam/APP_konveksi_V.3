-- Biaya tetap berbasis kontrak (mis. kontrak rumah Rp 45 jt / tahun).
-- Dialokasikan PER HARI selama masa kontrak (keputusan user 16 Nov 2026), dan menjadi
-- realisasi sub-kelompok overhead-nya di menu Biaya Overhead. Pembayaran kontrak di Buku Kas
-- untuk sub-kelompok yang punya biaya tetap TIDAK dihitung langsung (hindari dobel).
CREATE TABLE IF NOT EXISTS public.biaya_tetap (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       text NOT NULL DEFAULT 'STX-001',
  nama            text NOT NULL,
  overhead_sub_id uuid NOT NULL REFERENCES public.overhead_sub(id),
  nominal         numeric NOT NULL CHECK (nominal > 0),
  tanggal_mulai   date NOT NULL,
  tanggal_selesai date NOT NULL,
  catatan         text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (tanggal_selesai >= tanggal_mulai)
);
ALTER TABLE public.biaya_tetap ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS biaya_tetap_tenant_isolation ON public.biaya_tetap;
CREATE POLICY biaya_tetap_tenant_isolation ON public.biaya_tetap FOR ALL USING (tenant_id = 'STX-001');

-- Kontrak rumah berjalan: 30 Sep 2026 – 29 Sep 2027, Rp 45.000.000
INSERT INTO public.biaya_tetap (tenant_id, nama, overhead_sub_id, nominal, tanggal_mulai, tanggal_selesai)
SELECT 'STX-001', 'Kontrak Rumah 2026–2027', s.id, 45000000, DATE '2026-09-30', DATE '2027-09-29'
FROM public.overhead_sub s
WHERE s.tenant_id = 'STX-001' AND s.nama = 'Sewa Rumah'
  AND NOT EXISTS (SELECT 1 FROM public.biaya_tetap WHERE tenant_id = 'STX-001' AND nama = 'Kontrak Rumah 2026–2027');

-- Semua sub-kelompok ini ditanggung komponen HPP Operasional (keputusan user 16 Nov 2026)
UPDATE public.overhead_sub
SET hpp_komponen_id = (SELECT id FROM public.hpp_komponen WHERE tenant_id = 'STX-001' AND nama = 'Operasional')
WHERE tenant_id = 'STX-001' AND nama IN ('Bensin', 'Gas (setrika uap)', 'Service Mesin', 'Perbaikan Gedung');

CREATE OR REPLACE FUNCTION public.get_biaya_overhead(
  p_tenant_id text, p_dari date, p_sampai date, p_po_mulai integer DEFAULT NULL)
RETURNS TABLE(
  bulan text, jenis text,
  komponen_id uuid, komponen_nama text,
  sub_id uuid, sub_nama text,
  kategori text, nominal numeric, pcs numeric)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  -- Realisasi overhead dari Buku Kas (kecuali sub-kelompok yang dibiayai lewat kontrak)
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
    AND (p_po_mulai IS NULL OR k.po_id IS NULL OR po_nomor(po.no_po) >= p_po_mulai)
    AND (k.overhead_sub_id IS NULL OR NOT EXISTS (
          SELECT 1 FROM biaya_tetap bt WHERE bt.overhead_sub_id = k.overhead_sub_id AND bt.tenant_id = p_tenant_id))
  GROUP BY 1, 3, 4, 5, 6, 7

  UNION ALL
  -- Realisasi dari biaya tetap: nominal kontrak ÷ jumlah hari kontrak × hari yang masuk rentang
  SELECT to_char(d.hari, 'YYYY-MM'), 'realisasi',
         s.hpp_komponen_id, hk.nama, s.id, s.nama,
         'Biaya Tetap', SUM(bt.nominal / (bt.tanggal_selesai - bt.tanggal_mulai + 1)), NULL
  FROM biaya_tetap bt
  JOIN overhead_sub s ON s.id = bt.overhead_sub_id
  LEFT JOIN hpp_komponen hk ON hk.id = s.hpp_komponen_id
  CROSS JOIN LATERAL generate_series(GREATEST(bt.tanggal_mulai, p_dari), LEAST(bt.tanggal_selesai, p_sampai), interval '1 day') AS d(hari)
  WHERE bt.tenant_id = p_tenant_id
  GROUP BY 1, 3, 4, 5, 6

  UNION ALL
  -- Biaya Operasional & Lainnya (di luar overhead)
  SELECT to_char(k.tanggal, 'YYYY-MM'), 'lain', NULL, NULL, NULL, NULL,
         k.kategori, SUM(k.nominal), NULL
  FROM buku_kas k
  LEFT JOIN po ON po.id = k.po_id
  WHERE k.tenant_id = p_tenant_id AND k.tipe = 'keluar' AND k.kategori IN ('Biaya Operasional', 'Lainnya')
    AND k.tanggal BETWEEN p_dari AND p_sampai
    AND (p_po_mulai IS NULL OR k.po_id IS NULL OR po_nomor(po.no_po) >= p_po_mulai)
  GROUP BY 1, 7

  UNION ALL
  -- Patokan: tarif overhead HPP × pcs terkirim, per komponen
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
  -- Total pcs terkirim per bulan
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
