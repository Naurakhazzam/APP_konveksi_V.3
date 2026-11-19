import React from 'react';
import type { KontenPanduan } from '@/components/keuangan/panduan/Panduan';
import type { InvoiceRow } from '@/lib/actions/keuangan/invoice.types';

const rp = (n: number) => 'Rp ' + Math.round(Math.abs(n)).toLocaleString('id-ID');
const B = ({ children }: { children: React.ReactNode }) => <b className="text-[#e8eaed]">{children}</b>;

export function buatPanduanInvoice(tampil: InvoiceRow[]): KontenPanduan {
  const belum = tampil.filter(i => i.status !== 'lunas');
  const piutang = belum.reduce((s, i) => s + i.sisa, 0);
  const adaBayar = tampil.some(i => i.total_bayar > 0);
  // Contoh: invoice dengan potongan reject bila ada, kalau tidak invoice dengan tagihan terbesar
  const contoh = tampil.find(i => i.potongan_reject > 0)
    ?? [...tampil].sort((a, b) => b.total_netto - a.total_netto)[0];

  return {
    judul: 'Invoice & Tagihan',
    untukApa: (
      <>
        <p>
          Menu ini mencatat <B>tagihan ke klien</B>. Setiap Surat Jalan yang diterbitkan otomatis membuat satu invoice
          senilai barang yang dikirim. Di sini Anda melihat tagihan mana yang sudah dibayar, sebagian, atau belum sama sekali.
        </p>
        <p>
          Tombol <B>Catat Pembayaran</B> hanya untuk melacak status tagihan. Uang yang benar-benar masuk tetap perlu dicatat
          di <B>Buku Kas</B> (kategori DP Klien / Pelunasan Klien) — angka itulah yang dipakai Kinerja Keuangan untuk menghitung piutang.
        </p>
      </>
    ),
    langkah: [
      {
        judul: 'Baca tiga kartu di atas',
        target: 'kartu-invoice',
        isi: (
          <ul className="list-disc space-y-0.5 pl-4">
            <li>Total Piutang Aktif <B>{rp(piutang)}</B> dari {belum.length} invoice yang belum lunas.</li>
            <li>Total Lunas = tagihan yang sudah tertutup pembayaran.</li>
            <li>Total Invoice = banyaknya invoice di daftar ({tampil.length}).</li>
          </ul>
        ),
      },
      {
        judul: 'Saring daftar',
        target: 'filter-invoice',
        isi: <p>Pilih status, klien, bulan dan tahun, lalu tekan <B>Terapkan</B>. Kartu di atas ikut menghitung ulang sesuai saringan.</p>,
      },
      {
        judul: 'Baca satu baris invoice',
        target: 'tabel-invoice',
        isi: contoh ? (
          <>
            <p>
              Contoh <B>{contoh.nomor_invoice}</B> ({contoh.klien_nama}{contoh.nomor_sj ? `, ${contoh.nomor_sj}` : ''}):
              nilai barang {rp(contoh.total_nilai)}
              {contoh.potongan_reject > 0 && <> − potongan reject {rp(contoh.potongan_reject)}</>}
              {' '}= tagihan <B>{rp(contoh.total_netto)}</B>.
            </p>
            <p>Terbayar {rp(contoh.total_bayar)} → sisa <B>{rp(contoh.sisa)}</B>.</p>
          </>
        ) : <p>Setiap baris = satu invoice: nomor, klien, Surat Jalan asal, tagihan, terbayar, sisa, dan status.</p>,
      },
      {
        judul: 'Buka rincian & catat pembayaran',
        target: 'tabel-invoice',
        isi: (
          <>
            <p>Klik baris untuk melihat jatuh tempo, catatan, dan riwayat pembayaran. Tombol kartu hijau (atau <B>Catat Pembayaran</B> di rincian) untuk mencatat uang dari klien.</p>
            {!adaBayar && <p className="text-xs text-[#9aa0a6]">Saat ini belum ada pembayaran yang dicatat di menu ini.</p>}
          </>
        ),
      },
    ],
    istilah: [
      'invoice_otomatis', 'total_tagihan', 'potongan_reject', 'terbayar_invoice', 'sisa_invoice',
      'status_invoice', 'piutang_invoice', 'lunas_invoice', 'jumlah_invoice', 'piutang',
    ],
    tanyaJawab: [
      {
        t: 'Saya sudah catat pembayaran di sini, kenapa Kinerja Keuangan masih menunjukkan piutang?',
        j: <p>Kinerja Keuangan menghitung piutang dari <B>uang klien di Buku Kas</B>, bukan dari menu ini. Catat juga uangnya di Buku Kas dengan kategori DP Klien atau Pelunasan Klien.</p>,
      },
      {
        t: 'Kenapa tagihan berkurang sendiri?',
        j: <p>Ada barang yang dikembalikan kantor (reject) dan belum dikirim ulang. Nilainya memotong tagihan. Begitu barang diperbaiki dan dikirim ulang lewat Surat Jalan Kirim Ulang, potongan itu hilang lagi.</p>,
      },
      {
        t: 'Kalau isi Surat Jalan diubah, apakah invoice ikut berubah?',
        j: <p>Ya. Menambah, mengurangi, atau mengoreksi qty di Surat Jalan langsung menghitung ulang tagihan invoice-nya.</p>,
      },
      {
        t: 'Kenapa invoice tidak bisa dihapus?',
        j: <p>Invoice yang sudah punya riwayat pembayaran tidak bisa dihapus. Hapus dulu pembayarannya di rincian invoice.</p>,
      },
      {
        t: 'Apa bedanya Total Piutang Aktif di sini dengan Piutang usaha di Kinerja Keuangan?',
        j: <p>Di sini = sisa invoice yang tampil sesuai saringan (mis. hanya bulan ini). Di Kinerja = seluruh nilai Surat Jalan dikurangi seluruh uang klien di Buku Kas, tidak tergantung bulan.</p>,
      },
    ],
  };
}
