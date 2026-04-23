'use server';

import { createClient } from '@/lib/supabase/server';
import { getCurrentUserProfile, permissions } from '@/lib/auth/permissions';

const TENANT_ID = 'STX-001';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type ImportRow = {
  sku_klien: string;
  nama: string;
  kategori: string;
  model: string;
  size: string;
  warna: string;
  harga_jual: number;
};

export type ValidateResult = {
  valid: (ImportRow & { model_id: string; size_id: string; warna_id: string })[];
  errors: { row: number; pesan: string }[];
};

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Generate SKU internal: LYX-{3 huruf model}-{3 huruf warna}-{size} */
function generateSkuInternal(modelNama: string, warnaNama: string, sizeNama: string): string {
  const model = modelNama.replace(/\s+/g, '').substring(0, 3).toUpperCase();
  const warna = warnaNama.replace(/\s+/g, '').substring(0, 3).toUpperCase();
  const size = sizeNama.toUpperCase();
  return `LYX-${model}-${warna}-${size}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Actions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * FUNGSI 1: getProdukForExport()
 * Mengambil data produk lengkap dan mengembalikan string CSV.
 */
export async function getProdukForExport(): Promise<string> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('produk')
    .select(`
      sku_internal,
      sku_klien,
      nama,
      harga_jual,
      aktif,
      model_produk(nama, kategori_produk(nama)),
      size(nama),
      warna(nama),
      hpp_item(qty, harga_satuan)
    `)
    .eq('tenant_id', TENANT_ID)
    .order('created_at', { ascending: false });

  if (error) throw new Error(error.message);

  const header = 'SKU_Internal;SKU_Klien;Nama_Produk;Kategori;Model;Size;Warna;Harga_Jual;Total_HPP;Margin;Status';
  
  const csvRows = (data ?? []).map((p) => {
    const model = (p.model_produk as any)?.nama ?? '';
    const kategori = (p.model_produk as any)?.kategori_produk?.nama ?? '';
    const size = (p.size as any)?.nama ?? '';
    const warna = (p.warna as any)?.nama ?? '';
    
    const hppItems = (p.hpp_item as { qty: number; harga_satuan: number }[]) ?? [];
    const total_hpp = hppItems.reduce((sum, item) => sum + item.qty * item.harga_satuan, 0);
    const margin = p.harga_jual - total_hpp;
    const status = p.aktif ? 'Aktif' : 'NonAktif';

    return [
      p.sku_internal,
      p.sku_klien ?? '',
      p.nama,
      kategori,
      model,
      size,
      warna,
      p.harga_jual,
      total_hpp,
      margin,
      status
    ].join(';');
  });

  return [header, ...csvRows].join('\n');
}

/**
 * FUNGSI 2: validateImportCSV(rows: ImportRow[]): Promise<ValidateResult>
 * Memvalidasi keberadaan master data (Model, Size, Warna) secara massal.
 */
export async function validateImportCSV(rows: ImportRow[]): Promise<ValidateResult> {
  const supabase = await createClient();

  // Fetch all reference data for validation
  const [modelRes, sizeRes, warnaRes] = await Promise.all([
    supabase.from('model_produk').select('id, nama, kategori_produk(nama)').eq('tenant_id', TENANT_ID),
    supabase.from('size').select('id, nama').eq('tenant_id', TENANT_ID),
    supabase.from('warna').select('id, nama').eq('tenant_id', TENANT_ID),
  ]);

  const models = modelRes.data ?? [];
  const sizes = sizeRes.data ?? [];
  const warnas = warnaRes.data ?? [];

  const valid: ValidateResult['valid'] = [];
  const errors: ValidateResult['errors'] = [];

  rows.forEach((row, index) => {
    const rowNum = index + 1;

    // 1. Cari Model + Kategori
    const foundModel = models.find(m => 
      m.nama.toLowerCase() === row.model.toLowerCase() && 
      (m.kategori_produk as any)?.nama.toLowerCase() === row.kategori.toLowerCase()
    );

    // 2. Cari Size
    const foundSize = sizes.find(s => s.nama.toLowerCase() === row.size.toLowerCase());

    // 3. Cari Warna
    const foundWarna = warnas.find(w => w.nama.toLowerCase() === row.warna.toLowerCase());

    const rowErrors: string[] = [];
    if (!foundModel) rowErrors.push(`Model '${row.model}' tidak ditemukan di kategori '${row.kategori}'`);
    if (!foundSize) rowErrors.push(`Size '${row.size}' tidak ditemukan`);
    if (!foundWarna) rowErrors.push(`Warna '${row.warna}' tidak ditemukan`);

    if (rowErrors.length > 0) {
      errors.push({ row: rowNum, pesan: rowErrors.join(', ') });
    } else if (foundModel && foundSize && foundWarna) {
      valid.push({
        ...row,
        model_id: foundModel.id,
        size_id: foundSize.id,
        warna_id: foundWarna.id
      });
    }
  });

  return { valid, errors };
}

/**
 * FUNGSI 3: executeImportCSV(validRows)
 * Melakukan bulk upsert produk berdasarkan SKU Internal.
 */
export async function executeImportCSV(
  validRows: (ImportRow & { model_id: string; size_id: string; warna_id: string })[]
): Promise<{ inserted: number; updated: number; errors: number }> {
  const profile = await getCurrentUserProfile();
  if (!profile || !permissions.canEditMasterData(profile.role)) {
    throw new Error('Unauthorized: Hanya owner yang dapat mengelola produk.');
  }

  const supabase = await createClient();
  let inserted = 0;
  let updated = 0;
  let errors = 0;

  // Proses per baris untuk capture error secara granular dan hitung stats
  for (const row of validRows) {
    try {
      const sku_internal = generateSkuInternal(row.model, row.warna, row.size);

      // Cek apakah SKU sudah ada
      const { data: existing } = await supabase
        .from('produk')
        .select('id')
        .eq('sku_internal', sku_internal)
        .eq('tenant_id', TENANT_ID)
        .single();

      if (existing) {
        // Update data yang diperbolehkan
        const { error: updateErr } = await supabase
          .from('produk')
          .update({
            nama: row.nama,
            sku_klien: row.sku_klien || null,
            harga_jual: row.harga_jual
          })
          .eq('id', existing.id);

        if (updateErr) throw updateErr;
        updated++;
      } else {
        // Insert baru
        const { error: insertErr } = await supabase
          .from('produk')
          .insert({
            tenant_id: TENANT_ID,
            sku_internal,
            sku_klien: row.sku_klien || null,
            nama: row.nama,
            model_id: row.model_id,
            size_id: row.size_id,
            warna_id: row.warna_id,
            harga_jual: row.harga_jual,
            aktif: true
          });

        if (insertErr) throw insertErr;
        inserted++;
      }
    } catch (err) {
      console.error('Import Row Error:', err);
      errors++;
    }
  }

  return { inserted, updated, errors };
}
