-- ================================================================
-- MIGRATION: Batalkan surat jalan (salah input) — barang kembali ke
--            daftar siap kirim
--
-- Kenapa perlu RPC khusus, bukan DELETE biasa? Aturan relasi bikin
-- DELETE polos berbahaya sekaligus mustahil:
--
--   surat_jalan_item.sj_id     -> CASCADE   : ikut terhapus (benar)
--   bundle.surat_jalan_id      -> NO ACTION : DELETE DITOLAK selama masih
--                                             ada bundle yang menunjuk SJ
--   invoice.surat_jalan_id     -> SET NULL  : invoice TIDAK ikut terhapus,
--                                             jadi tagihan gantung tanpa
--                                             surat jalan di belakangnya
--
-- Jebakan kedua yang paling berbahaya: tagihan jutaan rupiah selamat
-- sebagai invoice yatim, bisa terbawa ke laporan keuangan dan ditagihkan
-- ke klien padahal barangnya tidak jadi dikirim.
--
-- Fungsi ini mengerjakan urutan yang benar, dan menolak lebih dulu kalau
-- pembatalan sudah tidak aman:
--   - ada item yang sudah divalidasi klien (qty_diterima terisi)
--   - invoice-nya sudah dibayar sebagian/lunas
--   - ada reject_log yang menunjuk surat jalan ini
--
-- Nomor SJ TIDAK didaur ulang — sj_sequence dibiarkan maju, sehingga
-- nomor yang dibatalkan meninggalkan lubang. Itu memang disengaja: nomor
-- surat jalan yang pernah dicetak tidak boleh muncul lagi dengan isi
-- berbeda.
--
-- Setelah surat_jalan_item terhapus, sisa qty otomatis benar dengan
-- sendirinya — getBundlesReadyToShip menghitung sisa dari total qty_kirim
-- yang tercatat (lihat migrasi kirim bertahap), jadi tidak ada angka yang
-- perlu dihitung ulang di sini.
-- ================================================================

CREATE OR REPLACE FUNCTION public.batal_surat_jalan(
  p_sj_id uuid, p_alasan text, p_user_id uuid, p_tenant_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_sj              RECORD;
  v_nomor_invoice   TEXT;
  v_invoice_id      UUID;
  v_jml_divalidasi  INT;
  v_jml_reject      INT;
  v_jml_bayar       INT;
  v_total_bayar     NUMERIC;
  v_jml_item        INT;
  v_total_qty       INT;
  v_bundle_ids      UUID[];
BEGIN
  SELECT id, nomor_sj, status, klien_id
  INTO v_sj
  FROM surat_jalan
  WHERE id = p_sj_id AND tenant_id = p_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Surat jalan tidak ditemukan';
  END IF;

  -- ── Pemeriksaan keamanan ──
  SELECT COUNT(*) FILTER (WHERE qty_diterima IS NOT NULL),
         COUNT(*), COALESCE(SUM(qty_kirim), 0),
         ARRAY_AGG(bundle_id)
  INTO v_jml_divalidasi, v_jml_item, v_total_qty, v_bundle_ids
  FROM surat_jalan_item
  WHERE sj_id = p_sj_id;

  IF v_jml_divalidasi > 0 THEN
    RAISE EXCEPTION 'Surat jalan % sudah divalidasi klien (% item) — tidak bisa dibatalkan. Perbaiki lewat proses retur/penyesuaian.',
      v_sj.nomor_sj, v_jml_divalidasi;
  END IF;

  SELECT COUNT(*) INTO v_jml_reject
  FROM reject_log WHERE surat_jalan_id = p_sj_id;

  IF v_jml_reject > 0 THEN
    RAISE EXCEPTION 'Surat jalan % punya % catatan reject — tidak bisa dibatalkan',
      v_sj.nomor_sj, v_jml_reject;
  END IF;

  SELECT i.id, i.nomor_invoice, COALESCE(i.total_bayar, 0)
  INTO v_invoice_id, v_nomor_invoice, v_total_bayar
  FROM invoice i
  WHERE i.surat_jalan_id = p_sj_id AND i.tenant_id = p_tenant_id
  LIMIT 1;

  IF v_invoice_id IS NOT NULL THEN
    SELECT COUNT(*) INTO v_jml_bayar
    FROM invoice_pembayaran WHERE invoice_id = v_invoice_id;

    IF v_jml_bayar > 0 OR v_total_bayar > 0 THEN
      RAISE EXCEPTION 'Invoice % sudah menerima pembayaran — surat jalan % tidak bisa dibatalkan',
        v_nomor_invoice, v_sj.nomor_sj;
    END IF;
  END IF;

  -- ── Eksekusi, urut dari anak ke induk ──

  -- 1. Invoice dibuang duluan. Kalau dilewat, FK SET NULL akan
  --    menyisakannya sebagai tagihan yatim.
  IF v_invoice_id IS NOT NULL THEN
    DELETE FROM invoice WHERE id = v_invoice_id;
  END IF;

  -- 2. Lepas cap "sudah terkirim" di bundle. Wajib sebelum hapus SJ,
  --    karena FK-nya NO ACTION.
  UPDATE bundle
  SET surat_jalan_id = NULL
  WHERE surat_jalan_id = p_sj_id AND tenant_id = p_tenant_id;

  -- 3. Buang pengajuan approval qty-lebih yang lahir dari SJ ini dan
  --    belum diputuskan. Yang sudah disetujui/ditolak dibiarkan sebagai
  --    jejak.
  IF v_bundle_ids IS NOT NULL THEN
    DELETE FROM qty_approval_request
    WHERE bundle_id = ANY(v_bundle_ids)
      AND tahap = 'pengiriman'
      AND sumber = 'buat_surat_jalan'
      AND status = 'pending'
      AND tenant_id = p_tenant_id;
  END IF;

  -- 4. Surat jalan — item ikut terhapus lewat CASCADE
  DELETE FROM surat_jalan WHERE id = p_sj_id AND tenant_id = p_tenant_id;

  INSERT INTO audit_log (user_id, modul, aksi, target, metadata, tenant_id)
  VALUES (
    p_user_id, 'pengiriman', 'Batal Surat Jalan', v_sj.nomor_sj,
    jsonb_build_object(
      'nomor_sj',       v_sj.nomor_sj,
      'nomor_invoice',  v_nomor_invoice,
      'jumlah_bundle',  v_jml_item,
      'total_qty',      v_total_qty,
      'alasan',         p_alasan
    ),
    p_tenant_id
  );

  RETURN jsonb_build_object(
    'success',        true,
    'nomor_sj',       v_sj.nomor_sj,
    'nomor_invoice',  v_nomor_invoice,
    'jumlah_bundle',  v_jml_item,
    'total_qty',      v_total_qty
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.batal_surat_jalan(uuid, text, uuid, text) TO authenticated;
