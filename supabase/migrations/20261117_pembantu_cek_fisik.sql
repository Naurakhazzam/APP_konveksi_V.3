-- Cek fisik bahan pembantu: nilai sisa barang di rak per jenis pada tanggal tertentu.
-- Dipakai untuk menghitung hemat/boros NYATA:
--   pemakaian nyata = (barang lama + belanja s.d. tanggal cek) − sisa fisik
--   hemat/boros     = jatah HPP s.d. tanggal cek − pemakaian nyata
-- Tidak mengubah saldo/penghematan tercatat dan tidak menyentuh Buku Kas.

CREATE TABLE IF NOT EXISTS public.pembantu_cek_fisik (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    text NOT NULL,
  jenis_id     uuid NOT NULL REFERENCES public.pembantu_jenis(id),
  tanggal      date NOT NULL,
  qty          numeric CHECK (qty IS NULL OR qty >= 0),
  satuan       text,
  harga_satuan numeric CHECK (harga_satuan IS NULL OR harga_satuan >= 0),
  nilai_sisa   numeric NOT NULL CHECK (nilai_sisa >= 0),
  keterangan   text,
  created_by   uuid,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pembantu_cek_fisik_jenis_idx ON public.pembantu_cek_fisik (tenant_id, jenis_id, tanggal);
ALTER TABLE public.pembantu_cek_fisik ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pembantu_cek_fisik_tenant_isolation ON public.pembantu_cek_fisik;
CREATE POLICY pembantu_cek_fisik_tenant_isolation ON public.pembantu_cek_fisik
  FOR ALL TO authenticated USING (tenant_id = 'STX-001') WITH CHECK (tenant_id = 'STX-001');
