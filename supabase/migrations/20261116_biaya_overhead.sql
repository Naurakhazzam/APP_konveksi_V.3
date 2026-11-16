-- Menu Keuangan → Biaya Overhead (16 Nov 2026).
-- Realisasi  = Buku Kas keluar kategori 'Biaya Overhead', per sub-kelompok → komponen HPP.
-- Patokan    = tarif komponen overhead di HPP × pcs SUDAH DIKIRIM (surat jalan non-draft),
--              karena klien membayar setelah barang dikirim (keputusan user).
-- Lain       = Biaya Operasional & Lainnya (belum ditetapkan komponennya; user menentukan per kasus).

-- Tagihan Bulanan (listrik, internet, sampah) ditanggung komponen Listrik (keputusan user)
UPDATE public.overhead_sub
SET hpp_komponen_id = (SELECT id FROM public.hpp_komponen WHERE tenant_id = 'STX-001' AND nama = 'Listrik')
WHERE tenant_id = 'STX-001' AND nama = 'Tagihan Bulanan (listrik, internet, sampah)';

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
  -- Realisasi overhead per sub-kelompok
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
  GROUP BY 1, 3, 4, 5, 6, 7

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
  -- Total pcs terkirim per bulan (sekali, tidak dikali jumlah komponen)
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

REVOKE ALL ON FUNCTION public.get_biaya_overhead(text, date, date, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_biaya_overhead(text, date, date, integer) TO authenticated;

-- Pasang sub-kelompok untuk entri overhead lama (menu "Perlu dirapikan")
CREATE OR REPLACE FUNCTION public.atur_sub_overhead(p_buku_kas_id uuid, p_sub_id uuid, p_tenant_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_komp uuid;
BEGIN
  SELECT hpp_komponen_id INTO v_komp FROM overhead_sub WHERE id = p_sub_id AND tenant_id = p_tenant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sub-kelompok tidak ditemukan'; END IF;
  UPDATE buku_kas SET overhead_sub_id = p_sub_id, komponen_id = v_komp
  WHERE id = p_buku_kas_id AND tenant_id = p_tenant_id AND kategori = 'Biaya Overhead'
    AND inventory_batch_id IS NULL AND sumber_gaji IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Entri overhead tidak ditemukan'; END IF;
END $function$;

REVOKE ALL ON FUNCTION public.atur_sub_overhead(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.atur_sub_overhead(uuid, uuid, text) TO authenticated;
