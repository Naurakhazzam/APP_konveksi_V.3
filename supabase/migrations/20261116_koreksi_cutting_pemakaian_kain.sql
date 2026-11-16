-- Koreksi hasil cutting kini ikut menyesuaikan pemakaian kain (pemakaian_bahan + stok/LOT).
-- Sebelumnya koreksi_hasil_cutting, koreksi_serah_terima_jahit (p_koreksi_cutting) dan
-- koreksi_qty_berantai (tahap cutting) hanya menyesuaikan upah cutting.
-- Aturan: qty_pakai += rate_per_pcs × selisih pcs.
--   naik  → ambil FIFO dari LOT (_ambil_stok_bahan_fifo; stok boleh minus, dilunasi Stok Masuk)
--   turun → kembalikan ke LOT (_kembalikan_stok_bahan), harga diprorata.
-- Catatan pemakaian kain selalu menempel di bundle pemilik cutting (induk bila Split).

CREATE OR REPLACE FUNCTION public._sesuaikan_pemakaian_kain(p_bundle_id uuid, p_delta_pcs numeric, p_tenant_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_pb    RECORD;
  v_baru  numeric;
  v_ubah  numeric;
  v_ambil RECORD;
  v_harga numeric;
  v_hsat  numeric;
  v_info  jsonb := '[]'::jsonb;
BEGIN
  IF COALESCE(p_delta_pcs, 0) = 0 THEN RETURN v_info; END IF;

  FOR v_pb IN
    SELECT pb.*, ii.nama AS item_nama
    FROM pemakaian_bahan pb
    JOIN inventory_item ii ON ii.id = pb.inventory_item_id
    WHERE pb.bundle_id = p_bundle_id AND pb.tenant_id = p_tenant_id
      AND COALESCE(pb.rate_per_pcs, 0) > 0
    ORDER BY pb.created_at
    FOR UPDATE OF pb
  LOOP
    v_baru := GREATEST(ROUND(v_pb.qty_pakai + v_pb.rate_per_pcs * p_delta_pcs, 3), 0);
    v_ubah := v_baru - v_pb.qty_pakai;
    CONTINUE WHEN v_ubah = 0;

    IF v_pb.dari_sisa THEN
      SELECT harga_satuan INTO v_hsat FROM inventory_batch WHERE id = v_pb.inventory_batch_id;
      v_harga := v_baru * COALESCE(v_hsat, 0);
      UPDATE inventory_batch SET qty_awal = v_baru WHERE id = v_pb.inventory_batch_id AND dari_sisa;
    ELSIF v_ubah > 0 THEN
      SELECT * INTO v_ambil FROM _ambil_stok_bahan_fifo(v_pb.inventory_item_id, v_ubah, p_tenant_id);
      v_harga := COALESCE(v_pb.harga_pakai, 0) + v_ambil.harga;
    ELSE
      PERFORM _kembalikan_stok_bahan(v_pb.inventory_item_id, -v_ubah, p_tenant_id);
      v_harga := CASE WHEN v_pb.qty_pakai > 0
                      THEN COALESCE(v_pb.harga_pakai, 0) * v_baru / v_pb.qty_pakai ELSE 0 END;
    END IF;

    UPDATE pemakaian_bahan SET qty_pakai = v_baru, harga_pakai = ROUND(v_harga, 2) WHERE id = v_pb.id;

    v_info := v_info || jsonb_build_object(
      'pemakaian_id', v_pb.id, 'bahan', v_pb.item_nama, 'rate_per_pcs', v_pb.rate_per_pcs,
      'qty_lama', v_pb.qty_pakai, 'qty_baru', v_baru,
      'harga_lama', v_pb.harga_pakai, 'harga_baru', ROUND(v_harga, 2));
  END LOOP;

  RETURN v_info;
END;
$function$;

REVOKE ALL ON FUNCTION public._sesuaikan_pemakaian_kain(uuid, numeric, text) FROM PUBLIC, anon, authenticated;

-- Sisipkan pemanggilan ke tiga fungsi koreksi (tanpa menyalin ulang seluruh badan fungsi).
CREATE OR REPLACE FUNCTION pg_temp._ganti1(src text, a text, b text) RETURNS text
LANGUAGE plpgsql AS $$
BEGIN
  IF (length(src) - length(replace(src, a, ''))) / length(a) <> 1 THEN
    RAISE EXCEPTION 'Pola tidak tepat satu kali: %', a;
  END IF;
  RETURN replace(src, a, b);
END $$;

DO $mig$
DECLARE
  d text;
BEGIN
  -- 1. koreksi_hasil_cutting
  d := pg_get_functiondef('public.koreksi_hasil_cutting(uuid,numeric,text,uuid,text)'::regprocedure);
  IF position('_sesuaikan_pemakaian_kain' IN d) = 0 THEN
    d := pg_temp._ganti1(d, 'v_upah_aksi     TEXT := NULL;',
                            'v_upah_aksi     TEXT := NULL;' || chr(10) || '  v_kain          JSONB := ''[]''::jsonb;');
    d := pg_temp._ganti1(d, '-- ── Update bundle ──',
                            '-- ── Pemakaian kain ikut selisih pcs ──' || chr(10) ||
                            '  v_kain := _sesuaikan_pemakaian_kain(v_bundle.id, v_delta, p_tenant_id);' || chr(10) || chr(10) ||
                            '  -- ── Update bundle ──');
    d := pg_temp._ganti1(d, '''upah_aksi'',      v_upah_aksi,',
                            '''upah_aksi'',      v_upah_aksi,' || chr(10) || '      ''kain'',           v_kain,');
    d := pg_temp._ganti1(d, '''upah_aksi'',    v_upah_aksi',
                            '''upah_aksi'',    v_upah_aksi,' || chr(10) || '    ''kain'',         v_kain');
    EXECUTE d;
  END IF;

  -- 2. koreksi_serah_terima_jahit (centang koreksi cutting)
  d := pg_get_functiondef('public.koreksi_serah_terima_jahit(uuid,uuid,numeric,text,uuid,text,boolean)'::regprocedure);
  IF position('_sesuaikan_pemakaian_kain' IN d) = 0 THEN
    d := pg_temp._ganti1(d, 'v_upah_aksi            TEXT := NULL;',
                            'v_upah_aksi            TEXT := NULL;' || chr(10) || '  v_kain                 JSONB := ''[]''::jsonb;');
    d := pg_temp._ganti1(d, 'v_qty_maks := p_qty;',
                            '-- Pemakaian kain (tercatat di bundle pemilik cutting) ikut selisih pcs' || chr(10) ||
                            '    v_kain := _sesuaikan_pemakaian_kain(v_root_id, v_cut_delta, p_tenant_id);' || chr(10) ||
                            '    v_qty_maks := p_qty;');
    d := pg_temp._ganti1(d, '''upah_aksi'',        v_upah_aksi',
                            '''upah_aksi'',        v_upah_aksi,' || chr(10) || '                              ''kain'',             v_kain');
    d := pg_temp._ganti1(d, '''upah_cutting_aksi'',   v_upah_aksi',
                            '''upah_cutting_aksi'',   v_upah_aksi,' || chr(10) || '    ''kain'',                v_kain');
    EXECUTE d;
  END IF;

  -- 3. koreksi_qty_berantai (mulai dari tahap cutting; bundle Split ditolak, jadi kain di bundle ini)
  d := pg_get_functiondef('public.koreksi_qty_berantai(uuid,text,integer,text,uuid,text)'::regprocedure);
  IF position('_sesuaikan_pemakaian_kain' IN d) = 0 THEN
    d := pg_temp._ganti1(d, 'v_cap_sj      UUID;',
                            'v_cap_sj      UUID;' || chr(10) || '  v_kain        JSONB := ''[]''::jsonb;');
    d := pg_temp._ganti1(d, 'v_dasar := v_lama;',
                            'v_dasar := v_lama;' || chr(10) ||
                            '      IF v_lama IS NOT NULL THEN' || chr(10) ||
                            '        v_kain := _sesuaikan_pemakaian_kain(v_bundle.id, p_qty - v_lama, p_tenant_id);' || chr(10) ||
                            '      END IF;');
    d := pg_temp._ganti1(d, '''stok_warnings'',     v_warn,',
                            '''stok_warnings'',     v_warn,' || chr(10) || '      ''kain'',              v_kain,');
    d := pg_temp._ganti1(d, '''upah'', v_upah_info, ''stok_warnings'', v_warn);',
                            '''upah'', v_upah_info, ''stok_warnings'', v_warn, ''kain'', v_kain);');
    EXECUTE d;
  END IF;
END $mig$;
