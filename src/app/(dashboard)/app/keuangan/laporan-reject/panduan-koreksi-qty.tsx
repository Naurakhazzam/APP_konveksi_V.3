import React from 'react';
import type { KontenPanduan } from '@/components/keuangan/panduan/Panduan';
import type { LaporanRejectSummary } from '@/lib/actions/keuangan/laporan-reject.actions';

const rp = (n: number) => 'Rp ' + Math.round(Math.abs(n)).toLocaleString('id-ID');
const B = ({ children }: { children: React.ReactNode }) => <b className="text-[#e8eaed]">{children}</b>;

/** Panduan menu Laporan Potongan Reject (folder lama: laporan-reject, dulu bernama "Laporan Koreksi QTY") */
export function buatPanduanKoreksiQty(data: LaporanRejectSummary): KontenPanduan {
  const teratas = data.per_karyawan[0];
  const ada = data.items.length > 0;

  return {
    judul: 'Laporan Potongan Reject',
    untukApa: (
      <>
        <p>
          Laporan ini mendaftar <B>potongan upah</B> karyawan karena hasil kerjanya reject, dan <B>pengembaliannya</B> bila
          barang itu berhasil diperbaiki. Gunanya untuk melihat siapa yang paling sering menghasilkan barang cacat dan
          berapa rupiah yang dipotong.
        </p>
        <p>Alurnya di menu <B>Produksi → Reject</B>:</p>
        <ol className="list-decimal space-y-0.5 pl-4">
          <li><B>Catat reject</B>: pilih bundle, alasan reject dan tahap ditemukan. Sistem mengisi karyawan tiap tahap dari riwayat scan.</li>
          <li><B>Konfirmasi</B>: centang karyawan yang bertanggung jawab. Upah tahap mereka untuk bundle itu dipotong sebesar persen alasan reject.</li>
          <li>Bila alasannya <B>tidak bisa diperbaiki</B> (mis. bahan berlubang) → potongan tetap. Bila <B>bisa diperbaiki</B> (rework) → potongan itu sifatnya <B>ditahan</B>.</li>
          <li><B>Selesai Rework</B>: potongan yang ditahan dikembalikan (baris hijau di laporan ini). Bersihnya jadi nol.</li>
        </ol>
        <p className="text-xs text-[#9aa0a6]">
          Koreksi qty di Lacak Barcode tidak muncul di sini: koreksi itu langsung mengubah nominal upahnya dan tercatat di riwayat audit.
        </p>
      </>
    ),
    langkah: [
      {
        judul: 'Pilih bulan dan karyawan',
        target: 'filter-koreksi',
        isi: <p>Pilih bulan, tahun, dan (bila perlu) satu karyawan, lalu tekan <B>Terapkan</B>.</p>,
      },
      {
        judul: 'Baca dua kartu',
        target: 'kartu-koreksi',
        isi: ada
          ? (
            <p>
              Periode ini ada <B>{data.jumlah_kejadian} kejadian</B> dengan potongan bersih <B>{rp(data.total_potongan_periode)}</B>
              {data.total_dikembalikan > 0 && <> (sudah dikurangi pengembalian rework {rp(data.total_dikembalikan)})</>}.
            </p>
          )
          : <p>Periode ini belum ada potongan upah, jadi kedua kartu bernilai nol.</p>,
      },
      {
        judul: 'Lihat per karyawan',
        target: data.per_karyawan.length ? 'tabel-koreksi-karyawan' : undefined,
        isi: teratas
          ? <p>Potongan bersih terbanyak: <B>{teratas.karyawan_nama}</B> — {teratas.jumlah_kejadian}x, total {rp(teratas.total_potongan)}.</p>
          : <p>Tabel per karyawan muncul bila sudah ada potongan.</p>,
      },
      {
        judul: 'Periksa detail kejadian',
        target: 'tabel-koreksi-detail',
        isi: (
          <p>
            Setiap baris berisi tanggal, karyawan, keterangan (tahap, persen, alasan & nomor reject) dan nilainya.
            <span className="text-red-400"> Merah (−)</span> = potongan; <span className="text-green-400">hijau (+)</span> = pengembalian setelah rework selesai.
          </p>
        ),
      },
    ],
    istilah: ['potongan_upah', 'pengembalian_rework', 'jumlah_kejadian', 'efek_potongan', 'upah_belum_bayar'],
    tanyaJawab: [
      {
        t: 'Apakah ini sama dengan Laporan Reject Kantor?',
        j: <p>Tidak. Reject Kantor = barang yang dikembalikan klien dan mengurangi <B>pendapatan</B>. Laporan ini = potongan <B>upah karyawan</B>, yang mengurangi biaya upah.</p>,
      },
      {
        t: 'Kapan potongan benar-benar memotong gaji?',
        j: <p>Potongan dicatat sebagai &ldquo;belum lunas&rdquo; dan mengurangi pembayaran gaji berikutnya karyawan tersebut — juga bila upah pekerjaan itu sudah dibayar sebelumnya. Bila rework selesai sebelum gajian, potongan dan pengembaliannya saling menghapus.</p>,
      },
      {
        t: 'Ke mana potongan ini mengalir di laporan lain?',
        j: <p>Potongan mengurangi upah PO bundle itu di Laporan Per PO, Kinerja Keuangan dan Jurnal Produksi (baris upah merah), serta upah karyawan di Rekap Gaji & Laporan Gaji. Pengembalian rework menambahkannya kembali.</p>,
      },
      {
        t: 'Kenapa laporan ini kosong?',
        j: <p>Potongan hanya muncul setelah reject di menu Produksi → Reject <B>dikonfirmasi</B> dan ada karyawan yang dicentang bertanggung jawab.</p>,
      },
    ],
  };
}
