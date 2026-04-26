CREATE TABLE IF NOT EXISTS overhead_period (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     TEXT NOT NULL,
  label         TEXT NOT NULL,
  tanggal_mulai DATE NOT NULL,
  tanggal_akhir DATE NOT NULL,
  is_active     BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- Pastikan hanya 1 yang aktif per tenant
CREATE UNIQUE INDEX IF NOT EXISTS idx_overhead_period_active
  ON overhead_period (tenant_id)
  WHERE is_active = true;

ALTER TABLE overhead_period ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON overhead_period
  USING (tenant_id = 'STX-001');
