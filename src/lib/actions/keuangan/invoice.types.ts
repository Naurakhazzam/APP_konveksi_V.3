// Types & constants for Invoice — NOT a server file

export type InvoiceStatus = 'belum_bayar' | 'dp' | 'lunas';

export const METODE_BAYAR = ['transfer', 'tunai', 'cek', 'lainnya'] as const;
export type MetodeBayar = typeof METODE_BAYAR[number];

export const STATUS_LABEL: Record<InvoiceStatus, string> = {
  belum_bayar: 'Belum Bayar',
  dp:          'DP / Sebagian',
  lunas:       'Lunas',
};

export const STATUS_COLOR: Record<InvoiceStatus, string> = {
  belum_bayar: 'bg-red-500/10 text-red-400 border-red-500/20',
  dp:          'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
  lunas:       'bg-green-500/10 text-green-400 border-green-500/20',
};

export interface InvoiceRow {
  id: string;
  nomor_invoice: string;
  tanggal: string;
  tanggal_jatuh_tempo: string | null;
  surat_jalan_id: string | null;
  nomor_sj: string | null;
  klien_id: string;
  klien_nama: string;
  total_nilai: number;
  total_bayar: number;
  sisa: number;
  status: InvoiceStatus;
  catatan: string | null;
  created_at: string;
}

export interface InvoicePembayaran {
  id: string;
  invoice_id: string;
  tanggal: string;
  jumlah: number;
  metode: MetodeBayar;
  keterangan: string | null;
  created_at: string;
}

export interface InvoiceDetail extends InvoiceRow {
  pembayaran: InvoicePembayaran[];
}

export interface CreateInvoiceInput {
  tanggal: string;
  tanggal_jatuh_tempo?: string;
  surat_jalan_id?: string;
  klien_id: string;
  total_nilai: number;
  catatan?: string;
}

export interface AddPembayaranInput {
  invoice_id: string;
  tanggal: string;
  jumlah: number;
  metode: MetodeBayar;
  keterangan?: string;
}
