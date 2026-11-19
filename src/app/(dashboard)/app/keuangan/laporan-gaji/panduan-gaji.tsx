import React from 'react';
import type { KontenPanduan } from '@/components/keuangan/panduan/Panduan';
import type { LaporanGajiData } from '@/lib/actions/keuangan/laporan-gaji.actions';

const rp = (n: number) => (n < 0 ? '−' : '') + 'Rp ' + Math.round(Math.abs(n)).toLocaleString('id-ID');
const B = ({ children }: { children: React.ReactNode }) => <b className="text-[#e8eaed]">{children}</b>;

export function buatPanduanGaji(data: LaporanGajiData): KontenPanduan {
  const total = data.total_upah_sudah_bayar + data.total_upah_belum_bayar;
  const contoh = [...data.per_karyawan]
    .sort((a, b) => (b.upah_sudah_bayar + b.upah_belum_bayar) - (a.upah_sudah_bayar + a.upah_belum_bayar))[0];
  const totalHistory = data.history_pembayaran.reduce((s, h) => s + h.jumlah_dibayar, 0);

  return {
    judul: 'Laporan Gaji',
    untukApa: (
      <>
        <p>
          Laporan Gaji merangkum <B>upah borongan</B> karyawan dari sisi keuangan: berapa yang sudah dibayar, berapa yang
          masih menjadi utang ke karyawan, dan berapa kasbon yang belum kembali.
        </p>
        <p>
          Menu ini hanya untuk <B>membaca</B>. Pembayaran gaji dan kasbon dikelola di menu Penggajian (tombol
          <B> Kelola Pembayaran</B>).
        </p>
      </>
    ),
    langkah: [
      {
        judul: 'Pilih bulan',
        target: 'filter-gaji',
        isi: <p>Pilih bulan & tahun lalu tekan <B>Terapkan</B>. Upah dikelompokkan menurut <B>tanggal pekerjaannya</B>, bukan tanggal dibayar.</p>,
      },
      {
        judul: 'Baca tiga kartu',
        target: 'kartu-gaji',
        isi: (
          <ul className="list-disc space-y-0.5 pl-4">
            <li>Sudah dibayar <B>{rp(data.total_upah_sudah_bayar)}</B> + belum dibayar <B>{rp(data.total_upah_belum_bayar)}</B> = seluruh upah bulan ini <B>{rp(total)}</B>.</li>
            <li>Belum dibayar = utang ke karyawan (di Kinerja Keuangan: Upah terutang).</li>
            <li>Kasbon <B>{rp(data.total_kasbon_outstanding)}</B> = pinjaman yang belum kembali, per hari ini.</li>
          </ul>
        ),
      },
      {
        judul: 'Baca tabel per karyawan',
        target: 'tabel-gaji',
        isi: contoh ? (
          <p>
            Contoh <B>{contoh.karyawan_nama}</B>: sudah dibayar {rp(contoh.upah_sudah_bayar)}, belum dibayar {rp(contoh.upah_belum_bayar)}
            {contoh.kasbon_sisa > 0 && <>, kasbon {rp(contoh.kasbon_sisa)}</>}.
          </p>
        ) : <p>Setiap baris = satu karyawan dengan upah sudah/belum dibayar dan sisa kasbonnya.</p>,
      },
      {
        judul: 'Lihat History Pembayaran',
        target: data.history_pembayaran.length ? 'history-gaji' : undefined,
        isi: data.history_pembayaran.length ? (
          <p>
            Ada <B>{data.history_pembayaran.length} kali</B> pembayaran di bulan ini, total <B>{rp(totalHistory)}</B> yang diterima
            karyawan. Klik judulnya untuk membuka daftar.
          </p>
        ) : <p>Belum ada pembayaran gaji di bulan ini, jadi bagian History tidak muncul.</p>,
      },
    ],
    istilah: ['upah_sudah_bayar', 'upah_belum_bayar', 'kasbon', 'history_gaji', 'potongan_upah', 'upah_terutang'],
    tanyaJawab: [
      {
        t: 'Kenapa total History Pembayaran tidak sama dengan kartu "Sudah Dibayar"?',
        j: (
          <ul className="list-disc space-y-0.5 pl-4">
            <li>Kartu dihitung menurut <B>tanggal pekerjaan</B>, History menurut <B>tanggal bayar</B>. Upah kerja minggu terakhir bulan lalu bisa dibayar bulan ini.</li>
            <li>History adalah uang yang diterima karyawan: ditambah gaji pokok (bila ada) dan dikurangi potongan kasbon.</li>
          </ul>
        ),
      },
      {
        t: 'Apakah kasbon termasuk biaya?',
        j: <p>Tidak. Kasbon adalah pinjaman; uangnya kembali lewat potongan gaji. Yang menjadi biaya produksi hanya upah borongan.</p>,
      },
      {
        t: 'Kenapa angka upah ada yang berkurang sendiri?',
        j: <p>Ada potongan upah karena reject (lihat Laporan Potongan Reject). Potongan mengurangi upah pada bulan kejadiannya.</p>,
      },
      {
        t: 'Upah PO lama tidak muncul, kenapa?',
        j: <p>Hanya upah dari PO periode baru yang ditampilkan. Kasbon tetap ditampilkan semua karena itu uang yang masih harus kembali.</p>,
      },
    ],
  };
}
