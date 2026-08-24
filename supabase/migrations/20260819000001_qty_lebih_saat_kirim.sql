-- ================================================================
-- MIGRATION: Qty lebih saat Buat Surat Jalan
--
-- Latar belakang: qty_kirim per bundle sebelumnya dibatasi maksimal
-- qty_per_bundle hanya di sisi tampilan (JS), tidak ada penegakan di
-- database. Sekarang dibuka: tim boleh input qty_kirim > qty_per_bundle
-- (mengantisipasi kemungkinan qty awal salah input), TAPI wajib isi
-- alasan dan kelebihannya masuk antrian approval PIN Owner — SJ tetap
-- langsung jadi & bisa dicetak, approval berjalan async (tidak
-- menghambat proses). Invoice memakai qty_kirim penuh sejak awal
-- (lihat getInvoiceTotalFromSJ di invoice.actions.ts yang sudah
-- SUM(qty_kirim * harga_jual) langsung), jadi approve/reject di sini
-- murni konfirmasi & jejak audit, tidak mengubah invoice.
--
-- Reuse tabel qty_approval_request yang sudah ada (dipakai juga oleh
-- flow validasi_pengiriman utk kasus qty_diterima > qty_kirim).
-- Kolom "sumber" membedakan asal pengajuannya supaya dua flow yang
-- beda tidak tertukar.
-- ================================================================

-- ── A. Kolom pembeda sumber pengajuan + catatan dari pengaju ────────────────

ALTER TABLE qty_approval_request
  ADD COLUMN IF NOT EXISTS sumber text NOT NULL DEFAULT 'validasi_penerimaan';

ALTER TABLE qty_approval_request
  ADD COLUMN IF NOT EXISTS catatan_pengajuan text;

COMMENT ON COLUMN qty_approval_request.sumber IS
  'validasi_penerimaan = qty_diterima > qty_kirim (flow lama, Validasi Pengiriman); buat_surat_jalan = qty_kirim > qty_per_bundle rencana (flow baru, saat Buat Surat Jalan)';


-- ── B. Update finalize_surat_jalan: terima alasan_lebih per bundle, ─────────
--       buat qty_approval_request kalau qty_kirim > qty_per_bundle rencana.
--       Signature TIDAK berubah supaya kompatibel dengan action layer yang
--       sudah ada (p_bundles hanya menambah field opsional "alasan_lebih").

CREATE OR REPLACE FUNCTION finalize_surat_jalan(
  p_klien_id    UUID,
  p_tanggal     DATE,
  p_catatan     TEXT,
  p_bundles     JSONB,
  p_tenant_id   TEXT DEFAULT 'STX-001'::TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tahun          INT;
  v_seq            INT;
  v_nomor_sj       TEXT;
  v_sj_id          UUID;
  v_bundle         JSONB;
  v_bundle_id      UUID;
  v_qty_kirim      INT;
  v_qty_per_bundle INT;
  v_alasan_lebih   TEXT;
BEGIN
  -- Validasi: array bundles tidak boleh kosong
  IF jsonb_array_length(p_bundles) = 0 THEN
    RAISE EXCEPTION 'Tidak ada bundle yang dipilih';
  END IF;

  -- Validasi per-bundle: belum di SJ lain, packing selesai, dan kalau
  -- qty_kirim melebihi qty_per_bundle rencana maka alasan_lebih wajib diisi.
  FOR v_bundle IN SELECT * FROM jsonb_array_elements(p_bundles) LOOP
    v_bundle_id    := (v_bundle->>'bundle_id')::UUID;
    v_qty_kirim    := (v_bundle->>'qty_kirim')::INT;
    v_alasan_lebih := NULLIF(TRIM(v_bundle->>'alasan_lebih'), '');

    IF EXISTS (
      SELECT 1 FROM surat_jalan_item WHERE bundle_id = v_bundle_id
    ) THEN
      RAISE EXCEPTION 'Bundle % sudah masuk Surat Jalan lain', v_bundle_id;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM bundle
      WHERE id = v_bundle_id
        AND (status_tahap->'packing'->>'status') = 'selesai'
        AND tenant_id = p_tenant_id
    ) THEN
      RAISE EXCEPTION 'Bundle % belum selesai tahap Packing', v_bundle_id;
    END IF;

    SELECT pi.qty_per_bundle INTO v_qty_per_bundle
    FROM bundle b
    JOIN po_item pi ON pi.id = b.po_item_id
    WHERE b.id = v_bundle_id;

    IF v_qty_per_bundle IS NOT NULL AND v_qty_kirim > v_qty_per_bundle AND v_alasan_lebih IS NULL THEN
      RAISE EXCEPTION 'Qty kirim bundle % (%) melebihi qty rencana (%) — alasan wajib diisi', v_bundle_id, v_qty_kirim, v_qty_per_bundle;
    END IF;
  END LOOP;

  -- 1. Increment sequence nomor SJ untuk tahun ini
  v_tahun := EXTRACT(YEAR FROM p_tanggal)::INT;

  INSERT INTO sj_sequence (tahun, tenant_id, last_sequence)
  VALUES (v_tahun, p_tenant_id, 1)
  ON CONFLICT (tahun, tenant_id)
  DO UPDATE SET last_sequence = sj_sequence.last_sequence + 1
  RETURNING last_sequence INTO v_seq;

  -- 2. Generate format nomor SJ: SJ/YYYY/XXXXX
  v_nomor_sj := 'SJ/' || v_tahun || '/' || LPAD(v_seq::TEXT, 5, '0');

  -- 3. Insert header surat_jalan
  INSERT INTO surat_jalan (nomor_sj, klien_id, tanggal, status, catatan, tenant_id, created_by)
  VALUES (v_nomor_sj, p_klien_id, p_tanggal, 'final', p_catatan, p_tenant_id, auth.uid())
  RETURNING id INTO v_sj_id;

  -- 4. Insert setiap item + update bundle.surat_jalan_id + approval kalau lebih
  FOR v_bundle IN SELECT * FROM jsonb_array_elements(p_bundles) LOOP
    v_bundle_id    := (v_bundle->>'bundle_id')::UUID;
    v_qty_kirim    := (v_bundle->>'qty_kirim')::INT;
    v_alasan_lebih := NULLIF(TRIM(v_bundle->>'alasan_lebih'), '');

    INSERT INTO surat_jalan_item (sj_id, bundle_id, qty_kirim, tenant_id)
    VALUES (v_sj_id, v_bundle_id, v_qty_kirim, p_tenant_id);

    UPDATE bundle
    SET surat_jalan_id = v_sj_id
    WHERE id = v_bundle_id
      AND surat_jalan_id IS NULL;

    SELECT pi.qty_per_bundle INTO v_qty_per_bundle
    FROM bundle b
    JOIN po_item pi ON pi.id = b.po_item_id
    WHERE b.id = v_bundle_id;

    IF v_qty_per_bundle IS NOT NULL AND v_qty_kirim > v_qty_per_bundle THEN
      INSERT INTO qty_approval_request (
        bundle_id, tahap, qty_diajukan, qty_default,
        status, sumber, catatan_pengajuan, tenant_id, created_by
      ) VALUES (
        v_bundle_id, 'pengiriman', v_qty_kirim - v_qty_per_bundle, v_qty_per_bundle,
        'pending', 'buat_surat_jalan', v_alasan_lebih, p_tenant_id, auth.uid()
      );
    END IF;
  END LOOP;

  -- 5. Catat audit_log
  INSERT INTO audit_log (
    user_id, modul, aksi, target, metadata, tenant_id
  )
  VALUES (
    auth.uid(),
    'pengiriman',
    'Buat Surat Jalan',
    v_sj_id::TEXT,
    jsonb_build_object(
      'nomor_sj',       v_nomor_sj,
      'klien_id',       p_klien_id,
      'jumlah_bundle',  jsonb_array_length(p_bundles)
    ),
    p_tenant_id
  );

  RETURN v_nomor_sj;

EXCEPTION
  WHEN OTHERS THEN
    RAISE;

END;
$$;

GRANT EXECUTE ON FUNCTION finalize_surat_jalan(UUID, DATE, TEXT, JSONB, TEXT)
  TO authenticated;


-- ── C. RPC: resolve_qty_lebih_kirim ──────────────────────────────────────────
-- Dipanggil setelah PIN owner diverifikasi di TypeScript layer.
-- Murni update status approval (approved/rejected) — TIDAK menyentuh invoice
-- karena invoice sudah menghitung qty_kirim penuh sejak SJ difinalisasi.

CREATE OR REPLACE FUNCTION resolve_qty_lebih_kirim(
  p_approval_id  UUID,
  p_status       TEXT,   -- 'approved' | 'rejected'
  p_catatan      TEXT,
  p_user_id      UUID,
  p_tenant_id    TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_req RECORD;
BEGIN
  IF p_status NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'Status tidak valid: %', p_status;
  END IF;

  SELECT * INTO v_req
  FROM qty_approval_request
  WHERE id = p_approval_id
    AND tenant_id = p_tenant_id
    AND sumber = 'buat_surat_jalan'
    AND status = 'pending';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Approval request tidak ditemukan atau sudah diproses';
  END IF;

  UPDATE qty_approval_request
  SET status        = p_status,
      catatan_owner = p_catatan,
      resolved_by   = p_user_id,
      resolved_at   = now()
  WHERE id = p_approval_id;

  RETURN jsonb_build_object('success', true, 'status', p_status);
END;
$$;

GRANT EXECUTE ON FUNCTION resolve_qty_lebih_kirim(UUID, TEXT, TEXT, UUID, TEXT)
  TO authenticated;
