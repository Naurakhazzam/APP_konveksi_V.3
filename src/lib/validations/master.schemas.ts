import { z } from 'zod';

export const JabatanSchema = z.object({
  nama: z.string().min(2, 'Nama jabatan minimal 2 karakter'),
  deskripsi: z.string().optional(),
  tahap_produksi: z.array(z.string()),
  gaji_default: z.number().min(0, 'Gaji default tidak boleh negatif'),
  aktif: z.boolean(),
});

export type JabatanInput = z.infer<typeof JabatanSchema>;

export const TAHAP_PRODUKSI_OPTIONS = [
  { value: 'cutting',        label: 'Cutting' },
  { value: 'jahit',          label: 'Jahit' },
  { value: 'lubang_kancing', label: 'Lubang Kancing' },
  { value: 'buang_benang',   label: 'Buang Benang' },
  { value: 'qc',             label: 'QC' },
  { value: 'steam',          label: 'Steam' },
  { value: 'packing',        label: 'Packing' },
] as const;

export const KaryawanSchema = z.object({
  nama: z.string().min(2, 'Nama minimal 2 karakter'),
  jabatan: z.string().min(1, 'Jabatan tidak boleh kosong'),
  gaji_pokok: z.number().min(0, 'Gaji pokok tidak boleh negatif'),
  tahap_produksi: z.array(z.string()).default([]),
  aktif: z.boolean(),
});

export type KaryawanInput = z.infer<typeof KaryawanSchema>;

export const KlienSchema = z.object({
  nama: z.string().min(2, 'Nama klien minimal 2 karakter'),
  alamat: z.string().optional(),
  kontak: z.string().optional(),
});

export type KlienInput = z.infer<typeof KlienSchema>;

export const KategoriTrxSchema = z.object({
  nama: z.string().min(2, 'Nama kategori minimal 2 karakter'),
  jenis: z.enum(['direct_bahan', 'direct_upah', 'overhead', 'masuk'] as const, {
    message: 'Jenis kategori wajib diisi dan harus valid',
  }),
  aktif: z.boolean(),
});

export type KategoriTrxInput = z.infer<typeof KategoriTrxSchema>;

export const KategoriProdukSchema = z.object({
  nama: z.string().min(1, 'Nama kategori tidak boleh kosong'),
});
export type KategoriProdukInput = z.infer<typeof KategoriProdukSchema>;

export const ModelProdukSchema = z.object({
  nama: z.string().min(1, 'Nama model tidak boleh kosong'),
  kategori_id: z.string().min(1, 'Kategori harus dipilih'),
});
export type ModelProdukInput = z.infer<typeof ModelProdukSchema>;

export const SizeSchema = z.object({
  nama: z.string().min(1, 'Nama size tidak boleh kosong'),
  urutan: z.number().int().min(0, 'Urutan tidak boleh negatif'),
});
export type SizeInput = z.infer<typeof SizeSchema>;

export const WarnaSchema = z.object({
  nama: z.string().min(1, 'Nama warna tidak boleh kosong'),
  kode_hex: z.string().optional().nullable(),
});
export type WarnaInput = z.infer<typeof WarnaSchema>;

export const SatuanSchema = z.object({
  nama: z.string().min(1, 'Nama satuan tidak boleh kosong'),
});
export type SatuanInput = z.infer<typeof SatuanSchema>;

export const JenisRejectSchema = z.object({
  nama: z.string().min(1, 'Jenis reject tidak boleh kosong'),
});
export type JenisRejectInput = z.infer<typeof JenisRejectSchema>;

export const AlasanRejectSchema = z.object({
  nama: z.string().min(1, 'Alasan reject tidak boleh kosong'),
  jenis_reject_id: z.string().min(1, 'Jenis reject wajib dipilih'),
  tahap_bertanggung_jawab: z.string().min(1, 'Tahap produksi wajib dipilih'),
  bisa_diperbaiki: z.boolean(),
  dampak_potongan: z.enum(['upah_tahap', 'hpp_po']).nullable().optional(),
});
export type AlasanRejectInput = z.infer<typeof AlasanRejectSchema>;

export const ProdukSchema = z.object({
  model_id: z.string().uuid('Model wajib dipilih'),
  size_id: z.string().uuid('Size wajib dipilih'),
  warna_id: z.string().uuid('Warna wajib dipilih'),
  sku_klien: z.string().optional(),
  harga_jual: z.number().min(0, 'Harga jual tidak boleh negatif'),
});
export type ProdukInput = z.infer<typeof ProdukSchema>;

export const HppItemSchema = z.object({
  qty: z.number().positive('Qty harus lebih dari 0'),
  harga_satuan: z.number().min(0, 'Harga satuan tidak boleh negatif'),
  qty_fisik: z.number().min(0).optional(),
});
export type HppItemInput = z.infer<typeof HppItemSchema>;

export const KomponenHppSchema = z.object({
  nama: z.string().min(2, 'Nama komponen minimal 2 karakter'),
  kategori: z.enum(['bahan_baku', 'biaya_produksi', 'overhead'] as const),
  satuan_id: z.string().uuid('Satuan wajib dipilih'),
  track_inventory: z.boolean(),
  inventory_item_id: z.string().uuid().optional().nullable(),
  deskripsi: z.string().optional().nullable(),
  aktif: z.boolean(),
});
export type KomponenHppInput = z.infer<typeof KomponenHppSchema>;
