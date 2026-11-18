-- ============================================================================
-- Reject Kantor v2 (Sesi 2 — Fase 2+3 rencana Pengiriman, 18 Nov 2026)
--
-- 1. Lapor reject belakangan TANPA pilih SJ: kantor pilih produk + qty + alasan,
--    sistem membagi ke surat jalan secara FIFO (SJ terlama dulu, per baris SJ),
--    boleh pecah ke beberapa SJ. Harga = harga di baris SJ asal (bukan harga
--    jual produk saat ini — bug lama lapor_reject_kantor).
--    Yang dihitung: SJ biasa periode baru (≥ tanggal_awal_periode) yang sudah
--    divalidasi kantor.
-- 2. Reject barang lama (di luar sistem): tanpa SJ, tidak memotong invoice,
--    langsung jadi kerugian reject (dipakai L/R di Sesi 3); batal kalau
--    dikirim ulang lewat SJ kirim ulang.
-- 3. Tingkat reject: minor / mayor / parah.
-- 4. Penyelesaian "dibeli kantor": kantor membeli barang reject dengan harga
--    lebih murah (default = harga jual normal, kantor ubah). Potongan permanen
--    = (harga SJ − harga beli) × pcs yang belum dikirim ulang.
-- ============================================================================

-- ─── 1. Kolom & constraint ─────────────────────────────────────────────────

ALTER TABLE reject_kantor ALTER COLUMN surat_jalan_id DROP NOT NULL;

ALTER TABLE reject_kantor
  ADD COLUMN IF NOT EXISTS sumber            text NOT NULL DEFAULT 'sj',
  ADD COLUMN IF NOT EXISTS tingkat           text NOT NULL DEFAULT 'mayor',
  ADD COLUMN IF NOT EXISTS klien_id          uuid REFERENCES klien(id),
  ADD COLUMN IF NOT EXISTS harga_beli_kantor numeric;

UPDATE reject_kantor rk SET klien_id = sj.klien_id
FROM surat_jalan sj WHERE sj.id = rk.surat_jalan_id AND rk.klien_id IS NULL;

ALTER TABLE reject_kantor DROP CONSTRAINT IF EXISTS reject_kantor_status_check;
ALTER TABLE reject_kantor ADD CONSTRAINT reject_kantor_status_check
  CHECK (status IN ('retur', 'diperbaiki', 'tidak_bisa', 'dibeli_kantor', 'selesai'));

ALTER TABLE reject_kantor DROP CONSTRAINT IF EXISTS reject_kantor_sumber_check;
ALTER TABLE reject_kantor ADD CONSTRAINT reject_kantor_sumber_check
  CHECK ((sumber = 'sj' AND surat_jalan_id IS NOT NULL)
      OR (sumber = 'barang_lama' AND surat_jalan_id IS NULL AND klien_id IS NOT NULL));

ALTER TABLE reject_kantor DROP CONSTRAINT IF EXISTS reject_kantor_tingkat_check;
ALTER TABLE reject_kantor ADD CONSTRAINT reject_kantor_tingkat_check
  CHECK (tingkat IN ('minor', 'mayor', 'parah'));

ALTER TABLE reject_kantor DROP CONSTRAINT IF EXISTS reject_kantor_dibeli_check;
ALTER TABLE reject_kantor ADD CONSTRAINT reject_kantor_dibeli_check
  CHECK ((status = 'dibeli_kantor') = (harga_beli_kantor IS NOT NULL) AND COALESCE(harga_beli_kantor, 0) >= 0);

CREATE INDEX IF NOT EXISTS idx_reject_kantor_sji ON reject_kantor (surat_jalan_item_id);

-- ─── 2. Nilai potongan per baris & sinkron invoice ─────────────────────────

-- Nilai yang hilang dari tagihan/pendapatan untuk satu catatan reject:
--   pcs belum dikirim ulang × harga SJ, atau × (harga SJ − harga beli) bila dibeli kantor.
CREATE OR REPLACE FUNCTION _nilai_potongan_reject(p_rk reject_kantor)
RETURNS numeric LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT GREATEST(p_rk.qty - _reject_kantor_terkirim(p_rk.id), 0)
       * CASE WHEN p_rk.status = 'dibeli_kantor'
              THEN GREATEST(p_rk.harga_satuan - COALESCE(p_rk.harga_beli_kantor, 0), 0)
              ELSE p_rk.harga_satuan END;
$$;

CREATE OR REPLACE FUNCTION _sinkron_potongan_invoice(p_sj_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_pot numeric;
BEGIN
  IF p_sj_id IS NULL THEN RETURN; END IF;

  SELECT COALESCE(SUM(_nilai_potongan_reject(rk)), 0)
  INTO v_pot
  FROM reject_kantor rk
  WHERE rk.surat_jalan_id = p_sj_id;

  UPDATE invoice
  SET potongan_reject = v_pot,
      status = CASE
        WHEN COALESCE(total_bayar, 0) = 0 THEN 'belum_bayar'
        WHEN COALESCE(total_bayar, 0) >= GREATEST(total_nilai - v_pot, 0) THEN 'lunas'
        ELSE 'dp'
      END
  WHERE surat_jalan_id = p_sj_id;
END $$;

CREATE OR REPLACE FUNCTION _trg_reject_kantor_sinkron()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    PERFORM _sinkron_potongan_invoice(OLD.surat_jalan_id);
  END IF;
  IF TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND NEW.surat_jalan_id IS DISTINCT FROM OLD.surat_jalan_id) THEN
    PERFORM _sinkron_potongan_invoice(NEW.surat_jalan_id);
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_reject_kantor_sinkron ON reject_kantor;
CREATE TRIGGER trg_reject_kantor_sinkron
  AFTER INSERT OR DELETE OR UPDATE OF qty, harga_satuan, surat_jalan_id, status, harga_beli_kantor ON reject_kantor
  FOR EACH ROW EXECUTE FUNCTION _trg_reject_kantor_sinkron();

-- ─── 3. Lapor reject belakangan: alokasi FIFO ──────────────────────────────

DROP FUNCTION IF EXISTS lapor_reject_kantor(uuid, uuid, integer, uuid, text, text);

-- Baris SJ yang masih bisa dilapor reject untuk satu produk, urut FIFO.
CREATE OR REPLACE FUNCTION _kapasitas_reject_fifo(p_produk_id uuid, p_tenant_id text)
RETURNS TABLE (sji_id uuid, sj_id uuid, nomor_sj text, klien_id uuid, bundle_id uuid, harga numeric, sisa int)
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT sji.id, sj.id, sj.nomor_sj, sj.klien_id, sji.bundle_id,
         COALESCE(sji.harga_satuan, pr.harga_jual, 0),
         (LEAST(COALESCE(sji.qty_diterima, sji.qty_kirim), sji.qty_kirim)
          - COALESCE((SELECT SUM(rk.qty) FROM reject_kantor rk WHERE rk.surat_jalan_item_id = sji.id), 0))::int
  FROM surat_jalan_item sji
  JOIN surat_jalan sj ON sj.id = sji.sj_id
  JOIN bundle b       ON b.id = sji.bundle_id
  JOIN po_item pi     ON pi.id = b.po_item_id
  JOIN produk pr      ON pr.id = pi.produk_id
  WHERE pi.produk_id = p_produk_id
    AND sj.tenant_id = p_tenant_id
    AND sj.jenis = 'normal'
    AND sj.tanggal_validasi IS NOT NULL
    AND sj.tanggal >= tanggal_awal_periode()
    AND (LEAST(COALESCE(sji.qty_diterima, sji.qty_kirim), sji.qty_kirim)
         - COALESCE((SELECT SUM(rk.qty) FROM reject_kantor rk WHERE rk.surat_jalan_item_id = sji.id), 0)) > 0
  ORDER BY sj.tanggal, sj.nomor_sj, sji.urutan NULLS LAST, sji.created_at;
$$;

CREATE OR REPLACE FUNCTION lapor_reject_kantor(
  p_produk_id        uuid,
  p_qty              int,
  p_alasan_reject_id uuid,
  p_tingkat          text,
  p_keterangan       text,
  p_tenant_id        text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_role   text := get_current_user_role();
  v_nama   text;
  v_total  int;
  v_sisa   int := p_qty;
  v_ambil  int;
  v_row    RECORD;
  v_nomor  text;
  v_hasil  jsonb := '[]'::jsonb;
BEGIN
  IF v_role IS NULL OR v_role NOT IN ('owner', 'admin_keuangan', 'admin_produksi') THEN
    RAISE EXCEPTION '[TIDAK BERHAK] Role Anda tidak bisa mencatat reject kantor.';
  END IF;
  IF p_qty IS NULL OR p_qty < 1 THEN
    RAISE EXCEPTION '[QTY TIDAK VALID] Qty reject minimal 1 pcs.';
  END IF;
  IF p_alasan_reject_id IS NULL THEN
    RAISE EXCEPTION '[ALASAN KOSONG] Pilih alasan reject.';
  END IF;
  IF p_tingkat IS NULL OR p_tingkat NOT IN ('minor', 'mayor', 'parah') THEN
    RAISE EXCEPTION '[TINGKAT KOSONG] Pilih tingkat reject: minor / mayor / parah.';
  END IF;

  -- Kunci yang sama dengan penomoran → dua laporan bersamaan tidak berebut kapasitas.
  PERFORM pg_advisory_xact_lock(hashtext('reject_kantor:' || p_tenant_id));

  SELECT nama INTO v_nama FROM produk WHERE id = p_produk_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION '[PRODUK TIDAK DITEMUKAN] Produk tidak ada di sistem.';
  END IF;

  SELECT COALESCE(SUM(sisa), 0) INTO v_total FROM _kapasitas_reject_fifo(p_produk_id, p_tenant_id);
  IF v_total < p_qty THEN
    RAISE EXCEPTION '[QTY MELEBIHI] % yang sudah diterima kantor (dan belum dicatat reject) hanya % pcs. Kalau barangnya dari kiriman lama di luar sistem, pakai pilihan "Barang lama".',
      v_nama, v_total;
  END IF;

  FOR v_row IN SELECT * FROM _kapasitas_reject_fifo(p_produk_id, p_tenant_id) LOOP
    EXIT WHEN v_sisa <= 0;
    v_ambil := LEAST(v_sisa, v_row.sisa);
    v_nomor := _nomor_reject_kantor(p_tenant_id, CURRENT_DATE);

    INSERT INTO reject_kantor (
      nomor_reject, surat_jalan_id, surat_jalan_item_id, produk_id, bundle_id, alasan_reject_id,
      qty, harga_satuan, waktu_temuan, keterangan, tingkat, sumber, klien_id, tenant_id, created_by
    ) VALUES (
      v_nomor, v_row.sj_id, v_row.sji_id, p_produk_id, v_row.bundle_id, p_alasan_reject_id,
      v_ambil, v_row.harga, 'belakangan', NULLIF(trim(p_keterangan), ''), p_tingkat, 'sj', v_row.klien_id,
      p_tenant_id, auth.uid()
    );

    v_hasil := v_hasil || jsonb_build_object('nomor_reject', v_nomor, 'nomor_sj', v_row.nomor_sj, 'qty', v_ambil);
    v_sisa := v_sisa - v_ambil;
  END LOOP;

  INSERT INTO audit_log (user_id, modul, aksi, target, metadata, tenant_id)
  VALUES (auth.uid(), 'pengiriman', 'Lapor Reject Kantor', v_nama,
          jsonb_build_object('produk', v_nama, 'qty', p_qty, 'tingkat', p_tingkat, 'alokasi', v_hasil), p_tenant_id);

  RETURN jsonb_build_object('alokasi', v_hasil);
END $$;

-- ─── 4. Lapor reject barang lama (di luar sistem) ──────────────────────────

CREATE OR REPLACE FUNCTION lapor_reject_barang_lama(
  p_produk_id        uuid,
  p_klien_id         uuid,
  p_qty              int,
  p_alasan_reject_id uuid,
  p_tingkat          text,
  p_harga_satuan     numeric,
  p_keterangan       text,
  p_tenant_id        text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_role  text := get_current_user_role();
  v_nama  text;
  v_harga numeric;
  v_klien uuid := p_klien_id;
  v_nomor text;
  v_id    uuid;
BEGIN
  IF v_role IS NULL OR v_role NOT IN ('owner', 'admin_keuangan', 'admin_produksi') THEN
    RAISE EXCEPTION '[TIDAK BERHAK] Role Anda tidak bisa mencatat reject kantor.';
  END IF;
  IF p_qty IS NULL OR p_qty < 1 THEN
    RAISE EXCEPTION '[QTY TIDAK VALID] Qty reject minimal 1 pcs.';
  END IF;
  IF p_alasan_reject_id IS NULL THEN
    RAISE EXCEPTION '[ALASAN KOSONG] Pilih alasan reject.';
  END IF;
  IF p_tingkat IS NULL OR p_tingkat NOT IN ('minor', 'mayor', 'parah') THEN
    RAISE EXCEPTION '[TINGKAT KOSONG] Pilih tingkat reject: minor / mayor / parah.';
  END IF;
  IF p_harga_satuan IS NOT NULL AND p_harga_satuan < 0 THEN
    RAISE EXCEPTION '[HARGA TIDAK VALID] Harga tidak boleh minus.';
  END IF;

  SELECT nama, harga_jual INTO v_nama, v_harga FROM produk WHERE id = p_produk_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION '[PRODUK TIDAK DITEMUKAN] Produk tidak ada di sistem.';
  END IF;

  IF v_klien IS NULL THEN
    SELECT CASE WHEN COUNT(*) = 1 THEN MIN(id::text)::uuid END INTO v_klien
    FROM klien WHERE tenant_id = p_tenant_id;
  END IF;
  IF v_klien IS NULL THEN
    RAISE EXCEPTION '[KLIEN KOSONG] Pilih klien pemilik barang.';
  END IF;

  v_nomor := _nomor_reject_kantor(p_tenant_id, CURRENT_DATE);

  INSERT INTO reject_kantor (
    nomor_reject, surat_jalan_id, produk_id, alasan_reject_id, qty, harga_satuan,
    waktu_temuan, keterangan, tingkat, sumber, klien_id, tenant_id, created_by
  ) VALUES (
    v_nomor, NULL, p_produk_id, p_alasan_reject_id, p_qty, COALESCE(p_harga_satuan, v_harga, 0),
    'belakangan', NULLIF(trim(p_keterangan), ''), p_tingkat, 'barang_lama', v_klien, p_tenant_id, auth.uid()
  ) RETURNING id INTO v_id;

  INSERT INTO audit_log (user_id, modul, aksi, target, metadata, tenant_id)
  VALUES (auth.uid(), 'pengiriman', 'Lapor Reject Barang Lama', v_nomor,
          jsonb_build_object('produk', v_nama, 'qty', p_qty, 'tingkat', p_tingkat), p_tenant_id);

  RETURN jsonb_build_object('id', v_id, 'nomor_reject', v_nomor);
END $$;

-- ─── 5. Penyelesaian: dibeli kantor ────────────────────────────────────────

CREATE OR REPLACE FUNCTION selesaikan_reject_dibeli_kantor(
  p_id         uuid,
  p_harga_beli numeric,
  p_tenant_id  text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_role text := get_current_user_role();
  v_rk   reject_kantor%ROWTYPE;
BEGIN
  IF v_role IS NULL OR v_role NOT IN ('owner', 'admin_keuangan') THEN
    RAISE EXCEPTION '[TIDAK BERHAK] Hanya owner / kantor (admin keuangan) yang bisa mencatat barang reject dibeli kantor.';
  END IF;
  IF p_harga_beli IS NULL OR p_harga_beli < 0 THEN
    RAISE EXCEPTION '[HARGA TIDAK VALID] Isi harga beli kantor (boleh 0, tidak boleh minus).';
  END IF;

  SELECT * INTO v_rk FROM reject_kantor WHERE id = p_id AND tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '[TIDAK DITEMUKAN] Catatan reject tidak ada.';
  END IF;
  IF v_rk.status NOT IN ('retur', 'diperbaiki', 'tidak_bisa', 'dibeli_kantor') THEN
    RAISE EXCEPTION '[SUDAH SELESAI] % sudah dikirim ulang semua.', v_rk.nomor_reject;
  END IF;
  IF v_rk.qty - _reject_kantor_terkirim(p_id) <= 0 THEN
    RAISE EXCEPTION '[TIDAK ADA SISA] % tidak punya pcs tersisa.', v_rk.nomor_reject;
  END IF;

  UPDATE reject_kantor
  SET status = 'dibeli_kantor', harga_beli_kantor = p_harga_beli, updated_at = now()
  WHERE id = p_id;

  INSERT INTO audit_log (user_id, modul, aksi, target, metadata, tenant_id)
  VALUES (auth.uid(), 'pengiriman', 'Reject Dibeli Kantor', v_rk.nomor_reject,
          jsonb_build_object('dari', v_rk.status, 'harga_sj', v_rk.harga_satuan, 'harga_beli', p_harga_beli), p_tenant_id);
END $$;

-- Ubah status (retur ↔ diperbaiki ↔ tidak_bisa, atau batalkan "dibeli kantor").
CREATE OR REPLACE FUNCTION ubah_status_reject_kantor(
  p_id        uuid,
  p_status    text,
  p_tenant_id text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_role text := get_current_user_role();
  v_rk   reject_kantor%ROWTYPE;
BEGIN
  IF p_status NOT IN ('retur', 'diperbaiki', 'tidak_bisa') THEN
    RAISE EXCEPTION '[STATUS TIDAK VALID] Status % tidak dikenal.', p_status;
  END IF;

  SELECT * INTO v_rk FROM reject_kantor WHERE id = p_id AND tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '[TIDAK DITEMUKAN] Catatan reject tidak ada.';
  END IF;
  IF v_rk.status = 'selesai' THEN
    RAISE EXCEPTION '[SUDAH SELESAI] % sudah dikirim ulang semua.', v_rk.nomor_reject;
  END IF;

  IF v_rk.status = 'dibeli_kantor' THEN
    IF v_role IS NULL OR v_role NOT IN ('owner', 'admin_keuangan') THEN
      RAISE EXCEPTION '[TIDAK BERHAK] Hanya owner / kantor yang bisa membatalkan "dibeli kantor".';
    END IF;
  ELSIF v_role IS NULL OR v_role NOT IN ('owner', 'admin_produksi') THEN
    RAISE EXCEPTION '[TIDAK BERHAK] Hanya owner / admin produksi yang bisa mengubah status reject.';
  END IF;

  UPDATE reject_kantor SET status = p_status, harga_beli_kantor = NULL, updated_at = now() WHERE id = p_id;

  INSERT INTO audit_log (user_id, modul, aksi, target, metadata, tenant_id)
  VALUES (auth.uid(), 'pengiriman', 'Ubah Status Reject Kantor', v_rk.nomor_reject,
          jsonb_build_object('dari', v_rk.status, 'ke', p_status), p_tenant_id);
END $$;

-- Ubah tingkat reject (koreksi penilaian).
CREATE OR REPLACE FUNCTION ubah_tingkat_reject_kantor(
  p_id        uuid,
  p_tingkat   text,
  p_tenant_id text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_role text := get_current_user_role();
  v_rk   reject_kantor%ROWTYPE;
BEGIN
  IF v_role IS NULL OR v_role NOT IN ('owner', 'admin_keuangan', 'admin_produksi') THEN
    RAISE EXCEPTION '[TIDAK BERHAK] Role Anda tidak bisa mengubah tingkat reject.';
  END IF;
  IF p_tingkat IS NULL OR p_tingkat NOT IN ('minor', 'mayor', 'parah') THEN
    RAISE EXCEPTION '[TINGKAT TIDAK VALID] Tingkat reject harus minor / mayor / parah.';
  END IF;
  SELECT * INTO v_rk FROM reject_kantor WHERE id = p_id AND tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '[TIDAK DITEMUKAN] Catatan reject tidak ada.';
  END IF;
  UPDATE reject_kantor SET tingkat = p_tingkat, updated_at = now() WHERE id = p_id;
  INSERT INTO audit_log (user_id, modul, aksi, target, metadata, tenant_id)
  VALUES (auth.uid(), 'pengiriman', 'Ubah Tingkat Reject Kantor', v_rk.nomor_reject,
          jsonb_build_object('dari', v_rk.tingkat, 'ke', p_tingkat), p_tenant_id);
END $$;

-- ─── 6. SJ kirim ulang: klien dari catatan reject (barang lama tanpa SJ) ───

CREATE OR REPLACE FUNCTION buat_sj_kirim_ulang(
  p_tanggal   date,
  p_catatan   text,
  p_items     jsonb,   -- [{reject_kantor_id, qty}]
  p_tenant_id text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_role     text := get_current_user_role();
  v_item     jsonb;
  v_row      RECORD;
  v_rk       RECORD;
  v_qty      int;
  v_sisa     int;
  v_klien_id uuid;
  v_tahun    int;
  v_seq      int;
  v_nomor_sj text;
  v_sj_id    uuid;
BEGIN
  IF v_role IS NULL OR v_role NOT IN ('owner', 'admin_produksi') THEN
    RAISE EXCEPTION '[TIDAK BERHAK] Hanya owner / admin produksi yang bisa membuat surat jalan kirim ulang.';
  END IF;
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION '[TIDAK ADA BARANG] Pilih minimal 1 reject untuk dikirim ulang.';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_qty := (v_item->>'qty')::int;

    SELECT rk.id, rk.nomor_reject, rk.qty, rk.status, COALESCE(rk.klien_id, sj.klien_id) AS klien_id
    INTO v_rk
    FROM reject_kantor rk
    LEFT JOIN surat_jalan sj ON sj.id = rk.surat_jalan_id
    WHERE rk.id = (v_item->>'reject_kantor_id')::uuid AND rk.tenant_id = p_tenant_id
    FOR UPDATE OF rk;

    IF NOT FOUND THEN
      RAISE EXCEPTION '[TIDAK DITEMUKAN] Catatan reject tidak ada. Muat ulang halaman.';
    END IF;
    IF v_rk.status IN ('tidak_bisa', 'dibeli_kantor', 'selesai') THEN
      RAISE EXCEPTION '[STATUS] % berstatus % — tidak bisa dikirim ulang.', v_rk.nomor_reject, replace(v_rk.status, '_', ' ');
    END IF;

    v_sisa := v_rk.qty - _reject_kantor_terkirim(v_rk.id);
    IF v_qty IS NULL OR v_qty < 1 OR v_qty > v_sisa THEN
      RAISE EXCEPTION '[QTY TIDAK VALID] %: sisa yang belum dikirim ulang % pcs.', v_rk.nomor_reject, v_sisa;
    END IF;

    IF v_klien_id IS NULL THEN
      v_klien_id := v_rk.klien_id;
    ELSIF v_klien_id <> v_rk.klien_id THEN
      RAISE EXCEPTION '[KLIEN BERBEDA] Satu surat jalan kirim ulang hanya untuk satu klien.';
    END IF;
  END LOOP;

  v_tahun := EXTRACT(YEAR FROM p_tanggal)::int;

  INSERT INTO sj_sequence (tahun, tenant_id, last_sequence)
  VALUES (v_tahun, p_tenant_id, 1)
  ON CONFLICT (tahun, tenant_id)
  DO UPDATE SET last_sequence = sj_sequence.last_sequence + 1
  RETURNING last_sequence INTO v_seq;

  v_nomor_sj := 'SJ/' || v_tahun || '/' || lpad(v_seq::text, 5, '0');

  INSERT INTO surat_jalan (nomor_sj, klien_id, tanggal, status, catatan, jenis, tenant_id, created_by)
  VALUES (v_nomor_sj, v_klien_id, p_tanggal, 'final', NULLIF(trim(p_catatan), ''), 'kirim_ulang', p_tenant_id, auth.uid())
  RETURNING id INTO v_sj_id;

  FOR v_row IN SELECT value, ordinality FROM jsonb_array_elements(p_items) WITH ORDINALITY LOOP
    INSERT INTO kirim_ulang_item (sj_id, reject_kantor_id, qty, urutan, tenant_id)
    VALUES (v_sj_id, (v_row.value->>'reject_kantor_id')::uuid, (v_row.value->>'qty')::int,
            v_row.ordinality::int, p_tenant_id);
  END LOOP;

  INSERT INTO audit_log (user_id, modul, aksi, target, metadata, tenant_id)
  VALUES (auth.uid(), 'pengiriman', 'Buat SJ Kirim Ulang', v_sj_id::text,
          jsonb_build_object('nomor_sj', v_nomor_sj, 'jumlah_item', jsonb_array_length(p_items)), p_tenant_id);

  RETURN jsonb_build_object('id', v_sj_id, 'nomor_sj', v_nomor_sj);
END $$;

GRANT EXECUTE ON FUNCTION lapor_reject_kantor(uuid, int, uuid, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION lapor_reject_barang_lama(uuid, uuid, int, uuid, text, numeric, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION selesaikan_reject_dibeli_kantor(uuid, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION ubah_tingkat_reject_kantor(uuid, text, text) TO authenticated;

-- ─── 7. Validasi Kirim: reject saat terima ikut tingkat + klien ────────────
CREATE OR REPLACE FUNCTION public.validasi_pengiriman(p_surat_jalan_id uuid, p_items jsonb, p_catatan text, p_user_id uuid, p_tenant_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_item jsonb; v_sji_id uuid; v_bundle_id uuid; v_qty_kirim int; v_qty_diterima int; v_qty_lama int; v_selisih int;
  v_qty_reject int; v_reject_alasan_id uuid; v_reject_ket text; v_reject_tingkat text; v_produk_id uuid; v_klien_id uuid;
  v_harga numeric; v_barcode text; v_delta_nilai numeric := 0; v_has_kurang boolean := false; v_has_lebih boolean := false;
  v_approval_ids jsonb := '[]'::jsonb; v_status_final sj_status := 'tervalidasi'; v_approval_id uuid;
  v_periode_baru boolean; v_dijawab selisih_kirim;
BEGIN
  IF EXISTS (SELECT 1 FROM surat_jalan WHERE id = p_surat_jalan_id AND jenis = 'kirim_ulang') THEN
    RAISE EXCEPTION '[SJ KIRIM ULANG] Surat jalan kirim ulang divalidasi lewat form kirim ulang.';
  END IF;
  SELECT tanggal >= tanggal_awal_periode(), klien_id INTO v_periode_baru, v_klien_id
  FROM surat_jalan WHERE id = p_surat_jalan_id AND tenant_id = p_tenant_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_sji_id := (v_item->>'surat_jalan_item_id')::uuid;
    v_qty_diterima := (v_item->>'qty_diterima')::int;
    v_qty_reject := COALESCE(NULLIF(v_item->>'qty_reject', '')::int, 0);
    v_reject_alasan_id := NULLIF(v_item->>'reject_alasan_id', '')::uuid;
    v_reject_ket := NULLIF(trim(v_item->>'reject_keterangan'), '');
    v_reject_tingkat := COALESCE(NULLIF(v_item->>'reject_tingkat', ''), 'mayor');
    IF v_reject_tingkat NOT IN ('minor','mayor','parah') THEN RAISE EXCEPTION '[TINGKAT TIDAK VALID] Tingkat reject harus minor / mayor / parah.'; END IF;
    SELECT sji.bundle_id, sji.qty_kirim, sji.qty_diterima, pi.produk_id, COALESCE(sji.harga_satuan, pr.harga_jual, 0), b.barcode
    INTO v_bundle_id, v_qty_kirim, v_qty_lama, v_produk_id, v_harga, v_barcode
    FROM surat_jalan_item sji JOIN bundle b ON b.id = sji.bundle_id JOIN po_item pi ON pi.id = b.po_item_id JOIN produk pr ON pr.id = pi.produk_id
    WHERE sji.id = v_sji_id AND sji.sj_id = p_surat_jalan_id AND sji.tenant_id = p_tenant_id;
    IF NOT FOUND THEN RAISE EXCEPTION '[ITEM TIDAK DITEMUKAN] Baris surat jalan tidak cocok. Muat ulang halaman.'; END IF;
    IF v_qty_diterima IS NULL OR v_qty_diterima < 0 THEN RAISE EXCEPTION '[QTY TIDAK VALID] Qty diterima % tidak valid.', v_barcode; END IF;

    -- Selisih yang sudah dijelaskan owner (ketinggalan/hilang) mengunci qty diterima baris ini.
    SELECT * INTO v_dijawab FROM selisih_kirim
    WHERE surat_jalan_item_id = v_sji_id AND status IN ('ketinggalan','hilang');
    IF FOUND AND v_qty_diterima IS DISTINCT FROM v_dijawab.qty_diterima THEN
      RAISE EXCEPTION '[SELISIH SUDAH DIJELASKAN] %: kurang % pcs sudah dijelaskan owner (%), qty diterima tidak bisa diubah.',
        v_barcode, v_dijawab.qty, CASE v_dijawab.status WHEN 'ketinggalan' THEN 'ketinggalan' ELSE 'hilang/rusak' END;
    END IF;

    v_selisih := v_qty_diterima - v_qty_kirim;
    -- Pendapatan yang diakui = min(diterima, kirim); dihitung dari selisih terhadap pengakuan sebelumnya
    v_delta_nilai := v_delta_nilai + (LEAST(v_qty_diterima, v_qty_kirim) - LEAST(COALESCE(v_qty_lama, v_qty_kirim), v_qty_kirim)) * v_harga;
    UPDATE surat_jalan_item SET qty_diterima = v_qty_diterima WHERE id = v_sji_id AND tenant_id = p_tenant_id;

    IF v_selisih < 0 THEN
      v_has_kurang := true;
      IF v_periode_baru AND v_dijawab.id IS NULL THEN
        INSERT INTO selisih_kirim (tenant_id, surat_jalan_id, surat_jalan_item_id, bundle_id, produk_id,
                                   qty_kirim, qty_diterima, qty, harga_satuan, created_by)
        VALUES (p_tenant_id, p_surat_jalan_id, v_sji_id, v_bundle_id, v_produk_id,
                v_qty_kirim, v_qty_diterima, -v_selisih, v_harga, p_user_id)
        ON CONFLICT (surat_jalan_item_id) WHERE status <> 'salah_hitung'
        DO UPDATE SET qty_kirim = EXCLUDED.qty_kirim, qty_diterima = EXCLUDED.qty_diterima,
                      qty = EXCLUDED.qty, harga_satuan = EXCLUDED.harga_satuan, created_at = now();
      END IF;
    ELSE
      DELETE FROM selisih_kirim WHERE surat_jalan_item_id = v_sji_id AND status = 'menunggu';
    END IF;
    v_dijawab := NULL;

    IF v_selisih > 0 THEN
      v_has_lebih := true;
      INSERT INTO qty_approval_request (bundle_id, tahap, qty_diajukan, qty_default, status, tenant_id, created_by)
      VALUES (v_bundle_id, 'pengiriman', v_selisih, v_qty_kirim, 'pending', p_tenant_id, p_user_id) RETURNING id INTO v_approval_id;
      v_approval_ids := v_approval_ids || jsonb_build_array(v_approval_id::text);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM reject_kantor rk JOIN kirim_ulang_item k ON k.reject_kantor_id = rk.id WHERE rk.surat_jalan_item_id = v_sji_id AND rk.waktu_temuan = 'saat_terima') THEN
      DELETE FROM reject_kantor WHERE surat_jalan_item_id = v_sji_id AND waktu_temuan = 'saat_terima';
      IF v_qty_reject > 0 THEN
        IF v_reject_alasan_id IS NULL THEN RAISE EXCEPTION '[ALASAN KOSONG] Pilih alasan reject untuk %.', v_barcode; END IF;
        IF v_qty_reject + (SELECT COALESCE(SUM(qty),0) FROM reject_kantor WHERE surat_jalan_item_id = v_sji_id AND waktu_temuan = 'belakangan') > v_qty_diterima THEN RAISE EXCEPTION '[REJECT MELEBIHI] %: reject % pcs (ditambah reject belakangan) lebih banyak dari yang diterima (% pcs).', v_barcode, v_qty_reject, v_qty_diterima; END IF;
        INSERT INTO reject_kantor (nomor_reject, surat_jalan_id, surat_jalan_item_id, produk_id, bundle_id, alasan_reject_id, qty, harga_satuan, waktu_temuan, keterangan, tenant_id, created_by, tingkat, klien_id, sumber)
        VALUES (_nomor_reject_kantor(p_tenant_id, CURRENT_DATE), p_surat_jalan_id, v_sji_id, v_produk_id, v_bundle_id, v_reject_alasan_id, v_qty_reject, v_harga, 'saat_terima', v_reject_ket, p_tenant_id, p_user_id, v_reject_tingkat, v_klien_id, 'sj');
      END IF;
    END IF;
  END LOOP;
  IF v_delta_nilai <> 0 THEN
    UPDATE invoice SET total_nilai = GREATEST(total_nilai + v_delta_nilai, 0) WHERE surat_jalan_id = p_surat_jalan_id AND tenant_id = p_tenant_id;
  END IF;
  PERFORM _sinkron_potongan_invoice(p_surat_jalan_id);
  IF v_has_lebih THEN v_status_final := 'selisih_lebih'; ELSIF v_has_kurang THEN v_status_final := 'selisih_kurang'; END IF;
  UPDATE surat_jalan SET status = v_status_final, catatan_validasi = p_catatan, tanggal_validasi = CURRENT_DATE, validated_by = p_user_id
  WHERE id = p_surat_jalan_id AND tenant_id = p_tenant_id;
  RETURN jsonb_build_object('status', v_status_final, 'has_kurang', v_has_kurang, 'has_lebih', v_has_lebih, 'approval_ids', v_approval_ids);
END;
$function$;
GRANT EXECUTE ON FUNCTION validasi_pengiriman(uuid, jsonb, text, uuid, text) TO authenticated;
