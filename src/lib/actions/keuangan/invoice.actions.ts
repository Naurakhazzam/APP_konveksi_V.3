'use server';

import { createClient } from '@/lib/supabase/server';
import { getCurrentUserProfile } from '@/lib/auth/permissions';
import { revalidatePath } from 'next/cache';
import type {
  InvoiceRow, InvoiceDetail, InvoicePembayaran,
  CreateInvoiceInput, AddPembayaranInput,
} from './invoice.types';

export type { InvoiceRow, InvoiceDetail, InvoicePembayaran } from './invoice.types';

const TENANT_ID = 'STX-001';
const REVALIDATE = '/app/keuangan/invoice';

// ─────────────────────────────────────────────────────────────────────────────
// GET LIST
// ─────────────────────────────────────────────────────────────────────────────

export async function getInvoiceList(filters?: {
  status?: string;
  klien_id?: string;
  bulan?: string;
  tahun?: string;
}): Promise<InvoiceRow[]> {
  const supabase = await createClient();

  let query = supabase
    .from('invoice')
    .select('id, nomor_invoice, tanggal, tanggal_jatuh_tempo, surat_jalan_id, klien_id, total_nilai, total_bayar, status, catatan, created_at')
    .eq('tenant_id', TENANT_ID)
    .order('created_at', { ascending: false });

  if (filters?.status)   query = query.eq('status', filters.status);
  if (filters?.klien_id) query = query.eq('klien_id', filters.klien_id);

  if (filters?.tahun) {
    const y = filters.tahun;
    if (filters.bulan) {
      const m = filters.bulan.padStart(2, '0');
      const lastDay = new Date(Number(y), Number(m), 0).getDate();
      query = query
        .gte('tanggal', `${y}-${m}-01`)
        .lte('tanggal', `${y}-${m}-${String(lastDay).padStart(2, '0')}`);
    } else {
      query = query.gte('tanggal', `${y}-01-01`).lte('tanggal', `${y}-12-31`);
    }
  }

  const { data: invoices, error } = await query;
  if (error) throw new Error(error.message);

  if (!invoices || invoices.length === 0) return [];

  // Fetch klien names
  const klienIds = [...new Set(invoices.map((i: any) => i.klien_id))];
  const { data: klienData } = await supabase
    .from('klien')
    .select('id, nama')
    .in('id', klienIds);
  const klienMap: Record<string, string> = {};
  (klienData ?? []).forEach((k: any) => { klienMap[k.id] = k.nama; });

  // Fetch SJ nomors
  const sjIds = invoices.map((i: any) => i.surat_jalan_id).filter(Boolean);
  const sjMap: Record<string, string> = {};
  if (sjIds.length > 0) {
    const { data: sjData } = await supabase
      .from('surat_jalan')
      .select('id, nomor_sj')
      .in('id', sjIds);
    (sjData ?? []).forEach((sj: any) => { sjMap[sj.id] = sj.nomor_sj; });
  }

  return invoices.map((inv: any) => ({
    id:                 inv.id,
    nomor_invoice:      inv.nomor_invoice,
    tanggal:            inv.tanggal,
    tanggal_jatuh_tempo: inv.tanggal_jatuh_tempo ?? null,
    surat_jalan_id:     inv.surat_jalan_id ?? null,
    nomor_sj:           inv.surat_jalan_id ? (sjMap[inv.surat_jalan_id] ?? null) : null,
    klien_id:           inv.klien_id,
    klien_nama:         klienMap[inv.klien_id] ?? '-',
    total_nilai:        Number(inv.total_nilai),
    total_bayar:        Number(inv.total_bayar),
    sisa:               Number(inv.total_nilai) - Number(inv.total_bayar),
    status:             inv.status,
    catatan:            inv.catatan ?? null,
    created_at:         inv.created_at,
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// GET DETAIL (with pembayaran)
// ─────────────────────────────────────────────────────────────────────────────

export async function getInvoiceDetail(id: string): Promise<InvoiceDetail | null> {
  const supabase = await createClient();

  const [invRes, bayarRes] = await Promise.all([
    supabase
      .from('invoice')
      .select('id, nomor_invoice, tanggal, tanggal_jatuh_tempo, surat_jalan_id, klien_id, total_nilai, total_bayar, status, catatan, created_at')
      .eq('id', id)
      .eq('tenant_id', TENANT_ID)
      .single(),
    supabase
      .from('invoice_pembayaran')
      .select('id, invoice_id, tanggal, jumlah, metode, keterangan, created_at')
      .eq('invoice_id', id)
      .eq('tenant_id', TENANT_ID)
      .order('tanggal', { ascending: true }),
  ]);

  if (invRes.error || !invRes.data) return null;
  const inv = invRes.data;

  // Klien name
  const { data: klienData } = await supabase
    .from('klien')
    .select('nama')
    .eq('id', inv.klien_id)
    .single();

  // SJ nomor
  let nomor_sj: string | null = null;
  if (inv.surat_jalan_id) {
    const { data: sjData } = await supabase
      .from('surat_jalan')
      .select('nomor_sj')
      .eq('id', inv.surat_jalan_id)
      .single();
    nomor_sj = sjData?.nomor_sj ?? null;
  }

  const pembayaran: InvoicePembayaran[] = (bayarRes.data ?? []).map((p: any) => ({
    id:          p.id,
    invoice_id:  p.invoice_id,
    tanggal:     p.tanggal,
    jumlah:      Number(p.jumlah),
    metode:      p.metode,
    keterangan:  p.keterangan ?? null,
    created_at:  p.created_at,
  }));

  return {
    id:                 inv.id,
    nomor_invoice:      inv.nomor_invoice,
    tanggal:            inv.tanggal,
    tanggal_jatuh_tempo: inv.tanggal_jatuh_tempo ?? null,
    surat_jalan_id:     inv.surat_jalan_id ?? null,
    nomor_sj,
    klien_id:           inv.klien_id,
    klien_nama:         (klienData as any)?.nama ?? '-',
    total_nilai:        Number(inv.total_nilai),
    total_bayar:        Number(inv.total_bayar),
    sisa:               Number(inv.total_nilai) - Number(inv.total_bayar),
    status:             inv.status,
    catatan:            inv.catatan ?? null,
    created_at:         inv.created_at,
    pembayaran,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// CREATE INVOICE
// ─────────────────────────────────────────────────────────────────────────────

export async function createInvoice(
  input: CreateInvoiceInput
): Promise<{ success: boolean; error?: string; id?: string }> {
  const profile = await getCurrentUserProfile();
  if (!profile) return { success: false, error: 'Unauthorized.' };

  if (!input.tanggal)    return { success: false, error: 'Tanggal tidak boleh kosong.' };
  if (!input.klien_id)   return { success: false, error: 'Klien tidak boleh kosong.' };
  if (!input.total_nilai || input.total_nilai <= 0)
    return { success: false, error: 'Total nilai harus lebih dari 0.' };

  const supabase = await createClient();

  // Generate nomor invoice via SQL function
  const { data: nomorData, error: nomorErr } = await supabase
    .rpc('generate_nomor_invoice', {
      p_tenant_id: TENANT_ID,
      p_tanggal:   input.tanggal,
    });

  if (nomorErr) return { success: false, error: nomorErr.message };

  const { data, error } = await supabase
    .from('invoice')
    .insert({
      nomor_invoice:       nomorData as string,
      tanggal:             input.tanggal,
      tanggal_jatuh_tempo: input.tanggal_jatuh_tempo ?? null,
      surat_jalan_id:      input.surat_jalan_id ?? null,
      klien_id:            input.klien_id,
      total_nilai:         input.total_nilai,
      catatan:             input.catatan ?? null,
      tenant_id:           TENANT_ID,
      created_by:          profile.id,
    })
    .select('id')
    .single();

  if (error) return { success: false, error: error.message };

  revalidatePath(REVALIDATE);
  return { success: true, id: data.id };
}

// ─────────────────────────────────────────────────────────────────────────────
// ADD PEMBAYARAN
// ─────────────────────────────────────────────────────────────────────────────

export async function addPembayaran(
  input: AddPembayaranInput
): Promise<{ success: boolean; error?: string }> {
  const profile = await getCurrentUserProfile();
  if (!profile) return { success: false, error: 'Unauthorized.' };

  if (!input.jumlah || input.jumlah <= 0)
    return { success: false, error: 'Jumlah bayar harus lebih dari 0.' };
  if (!input.tanggal)
    return { success: false, error: 'Tanggal tidak boleh kosong.' };

  const supabase = await createClient();

  // Pastikan invoice tidak overpay
  const { data: inv } = await supabase
    .from('invoice')
    .select('total_nilai, total_bayar, status')
    .eq('id', input.invoice_id)
    .single();

  if (!inv) return { success: false, error: 'Invoice tidak ditemukan.' };
  if (inv.status === 'lunas') return { success: false, error: 'Invoice sudah lunas.' };

  const sisa = Number(inv.total_nilai) - Number(inv.total_bayar);
  if (input.jumlah > sisa)
    return { success: false, error: `Jumlah melebihi sisa tagihan (${sisa.toLocaleString('id-ID')}).` };

  const { error } = await supabase.from('invoice_pembayaran').insert({
    invoice_id:  input.invoice_id,
    tanggal:     input.tanggal,
    jumlah:      input.jumlah,
    metode:      input.metode,
    keterangan:  input.keterangan ?? null,
    tenant_id:   TENANT_ID,
    created_by:  profile.id,
  });

  if (error) return { success: false, error: error.message };

  revalidatePath(REVALIDATE);
  return { success: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// DELETE PEMBAYARAN
// ─────────────────────────────────────────────────────────────────────────────

export async function deletePembayaran(
  id: string
): Promise<{ success: boolean; error?: string }> {
  const profile = await getCurrentUserProfile();
  if (!profile) return { success: false, error: 'Unauthorized.' };
  if (profile.role !== 'owner')
    return { success: false, error: 'Hanya owner yang dapat menghapus pembayaran.' };

  const supabase = await createClient();
  const { error } = await supabase
    .from('invoice_pembayaran')
    .delete()
    .eq('id', id)
    .eq('tenant_id', TENANT_ID);

  if (error) return { success: false, error: error.message };

  revalidatePath(REVALIDATE);
  return { success: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// DELETE INVOICE (owner only, hanya jika belum ada pembayaran)
// ─────────────────────────────────────────────────────────────────────────────

export async function deleteInvoice(
  id: string
): Promise<{ success: boolean; error?: string }> {
  const profile = await getCurrentUserProfile();
  if (!profile) return { success: false, error: 'Unauthorized.' };
  if (profile.role !== 'owner')
    return { success: false, error: 'Hanya owner yang dapat menghapus invoice.' };

  const supabase = await createClient();

  // Cek apakah sudah ada pembayaran
  const { count } = await supabase
    .from('invoice_pembayaran')
    .select('id', { count: 'exact', head: true })
    .eq('invoice_id', id);

  if ((count ?? 0) > 0)
    return { success: false, error: 'Invoice sudah memiliki riwayat pembayaran, tidak dapat dihapus.' };

  const { error } = await supabase
    .from('invoice')
    .delete()
    .eq('id', id)
    .eq('tenant_id', TENANT_ID);

  if (error) return { success: false, error: error.message };

  revalidatePath(REVALIDATE);
  return { success: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

export async function getKlienListForInvoice(): Promise<{ id: string; nama: string }[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('klien')
    .select('id, nama')
    .eq('tenant_id', TENANT_ID)
    .order('nama');
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function getSuratJalanForInvoice(): Promise<{ id: string; nomor_sj: string; klien_id: string; klien_nama: string; tanggal: string }[]> {
  const supabase = await createClient();

  // SJ yang belum punya invoice
  const { data: sjs, error } = await supabase
    .from('surat_jalan')
    .select('id, nomor_sj, tanggal, klien_id')
    .eq('tenant_id', TENANT_ID)
    .order('tanggal', { ascending: false });

  if (error) throw new Error(error.message);
  if (!sjs || sjs.length === 0) return [];

  // Filter SJ yang sudah punya invoice
  const { data: usedSJs } = await supabase
    .from('invoice')
    .select('surat_jalan_id')
    .eq('tenant_id', TENANT_ID)
    .not('surat_jalan_id', 'is', null);

  const usedIds = new Set((usedSJs ?? []).map((u: any) => u.surat_jalan_id));
  const availableSJs = sjs.filter((sj: any) => !usedIds.has(sj.id));

  if (availableSJs.length === 0) return [];

  // Fetch klien names
  const klienIds = [...new Set(availableSJs.map((sj: any) => sj.klien_id))];
  const { data: klienData } = await supabase
    .from('klien')
    .select('id, nama')
    .in('id', klienIds);
  const klienMap: Record<string, string> = {};
  (klienData ?? []).forEach((k: any) => { klienMap[k.id] = k.nama; });

  return availableSJs.map((sj: any) => ({
    id:         sj.id,
    nomor_sj:   sj.nomor_sj,
    klien_id:   sj.klien_id,
    klien_nama: klienMap[sj.klien_id] ?? '-',
    tanggal:    sj.tanggal,
  }));
}
