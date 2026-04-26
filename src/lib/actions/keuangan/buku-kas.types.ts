// Types & constants for Buku Kas — NOT a server file, safe to import anywhere

export interface BukuKasEntry {
  id: string;
  tanggal: string;
  tipe: 'masuk' | 'keluar';
  kategori: string;
  nominal: number;
  keterangan: string;
  no_referensi: string | null;
  po_id: string | null;
  po_no: string | null;
  created_at: string;
}

export interface AddBukuKasInput {
  tanggal: string;
  tipe: 'masuk' | 'keluar';
  kategori: string;
  nominal: number;
  keterangan: string;
  no_referensi?: string;
  po_id?: string;
}

export const KATEGORI_MASUK = [
  'DP Klien',
  'Pelunasan Klien',
  'Pendapatan Lain',
] as const;

export const KATEGORI_KELUAR = [
  'Pembelian Bahan',
  'Pembayaran Gaji',
  'Biaya Overhead',
  'Biaya Operasional',
  'Lainnya',
] as const;
