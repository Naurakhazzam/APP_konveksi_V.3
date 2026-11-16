-- Pendapatan diakui saat Surat Jalan dibuat (qty kirim × harga jual) lalu dicocokkan
-- dengan hasil Validasi Kirim (qty diterima, reject, qty lebih yang disetujui).
-- Sumber angka: invoice.total_nilai − invoice.potongan_reject.

-- 1. Harga jual dicatat per baris SJ (snapshot), supaya koreksi validasi memakai harga
--    saat SJ dibuat, bukan harga master yang mungkin sudah berubah.
ALTER TABLE surat_jalan_item ADD COLUMN IF NOT EXISTS harga_satuan numeric;

CREATE OR REPLACE FUNCTION _isi_harga_sj_item()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.harga_satuan IS NULL AND NEW.bundle_id IS NOT NULL THEN
    SELECT p.harga_jual INTO NEW.harga_satuan
    FROM bundle b JOIN po_item pi ON pi.id = b.po_item_id JOIN produk p ON p.id = pi.produk_id
    WHERE b.id = NEW.bundle_id;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_isi_harga_sj_item ON surat_jalan_item;
CREATE TRIGGER trg_isi_harga_sj_item BEFORE INSERT ON surat_jalan_item
  FOR EACH ROW EXECUTE FUNCTION _isi_harga_sj_item();

-- Backfill: harga master × faktor per SJ, supaya Σ qty_kirim × harga_satuan = total invoice yang ada
-- (harga jual master berubah 15 Nov 2026; invoice lama memakai harga lama).
WITH dasar AS (
  SELECT sji.id, sji.sj_id, sji.qty_kirim, COALESCE(p.harga_jual, 0) AS hj
  FROM surat_jalan_item sji
  JOIN bundle b ON b.id = sji.bundle_id
  JOIN po_item pi ON pi.id = b.po_item_id
  JOIN produk p ON p.id = pi.produk_id
  WHERE sji.harga_satuan IS NULL
), per_sj AS (
  SELECT d.sj_id, SUM(d.qty_kirim * d.hj) AS nilai_master, MAX(i.total_nilai) AS nilai_invoice
  FROM dasar d LEFT JOIN invoice i ON i.surat_jalan_id = d.sj_id
  GROUP BY d.sj_id
)
UPDATE surat_jalan_item sji
SET harga_satuan = ROUND(d.hj * CASE
      WHEN ps.nilai_master > 0 AND ps.nilai_invoice > 0 THEN ps.nilai_invoice / ps.nilai_master
      ELSE 1 END, 2)
FROM dasar d JOIN per_sj ps ON ps.sj_id = d.sj_id
WHERE sji.id = d.id;

-- 2. Validasi: invoice ikut qty diterima (kurang → tagihan berkurang). Qty lebih tetap
--    menunggu persetujuan owner. Aman untuk validasi ulang (dihitung dari selisih qty lama).
CREATE OR REPLACE FUNCTION public.validasi_pengiriman(p_surat_jalan_id uuid, p_items jsonb, p_catatan text, p_user_id uuid, p_tenant_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_item              jsonb;
  v_sji_id            uuid;
  v_bundle_id         uuid;
  v_qty_kirim         int;
  v_qty_diterima      int;
  v_qty_lama          int;
  v_selisih           int;
  v_alasan_reject_id  uuid;
  v_qty_reject        int;
  v_reject_alasan_id  uuid;
  v_reject_ket        text;
  v_produk_id         uuid;
  v_harga             numeric;
  v_barcode           text;
  v_delta_nilai       numeric   := 0;
  v_has_kurang        boolean   := false;
  v_has_lebih         boolean   := false;
  v_approval_ids      jsonb     := '[]'::jsonb;
  v_status_final      sj_status := 'tervalidasi';
  v_approval_id       uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM surat_jalan WHERE id = p_surat_jalan_id AND jenis = 'kirim_ulang') THEN
    RAISE EXCEPTION '[SJ KIRIM ULANG] Surat jalan kirim ulang divalidasi lewat form kirim ulang.';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_sji_id           := (v_item->>'surat_jalan_item_id')::uuid;
    v_qty_diterima     := (v_item->>'qty_diterima')::int;
    v_alasan_reject_id := NULLIF(v_item->>'alasan_reject_id', '')::uuid;
    v_qty_reject       := COALESCE(NULLIF(v_item->>'qty_reject', '')::int, 0);
    v_reject_alasan_id := NULLIF(v_item->>'reject_alasan_id', '')::uuid;
    v_reject_ket       := NULLIF(trim(v_item->>'reject_keterangan'), '');

    -- Ambil data item dari DB (jangan percaya qty_kirim/bundle dari client)
    SELECT sji.bundle_id, sji.qty_kirim, sji.qty_diterima, pi.produk_id,
           COALESCE(sji.harga_satuan, pr.harga_jual, 0), b.barcode
    INTO v_bundle_id, v_qty_kirim, v_qty_lama, v_produk_id, v_harga, v_barcode
    FROM surat_jalan_item sji
    JOIN bundle b   ON b.id = sji.bundle_id
    JOIN po_item pi ON pi.id = b.po_item_id
    JOIN produk pr  ON pr.id = pi.produk_id
    WHERE sji.id = v_sji_id AND sji.sj_id = p_surat_jalan_id AND sji.tenant_id = p_tenant_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION '[ITEM TIDAK DITEMUKAN] Baris surat jalan tidak cocok. Muat ulang halaman.';
    END IF;

    IF v_qty_diterima IS NULL OR v_qty_diterima < 0 THEN
      RAISE EXCEPTION '[QTY TIDAK VALID] Qty diterima % tidak valid.', v_barcode;
    END IF;

    v_selisih := v_qty_diterima - v_qty_kirim;

    -- Pendapatan: yang diakui = min(diterima, kirim). Selisih terhadap pengakuan sebelumnya.
    v_delta_nilai := v_delta_nilai
      + (LEAST(v_qty_diterima, v_qty_kirim) - LEAST(COALESCE(v_qty_lama, v_qty_kirim), v_qty_kirim)) * v_harga;

    UPDATE surat_jalan_item
    SET qty_diterima = v_qty_diterima
    WHERE id = v_sji_id AND tenant_id = p_tenant_id;

    IF v_selisih < 0 THEN
      v_has_kurang := true;
      IF v_alasan_reject_id IS NOT NULL THEN
        INSERT INTO reject_log (
          nomor_reject, alasan_reject_id, qty_reject, tahap_ditemukan,
          source, bundle_id, surat_jalan_id,
          keterangan, status, tenant_id, created_by
        ) VALUES (
          generate_nomor_reject(p_tenant_id, CURRENT_DATE),
          v_alasan_reject_id, ABS(v_selisih), 'pengiriman',
          'konsumen', v_bundle_id, p_surat_jalan_id,
          'Selisih validasi: kirim ' || v_qty_kirim || ' pcs, diterima ' || v_qty_diterima || ' pcs',
          'menunggu_konfirmasi', p_tenant_id, p_user_id
        );
      END IF;
    END IF;

    IF v_selisih > 0 THEN
      v_has_lebih := true;
      INSERT INTO qty_approval_request (
        bundle_id, tahap, qty_diajukan, qty_default,
        status, tenant_id, created_by
      ) VALUES (
        v_bundle_id, 'pengiriman', v_selisih, v_qty_kirim,
        'pending', p_tenant_id, p_user_id
      )
      RETURNING id INTO v_approval_id;

      v_approval_ids := v_approval_ids || jsonb_build_array(v_approval_id::text);
    END IF;

    -- Reject yang ditemukan saat terima (barang sampai tapi cacat → diretur).
    -- Validasi ulang mengganti catatan sebelumnya untuk baris ini, kecuali
    -- reject baris ini sudah punya kirim ulang (dibiarkan apa adanya).
    IF NOT EXISTS (
      SELECT 1 FROM reject_kantor rk
      JOIN kirim_ulang_item k ON k.reject_kantor_id = rk.id
      WHERE rk.surat_jalan_item_id = v_sji_id AND rk.waktu_temuan = 'saat_terima'
    ) THEN
      DELETE FROM reject_kantor
      WHERE surat_jalan_item_id = v_sji_id AND waktu_temuan = 'saat_terima';

      IF v_qty_reject > 0 THEN
        IF v_reject_alasan_id IS NULL THEN
          RAISE EXCEPTION '[ALASAN KOSONG] Pilih alasan reject untuk %.', v_barcode;
        END IF;
        IF v_qty_reject > v_qty_diterima THEN
          RAISE EXCEPTION '[REJECT MELEBIHI] %: reject % pcs lebih banyak dari yang diterima (% pcs).',
            v_barcode, v_qty_reject, v_qty_diterima;
        END IF;

        INSERT INTO reject_kantor (
          nomor_reject, surat_jalan_id, surat_jalan_item_id, produk_id, bundle_id,
          alasan_reject_id, qty, harga_satuan, waktu_temuan, keterangan, tenant_id, created_by
        ) VALUES (
          _nomor_reject_kantor(p_tenant_id, CURRENT_DATE), p_surat_jalan_id, v_sji_id, v_produk_id, v_bundle_id,
          v_reject_alasan_id, v_qty_reject, v_harga, 'saat_terima', v_reject_ket, p_tenant_id, p_user_id
        );
      END IF;
    END IF;
  END LOOP;

  IF v_delta_nilai <> 0 THEN
    UPDATE invoice SET total_nilai = GREATEST(total_nilai + v_delta_nilai, 0)
    WHERE surat_jalan_id = p_surat_jalan_id AND tenant_id = p_tenant_id;
  END IF;
  -- Segarkan potongan reject & status lunas terhadap total baru
  PERFORM _sinkron_potongan_invoice(p_surat_jalan_id);

  IF v_has_lebih THEN
    v_status_final := 'selisih_lebih';
  ELSIF v_has_kurang THEN
    v_status_final := 'selisih_kurang';
  END IF;

  UPDATE surat_jalan
  SET status           = v_status_final,
      catatan_validasi = p_catatan,
      tanggal_validasi = CURRENT_DATE,
      validated_by     = p_user_id
  WHERE id = p_surat_jalan_id AND tenant_id = p_tenant_id;

  RETURN jsonb_build_object(
    'status',       v_status_final,
    'has_kurang',   v_has_kurang,
    'has_lebih',    v_has_lebih,
    'approval_ids', v_approval_ids
  );
END;
$function$;

-- 3. Qty lebih yang disetujui menambah tagihan dengan HARGA JUAL (sebelumnya keliru memakai HPP).
--    Tidak lagi membuat jurnal pendapatan terpisah: pendapatan dibaca dari invoice.
CREATE OR REPLACE FUNCTION public.approve_qty_lebih_pengiriman(p_approval_id uuid, p_user_id uuid, p_catatan text, p_tenant_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_req          record;
  v_sj_id        uuid;
  v_harga        numeric;
  v_invoice_id   uuid;
  v_tambahan     numeric;
BEGIN
  SELECT * INTO v_req
  FROM qty_approval_request
  WHERE id = p_approval_id AND tenant_id = p_tenant_id AND status = 'pending';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Approval request tidak ditemukan atau sudah diproses';
  END IF;

  SELECT sj.id, COALESCE(sji.harga_satuan, pr.harga_jual, 0)
  INTO v_sj_id, v_harga
  FROM surat_jalan      sj
  JOIN surat_jalan_item sji ON sji.sj_id = sj.id
  JOIN bundle b   ON b.id = sji.bundle_id
  JOIN po_item pi ON pi.id = b.po_item_id
  JOIN produk pr  ON pr.id = pi.produk_id
  WHERE sji.bundle_id = v_req.bundle_id
    AND sj.tenant_id  = p_tenant_id
    AND sj.status     = 'selisih_lebih'
  ORDER BY sj.created_at DESC
  LIMIT 1;

  v_tambahan := v_req.qty_diajukan * COALESCE(v_harga, 0);

  IF v_sj_id IS NOT NULL THEN
    SELECT id INTO v_invoice_id
    FROM invoice
    WHERE surat_jalan_id = v_sj_id AND tenant_id = p_tenant_id
    LIMIT 1;
  END IF;

  IF v_invoice_id IS NOT NULL AND v_tambahan > 0 THEN
    UPDATE invoice SET total_nilai = total_nilai + v_tambahan WHERE id = v_invoice_id;
    PERFORM _sinkron_potongan_invoice(v_sj_id);
  END IF;

  UPDATE qty_approval_request
  SET status = 'approved', catatan_owner = p_catatan,
      resolved_by = p_user_id, resolved_at = now()
  WHERE id = p_approval_id;

  IF v_sj_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM qty_approval_request qar
    JOIN surat_jalan_item     sji ON sji.bundle_id = qar.bundle_id
    WHERE sji.sj_id    = v_sj_id
      AND qar.tahap    = 'pengiriman'
      AND qar.status   = 'pending'
      AND qar.tenant_id = p_tenant_id
  ) THEN
    UPDATE surat_jalan SET status = 'tervalidasi'
    WHERE id = v_sj_id AND tenant_id = p_tenant_id;
  END IF;

  RETURN jsonb_build_object('success', true, 'tambahan', v_tambahan, 'invoice_id', v_invoice_id);
END;
$function$;
