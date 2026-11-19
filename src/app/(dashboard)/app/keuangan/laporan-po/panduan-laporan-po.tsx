import React from 'react';
import type { KontenPanduan } from '@/components/keuangan/panduan/Panduan';
import type { POLaporanItem } from '@/lib/actions/keuangan/laporan-po.actions';

const rp = (n: number) => 'Rp ' + Math.round(Math.abs(n)).toLocaleString('id-ID');
const hb = (n: number) => (Math.round(n) > 0 ? `Boros ${rp(n)}` : Math.round(n) < 0 ? `Hemat ${rp(n)}` : 'Sesuai');
const B = ({ children }: { children: React.ReactNode }) => <b className="text-[#e8eaed]">{children}</b>;

/** PO contoh untuk panduan: yang sudah dipotong & punya harga jual, utamakan yang Final */
export function pilihPOContoh(data: POLaporanItem[]): POLaporanItem | null {
  const layak = data.filter(p => p.tanda !== 'belum_dipotong' && p.nilai_project > 0);
  return layak.find(p => p.tanda === 'final') ?? layak[0] ?? null;
}

export function buatPanduanLaporanPO(data: POLaporanItem[], contoh: POLaporanItem | null): KontenPanduan {
  const jml = (f: (p: POLaporanItem) => number) => data.reduce((s, p) => s + f(p), 0);
  const tPerk = jml(p => p.perkiraan), tAkt = jml(p => p.aktual), tSisa = jml(p => p.sisa), tSel = jml(p => p.selisih);
  const adaPeringatan = data.some(p => p.kesimpulan?.peringatan);
  const c = contoh;
  const perluDetail = 'Klik tombol Detail di salah satu PO dulu, lalu tekan Tunjukkan lagi.';

  return {
    judul: 'Laporan Per PO',
    untukApa: (
      <>
        <p>
          Menjawab satu pertanyaan: <B>PO ini untung berapa, dan apakah biaya produksinya sesuai patokan HPP?</B>
        </p>
        <p>
          Tiap PO dibandingkan dua hal: <B>biaya</B> dibandingkan dengan patokan HPP (hemat atau boros), dan{' '}
          <B>harga jual</B> dibandingkan dengan biaya (laba). Angka laba di sini sama persis dengan menu Kinerja Keuangan.
        </p>
      </>
    ),
    langkah: [
      {
        judul: 'Pilih bulan order',
        target: 'filter',
        isi: <p>Laporan menampilkan PO berdasarkan <B>bulan order</B>. Pilih bulan & tahun, lalu klik <B>Terapkan Filter</B>. Pilih &quot;Semua&quot; untuk melihat setahun.</p>,
      },
      {
        judul: 'Baca kotak ringkasan',
        target: 'ringkasan',
        isi: (
          <>
            <p>Kotak di atas menjumlahkan semua PO yang tampil. Untuk filter sekarang:</p>
            <ul className="list-disc space-y-0.5 pl-4">
              <li>Perkiraan (patokan HPP) <B>{rp(tPerk)}</B></li>
              <li>Aktual sejauh ini <B>{rp(tAkt)}</B> + Sisa perkiraan <B>{rp(tSisa)}</B></li>
              <li>Jadi biaya {rp(tAkt)} + {rp(tSisa)} dibanding patokan {rp(tPerk)} → <B>{hb(tSel)}</B></li>
            </ul>
          </>
        ),
      },
      ...(adaPeringatan ? [{
        judul: 'Cek kotak merah "PO perlu perhatian"',
        target: 'peringatan',
        isi: <p>Kotak merah muncul bila ada PO yang <B>rugi</B> atau margin-nya <B>turun lebih dari 20%</B> dari perkiraan HPP. Mulailah dari PO di sini.</p>,
      }] : []),
      {
        judul: c ? `Baca satu baris PO — contoh ${c.no_po}` : 'Baca satu baris PO',
        target: c ? 'baris-contoh' : 'tabel',
        isi: c ? (
          <>
            <p>{c.no_po} ({c.klien_nama}): order {c.total_qty.toLocaleString('id-ID')} pcs, dipotong <B>{c.pcs_potong.toLocaleString('id-ID')} pcs</B>.</p>
            <ul className="list-disc space-y-0.5 pl-4">
              <li>Menurut HPP, biayanya seharusnya <B>{rp(c.perkiraan)}</B> (Perkiraan).</li>
              <li>Yang sudah keluar <B>{rp(c.aktual)}</B> (Aktual){Math.round(c.sisa) ? <>, masih akan keluar sekitar <B>{rp(c.sisa)}</B> (Sisa)</> : ''}.</li>
              <li>{rp(c.aktual)}{Math.round(c.sisa) ? ` + ${rp(c.sisa)}` : ''} − {rp(c.perkiraan)} = <B>{hb(c.selisih)}</B>.</li>
              <li>Nilai jual <B>{rp(c.nilai_project)}</B> dikurangi semua biaya itu = laba <B>{c.profit_final < 0 ? '−' : ''}{rp(c.profit_final)}</B>, margin <B>{c.margin_pct_final}%</B>.</li>
            </ul>
            <p className="text-xs text-[#9aa0a6]">Status <B>{c.tanda === 'final' ? 'Final' : 'Berjalan / Menunggu harga'}</B>{c.tanda === 'final' ? ': semua biaya sudah tercatat, angkanya tidak berubah lagi.' : ': sebagian biaya masih perkiraan, angkanya bisa berubah.'}</p>
          </>
        ) : <p>Belum ada PO yang sudah dipotong dan punya harga jual pada filter ini. Tiap baris: Perkiraan → Aktual + Sisa → Hemat/Boros → Nilai Jual → Laba → Margin.</p>,
      },
      {
        judul: 'Buka Detail untuk mencari penyebab',
        target: c ? 'detail-contoh' : undefined,
        isi: <p>Klik <B>Detail</B>. Kotak <B>Kesimpulan</B> di atas menjelaskan dalam kalimat: untung/rugi, dibanding HPP, dan komponen penyebab terbesar.</p>,
      },
      {
        judul: 'Tab Per Komponen',
        target: 'tab-komponen',
        bilaTidakAda: perluDetail,
        isi: <p>Biaya dipecah per kain, aksesori, bahan pembantu, upah per tahap, dan overhead. Cari angka <span className="text-red-400">Boros</span> merah terbesar — itu yang paling menggerus untung.</p>,
      },
      {
        judul: 'Tab Qty Pesan vs Potong',
        target: 'tab-qty',
        bilaTidakAda: perluDetail,
        isi: <p>Cek apakah ada size yang <B>kurang potong</B> (merah). Kurang potong berarti ada barang pesanan yang tidak bisa ditagih.</p>,
      },
      {
        judul: 'Tab Rincian Aktual & HPP per Size',
        target: 'tab-rincian',
        bilaTidakAda: perluDetail,
        isi: <p><B>Rincian Aktual</B> = daftar catatan biaya pembentuk angka Aktual. <B>HPP per Size</B> = biaya aktual per pcs untuk tiap warna & size.</p>,
      },
    ],
    istilah: [
      'qty_order', 'pcs_potong', 'pcs_kirim', 'perkiraan', 'aktual', 'sisa', 'hemat_boros', 'nilai_jual', 'laba', 'margin',
      'status_po', 'peringatan', 'overhead', 'overhead_sementara', 'fifo', 'tarif_dibayar',
      'untung_hpp', 'untung_sebenarnya', 'dibanding_hpp', 'kesimpulan', 'kurang_potong', 'status_komponen',
      'tab_komponen', 'tab_qty', 'tab_rincian', 'tab_hpp_size',
    ],
    tanyaJawab: [
      {
        t: 'Kenapa PO tertulis "Hemat" tapi labanya rugi?',
        j: <p>Hemat/Boros membandingkan biaya dengan <B>patokan HPP</B>, bukan dengan harga jual. Kalau harga jual sudah di bawah HPP, produksi yang hemat pun tetap rugi — hanya ruginya lebih kecil dari seharusnya.</p>,
      },
      {
        t: 'Kenapa angkanya berubah padahal tidak ada transaksi baru?',
        j: <p>Selama PO belum Final, sebagian biaya masih <B>Sisa perkiraan</B>, dan overhead bulan berjalan masih <B>sementara</B>. Begitu tahap selesai atau bulan tutup, perkiraan diganti biaya sebenarnya.</p>,
      },
      {
        t: 'Kenapa Nilai Jual berbeda dengan tagihan/invoice?',
        j: <p>Nilai Jual di sini = harga jual × pcs <B>dipotong</B> (semua yang akan dijual). Invoice hanya menagih barang yang sudah <B>dikirim</B>.</p>,
      },
      {
        t: 'Apakah laba di sini sama dengan Kinerja Keuangan?',
        j: <p>Ya. Keduanya memakai mesin hitung yang sama, jadi laba per PO selalu sama.</p>,
      },
      {
        t: 'Kenapa PO lama tidak muncul?',
        j: <p>Pencatatan periode baru dimulai pertengahan November 2026. PO sebelum periode itu disembunyikan karena datanya belum lengkap.</p>,
      },
      {
        t: 'Tarif upah di sheet HPP naik. Apakah PO lama jadi "Boros"?',
        j: <p>Tidak. Upah yang sudah dibayar dibandingkan dengan tarif yang dibayar saat itu, jadi perubahan tarif tidak dihitung hemat/boros.</p>,
      },
    ],
  };
}
