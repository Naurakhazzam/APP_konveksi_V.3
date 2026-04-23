import { z } from 'zod';

export const PoItemInputSchema = z.object({
  model_id: z.string().uuid(),
  warna_id: z.string().uuid(),
  size_id: z.string().uuid(),
  produk_id: z.string().uuid(),
  warna: z.string().min(1),
  size: z.string().min(1),
  qty_order: z.number().int().min(1),
  qty_per_bundle: z.number().int().min(1).default(12),
});

export const CreatePoSchema = z.object({
  no_po: z.string().regex(/^PO-\d{4}$/, 'Format PO tidak valid'),
  klien_id: z.string().uuid(),
  tanggal_order: z.string().regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}.\d{3}Z)?$/, 'Format tanggal_order tidak valid'),
  tanggal_target: z.string().regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}.\d{3}Z)?$/).optional().nullable(),
  catatan: z.string().optional().nullable(),
  items: z.array(PoItemInputSchema).min(1, 'Minimal satu baris item'),
});

export const CancelPoSchema = z.object({
  id: z.string().uuid(),
});

export type PoItemInput = z.infer<typeof PoItemInputSchema>;
export type CreatePoInput = z.infer<typeof CreatePoSchema>;
export type CancelPoInput = z.infer<typeof CancelPoSchema>;
