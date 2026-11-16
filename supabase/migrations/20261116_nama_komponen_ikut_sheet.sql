-- Nama komponen overhead HPP disamakan dengan nama baris di Google Sheet HPP (keputusan user 16 Nov 2026).
-- Angka HPP tidak berubah. Patokan overhead per PO kini memilih komponen lewat kategori,
-- bukan nama, agar tidak rusak bila nama diganti lagi.
CREATE OR REPLACE FUNCTION public.get_patokan_tidak_langsung_per_po(p_tenant_id text)
 RETURNS TABLE(po_id uuid, patokan_overhead numeric, patokan_pembantu numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT pi.po_id,
    SUM(pi.qty_order * COALESCE((SELECT SUM(hi.qty * hi.harga_satuan) FROM hpp_item hi JOIN hpp_komponen hk ON hk.id = hi.komponen_id
        WHERE hi.produk_id = pi.produk_id AND hk.kategori = 'overhead'), 0)),
    SUM(pi.qty_order * COALESCE((SELECT SUM(t.tarif) FROM v_pembantu_tarif_produk t WHERE t.produk_id = pi.produk_id), 0))
  FROM po_item pi WHERE pi.tenant_id = p_tenant_id GROUP BY pi.po_id
$function$;

UPDATE public.hpp_komponen SET nama = 'Operasional' WHERE tenant_id = 'STX-001' AND nama = 'Operasional Sehari-hari';
UPDATE public.hpp_komponen SET nama = 'Sewa Rumah'  WHERE tenant_id = 'STX-001' AND nama = 'Operasional Rumah';
UPDATE public.hpp_komponen SET nama = 'Listrik'     WHERE tenant_id = 'STX-001' AND nama = 'Operasional Listrik';
UPDATE public.hpp_komponen SET nama = 'Makan'       WHERE tenant_id = 'STX-001' AND nama = 'Uang Makan';

-- Sub-kelompok overhead yang memakai nama komponen lama
UPDATE public.overhead_sub SET nama = 'Operasional' WHERE tenant_id = 'STX-001' AND nama = 'Operasional Sehari-hari';
UPDATE public.overhead_sub SET nama = 'Sewa Rumah'  WHERE tenant_id = 'STX-001' AND nama = 'Operasional Rumah';
