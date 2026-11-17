-- Stock Opname: stok fisik LEBIH dari sistem = barang lama yang tidak dibeli periode ini.
-- (17 Nov 2026: Kerah Lakos 32,8 kg ter-opname dengan harga Rp 0 karena barang baru dibuat tanpa harga.)
--  * p_items[].harga (opsional) = harga beli per satuan untuk kelebihan stok.
--    Urutan harga: input user → harga LOT terakhir → harga_referensi; bila tetap 0 → tolak (wajib isi).
--  * Kelebihan dicatat sebagai LOT baru + Buku Kas "Setoran Modal" (masuk) DAN "Pembelian Bahan" (keluar)
--    senilai sama (MODAL-SISA, pindah buku → saldo kas tidak berubah),
--    sama seperti sisa bahan lama Toyobo (setoran_modal_sisa_bahan). Bukan pendapatan.
--  * harga_referensi barang yang masih 0 diisi dengan harga tersebut.
CREATE OR REPLACE FUNCTION public.simpan_stock_opname(p_items jsonb, p_tanggal date, p_catatan text, p_user_id uuid, p_tenant_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_it RECORD; v_inv RECORD; v_selisih numeric; v_nilai numeric; v_ambil RECORD; v_harga numeric;
  v_n int := 0; v_total numeric := 0;
BEGIN
  IF jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN RAISE EXCEPTION 'Tidak ada barang yang diisi'; END IF;
  FOR v_it IN SELECT (e->>'inventory_item_id')::uuid item_id, (e->>'stok_fisik')::numeric fisik,
                     NULLIF(e->>'harga', '')::numeric harga
              FROM jsonb_array_elements(p_items) e LOOP
    IF v_it.fisik IS NULL OR v_it.fisik < 0 THEN RAISE EXCEPTION 'Stok fisik tidak valid'; END IF;
    IF v_it.harga IS NOT NULL AND v_it.harga < 0 THEN RAISE EXCEPTION 'Harga tidak valid'; END IF;
    SELECT id, nama, satuan, stok_aktual, harga_referensi INTO v_inv FROM inventory_item
    WHERE id = v_it.item_id AND tenant_id = p_tenant_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Barang tidak ditemukan'; END IF;
    v_selisih := ROUND(v_it.fisik - v_inv.stok_aktual, 3);
    v_nilai := 0;
    IF v_selisih < 0 THEN
      IF EXISTS (SELECT 1 FROM inventory_batch WHERE inventory_item_id = v_inv.id AND tenant_id = p_tenant_id) THEN
        SELECT * INTO v_ambil FROM _ambil_stok_bahan_fifo(v_inv.id, -v_selisih, p_tenant_id);
        v_nilai := -COALESCE(v_ambil.harga, 0);
      ELSE
        UPDATE inventory_item SET stok_aktual = stok_aktual + v_selisih WHERE id = v_inv.id;
        v_nilai := v_selisih * COALESCE(v_inv.harga_referensi, 0);
      END IF;
    ELSIF v_selisih > 0 THEN
      v_harga := NULLIF(v_it.harga, 0);
      IF v_harga IS NULL THEN
        SELECT NULLIF(harga_satuan, 0) INTO v_harga FROM inventory_batch
        WHERE inventory_item_id = v_inv.id AND tenant_id = p_tenant_id
        ORDER BY tanggal_masuk DESC, created_at DESC LIMIT 1;
      END IF;
      v_harga := COALESCE(v_harga, NULLIF(v_inv.harga_referensi, 0));
      IF v_harga IS NULL THEN
        RAISE EXCEPTION 'Isi harga beli untuk % (stok lebih %, belum ada harga)', v_inv.nama, v_selisih;
      END IF;
      INSERT INTO inventory_batch (inventory_item_id, qty_awal, qty_sisa, harga_satuan, tanggal_masuk, jurnal_entry_id, tenant_id)
      VALUES (v_inv.id, v_selisih, v_selisih, v_harga, p_tanggal, NULL, p_tenant_id);
      UPDATE inventory_item SET stok_aktual = stok_aktual + v_selisih,
        harga_referensi = CASE WHEN COALESCE(harga_referensi, 0) = 0 THEN v_harga ELSE harga_referensi END
      WHERE id = v_inv.id;
      v_nilai := v_selisih * v_harga;
      INSERT INTO buku_kas (tenant_id, tanggal, tipe, kategori, nominal, keterangan, no_referensi, created_by)
      VALUES (p_tenant_id, p_tanggal, 'masuk', 'Setoran Modal', ROUND(v_nilai, 2),
        'Setoran modal berupa sisa bahan lama (' || v_inv.nama || ' '
          || replace(trim_scale(v_selisih)::text, '.', ',') || ' ' || COALESCE(v_inv.satuan, '')
          || ' @ Rp ' || replace(to_char(v_harga, 'FM999G999G999'), ',', '.')
          || ', dari stock opname) — pindah buku, bukan pendapatan',
        'MODAL-SISA', p_user_id);
      -- pasangan "pindah buku": seolah dibeli dengan uang setoran tadi → saldo kas tidak berubah
      INSERT INTO buku_kas (tenant_id, tanggal, tipe, kategori, nominal, keterangan, no_referensi, created_by)
      VALUES (p_tenant_id, p_tanggal, 'keluar', 'Pembelian Bahan', ROUND(v_nilai, 2),
        'Belanja ' || v_inv.nama || ' ' || replace(trim_scale(v_selisih)::text, '.', ',') || ' ' || COALESCE(v_inv.satuan, '')
          || ' — Sisa bahan lama (stock opname) — setoran modal (pindah buku)',
        'MODAL-SISA', p_user_id);
    END IF;
    INSERT INTO stock_opname (tanggal, inventory_item_id, stok_sistem, stok_fisik, selisih, nilai_selisih, catatan, tenant_id, created_by)
    VALUES (p_tanggal, v_inv.id, v_inv.stok_aktual, v_it.fisik, v_selisih, ROUND(v_nilai, 2), NULLIF(trim(COALESCE(p_catatan,'')),''), p_tenant_id, p_user_id);
    v_n := v_n + 1; v_total := v_total + v_nilai;
  END LOOP;
  INSERT INTO audit_log (user_id, modul, aksi, target, metadata, tenant_id)
  VALUES (p_user_id, 'inventory', 'Stock Opname', p_tanggal::text, jsonb_build_object('jumlah_barang', v_n, 'nilai_selisih', ROUND(v_total, 2)), p_tenant_id);
  RETURN jsonb_build_object('jumlah', v_n, 'nilai_selisih', ROUND(v_total, 2));
END; $function$;
