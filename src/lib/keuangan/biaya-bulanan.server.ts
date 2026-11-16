/* eslint-disable @typescript-eslint/no-explicit-any */
import { PO_AWAL_PERIODE, poPeriodeBaru, batasAwalPeriode } from './periode-po';

type Supa = { rpc: (fn: string, args: Record<string, unknown>) => any; from: (t: string) => any };

const TENANT_ID = 'STX-001';

/**
 * Overhead per bulan ('YYYY-MM' → Rp) dari sumber resmi (RPC get_biaya_overhead):
 * Buku Kas "Biaya Overhead" (+ alokasi harian biaya tetap, menggantikan pembayaran
 * sub-kelompok yang punya kontrak) ditambah "Biaya Operasional" & "Lainnya".
 * Menggantikan pembacaan jurnal_entry jenis overhead yang sudah tidak diisi.
 */
export async function overheadPerBulan(
  supabase: Supa, dari: string, sampai: string, hanyaPeriodeBaru: boolean,
): Promise<Map<string, number>> {
  const { data, error } = await supabase.rpc('get_biaya_overhead', {
    p_tenant_id: TENANT_ID, p_dari: dari, p_sampai: sampai,
    p_po_mulai: hanyaPeriodeBaru ? PO_AWAL_PERIODE : null,
  });
  if (error) throw new Error(error.message);
  const m = new Map<string, number>();
  ((data ?? []) as any[]).forEach(r => {
    if (r.jenis !== 'realisasi' && r.jenis !== 'lain') return;
    m.set(r.bulan, (m.get(r.bulan) ?? 0) + Number(r.nominal ?? 0));
  });
  return m;
}

/**
 * Belanja bahan pembantu per bulan dari Buku Kas (sistem saldo: belanja = biaya).
 * Pemakaian aksesori yang masih tercatat per bundle sudah ikut get_biaya_bahan_bulanan.
 */
export async function pembantuPerBulan(
  supabase: Supa, dari: string, sampai: string, hanyaPeriodeBaru: boolean,
): Promise<Map<string, number>> {
  const { data, error } = await supabase
    .from('buku_kas')
    .select('nominal, tanggal, po:po_id(no_po)')
    .eq('tenant_id', TENANT_ID)
    .eq('tipe', 'keluar')
    .eq('kategori', 'Bahan Pembantu')
    .gte('tanggal', hanyaPeriodeBaru ? batasAwalPeriode(dari) : dari)
    .lte('tanggal', sampai);
  if (error) throw new Error(error.message);
  const m = new Map<string, number>();
  ((data ?? []) as any[]).forEach(k => {
    const po = Array.isArray(k.po) ? k.po[0] : k.po;
    if (hanyaPeriodeBaru && po?.no_po && !poPeriodeBaru(po.no_po)) return;
    const bulan = String(k.tanggal).slice(0, 7);
    m.set(bulan, (m.get(bulan) ?? 0) + Number(k.nominal ?? 0));
  });
  return m;
}
