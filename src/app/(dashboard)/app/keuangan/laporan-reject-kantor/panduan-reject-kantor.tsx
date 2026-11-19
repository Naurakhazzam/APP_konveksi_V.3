import React from 'react';
import type { KontenPanduan } from '@/components/keuangan/panduan/Panduan';

const rp = (n: number) => 'Rp ' + Math.round(Math.abs(n)).toLocaleString('id-ID');
const B = ({ children }: { children: React.ReactNode }) => <b className="text-[#e8eaed]">{children}</b>;

/** Angka ringkasan yang sudah dihitung LaporanRejectKantorClient */
export interface RingkasRejectKantor {
  catatan: number;
  pcs: number;
  nilai: number;
  pulih: number;
  pcsPulih: number;
  pcsDibeli: number;
  gantung: number;
  pcsGantung: number;
  permanen: number;
}

export function buatPanduanRejectKantor(t: RingkasRejectKantor): KontenPanduan {
  const ada = t.catatan > 0;
  return {
    judul: 'Laporan Reject Kantor',
    untukApa: (
      <>
        <p>
          Kantor (klien) kadang mengembalikan barang yang cacat. Laporan ini menghitung <B>berapa rupiah</B> yang hilang karena
          reject tersebut, berapa yang sudah kembali, dan berapa yang masih menunggu keputusan.
        </p>
        <p>Setiap barang reject berakhir di salah satu dari tiga jalan:</p>
        <ul className="list-disc space-y-0.5 pl-4">
          <li><B>Diperbaiki & dikirim ulang</B> → nilainya pulih penuh.</li>
          <li><B>Dibeli kantor</B> dengan harga lebih murah → rugi selisih harganya saja.</li>
          <li><B>Tidak bisa diperbaiki</B> → rugi penuh.</li>
        </ul>
        <p>Selama belum diputuskan, nilainya &ldquo;menggantung&rdquo;. Pencatatan reject sendiri dilakukan di menu Pengiriman → Reject Kantor.</p>
      </>
    ),
    langkah: [
      {
        judul: 'Pilih periode dan jenis barang',
        target: 'filter-reject-kantor',
        isi: <p>Periode memakai <B>tanggal reject dilaporkan</B>. Pilihan kedua memisahkan kiriman yang tercatat di sistem dari barang lama (dikirim sebelum memakai aplikasi).</p>,
      },
      {
        judul: 'Baca lima kartu dari kiri ke kanan',
        target: 'kartu-reject-kantor',
        isi: ada ? (
          <>
            <p>Nilai reject <B>{rp(t.nilai)}</B> ({t.pcs} pcs, {t.catatan} catatan), lalu dipecah:</p>
            <ul className="list-disc space-y-0.5 pl-4">
              <li>Sudah pulih <B>{rp(t.pulih)}</B> ({t.pcsPulih} pcs dikirim ulang, {t.pcsDibeli} pcs dibeli kantor)</li>
              <li>Masih menggantung <B>{rp(t.gantung)}</B> ({t.pcsGantung} pcs)</li>
              <li>Kerugian pasti <B>{rp(t.permanen)}</B></li>
            </ul>
            <p>Kerugian bersih saat ini = {rp(t.permanen)} + {rp(t.gantung)} = <B>{rp(t.permanen + t.gantung)}</B>. Angka ini sama dengan baris Retur & Reject di Kinerja Keuangan.</p>
          </>
        ) : <p>Belum ada reject pada pilihan ini, jadi semua kartu bernilai Rp 0.</p>,
      },
      {
        judul: 'Cari sumber kerugian terbesar',
        target: 'tabel-grup-reject',
        isi: <p>Tabel Per Tingkat, Per Penyelesaian, Per Produk, Per Alasan, dan Per Surat Jalan diurutkan dari <B>kerugian terbesar</B>. Baris paling atas = yang paling perlu dibenahi.</p>,
      },
      {
        judul: 'Periksa satu per satu di Rincian',
        target: 'rincian-reject-kantor',
        isi: <p>Setiap catatan menunjukkan qty, harga di Surat Jalan, bagaimana penyelesaiannya, dan kerugiannya. Merah = kerugian pasti, oranye = masih menggantung, hijau &ldquo;pulih&rdquo; = tidak ada kerugian.</p>,
      },
    ],
    istilah: [
      'nilai_reject', 'pulih_reject', 'gantung_reject', 'kerugian_pasti', 'kerugian_bersih_reject',
      'dibeli_kantor', 'tidak_bisa_diperbaiki', 'tingkat_reject', 'barang_lama_reject', 'potongan_reject', 'retur_reject',
    ],
    tanyaJawab: [
      {
        t: 'Apa hubungan reject dengan tagihan klien?',
        j: <p>Selama barang reject belum dikirim ulang, nilainya memotong invoice Surat Jalan asalnya. Begitu dikirim ulang, potongan hilang. Bila tidak bisa diperbaiki, potongan menjadi permanen. Barang lama tidak memotong invoice apa pun.</p>,
      },
      {
        t: 'Kenapa angka "masih menggantung" sudah dihitung rugi?',
        j: <p>Supaya laba tidak terlihat lebih besar dari kenyataan: barang yang dikembalikan belum menghasilkan uang. Bila nanti dikirim ulang, nilainya kembali sebagai pemulihan di tanggal barang diterima kantor.</p>,
      },
      {
        t: 'Kalau kantor membeli barang reject, berapa ruginya?',
        j: <p>Hanya selisih antara harga di Surat Jalan dan harga beli kantor, dikalikan jumlah pcs yang dibeli.</p>,
      },
      {
        t: 'Apakah reject kantor memotong upah penjahit?',
        j: <p>Tidak otomatis. Potongan upah karyawan dicatat terpisah dan tampil di Laporan Potongan Reject.</p>,
      },
    ],
  };
}
