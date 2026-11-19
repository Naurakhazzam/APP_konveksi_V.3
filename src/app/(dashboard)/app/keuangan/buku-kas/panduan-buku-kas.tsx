import React from 'react';
import type { KontenPanduan } from '@/components/keuangan/panduan/Panduan';

const rp = (n: number) => 'Rp ' + Math.round(Math.abs(n)).toLocaleString('id-ID');
const tanda = (n: number) => (Math.round(n) < 0 ? '−' : '') + rp(n);
const B = ({ children }: { children: React.ReactNode }) => <b className="text-[#e8eaed]">{children}</b>;

export interface RingkasBukuKas {
  /** mis. "November 2026" atau "semua bulan 2026" */
  periode: string;
  totalMasuk: number;
  totalKeluar: number;
  saldo: number;
  totalModal: number;
  jumlahTransaksi: number;
  /** [nama sub-kelompok, total] urut terbesar */
  rekapOverhead: [string, number][];
}

export function buatPanduanBukuKas(r: RingkasBukuKas): KontenPanduan {
  const ohTotal = r.rekapOverhead.reduce((s, [, v]) => s + v, 0);
  const ohTerbesar = r.rekapOverhead[0];

  return {
    judul: 'Buku Kas',
    untukApa: (
      <>
        <p>
          Buku Kas adalah <B>catatan semua uang yang benar-benar masuk dan keluar</B> — seperti buku catatan dompet usaha.
          Setiap rupiah yang diterima atau dibayar ditulis di sini dengan tanggal sebenarnya.
        </p>
        <p>
          Hampir semua laporan keuangan lain mengambil angka dari sini, jadi <B>kategori yang dipilih menentukan ke mana
          angkanya mengalir</B> (lihat istilah &quot;Kategori&quot;). Belanja dari Stok Masuk dan pembayaran gaji tercatat otomatis.
        </p>
      </>
    ),
    langkah: [
      {
        judul: 'Pilih bulan & tipe',
        target: 'filter-kas',
        isi: <p>Pilih bulan/tahun lalu klik <B>Terapkan Filter</B>. Sekarang tampil: <B>{r.periode}</B>, {r.jumlahTransaksi.toLocaleString('id-ID')} transaksi.</p>,
      },
      {
        judul: 'Baca tiga kartu di atas',
        target: 'ringkasan-kas',
        isi: (
          <>
            <p>Masuk <B>{rp(r.totalMasuk)}</B> − Keluar <B>{rp(r.totalKeluar)}</B> = Saldo <B>{tanda(r.saldo)}</B>.</p>
            <p className="text-xs text-[#9aa0a6]">
              Saldo ini hanya untuk {r.periode}, bukan isi rekening saat ini.
              {r.saldo < 0 && ' Minus berarti bulan ini uang keluar lebih banyak dari yang masuk — wajar bila sedang banyak belanja bahan sebelum barang dikirim & dibayar klien.'}
            </p>
            {r.totalModal > 0 && <p className="text-xs text-[#9aa0a6]">Setoran modal barang {rp(r.totalModal)} tidak ikut dihitung karena bukan uang.</p>}
          </>
        ),
      },
      {
        judul: 'Lihat ke mana uang overhead pergi',
        target: r.rekapOverhead.length ? 'rekap-overhead' : undefined,
        isi: r.rekapOverhead.length ? (
          <p>
            Biaya Overhead {r.periode}: <B>{rp(ohTotal)}</B>, terbesar <B>{ohTerbesar[0]}</B> ({rp(ohTerbesar[1])}).
            Untuk dibandingkan dengan patokan HPP, buka menu <B>Biaya Overhead</B>.
          </p>
        ) : <p>Belum ada Biaya Overhead pada {r.periode}, jadi kotak rekapnya tidak muncul.</p>,
      },
      {
        judul: 'Baca tabel transaksi',
        target: 'tabel-kas',
        isi: (
          <ul className="list-disc space-y-0.5 pl-4">
            <li><span className="text-green-400">Masuk</span> / <span className="text-red-400">Keluar</span> menunjukkan arah uang.</li>
            <li>Qty × Harga Satuan = Total (bila diisi).</li>
            <li>Baris <B>Pembayaran Gaji</B> disatukan per tanggal — klik untuk rincian per orang. Perbaikannya lewat menu Gaji.</li>
            <li>Baris dari <B>Stok Masuk</B> hanya bisa diubah tanggalnya; nominalnya mengikuti stok.</li>
          </ul>
        ),
      },
      {
        judul: 'Mencatat transaksi baru',
        target: 'tombol-kas',
        isi: (
          <>
            <p>Klik <B>Kas Masuk</B> atau <B>Kas Keluar</B>. Yang paling penting:</p>
            <ul className="list-disc space-y-0.5 pl-4">
              <li><B>Tanggal sebenarnya</B> — terutama belanja bahan pembantu, karena urutan tanggal memengaruhi penghematan.</li>
              <li><B>Kategori yang tepat</B> — Bahan Pembantu wajib pilih jenis bahan, Biaya Overhead wajib pilih sub-kelompok.</li>
              <li><B>Tag ke PO</B> untuk DP/pelunasan klien, dan untuk biaya yang khusus satu PO.</li>
            </ul>
          </>
        ),
      },
    ],
    istilah: [
      'kas_masuk', 'kas_keluar', 'saldo_kas_periode', 'kategori_kas', 'tag_po',
      'modal_barang', 'setoran_modal', 'gaji_otomatis', 'rekap_overhead_sub', 'arus_kas',
    ],
    tanyaJawab: [
      {
        t: 'Kenapa Saldo Kas minus padahal usaha untung?',
        j: <p>Saldo Kas = uang masuk − keluar bulan ini saja. Belanja bahan langsung mengurangi kas, sedangkan uang dari klien baru masuk setelah barang dikirim/ditagih. Untung-rugi dilihat di <B>Kinerja Keuangan</B>, bukan di sini.</p>,
      },
      {
        t: 'DP dari klien apakah sudah pendapatan?',
        j: <p>Belum. DP menambah kas, tapi baru jadi pendapatan saat barangnya dikirim (Surat Jalan). Sampai itu, DP tercatat sebagai <B>uang muka pelanggan</B> (kewajiban).</p>,
      },
      {
        t: 'Beli bahan pembantu langsung jadi biaya?',
        j: <p>Tidak. Belanja masuk ke saldo di menu <B>Saldo Bahan Pembantu</B>; yang menjadi biaya adalah jatah HPP saat barang selesai dijahit.</p>,
      },
      {
        t: 'Bayar kontrak rumah setahun, apakah bulan ini jadi sangat boros?',
        j: <p>Tidak, bila kontraknya dicatat di <B>Biaya Tetap (kontrak)</B> menu Biaya Overhead. Nilainya dibagi rata per hari selama masa kontrak.</p>,
      },
      {
        t: 'Salah input gaji, diperbaiki di mana?',
        j: <p>Di menu <B>Gaji</B>. Baris gaji di Buku Kas dibuat otomatis dan akan ikut berubah.</p>,
      },
    ],
  };
}
