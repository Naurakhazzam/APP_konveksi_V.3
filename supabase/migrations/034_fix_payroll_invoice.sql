-- =============================================================================
-- MIGRATION 034: Fix pay_salary_atomic + Invoice Trigger
--
-- Masalah yang diperbaiki:
--
-- A. pay_salary_atomic (migration 005) — signature lama tidak cocok dengan kode
--    Kode memanggil: (p_karyawan_id, p_ledger_ids, p_tanggal_bayar,
--                     p_gapok_row JSONB, p_kasbon_row JSONB, p_jurnal_row JSONB)
--    Fungsi lama:    (p_karyawan_id, p_ledger_ids, p_tanggal_bayar,
--                     p_kasbon_potong NUMERIC, p_tenant_id TEXT, p_user_id UUID)
--    → Proses bayar gaji akan error karena parameter tidak cocok.
--    Solusi: Replace dengan fungsi baru yang menerima JSONB rows dan
--            sekaligus membuat jurnal_entry + buku_kas.
--
-- B. invoice — tidak ada trigger untuk update total_bayar & status
--    → invoice.status tidak pernah berubah menjadi 'lunas' atau 'dp'.
--    Solusi: trigger AFTER INSERT/DELETE pada invoice_pembayaran.
-- =============================================================================


-- =============================================================================
-- A. REPLACE pay_salary_atomic
-- =============================================================================

-- Drop versi lama (signature lama)
DROP FUNCTION IF EXISTS pay_salary_atomic(UUID, UUID[], TIMESTAMPTZ, NUMERIC, TEXT, UUID);

CREATE OR REPLACE FUNCTION pay_salary_atomic(
  p_karyawan_id    UUID,
  p_ledger_ids     UUID[],
  p_tanggal_bayar  TIMESTAMPTZ,
  p_gapok_row      JSONB    DEFAULT NULL,   -- { jumlah, keterangan }
  p_kasbon_row     JSONB    DEFAULT NULL,   -- { jumlah, keterangan }
  p_jurnal_row     JSONB    DEFAULT NULL    -- { keterangan, nominal, tag_po_ids, detail_upah }
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_tenant_id      TEXT    := 'STX-001';
  v_user_id        UUID    := auth.uid();
  v_kasbon         RECORD;
  v_sisa_potong    NUMERIC;
  v_kasbon_jumlah  NUMERIC;
  v_kategori_id    UUID;
  v_jurnal_nominal NUMERIC;
BEGIN

  -- ── 1. Tandai gaji_ledger sebagai lunas ──────────────────────────────────
  UPDATE gaji_ledger
  SET
    status        = 'lunas',
    tanggal_bayar = p_tanggal_bayar
  WHERE id          = ANY(p_ledger_ids)
    AND karyawan_id = p_karyawan_id
    AND status      = 'belum_lunas'
    AND tenant_id   = v_tenant_id;

  -- ── 2. Potong kasbon (jika ada) ──────────────────────────────────────────
  IF p_kasbon_row IS NOT NULL THEN
    v_kasbon_jumlah := COALESCE((p_kasbon_row->>'jumlah')::NUMERIC, 0);

    IF v_kasbon_jumlah > 0 THEN
      v_sisa_potong := v_kasbon_jumlah;

      FOR v_kasbon IN
        SELECT id, jumlah
        FROM   kasbon
        WHERE  karyawan_id = p_karyawan_id
          AND  status      = 'belum_lunas'
          AND  tenant_id   = v_tenant_id
        ORDER  BY tanggal ASC
      LOOP
        EXIT WHEN v_sisa_potong <= 0;

        IF v_kasbon.jumlah <= v_sisa_potong THEN
          UPDATE kasbon SET status = 'lunas' WHERE id = v_kasbon.id;
          v_sisa_potong := v_sisa_potong - v_kasbon.jumlah;
        ELSE
          -- Partial pay tidak di-support di MVP — hentikan di sini
          EXIT;
        END IF;
      END LOOP;
    END IF;
  END IF;

  -- ── 3. Buat jurnal_entry + buku_kas (jika ada p_jurnal_row) ─────────────
  IF p_jurnal_row IS NOT NULL THEN
    v_jurnal_nominal := COALESCE((p_jurnal_row->>'nominal')::NUMERIC, 0);

    IF v_jurnal_nominal > 0 THEN
      -- Cari kategori_trx dengan jenis='direct_upah'
      SELECT id INTO v_kategori_id
      FROM   kategori_trx
      WHERE  jenis     = 'direct_upah'
        AND  tenant_id = v_tenant_id
      LIMIT  1;

      -- Insert jurnal_entry
      IF v_kategori_id IS NOT NULL THEN
        INSERT INTO jurnal_entry (
          kategori_trx_id,
          jenis,
          nominal,
          tanggal,
          keterangan,
          tag_po_ids,
          detail_upah,
          tenant_id,
          created_by
        ) VALUES (
          v_kategori_id,
          'direct_upah',
          v_jurnal_nominal,
          p_tanggal_bayar::DATE,
          COALESCE(p_jurnal_row->>'keterangan', 'Pembayaran Gaji'),
          COALESCE(p_jurnal_row->'tag_po_ids', '[]'::JSONB),
          p_jurnal_row->'detail_upah',
          v_tenant_id,
          v_user_id
        );
      END IF;

      -- Insert buku_kas keluar (cash flow record)
      INSERT INTO buku_kas (
        tanggal,
        tipe,
        kategori,
        nominal,
        keterangan,
        tenant_id,
        created_by
      ) VALUES (
        p_tanggal_bayar::DATE,
        'keluar',
        'Pembayaran Gaji',
        v_jurnal_nominal,
        COALESCE(p_jurnal_row->>'keterangan', 'Pembayaran Gaji'),
        v_tenant_id,
        v_user_id
      );
    END IF;
  END IF;

  -- ── 4. Audit log ──────────────────────────────────────────────────────────
  INSERT INTO audit_log (user_id, modul, aksi, target, metadata, tenant_id)
  VALUES (
    v_user_id,
    'penggajian',
    'Bayar Gaji',
    p_karyawan_id::TEXT,
    jsonb_build_object(
      'ledger_ids',      to_jsonb(p_ledger_ids),
      'gapok_jumlah',    COALESCE((p_gapok_row->>'jumlah')::NUMERIC, 0),
      'kasbon_jumlah',   COALESCE((p_kasbon_row->>'jumlah')::NUMERIC, 0),
      'jurnal_nominal',  COALESCE((p_jurnal_row->>'nominal')::NUMERIC, 0),
      'tanggal_bayar',   p_tanggal_bayar
    ),
    v_tenant_id
  );

END;
$$;

-- Grant ke authenticated role
GRANT EXECUTE ON FUNCTION pay_salary_atomic(UUID, UUID[], TIMESTAMPTZ, JSONB, JSONB, JSONB) TO authenticated;


-- =============================================================================
-- B. TRIGGER: invoice_pembayaran → auto-update invoice.total_bayar + status
-- =============================================================================

-- Fungsi trigger
CREATE OR REPLACE FUNCTION fn_update_invoice_totals()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_inv_id       UUID;
  v_total_bayar  NUMERIC;
  v_total_nilai  NUMERIC;
  v_new_status   TEXT;
BEGIN
  -- Tentukan invoice_id
  IF TG_OP = 'DELETE' THEN
    v_inv_id := OLD.invoice_id;
  ELSE
    v_inv_id := NEW.invoice_id;
  END IF;

  -- Hitung total dari semua pembayaran yang tersisa
  SELECT COALESCE(SUM(jumlah), 0)
  INTO   v_total_bayar
  FROM   invoice_pembayaran
  WHERE  invoice_id = v_inv_id;

  -- Ambil total_nilai invoice
  SELECT total_nilai
  INTO   v_total_nilai
  FROM   invoice
  WHERE  id = v_inv_id;

  -- Tentukan status baru
  v_new_status := CASE
    WHEN v_total_bayar = 0              THEN 'belum_bayar'
    WHEN v_total_bayar >= v_total_nilai THEN 'lunas'
    ELSE                                     'dp'
  END;

  -- Update invoice
  UPDATE invoice
  SET
    total_bayar = v_total_bayar,
    status      = v_new_status
  WHERE id = v_inv_id;

  -- Return (value diabaikan oleh AFTER trigger)
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  ELSE
    RETURN NEW;
  END IF;
END;
$$;

-- Drop trigger lama jika ada
DROP TRIGGER IF EXISTS trg_invoice_pembayaran_totals ON invoice_pembayaran;

-- Buat trigger baru
CREATE TRIGGER trg_invoice_pembayaran_totals
AFTER INSERT OR UPDATE OR DELETE ON invoice_pembayaran
FOR EACH ROW
EXECUTE FUNCTION fn_update_invoice_totals();
