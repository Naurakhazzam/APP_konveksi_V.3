import { z } from 'zod';
import { TAHAP_ORDER } from '@/modules/produksi/constants/tahap';

// Schema untuk satu bahan yang dipakai saat scan
export const PemakaianItemInputSchema = z.object({
  inventory_item_id: z.string().uuid(),
  rate_per_pcs: z.number().positive(),
});

// Schema untuk scan cutting — terima bundle dari gudang potong
export const ScanCuttingTerimaInputSchema = z.object({
  barcode: z.string().min(1),
  karyawan_id: z.string().uuid(),
  qty: z.number().int().min(1),
  pemakaian: z.array(PemakaianItemInputSchema),
  tenant_id: z.string().min(1),
});

// Schema untuk scan selesai — per tahap produksi
export const ScanSelesaiInputSchema = z.object({
  barcode: z.string().min(1),
  tahap: z.enum(TAHAP_ORDER),
  karyawan_id: z.string().uuid().nullable().optional(),
  qty: z.number().int().min(1),
  catatan: z.string().optional(),
  alasan_qty_id: z.string().uuid().nullable().optional(),
  tenant_id: z.string().min(1),
});

// Schema untuk scan terima — generik untuk tahap non-cutting
export const ScanTerimaGenericInputSchema = z.object({
  barcode:      z.string().min(1),
  tahap:        z.enum(TAHAP_ORDER),
  karyawan_id:  z.string().uuid().nullable().optional(),
  qty:          z.number().int().positive(),
  tenant_id:    z.string(),
});

// TypeScript types (inferred)
export type PemakaianItemInput = z.infer<typeof PemakaianItemInputSchema>;
export type ScanCuttingTerimaInput = z.infer<typeof ScanCuttingTerimaInputSchema>;
export type ScanSelesaiInput = z.infer<typeof ScanSelesaiInputSchema>;
export type ScanTerimaGenericInput = z.infer<typeof ScanTerimaGenericInputSchema>;
