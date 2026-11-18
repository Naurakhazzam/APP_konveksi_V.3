-- ============================================================================
-- Reject Kantor → Keuangan (Sesi 3 rencana Pengiriman, 19 Nov 2026)
--
-- L/R mengakui "Retur & Reject" per kejadian:
--   • reject dilaporkan  → pengurang pendapatan di tanggal lapor (reject_kantor.tanggal)
--   • dikirim ulang      → pemulihan di tanggal diterima kantor (tanggal validasi SJ kirim ulang)
--   • dibeli kantor      → pemulihan harga beli × sisa di tanggal keputusan (kolom baru tanggal_dibeli)
-- Kolom tanggal_dibeli diisi otomatis oleh trigger saat status berubah.
-- ============================================================================

ALTER TABLE reject_kantor ADD COLUMN IF NOT EXISTS tanggal_dibeli date;

UPDATE reject_kantor SET tanggal_dibeli = COALESCE(updated_at::date, CURRENT_DATE)
WHERE status = 'dibeli_kantor' AND tanggal_dibeli IS NULL;

CREATE OR REPLACE FUNCTION _trg_reject_kantor_tanggal_dibeli()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.status = 'dibeli_kantor' THEN
    IF TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'dibeli_kantor' THEN
      NEW.tanggal_dibeli := CURRENT_DATE;
    END IF;
  ELSE
    NEW.tanggal_dibeli := NULL;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_reject_kantor_tanggal_dibeli ON reject_kantor;
CREATE TRIGGER trg_reject_kantor_tanggal_dibeli
  BEFORE INSERT OR UPDATE OF status ON reject_kantor
  FOR EACH ROW EXECUTE FUNCTION _trg_reject_kantor_tanggal_dibeli();

-- Halaman Laporan Reject Kantor (menu Keuangan)
INSERT INTO role_permissions (role, path, can_view, tenant_id) VALUES
  ('owner',          '/app/keuangan/laporan-reject-kantor', true,  'STX-001'),
  ('admin_keuangan', '/app/keuangan/laporan-reject-kantor', true,  'STX-001'),
  ('admin_produksi', '/app/keuangan/laporan-reject-kantor', false, 'STX-001'),
  ('supervisor',     '/app/keuangan/laporan-reject-kantor', false, 'STX-001'),
  ('mandor',         '/app/keuangan/laporan-reject-kantor', false, 'STX-001')
ON CONFLICT (role, path, tenant_id) DO UPDATE SET can_view = EXCLUDED.can_view;
