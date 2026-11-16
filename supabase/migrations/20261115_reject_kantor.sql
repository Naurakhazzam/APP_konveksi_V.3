-- ============================================================================
-- Reject Kantor (retur dari kantor) + Kirim Ulang + potongan tagihan
--
-- Alur:
--   1. Kantor (akun admin_keuangan) mencatat reject:
--        a. saat validasi kiriman (kolom "Reject" per baris), atau
--        b. belakangan: pilih SJ → pilih produk (model/warna/size) → qty + alasan.
--   2. Selama barang reject belum dikirim ulang, nilainya MEMOTONG tagihan
--      (invoice.potongan_reject = sisa pcs × harga jual).
--   3. Konveksi memperbaiki lalu mengirim ulang memakai SURAT JALAN KIRIM ULANG
--      (surat_jalan.jenis = 'kirim_ulang', isi di tabel kirim_ulang_item).
--      Pcs yang dikirim ulang membatalkan potongan tagihannya.
--      SJ kirim ulang TIDAK membuat invoice baru & TIDAK masuk upah borongan
--      (isinya bukan surat_jalan_item).
--   4. Yang tidak bisa diperbaiki ditandai 'tidak_bisa' → potongan permanen.
--
-- Sekaligus memperbaiki bug validasi_pengiriman: catatan qty kurang dulu
-- di-insert ke reject_log dengan status 'pending' & source 'pengiriman',
-- dua-duanya ditolak CHECK constraint → validasi yang ada kurangnya selalu gagal.
-- ============================================================================

-- ─── 1. Kolom baru ──────────────────────────────────────────────────────────

ALTER TABLE surat_jalan
  ADD COLUMN IF NOT EXISTS jenis text NOT NULL DEFAULT 'normal';

DO $$ BEGIN
  ALTER TABLE surat_jalan ADD CONSTRAINT surat_jalan_jenis_check
    CHECK (jenis IN ('normal', 'kirim_ulang'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE invoice
  ADD COLUMN IF NOT EXISTS potongan_reject numeric NOT NULL DEFAULT 0;

-- ─── 2. Tabel ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS reject_kantor (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nomor_reject        text NOT NULL UNIQUE,
  surat_jalan_id      uuid NOT NULL REFERENCES surat_jalan(id),
  surat_jalan_item_id uuid REFERENCES surat_jalan_item(id) ON DELETE SET NULL,
  produk_id           uuid NOT NULL REFERENCES produk(id),
  bundle_id           uuid REFERENCES bundle(id) ON DELETE SET NULL,
  alasan_reject_id    uuid NOT NULL REFERENCES alasan_reject(id),
  qty                 int  NOT NULL CHECK (qty > 0),
  harga_satuan        numeric NOT NULL DEFAULT 0,
  waktu_temuan        text NOT NULL CHECK (waktu_temuan IN ('saat_terima', 'belakangan')),
  status              text NOT NULL DEFAULT 'retur'
                      CHECK (status IN ('retur', 'diperbaiki', 'tidak_bisa', 'selesai')),
  keterangan          text,
  tanggal             date NOT NULL DEFAULT CURRENT_DATE,
  tenant_id           text NOT NULL DEFAULT 'STX-001',
  created_by          uuid,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reject_kantor_sj     ON reject_kantor (surat_jalan_id);
CREATE INDEX IF NOT EXISTS idx_reject_kantor_status ON reject_kantor (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_reject_kantor_tgl    ON reject_kantor (tenant_id, tanggal);

CREATE TABLE IF NOT EXISTS kirim_ulang_item (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sj_id            uuid NOT NULL REFERENCES surat_jalan(id) ON DELETE CASCADE,
  reject_kantor_id uuid NOT NULL REFERENCES reject_kantor(id),
  qty              int  NOT NULL CHECK (qty > 0),
  qty_diterima     int  CHECK (qty_diterima >= 0),
  urutan           int,
  tenant_id        text NOT NULL DEFAULT 'STX-001',
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_kirim_ulang_item_sj     ON kirim_ulang_item (sj_id);
CREATE INDEX IF NOT EXISTS idx_kirim_ulang_item_reject ON kirim_ulang_item (reject_kantor_id);

-- Baca saja lewat API; semua tulis lewat RPC SECURITY DEFINER di bawah.
ALTER TABLE reject_kantor    ENABLE ROW LEVEL SECURITY;
ALTER TABLE kirim_ulang_item ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS reject_kantor_select ON reject_kantor;
CREATE POLICY reject_kantor_select ON reject_kantor
  FOR SELECT USING (is_active_user() AND tenant_id = 'STX-001');

DROP POLICY IF EXISTS kirim_ulang_item_select ON kirim_ulang_item;
CREATE POLICY kirim_ulang_item_select ON kirim_ulang_item
  FOR SELECT USING (is_active_user() AND tenant_id = 'STX-001');

-- ─── 3. Helper: nomor, sisa, sinkron invoice & status ──────────────────────

CREATE OR REPLACE FUNCTION _nomor_reject_kantor(p_tenant_id text, p_tanggal date)
RETURNS text LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_prefix text := 'RK/' || to_char(p_tanggal, 'YYYY') || '/';
  v_seq    int;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('reject_kantor:' || p_tenant_id));
  SELECT COALESCE(MAX(substring(nomor_reject FROM length(v_prefix) + 1)::int), 0) + 1
  INTO v_seq
  FROM reject_kantor
  WHERE tenant_id = p_tenant_id AND nomor_reject LIKE v_prefix || '%';
  RETURN v_prefix || lpad(v_seq::text, 4, '0');
END $$;

-- Pcs reject yang sudah kembali ke kantor (pakai qty_diterima kalau SJ kirim
-- ulang sudah divalidasi, kalau belum pakai qty yang dikirim).
CREATE OR REPLACE FUNCTION _reject_kantor_terkirim(p_reject_id uuid)
RETURNS int LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT COALESCE(SUM(COALESCE(qty_diterima, qty)), 0)::int
  FROM kirim_ulang_item WHERE reject_kantor_id = p_reject_id;
$$;

CREATE OR REPLACE FUNCTION _sinkron_potongan_invoice(p_sj_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_pot numeric;
BEGIN
  SELECT COALESCE(SUM(GREATEST(rk.qty - _reject_kantor_terkirim(rk.id), 0) * rk.harga_satuan), 0)
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

CREATE OR REPLACE FUNCTION _sinkron_status_reject_kantor(p_reject_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rk       reject_kantor%ROWTYPE;
  v_terkirim int;
BEGIN
  SELECT * INTO v_rk FROM reject_kantor WHERE id = p_reject_id;
  IF NOT FOUND THEN RETURN; END IF;

  v_terkirim := _reject_kantor_terkirim(p_reject_id);

  IF v_terkirim >= v_rk.qty AND v_rk.status <> 'selesai' THEN
    UPDATE reject_kantor SET status = 'selesai', updated_at = now() WHERE id = p_reject_id;
  ELSIF v_terkirim < v_rk.qty AND v_rk.status = 'selesai' THEN
    UPDATE reject_kantor SET status = 'diperbaiki', updated_at = now() WHERE id = p_reject_id;
  END IF;

  PERFORM _sinkron_potongan_invoice(v_rk.surat_jalan_id);
END $$;

-- ─── 4. Trigger ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION _trg_reject_kantor_sinkron()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    PERFORM _sinkron_potongan_invoice(OLD.surat_jalan_id);
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') AND (TG_OP = 'INSERT' OR NEW.surat_jalan_id <> OLD.surat_jalan_id) THEN
    PERFORM _sinkron_potongan_invoice(NEW.surat_jalan_id);
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_reject_kantor_sinkron ON reject_kantor;
CREATE TRIGGER trg_reject_kantor_sinkron
  AFTER INSERT OR DELETE OR UPDATE OF qty, harga_satuan, surat_jalan_id ON reject_kantor
  FOR EACH ROW EXECUTE FUNCTION _trg_reject_kantor_sinkron();

CREATE OR REPLACE FUNCTION _trg_kirim_ulang_item_sinkron()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    PERFORM _sinkron_status_reject_kantor(OLD.reject_kantor_id);
  END IF;
  IF TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND NEW.reject_kantor_id <> OLD.reject_kantor_id) THEN
    PERFORM _sinkron_status_reject_kantor(NEW.reject_kantor_id);
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_kirim_ulang_item_sinkron ON kirim_ulang_item;
CREATE TRIGGER trg_kirim_ulang_item_sinkron
  AFTER INSERT OR UPDATE OR DELETE ON kirim_ulang_item
  FOR EACH ROW EXECUTE FUNCTION _trg_kirim_ulang_item_sinkron();

-- Barang kirim ulang yang sudah divalidasi kantor tidak boleh ikut terhapus
-- (mis. lewat batal surat jalan). reset_all_data melewati penjagaan ini.
CREATE OR REPLACE FUNCTION _trg_kirim_ulang_item_jaga_hapus()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_nomor text;
BEGIN
  IF OLD.qty_diterima IS NOT NULL
     AND COALESCE(current_setting('app.reset_data', true), '') <> 'on' THEN
    SELECT nomor_sj INTO v_nomor FROM surat_jalan WHERE id = OLD.sj_id;
    RAISE EXCEPTION '[SUDAH DIVALIDASI] Surat jalan kirim ulang % sudah divalidasi kantor — tidak bisa dibatalkan.', COALESCE(v_nomor, 'ini');
  END IF;
  RETURN OLD;
END $$;

DROP TRIGGER IF EXISTS trg_kirim_ulang_item_jaga_hapus ON kirim_ulang_item;
CREATE TRIGGER trg_kirim_ulang_item_jaga_hapus
  BEFORE DELETE ON kirim_ulang_item
  FOR EACH ROW EXECUTE FUNCTION _trg_kirim_ulang_item_jaga_hapus();

-- SJ kirim ulang isinya hanya lewat kirim_ulang_item — jangan sampai ada
-- surat_jalan_item (itu akan menambah invoice & upah borongan).
CREATE OR REPLACE FUNCTION _tolak_item_biasa_di_sj_kirim_ulang()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_nomor text;
BEGIN
  SELECT nomor_sj INTO v_nomor FROM surat_jalan WHERE id = NEW.sj_id AND jenis = 'kirim_ulang';
  IF FOUND THEN
    RAISE EXCEPTION '[SJ KIRIM ULANG] % adalah surat jalan kirim ulang reject — tidak bisa ditambah barang biasa. Buat surat jalan baru.', v_nomor;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_tolak_item_biasa_di_sj_kirim_ulang ON surat_jalan_item;
CREATE TRIGGER trg_tolak_item_biasa_di_sj_kirim_ulang
  BEFORE INSERT ON surat_jalan_item
  FOR EACH ROW EXECUTE FUNCTION _tolak_item_biasa_di_sj_kirim_ulang();

-- SJ yang punya catatan reject kantor tidak boleh dibatalkan/dihapus.
CREATE OR REPLACE FUNCTION _jaga_hapus_sj_ada_reject_kantor()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_jml int;
BEGIN
  IF COALESCE(current_setting('app.reset_data', true), '') = 'on' THEN
    RETURN OLD;
  END IF;
  SELECT COUNT(*) INTO v_jml FROM reject_kantor WHERE surat_jalan_id = OLD.id;
  IF v_jml > 0 THEN
    RAISE EXCEPTION '[ADA REJECT KANTOR] Surat jalan % punya % catatan reject dari kantor — tidak bisa dibatalkan.', OLD.nomor_sj, v_jml;
  END IF;
  RETURN OLD;
END $$;

DROP TRIGGER IF EXISTS trg_jaga_hapus_sj_ada_reject_kantor ON surat_jalan;
CREATE TRIGGER trg_jaga_hapus_sj_ada_reject_kantor
  BEFORE DELETE ON surat_jalan
  FOR EACH ROW EXECUTE FUNCTION _jaga_hapus_sj_ada_reject_kantor();

-- SJ kirim ulang tidak membuat invoice (barangnya sudah ditagih di SJ asal).
CREATE OR REPLACE FUNCTION auto_create_invoice_on_sj()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_nomor TEXT;
BEGIN
  IF NEW.jenis = 'kirim_ulang' THEN
    RETURN NEW;
  END IF;

  v_nomor := generate_nomor_invoice(NEW.tenant_id, NEW.tanggal::DATE);
  INSERT INTO invoice(
    nomor_invoice, tanggal, surat_jalan_id, klien_id,
    total_nilai, status, tenant_id
  ) VALUES (
    v_nomor, NEW.tanggal::DATE, NEW.id, NEW.klien_id,
    0, 'belum_bayar', NEW.tenant_id
  );
  RETURN NEW;
END;
$$;

-- Status lunas/dp dihitung dari tagihan BERSIH (total − potongan reject).
CREATE OR REPLACE FUNCTION fn_update_invoice_totals()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_inv_id       UUID;
  v_total_bayar  NUMERIC;
  v_netto        NUMERIC;
BEGIN
  IF TG_OP = 'DELETE' THEN v_inv_id := OLD.invoice_id; ELSE v_inv_id := NEW.invoice_id; END IF;

  SELECT COALESCE(SUM(jumlah), 0) INTO v_total_bayar
  FROM invoice_pembayaran WHERE invoice_id = v_inv_id;

  SELECT GREATEST(total_nilai - COALESCE(potongan_reject, 0), 0) INTO v_netto
  FROM invoice WHERE id = v_inv_id;

  UPDATE invoice
  SET total_bayar = v_total_bayar,
      status = CASE
        WHEN v_total_bayar = 0       THEN 'belum_bayar'
        WHEN v_total_bayar >= v_netto THEN 'lunas'
        ELSE 'dp'
      END
  WHERE id = v_inv_id;

  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION sync_invoice_status()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_invoice_id  uuid;
  v_total_bayar numeric;
  v_netto       numeric;
BEGIN
  IF TG_OP = 'DELETE' THEN v_invoice_id := OLD.invoice_id; ELSE v_invoice_id := NEW.invoice_id; END IF;

  SELECT COALESCE(SUM(jumlah), 0) INTO v_total_bayar
  FROM invoice_pembayaran WHERE invoice_id = v_invoice_id;

  SELECT GREATEST(total_nilai - COALESCE(potongan_reject, 0), 0) INTO v_netto
  FROM invoice WHERE id = v_invoice_id;

  UPDATE invoice SET
    total_bayar = v_total_bayar,
    status = CASE
      WHEN v_total_bayar = 0        THEN 'belum_bayar'
      WHEN v_total_bayar >= v_netto THEN 'lunas'
      ELSE 'dp'
    END
  WHERE id = v_invoice_id;

  RETURN NEW;
END;
$$;

-- ─── 5. RPC ─────────────────────────────────────────────────────────────────

-- 5a. Lapor reject belakangan (setelah barang diterima)
CREATE OR REPLACE FUNCTION lapor_reject_kantor(
  p_surat_jalan_id   uuid,
  p_produk_id        uuid,
  p_qty              int,
  p_alasan_reject_id uuid,
  p_keterangan       text,
  p_tenant_id        text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_role    text := get_current_user_role();
  v_sj      RECORD;
  v_basis   int;
  v_sudah   int;
  v_harga   numeric;
  v_nama    text;
  v_nomor   text;
  v_id      uuid;
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

  SELECT id, nomor_sj, jenis INTO v_sj
  FROM surat_jalan WHERE id = p_surat_jalan_id AND tenant_id = p_tenant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION '[SJ TIDAK DITEMUKAN] Surat jalan tidak ada di sistem.';
  END IF;
  IF v_sj.jenis = 'kirim_ulang' THEN
    RAISE EXCEPTION '[SJ KIRIM ULANG] % adalah kiriman ulang. Catat reject-nya di surat jalan asal.', v_sj.nomor_sj;
  END IF;

  SELECT COALESCE(SUM(COALESCE(sji.qty_diterima, sji.qty_kirim)), 0)
  INTO v_basis
  FROM surat_jalan_item sji
  JOIN bundle b    ON b.id = sji.bundle_id
  JOIN po_item pi  ON pi.id = b.po_item_id
  WHERE sji.sj_id = p_surat_jalan_id AND pi.produk_id = p_produk_id;

  IF v_basis = 0 THEN
    RAISE EXCEPTION '[PRODUK TIDAK ADA] Produk ini tidak ada di surat jalan %.', v_sj.nomor_sj;
  END IF;

  SELECT COALESCE(SUM(qty), 0) INTO v_sudah
  FROM reject_kantor WHERE surat_jalan_id = p_surat_jalan_id AND produk_id = p_produk_id;

  SELECT harga_jual, nama INTO v_harga, v_nama FROM produk WHERE id = p_produk_id;

  IF v_sudah + p_qty > v_basis THEN
    RAISE EXCEPTION '[QTY MELEBIHI] % di % hanya % pcs, sudah dicatat reject % pcs. Maksimal tambah % pcs.',
      v_nama, v_sj.nomor_sj, v_basis, v_sudah, v_basis - v_sudah;
  END IF;

  v_nomor := _nomor_reject_kantor(p_tenant_id, CURRENT_DATE);

  INSERT INTO reject_kantor (
    nomor_reject, surat_jalan_id, produk_id, alasan_reject_id, qty,
    harga_satuan, waktu_temuan, keterangan, tenant_id, created_by
  ) VALUES (
    v_nomor, p_surat_jalan_id, p_produk_id, p_alasan_reject_id, p_qty,
    COALESCE(v_harga, 0), 'belakangan', NULLIF(trim(p_keterangan), ''), p_tenant_id, auth.uid()
  ) RETURNING id INTO v_id;

  INSERT INTO audit_log (user_id, modul, aksi, target, metadata, tenant_id)
  VALUES (auth.uid(), 'pengiriman', 'Lapor Reject Kantor', v_nomor,
          jsonb_build_object('nomor_sj', v_sj.nomor_sj, 'produk', v_nama, 'qty', p_qty), p_tenant_id);

  RETURN jsonb_build_object('id', v_id, 'nomor_reject', v_nomor);
END $$;

-- 5b. Ubah status (retur → diperbaiki / tidak_bisa, atau kembalikan)
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
  IF v_role IS NULL OR v_role NOT IN ('owner', 'admin_produksi') THEN
    RAISE EXCEPTION '[TIDAK BERHAK] Hanya owner / admin produksi yang bisa mengubah status reject.';
  END IF;
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

  UPDATE reject_kantor SET status = p_status, updated_at = now() WHERE id = p_id;

  INSERT INTO audit_log (user_id, modul, aksi, target, metadata, tenant_id)
  VALUES (auth.uid(), 'pengiriman', 'Ubah Status Reject Kantor', v_rk.nomor_reject,
          jsonb_build_object('dari', v_rk.status, 'ke', p_status), p_tenant_id);
END $$;

-- 5c. Hapus catatan reject (salah input) — hanya kalau belum ada kirim ulang
CREATE OR REPLACE FUNCTION hapus_reject_kantor(
  p_id        uuid,
  p_tenant_id text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_role text := get_current_user_role();
  v_rk   reject_kantor%ROWTYPE;
BEGIN
  IF v_role IS NULL OR v_role NOT IN ('owner', 'admin_keuangan') THEN
    RAISE EXCEPTION '[TIDAK BERHAK] Hanya owner / admin keuangan yang bisa menghapus catatan reject kantor.';
  END IF;

  SELECT * INTO v_rk FROM reject_kantor WHERE id = p_id AND tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '[TIDAK DITEMUKAN] Catatan reject tidak ada.';
  END IF;
  IF EXISTS (SELECT 1 FROM kirim_ulang_item WHERE reject_kantor_id = p_id) THEN
    RAISE EXCEPTION '[SUDAH DIKIRIM ULANG] % sudah punya surat jalan kirim ulang — tidak bisa dihapus.', v_rk.nomor_reject;
  END IF;

  DELETE FROM reject_kantor WHERE id = p_id;

  INSERT INTO audit_log (user_id, modul, aksi, target, metadata, tenant_id)
  VALUES (auth.uid(), 'pengiriman', 'Hapus Reject Kantor', v_rk.nomor_reject,
          jsonb_build_object('qty', v_rk.qty, 'surat_jalan_id', v_rk.surat_jalan_id), p_tenant_id);
END $$;

-- 5d. Buat Surat Jalan Kirim Ulang
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

    SELECT rk.id, rk.nomor_reject, rk.qty, rk.status, sj.klien_id
    INTO v_rk
    FROM reject_kantor rk
    JOIN surat_jalan sj ON sj.id = rk.surat_jalan_id
    WHERE rk.id = (v_item->>'reject_kantor_id')::uuid AND rk.tenant_id = p_tenant_id
    FOR UPDATE OF rk;

    IF NOT FOUND THEN
      RAISE EXCEPTION '[TIDAK DITEMUKAN] Catatan reject tidak ada. Muat ulang halaman.';
    END IF;
    IF v_rk.status IN ('tidak_bisa', 'selesai') THEN
      RAISE EXCEPTION '[STATUS] % berstatus % — tidak bisa dikirim ulang.', v_rk.nomor_reject, v_rk.status;
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

-- 5e. Validasi SJ kirim ulang oleh kantor
CREATE OR REPLACE FUNCTION validasi_kirim_ulang(
  p_surat_jalan_id uuid,
  p_items          jsonb,   -- [{kirim_ulang_item_id, qty_diterima}]
  p_catatan        text,
  p_user_id        uuid,
  p_tenant_id      text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_role       text := get_current_user_role();
  v_item       jsonb;
  v_kui        RECORD;
  v_diterima   int;
  v_has_kurang boolean := false;
  v_status     sj_status;
BEGIN
  IF v_role IS NULL OR v_role NOT IN ('owner', 'admin_keuangan', 'admin_produksi') THEN
    RAISE EXCEPTION '[TIDAK BERHAK] Role Anda tidak bisa memvalidasi kiriman.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM surat_jalan WHERE id = p_surat_jalan_id AND tenant_id = p_tenant_id AND jenis = 'kirim_ulang') THEN
    RAISE EXCEPTION '[BUKAN KIRIM ULANG] Surat jalan ini bukan surat jalan kirim ulang.';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_diterima := (v_item->>'qty_diterima')::int;

    SELECT id, qty INTO v_kui FROM kirim_ulang_item
    WHERE id = (v_item->>'kirim_ulang_item_id')::uuid AND sj_id = p_surat_jalan_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION '[ITEM TIDAK DITEMUKAN] Baris kirim ulang tidak cocok dengan surat jalan ini.';
    END IF;
    IF v_diterima IS NULL OR v_diterima < 0 OR v_diterima > v_kui.qty THEN
      RAISE EXCEPTION '[QTY TIDAK VALID] Qty diterima harus 0 sampai % pcs.', v_kui.qty;
    END IF;
    IF v_diterima < v_kui.qty THEN v_has_kurang := true; END IF;

    UPDATE kirim_ulang_item SET qty_diterima = v_diterima WHERE id = v_kui.id;
  END LOOP;

  v_status := CASE WHEN v_has_kurang THEN 'selisih_kurang' ELSE 'tervalidasi' END;

  UPDATE surat_jalan
  SET status = v_status, catatan_validasi = p_catatan,
      tanggal_validasi = CURRENT_DATE, validated_by = p_user_id
  WHERE id = p_surat_jalan_id;

  RETURN jsonb_build_object('status', v_status, 'has_kurang', v_has_kurang,
                            'has_lebih', false, 'approval_ids', '[]'::jsonb);
END $$;

-- 5f. validasi_pengiriman: + reject saat terima, + perbaikan bug reject_log
CREATE OR REPLACE FUNCTION validasi_pengiriman(
  p_surat_jalan_id uuid,
  p_items          jsonb,
  p_catatan        text,
  p_user_id        uuid,
  p_tenant_id      text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_item              jsonb;
  v_sji_id            uuid;
  v_bundle_id         uuid;
  v_qty_kirim         int;
  v_qty_diterima      int;
  v_selisih           int;
  v_alasan_reject_id  uuid;
  v_qty_reject        int;
  v_reject_alasan_id  uuid;
  v_reject_ket        text;
  v_produk_id         uuid;
  v_harga             numeric;
  v_barcode           text;
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
    SELECT sji.bundle_id, sji.qty_kirim, pi.produk_id, pr.harga_jual, b.barcode
    INTO v_bundle_id, v_qty_kirim, v_produk_id, v_harga, v_barcode
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
          v_reject_alasan_id, v_qty_reject, COALESCE(v_harga, 0), 'saat_terima', v_reject_ket, p_tenant_id, p_user_id
        );
      END IF;
    END IF;
  END LOOP;

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
$$;

-- ─── 6. reset_all_data ikut membersihkan tabel baru ─────────────────────────

CREATE OR REPLACE FUNCTION reset_all_data(p_tenant_id text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('app.reset_data', 'on', true);

  -- STEP 0: Reject kantor & kirim ulang
  DELETE FROM kirim_ulang_item       WHERE tenant_id = p_tenant_id;
  DELETE FROM reject_kantor          WHERE tenant_id = p_tenant_id;

  -- STEP 1: Child paling dalam
  DELETE FROM invoice_pembayaran     WHERE tenant_id = p_tenant_id;
  DELETE FROM koreksi_qty            WHERE tenant_id = p_tenant_id;
  DELETE FROM surat_jalan_item       WHERE tenant_id = p_tenant_id;
  DELETE FROM qty_approval_request   WHERE tenant_id = p_tenant_id;
  DELETE FROM reject_karyawan        WHERE tenant_id = p_tenant_id;

  -- STEP 2: Level menengah
  DELETE FROM reject_log             WHERE tenant_id = p_tenant_id;
  DELETE FROM pemakaian_aksesori     WHERE tenant_id = p_tenant_id;
  -- hpp_item TIDAK dihapus — ini data master tarif borongan
  DELETE FROM scan_log               WHERE tenant_id = p_tenant_id;
  DELETE FROM pemakaian_bahan        WHERE tenant_id = p_tenant_id;
  DELETE FROM invoice                WHERE tenant_id = p_tenant_id;

  -- STEP 3: Bundle
  DELETE FROM bundle                 WHERE tenant_id = p_tenant_id;

  -- STEP 4: Tabel yang FK ke master
  DELETE FROM buku_kas               WHERE tenant_id = p_tenant_id;
  DELETE FROM gaji_ledger            WHERE tenant_id = p_tenant_id;
  DELETE FROM gaji_payment           WHERE tenant_id = p_tenant_id;
  DELETE FROM kasbon                 WHERE tenant_id = p_tenant_id;
  DELETE FROM overhead_period        WHERE tenant_id = p_tenant_id;
  DELETE FROM audit_log              WHERE tenant_id = p_tenant_id;

  -- STEP 5: inventory_batch (sebelum jurnal_entry)
  DELETE FROM inventory_batch        WHERE tenant_id = p_tenant_id;

  -- STEP 6: Level atas
  DELETE FROM surat_jalan            WHERE tenant_id = p_tenant_id;
  DELETE FROM jurnal_entry           WHERE tenant_id = p_tenant_id;
  DELETE FROM po_item                WHERE tenant_id = p_tenant_id;
  DELETE FROM po                     WHERE tenant_id = p_tenant_id;

  -- STEP 7: Reset stok ke 0
  UPDATE inventory_item SET stok_aktual = 0 WHERE tenant_id = p_tenant_id;

  -- STEP 8: Reset sequence (barcode mulai 00001 lagi)
  UPDATE po_item_sequence SET last_sequence = 0 WHERE tenant_id = p_tenant_id;
  UPDATE bundle_sequence  SET last_sequence = 0 WHERE tenant_id = p_tenant_id;
END;
$$;

-- ─── 7. Hak akses halaman ───────────────────────────────────────────────────

INSERT INTO role_permissions (role, path, can_view, tenant_id) VALUES
  ('owner',          '/app/pengiriman/validasi',      true,  'STX-001'),
  ('admin_keuangan', '/app/pengiriman/validasi',      true,  'STX-001'),
  ('admin_produksi', '/app/pengiriman/validasi',      false, 'STX-001'),
  ('supervisor',     '/app/pengiriman/validasi',      false, 'STX-001'),
  ('mandor',         '/app/pengiriman/validasi',      false, 'STX-001'),
  ('owner',          '/app/pengiriman/reject-kantor', true,  'STX-001'),
  ('admin_keuangan', '/app/pengiriman/reject-kantor', true,  'STX-001'),
  ('admin_produksi', '/app/pengiriman/reject-kantor', true,  'STX-001'),
  ('supervisor',     '/app/pengiriman/reject-kantor', false, 'STX-001'),
  ('mandor',         '/app/pengiriman/reject-kantor', false, 'STX-001')
ON CONFLICT (role, path, tenant_id) DO UPDATE SET can_view = EXCLUDED.can_view;
