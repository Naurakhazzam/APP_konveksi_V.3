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
  komponen_id: string | null;
  pembantu_jenis_id: string | null;
  qty: number | null;
  satuan: string | null;
  /** Diisi bila baris dibuat otomatis (Stok Masuk / gaji) → tidak bisa diedit dari Buku Kas */
  dikunci: string | null;
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
  komponen_id?: string | null;
  /** Wajib bila kategori = 'Bahan Pembantu' */
  pembantu_jenis_id?: string | null;
  qty?: number | null;
  satuan?: string | null;
}

export interface HppKomponenOption {
  id: string;
  nama: string;
}

/** Jenis saldo bahan pembantu (tabel pembantu_jenis) */
export interface PembantuJenisOption {
  id: string;
  nama: string;
  /** Satuan yang terakhir dipakai saat belanja jenis ini, atau satuan default */
  satuan_default: string | null;
}

export const KATEGORI_BAHAN_PEMBANTU = 'Bahan Pembantu';

export const SATUAN_BELI = ['pcs', 'lusin', 'gross', 'pack', 'roll', 'kg', 'meter', 'yard'] as const;

export const KATEGORI_MASUK = [
  'DP Klien',
  'Pelunasan Klien',
  'Pendapatan Lain',
] as const;

export const KATEGORI_KELUAR = [
  'Pembelian Bahan',
  'Bahan Pembantu',
  'Pembayaran Gaji',
  'Biaya Overhead',
  'Biaya Operasional',
  'Biaya Peralatan',
  'Lainnya',
] as const;
