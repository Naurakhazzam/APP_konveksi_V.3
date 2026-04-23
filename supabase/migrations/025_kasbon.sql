CREATE TABLE IF NOT EXISTS kasbon (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  karyawan_id UUID NOT NULL REFERENCES karyawan(id),
  jumlah NUMERIC(12,2) NOT NULL CHECK (jumlah > 0),
  keterangan TEXT,
  tanggal DATE NOT NULL DEFAULT CURRENT_DATE,
  status TEXT NOT NULL DEFAULT 'belum_dipotong' CHECK (status IN ('belum_dipotong', 'sudah_dipotong')),
  tenant_id TEXT NOT NULL DEFAULT 'STX-001',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE kasbon ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON kasbon USING (tenant_id = current_setting('app.tenant_id', true));
