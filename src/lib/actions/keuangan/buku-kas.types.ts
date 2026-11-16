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
  /** Sub-kelompok Biaya Overhead (Gaji Staff, Uang Makan, ...) */
  overhead_sub_id: string | null;
  overhead_sub_nama: string | null;
  pembantu_jenis_id: string | null;
  qty: number | null;
  satuan: string | null;
  /** Diisi bila baris dibuat otomatis (Stok Masuk / gaji) → tidak bisa diedit dari Buku Kas */
  dikunci: string | null;
  /** Baris dari Stok Masuk: nominal dikunci, tapi tanggal boleh diubah (LOT & jurnal ikut) */
  bisa_ubah_tanggal: boolean;
  /** Baris otomatis pembayaran gaji: id karyawan (dari sumber_gaji) — dipakai untuk menyatukan tampilan */
  karyawan_id_gaji: string | null;
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
  /** Wajib bila kategori = 'Biaya Overhead' */
  overhead_sub_id?: string | null;
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
export const KATEGORI_OVERHEAD = 'Biaya Overhead';

/** Sub-kelompok Biaya Overhead (tabel overhead_sub) */
export interface OverheadSubOption {
  id: string;
  nama: string;
  /** true = berasal dari komponen overhead HPP (bisa dibandingkan dengan patokan HPP) */
  dari_hpp: boolean;
}

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
  // 'Biaya Operasional' & 'Biaya Peralatan' dihapus 16 Nov 2026: mudah tertukar dengan komponen HPP
  // "Operasional". Semua biaya rutin dicatat sebagai Biaya Overhead + sub-kelompok (Bensin, Gas,
  // Peralatan Konveksi, Service Mesin, ...). Entri lama tetap tampil kategorinya saat diedit.
  'Lainnya',
] as const;
