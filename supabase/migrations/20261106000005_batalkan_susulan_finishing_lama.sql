-- ================================================================
-- MIGRATION: Batalkan upah finishing susulan untuk pekerjaan LAMA
--
-- Migrasi 20261106000003 membuat upah susulan (tanggal 6 Nov) untuk
-- semua bundle yang tahap finishing-nya selesai tapi belum masuk Surat
-- Jalan. Itu ikut menarik bundle yang selesai finishing berminggu-minggu
-- lalu (Agustus–Oktober: PO-0060, 0077, 0078, 0082, 0084, 0092, dan
-- sebagian 0080/0089/0094/0096) sehingga muncul sebagai pekerjaan
-- minggu ini — tidak sesuai kenyataan.
--
-- Dibatalkan: entri susulan yang tahapnya selesai SEBELUM 31 Okt 2026
-- (awal minggu penggajian berjalan). Susulan untuk pekerjaan yang
-- memang selesai minggu ini tetap.
-- ================================================================

WITH target AS (
  SELECT gl.id
  FROM gaji_ledger gl
  JOIN bundle b ON b.id::text = gl.sumber_id
  WHERE gl.tenant_id = 'STX-001'
    AND gl.status = 'belum_lunas'
    AND gl.created_at BETWEEN '2026-11-06 18:30+07' AND '2026-11-06 19:30+07'
    AND gl.keterangan NOT LIKE 'Upah jahit%'
    AND gl.keterangan NOT LIKE 'Upah cutting%'
    AND COALESCE(
          b.status_tahap -> split_part(split_part(gl.keterangan, ' - ', 1), ' ', 2) ->> 'waktu_selesai',
          b.status_tahap -> split_part(split_part(gl.keterangan, ' - ', 1), ' ', 2) ->> 'end_time'
        )::timestamptz::date < DATE '2026-10-31'
),
batal AS (
  UPDATE gaji_ledger gl
  SET status = 'cancelled',
      keterangan = gl.keterangan || ' [DIBATALKAN: susulan pekerjaan lama, lihat migrasi 20261106000005]'
  FROM target t
  WHERE gl.id = t.id
  RETURNING gl.id, gl.total
)
INSERT INTO audit_log (user_id, modul, aksi, target, metadata, tenant_id)
SELECT '71fb0890-5306-47be-a9c0-c5cce41cca95', 'penggajian', 'Batal Susulan Upah Finishing Lama',
       'migrasi 20261106000005',
       jsonb_build_object('jumlah_entri', COUNT(*), 'total', COALESCE(SUM(total), 0),
                          'ledger_ids', jsonb_agg(id)),
       'STX-001'
FROM batal;
