-- Sub-kelompok Biaya Overhead di Buku Kas (mis. Gaji Staff, Uang Makan, Listrik, Sampah).
-- Awal: 4 komponen overhead dari HPP (agar nanti bisa dibandingkan dengan patokan HPP);
-- user bisa menambah sub-kelompok sendiri dari form Buku Kas.
CREATE TABLE IF NOT EXISTS public.overhead_sub (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       text NOT NULL DEFAULT 'STX-001',
  nama            text NOT NULL,
  hpp_komponen_id uuid REFERENCES public.hpp_komponen(id) ON DELETE SET NULL,
  urutan          int NOT NULL DEFAULT 100,
  aktif           boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS overhead_sub_nama_uniq ON public.overhead_sub (tenant_id, lower(nama));

ALTER TABLE public.overhead_sub ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS overhead_sub_tenant_isolation ON public.overhead_sub;
CREATE POLICY overhead_sub_tenant_isolation ON public.overhead_sub
  FOR ALL USING (tenant_id = 'STX-001');

INSERT INTO public.overhead_sub (tenant_id, nama, hpp_komponen_id, urutan)
SELECT hk.tenant_id, hk.nama, hk.id, 10
FROM public.hpp_komponen hk
WHERE hk.tenant_id = 'STX-001' AND hk.kategori = 'overhead'
ON CONFLICT DO NOTHING;

-- Daftar biaya rutin dari user (16 Nov 2026). Listrik & Uang Makan tetap tertaut ke komponen HPP.
UPDATE public.overhead_sub SET nama = 'Listrik', urutan = 7 WHERE tenant_id = 'STX-001' AND nama = 'Operasional Listrik';
UPDATE public.overhead_sub SET urutan = 4 WHERE tenant_id = 'STX-001' AND nama = 'Uang Makan';
UPDATE public.overhead_sub SET urutan = 50 WHERE tenant_id = 'STX-001' AND nama IN ('Operasional Rumah', 'Operasional Sehari-hari');
INSERT INTO public.overhead_sub (tenant_id, nama, urutan) VALUES
  ('STX-001', 'Service Mesin', 1), ('STX-001', 'Bayar Sampah', 2), ('STX-001', 'Bensin', 3),
  ('STX-001', 'Galon', 5), ('STX-001', 'Gas', 6), ('STX-001', 'Internet', 8),
  ('STX-001', 'Perbaikan Gedung', 9), ('STX-001', 'Gaji Staff', 10)
ON CONFLICT DO NOTHING;
-- Disatukan atas persetujuan user: beras & galon → Uang Makan (HPP); sampah & internet → Tagihan Bulanan
UPDATE public.overhead_sub SET nama = 'Uang Makan (beras, galon)' WHERE tenant_id = 'STX-001' AND nama = 'Uang Makan';
UPDATE public.overhead_sub SET aktif = false WHERE tenant_id = 'STX-001' AND nama = 'Galon';
UPDATE public.overhead_sub SET nama = 'Tagihan Bulanan (sampah, internet)' WHERE tenant_id = 'STX-001' AND nama = 'Bayar Sampah';
UPDATE public.overhead_sub SET aktif = false WHERE tenant_id = 'STX-001' AND nama = 'Internet';
-- Listrik ikut Tagihan Bulanan; Gas = setrika uap (keputusan user)
UPDATE public.overhead_sub SET nama = 'Tagihan Bulanan (listrik, internet, sampah)' WHERE tenant_id = 'STX-001' AND nama = 'Tagihan Bulanan (sampah, internet)';
UPDATE public.overhead_sub SET aktif = false WHERE tenant_id = 'STX-001' AND nama = 'Listrik';
UPDATE public.overhead_sub SET nama = 'Gas (setrika uap)' WHERE tenant_id = 'STX-001' AND nama = 'Gas';

ALTER TABLE public.buku_kas
  ADD COLUMN IF NOT EXISTS overhead_sub_id uuid REFERENCES public.overhead_sub(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS buku_kas_overhead_sub_idx ON public.buku_kas (overhead_sub_id);
