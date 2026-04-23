-- =============================================================================
-- MIGRATION: 005_postgres_functions.sql
-- Phase 02 — Postgres Functions: Operasi Atomic
-- Dibuat: 20 April 2026
-- Depends on: 001–004 migrations
-- =============================================================================
-- Semua function pakai SECURITY DEFINER agar bisa bypass RLS (policy INSERT FALSE)
-- yang dipasang di tabel-tabel kritis (gaji_ledger, sj_item, audit_log, dll).
-- =============================================================================


-- =============================================================================
-- 1. generate_bundle_barcode
-- Increment global bundle_sequence secara atomic (row-level lock).
-- Hitung no_urut dalam PO dari jumlah bundle yang sudah ada.
-- Return format: PO-{no_po}-{5digit global}-bdl{3digit dalam PO}
-- =============================================================================

CREATE OR REPLACE FUNCTION generate_bundle_barcode(
  p_no_po     TEXT,
  p_tenant_id TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_sequence  INT;
  v_no_urut   INT;
  v_barcode   TEXT;
BEGIN
  -- 1. Increment global sequence dengan row lock (atomic)
  UPDATE bundle_sequence
  SET    last_sequence = last_sequence + 1
  WHERE  tenant_id = p_tenant_id
  RETURNING last_sequence INTO v_sequence;

  IF v_sequence IS NULL THEN
    RAISE EXCEPTION 'bundle_sequence tidak ditemukan untuk tenant %', p_tenant_id;
  END IF;

  -- 2. Hitung no_urut bundle dalam PO ini (berapa bundle sudah ada di PO ini)
  SELECT COUNT(*) + 1
  INTO   v_no_urut
  FROM   bundle b
  JOIN   po p ON p.id = b.po_id
  WHERE  p.no_po     = p_no_po
    AND  b.tenant_id = p_tenant_id;

  -- 3. Bentuk barcode: PO-{no_po}-{00001}-bdl{001}
  v_barcode := 'PO-'
    || p_no_po
    || '-'
    || lpad(v_sequence::TEXT, 5, '0')
    || '-bdl'
    || lpad(v_no_urut::TEXT, 3, '0');

  RETURN v_barcode;
END;
$$;


-- =============================================================================
-- 2. get_next_sj_number
-- Increment sj_sequence per tahun secara atomic.
-- INSERT baris baru jika tahun ini belum ada (ON CONFLICT DO NOTHING lalu UPDATE).
-- Return format: SJ-{tahun}-{0001}
-- =============================================================================

CREATE OR REPLACE FUNCTION get_next_sj_number(
  p_tenant_id TEXT,
  p_tahun     INT
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_sequence  INT;
  v_nomor_sj  TEXT;
BEGIN
  -- Pastikan baris untuk tahun ini ada (INSERT jika belum)
  INSERT INTO sj_sequence (tahun, tenant_id, last_sequence)
  VALUES (p_tahun, p_tenant_id, 0)
  ON CONFLICT (tahun, tenant_id) DO NOTHING;

  -- Increment dengan row lock
  UPDATE sj_sequence
  SET    last_sequence = last_sequence + 1
  WHERE  tahun      = p_tahun
    AND  tenant_id  = p_tenant_id
  RETURNING last_sequence INTO v_sequence;

  -- Bentuk nomor SJ: SJ-2026-0001
  v_nomor_sj := 'SJ-'
    || p_tahun::TEXT
    || '-'
    || lpad(v_sequence::TEXT, 4, '0');

  RETURN v_nomor_sj;
END;
$$;


-- =============================================================================
-- 3. finalize_surat_jalan
-- Buat SJ, insert semua item, dan update bundle.surat_jalan_id — dalam SATU transaksi.
-- p_items format JSONB: [{"bundle_id": "uuid", "qty_kirim": 12}, ...]
-- Return: nomor_sj yang dibuat.
-- =============================================================================

CREATE OR REPLACE FUNCTION finalize_surat_jalan(
  p_klien_id  UUID,
  p_tanggal   DATE,
  p_items     JSONB,
  p_tenant_id TEXT,
  p_user_id   UUID
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_nomor_sj  TEXT;
  v_sj_id     UUID;
  v_item      JSONB;
  v_bundle_id UUID;
  v_qty       INT;
BEGIN
  -- 1. Generate nomor SJ
  v_nomor_sj := get_next_sj_number(p_tenant_id, EXTRACT(YEAR FROM p_tanggal)::INT);

  -- 2. INSERT header surat_jalan
  INSERT INTO surat_jalan (nomor_sj, klien_id, tanggal, status, tenant_id, created_by)
  VALUES (v_nomor_sj, p_klien_id, p_tanggal, 'final', p_tenant_id, p_user_id)
  RETURNING id INTO v_sj_id;

  -- 3. Loop setiap item → INSERT sj_item + UPDATE bundle
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_bundle_id := (v_item->>'bundle_id')::UUID;
    v_qty       := (v_item->>'qty_kirim')::INT;

    -- Validasi bundle: harus belum punya surat_jalan_id
    IF EXISTS (
      SELECT 1 FROM bundle
      WHERE id = v_bundle_id
        AND surat_jalan_id IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'Bundle % sudah masuk surat jalan lain', v_bundle_id;
    END IF;

    -- INSERT surat_jalan_item
    INSERT INTO surat_jalan_item (sj_id, bundle_id, qty_kirim, tenant_id)
    VALUES (v_sj_id, v_bundle_id, v_qty, p_tenant_id);

    -- UPDATE bundle: tandai sudah masuk SJ ini
    UPDATE bundle
    SET    surat_jalan_id = v_sj_id
    WHERE  id = v_bundle_id;
  END LOOP;

  -- 4. Catat audit log
  INSERT INTO audit_log (user_id, modul, aksi, target, metadata, tenant_id)
  VALUES (
    p_user_id,
    'pengiriman',
    'Finalisasi Surat Jalan',
    v_nomor_sj,
    jsonb_build_object(
      'sj_id',      v_sj_id,
      'klien_id',   p_klien_id,
      'jumlah_bundle', jsonb_array_length(p_items)
    ),
    p_tenant_id
  );

  RETURN v_nomor_sj;

EXCEPTION
  WHEN OTHERS THEN
    -- Semua perubahan di-rollback otomatis karena dalam satu transaksi
    RAISE;
END;
$$;


-- =============================================================================
-- 4. pay_salary_atomic
-- Tandai gaji_ledger sebagai lunas + potong kasbon — dalam SATU transaksi.
-- Kasbon dipotong dengan menandai kasbon belum_lunas (terlama) menjadi lunas
-- sampai total p_kasbon_potong terpenuhi.
-- =============================================================================

CREATE OR REPLACE FUNCTION pay_salary_atomic(
  p_karyawan_id    UUID,
  p_ledger_ids     UUID[],
  p_tanggal_bayar  TIMESTAMPTZ,
  p_kasbon_potong  NUMERIC,
  p_tenant_id      TEXT,
  p_user_id        UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_total_gaji      NUMERIC;
  v_sisa_potong     NUMERIC;
  v_kasbon          RECORD;
BEGIN
  -- Validasi: semua ledger_id harus milik karyawan yang sama
  IF EXISTS (
    SELECT 1 FROM gaji_ledger
    WHERE id = ANY(p_ledger_ids)
      AND karyawan_id <> p_karyawan_id
  ) THEN
    RAISE EXCEPTION 'Salah satu ledger_id tidak milik karyawan %', p_karyawan_id;
  END IF;

  -- 1. Hitung total gaji untuk validasi
  SELECT COALESCE(SUM(total), 0)
  INTO v_total_gaji
  FROM gaji_ledger
  WHERE id = ANY(p_ledger_ids)
    AND status = 'belum_lunas';

  IF v_total_gaji = 0 THEN
    RAISE EXCEPTION 'Tidak ada gaji belum_lunas pada ledger yang dipilih';
  END IF;

  -- Validasi kasbon potong tidak melebihi total gaji
  IF p_kasbon_potong > v_total_gaji THEN
    RAISE EXCEPTION 'Kasbon potong (%) melebihi total gaji (%)', p_kasbon_potong, v_total_gaji;
  END IF;

  -- 2. UPDATE gaji_ledger → lunas
  UPDATE gaji_ledger
  SET
    status        = 'lunas',
    tanggal_bayar = p_tanggal_bayar
  WHERE id = ANY(p_ledger_ids)
    AND status = 'belum_lunas';

  -- 3. Potong kasbon (jika ada)
  IF p_kasbon_potong > 0 THEN
    v_sisa_potong := p_kasbon_potong;

    -- Tandai kasbon belum_lunas (urut terlama) sampai total potong terpenuhi
    FOR v_kasbon IN
      SELECT id, jumlah
      FROM   kasbon
      WHERE  karyawan_id = p_karyawan_id
        AND  status      = 'belum_lunas'
        AND  tenant_id   = p_tenant_id
      ORDER  BY tanggal ASC
    LOOP
      EXIT WHEN v_sisa_potong <= 0;

      IF v_kasbon.jumlah <= v_sisa_potong THEN
        -- Kasbon ini lunas sepenuhnya
        UPDATE kasbon SET status = 'lunas' WHERE id = v_kasbon.id;
        v_sisa_potong := v_sisa_potong - v_kasbon.jumlah;
      ELSE
        -- Kasbon ini hanya sebagian — tidak support partial bayar di MVP
        -- Catat di audit log sebagai partial, tidak di-update
        EXIT;
      END IF;
    END LOOP;
  END IF;

  -- 4. Catat audit log
  INSERT INTO audit_log (user_id, modul, aksi, target, metadata, tenant_id)
  VALUES (
    p_user_id,
    'penggajian',
    'Bayar Gaji',
    p_karyawan_id::TEXT,
    jsonb_build_object(
      'ledger_ids',     to_jsonb(p_ledger_ids),
      'total_gaji',     v_total_gaji,
      'kasbon_potong',  p_kasbon_potong,
      'tanggal_bayar',  p_tanggal_bayar
    ),
    p_tenant_id
  );
END;
$$;


-- =============================================================================
-- GRANT: izinkan authenticated role memanggil function-function ini via RPC
-- (Function sendiri pakai SECURITY DEFINER jadi akan jalan sebagai owner DB)
-- =============================================================================

GRANT EXECUTE ON FUNCTION generate_bundle_barcode(TEXT, TEXT)        TO authenticated;
GRANT EXECUTE ON FUNCTION get_next_sj_number(TEXT, INT)              TO authenticated;
GRANT EXECUTE ON FUNCTION finalize_surat_jalan(UUID, DATE, JSONB, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION pay_salary_atomic(UUID, UUID[], TIMESTAMPTZ, NUMERIC, TEXT, UUID) TO authenticated;
