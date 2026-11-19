import React from 'react';
import type { KontenPanduan } from '@/components/keuangan/panduan/Panduan';
import type { BiayaOverheadData } from '@/lib/actions/keuangan/biaya-overhead.actions';

const rp = (n: number) => 'Rp ' + Math.round(Math.abs(n)).toLocaleString('id-ID');
const tglFmt = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
const B = ({ children }: { children: React.ReactNode }) => <b className="text-[#e8eaed]">{children}</b>;

export function buatPanduanBiayaOverhead(data: BiayaOverheadData): KontenPanduan {
  const selisih = data.totalPatokan - data.totalRealisasiHpp;
  const boros = [...data.komponen].filter(k => k.realisasi > k.patokan).sort((a, b) => (b.realisasi - b.patokan) - (a.realisasi - a.patokan))[0];
  const totalLuar = data.luarHpp.reduce((s, x) => s + x.realisasi, 0);
  const kontrak = data.biayaTetap[0];

  return {
    judul: 'Biaya Overhead',
    untukApa: (
      <>
        <p>
          Overhead = biaya umum produksi yang tidak bisa ditunjuk ke satu baju: sewa, listrik, bensin, servis mesin, dll.
          Menu ini menjawab: <B>apakah uang overhead yang keluar masih sesuai patokan di sheet HPP?</B>
        </p>
        <p>
          Caranya: uang overhead yang keluar di Buku Kas (<B>Realisasi</B>) dibandingkan dengan tarif overhead HPP × pcs yang
          dikirim (<B>Patokan</B>).
        </p>
      </>
    ),
    langkah: [
      {
        judul: 'Pilih rentang tanggal',
        target: 'filter-overhead',
        isi: <p>Isi Dari–Sampai lalu klik <B>Terapkan</B>. Sekarang: <B>{tglFmt(data.dari)} – {tglFmt(data.sampai)}</B>.</p>,
      },
      {
        judul: 'Baca empat kartu di atas',
        target: 'kartu-overhead',
        isi: (
          <>
            <p>
              {data.pcsTerkirim.toLocaleString('id-ID')} pcs terkirim → patokan <B>{rp(data.totalPatokan)}</B>. Uang yang
              keluar <B>{rp(data.totalRealisasiHpp)}</B> → <B>{selisih >= 0 ? 'Hemat' : 'Boros'} {rp(selisih)}</B>.
            </p>
            {data.pcsTerkirim === 0 && <p className="text-xs text-[#9aa0a6]">Belum ada barang dikirim, jadi patokannya Rp 0 dan status &quot;Boros&quot; belum berarti boros.</p>}
          </>
        ),
      },
      {
        judul: 'Cari komponen yang boros',
        target: 'komponen-overhead',
        isi: (
          <>
            <p>Tiap baris = satu komponen overhead di sheet HPP. Batang biru = sudah terpakai berapa dari patokan; batang merah penuh = melewati patokan. Klik baris untuk melihat sub-kelompok & transaksinya.</p>
            {boros && <p>Paling boros saat ini: <B>{boros.nama}</B> — keluar {rp(boros.realisasi)} dari patokan {rp(boros.patokan)}.</p>}
          </>
        ),
      },
      {
        judul: 'Overhead di luar HPP & biaya lain',
        target: 'luar-hpp',
        isi: (
          <p>
            <B>Di luar patokan HPP</B> ({rp(totalLuar)}) = overhead yang tidak punya jatah di sheet HPP. <B>Biaya lain</B> =
            kategori Lainnya di Buku Kas, bukan overhead produksi. Keduanya tidak dibandingkan dengan patokan, tapi tetap mengurangi laba.
          </p>
        ),
      },
      {
        judul: 'Biaya tetap (kontrak)',
        target: 'biaya-tetap',
        isi: kontrak ? (
          <p>
            Contoh: <B>{kontrak.nama}</B> {rp(kontrak.nominal)} selama {kontrak.jumlah_hari} hari = <B>{rp(kontrak.per_hari)}/hari</B>.
            Pada rentang ini terhitung {kontrak.hari_dalam_rentang} hari = {rp(kontrak.alokasi_rentang)}.
          </p>
        ) : <p>Catat pembayaran besar untuk jangka panjang (mis. kontrak rumah) di sini supaya dibagi rata per hari, tidak membebani satu bulan saja.</p>,
      },
      {
        judul: 'Lihat tren 6 bulan',
        target: 'tren-overhead',
        isi: <p>Batang biru = uang keluar, garis oranye = patokan. Batang di atas garis = bulan itu boros. Klik &quot;Lihat sebagai tabel&quot; untuk angkanya.</p>,
      },
      {
        judul: 'Rapikan entri tanpa sub-kelompok',
        target: data.tanpaSub.length ? 'perlu-dirapikan' : undefined,
        isi: data.tanpaSub.length
          ? <p>Ada <B>{data.tanpaSub.length} entri</B> overhead tanpa sub-kelompok di bagian bawah. Pilihkan sub-kelompoknya supaya masuk ke komponen HPP yang tepat.</p>
          : <p>Semua entri overhead sudah punya sub-kelompok.</p>,
      },
    ],
    istilah: [
      'pcs_terkirim_oh', 'patokan_oh', 'realisasi_oh', 'selisih_oh', 'komponen_oh',
      'luar_hpp', 'biaya_lain', 'biaya_tetap', 'tren_overhead', 'perlu_dirapikan', 'overhead',
    ],
    tanyaJawab: [
      {
        t: 'Kenapa angka overhead di sini beda dengan Kinerja Keuangan / Laporan Per PO?',
        j: <p>Menu ini melihat <B>uang yang keluar</B> pada rentang tanggal dan membandingkannya dengan patokan untuk barang yang dikirim. Kinerja Keuangan & Laporan Per PO <B>membagi</B> overhead tiap bulan ke PO yang sedang diproduksi (metode pcs-hari). Tujuannya beda: di sini untuk mengontrol pengeluaran, di sana untuk menghitung laba.</p>,
      },
      {
        t: 'Awal bulan selalu terlihat boros, kenapa?',
        j: <p>Banyak tagihan (listrik, sewa) dibayar di awal bulan, sementara barang belum banyak dikirim sehingga patokannya masih kecil. Lihat di akhir bulan atau di tren 6 bulan.</p>,
      },
      {
        t: 'Sisa kontrak rumah dihitung aset?',
        j: <p>Tidak. Sisa kontrak sengaja tidak dicatat sebagai aset; biayanya cukup dibagi rata per hari.</p>,
      },
      {
        t: 'Bagaimana supaya biaya masuk komponen yang benar?',
        j: <p>Saat mencatat di Buku Kas, pilih kategori <B>Biaya Overhead</B> dan sub-kelompoknya. Sub-kelompok sudah tertaut ke komponen HPP.</p>,
      },
    ],
  };
}
