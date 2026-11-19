import React from 'react';
import type { KontenPanduan } from '@/components/keuangan/panduan/Panduan';
import type { JurnalProduksiData, JenisJurnal } from '@/lib/actions/keuangan/jurnal.actions';

const rp = (n: number) => 'Rp ' + Math.round(Math.abs(n)).toLocaleString('id-ID');
const B = ({ children }: { children: React.ReactNode }) => <b className="text-[#e8eaed]">{children}</b>;
const tgl = (d: string) =>
  new Date(`${d}T00:00:00`).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });

export function buatPanduanJurnal(data: JurnalProduksiData): KontenPanduan {
  const t = (j: JenisJurnal) => data.baris.filter(b => b.jenis === j).reduce((s, b) => s + b.nominal, 0);
  const kain = t('kain'), aks = t('aksesori'), pemb = t('pembantu'), upah = t('upah');
  const oh = t('overhead'), tetap = t('biaya_tetap'), lain = t('lainnya'), beli = t('pembelian');
  const belanjaPemb = t('belanja_pembantu');
  const total = kain + aks + pemb + upah + oh + tetap;
  const ph = data.penghubung;
  const adaHemat = data.baris.some(b => b.jenis === 'pembantu' && b.keterangan.includes('penghematan'));
  const contohKain = data.baris.find(b => b.jenis === 'kain');
  const contohTetap = data.baris.find(b => b.jenis === 'biaya_tetap');
  const adaMinus = data.baris.some(b => b.jenis === 'upah' && b.nominal < 0);

  return {
    judul: 'Jurnal Produksi',
    untukApa: (
      <>
        <p>
          Jurnal Produksi adalah <B>buku harian biaya produksi</B>: setiap uang yang terpakai untuk membuat barang
          tercatat satu baris — kain yang dipotong, aksesori, jatah bahan pembantu, upah, overhead dan biaya kontrak.
          Cara hitungnya sama dengan Kinerja Keuangan, hanya waktunya berbeda: di sini biaya dicatat saat <B>terjadi</B>,
          di Laba Rugi saat barangnya <B>dikirim</B>.
        </p>
        <p>
          Semua baris <B>dibuat otomatis</B> dari menu asalnya. Tidak ada yang perlu diketik di sini, dan bila ada angka
          yang salah, betulkan di menu asalnya (Cutting, Buku Kas, Gaji, Biaya Overhead) — jurnal ikut berubah sendiri.
        </p>
        <p className="text-xs text-[#9aa0a6]">Rentang saat ini: {tgl(data.dari)} – {tgl(data.sampai)}.</p>
      </>
    ),
    langkah: [
      {
        judul: 'Pilih rentang tanggal',
        target: 'filter-jurnal',
        isi: <p>Isi tanggal <B>Dari</B> dan <B>Sampai</B>, lalu tekan <B>Terapkan</B>. Bawaan = bulan berjalan.</p>,
      },
      {
        judul: 'Baca kartu ringkasan',
        target: 'kartu-jurnal',
        isi: (
          <>
            <ul className="list-disc space-y-0.5 pl-4">
              <li>Kain <B>{rp(kain)}</B></li>
              <li>Aksesori & Pembantu <B>{rp(aks + pemb)}</B> (aksesori {rp(aks)} + jatah bahan pembantu {rp(pemb)})</li>
              <li>Upah <B>{rp(upah)}</B></li>
              <li>Overhead <B>{rp(oh + tetap)}</B> (overhead {rp(oh)} + biaya tetap {rp(tetap)})</li>
            </ul>
            <p>Dijumlah = <B>Total Biaya Produksi {rp(total)}</B>.</p>
            {adaHemat && <p>Sebagian jatah bahan pembantu tertulis &ldquo;tidak tertutup saldo (penghematan)&rdquo; dengan nilai Rp 0: pcs itu memakai bahan pembantu yang tidak dibeli lewat Buku Kas (mis. kancing dari klien), jadi tidak ada biaya.</p>}
          </>
        ),
      },
      {
        judul: 'Beban operasional dipisah',
        target: 'operasional-jurnal',
        isi: <p>Biaya Operasional & Lainnya <B>{rp(lain)}</B> bukan biaya membuat barang, jadi tidak ikut Total Biaya Produksi. Di Kinerja Keuangan angka ini muncul sebagai Beban operasional.</p>,
      },
      {
        judul: 'Pembelian & belanja pembantu hanya informasi',
        target: 'catatan-jurnal',
        isi: (
          <p>
            Belanja kain/aksesori <B>{rp(beli)}</B> dan belanja bahan pembantu <B>{rp(belanjaPemb)}</B> tidak dihitung biaya,
            karena barangnya masuk stok / Saldo Bahan Pembantu dulu. Biayanya baru muncul saat kain dipakai cutting dan saat
            pcs selesai dijahit (jatah HPP).
          </p>
        ),
      },
      {
        judul: 'Baca penghubung ke Laba Rugi',
        target: 'penghubung-jurnal',
        isi: ph ? (
          <p>
            Dari biaya produksi <B>{rp(total)}</B>, sebesar <B>{rp(ph.hpp)}</B> sudah ikut barang yang dikirim (HPP di Laba Rugi)
            dan <B>{rp(ph.overheadTanpaProduksi)}</B> jadi beban karena hari tanpa produksi. Sisanya
            <B> {total - ph.hpp - ph.overheadTanpaProduksi < 0 ? '−' : ''}{rp(total - ph.hpp - ph.overheadTanpaProduksi)}</B> masih
            menempel di barang yang belum dikirim (perkiraan).
          </p>
        ) : <p>{data.alasanTanpaPenghubung}</p>,
      },
      {
        judul: 'Saring per jenis atau cari',
        target: 'saring-jurnal',
        isi: <p>Klik salah satu jenis (mis. <B>Upah</B>) untuk melihat baris jenis itu saja, atau ketik nama bahan, nomor bundle, atau nomor PO di kotak cari. Jumlah di bawah tabel mengikuti saringan.</p>,
      },
      {
        judul: 'Baca baris tabel',
        target: 'tabel-jurnal',
        isi: (
          <>
            {contohKain ? (
              <p>
                Contoh: <B>{tgl(contohKain.tanggal)}</B> · Kain · {contohKain.kategori} · bundle {contohKain.keterangan}
                {contohKain.no_po && <> · {contohKain.no_po}</>} — {contohKain.qty?.toLocaleString('id-ID', { maximumFractionDigits: 3 })} {contohKain.satuan} senilai <B>{rp(contohKain.nominal)}</B>.
              </p>
            ) : <p>Setiap baris: tanggal, jenis, kategori (nama bahan / karyawan / sub-kelompok), keterangan, PO, qty, dan nominal.</p>}
            {contohTetap && <p>Baris Biaya Tetap ditulis per bulan, mis. &ldquo;{contohTetap.keterangan}&rdquo;.</p>}
            {adaMinus && <p>Angka <span className="text-red-400">merah (minus)</span> pada Upah = potongan upah karena reject (lihat Laporan Potongan Reject).</p>}
          </>
        ),
      },
    ],
    istilah: [
      'jurnal_jenis', 'jurnal_kain', 'jurnal_aksesori_pembantu', 'jurnal_upah',
      'jurnal_overhead', 'biaya_tetap', 'jurnal_operasional', 'jurnal_pembelian', 'jurnal_belanja_pembantu',
      'jurnal_total', 'jurnal_penghubung', 'jatah_hpp', 'fifo',
    ],
    tanyaJawab: [
      {
        t: 'Kenapa Total Biaya Produksi di sini berbeda dengan HPP di Kinerja Keuangan?',
        j: (
          <ul className="list-disc space-y-0.5 pl-4">
            <li>Jurnal mencatat <B>menurut tanggal kejadian</B> (kain saat dipotong, upah saat dikerjakan). Kinerja Keuangan memasukkan biaya ke HPP saat <B>barangnya dikirim</B>.</li>
            <li>Selisihnya dijelaskan di kotak <B>Dari Jurnal ke Laba Rugi</B>: sebagian besar masih menempel di barang yang belum dikirim.</li>
            <li>Bahan pembantu & overhead dihitung dengan cara yang sama di kedua menu (jatah HPP; beban operasional dipisah).</li>
          </ul>
        ),
      },
      {
        t: 'Bagaimana cara membetulkan baris yang salah?',
        j: <p>Betulkan di menu asalnya: kain → Cutting / Lacak Barcode; overhead, bahan pembantu & lainnya → Buku Kas; upah → Gaji; kontrak → Biaya Overhead. Jurnal akan berubah sendiri.</p>,
      },
      {
        t: 'Kenapa kain sebelum November tidak ada?',
        j: <p>Angka uang sebelum periode baru (PO-0099 / 14 Nov 2026) sengaja disembunyikan karena catatan lama belum rapi.</p>,
      },
      {
        t: 'Apa arti "(kain sisa)" di keterangan?',
        j: <p>Bundle itu dipotong memakai kain sisa potongan sebelumnya, bukan kain baru dari gulungan.</p>,
      },
    ],
  };
}
