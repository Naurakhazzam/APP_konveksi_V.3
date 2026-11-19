import React from 'react';
import type { KontenPanduan } from '@/components/keuangan/panduan/Panduan';
import type { RingkasanKeuanganData } from '@/lib/actions/keuangan/ringkasan.actions';

const rp = (n: number) => 'Rp ' + Math.round(Math.abs(n)).toLocaleString('id-ID');
const tanda = (n: number) => (Math.round(n) < 0 ? '−' : '') + rp(n);
const pct = (a: number, b: number) => (b > 0 ? `${((a / b) * 100).toLocaleString('id-ID', { maximumFractionDigits: 1 })}%` : '–');
const blnFmt = (ym: string) => new Date(`${ym}-01T00:00:00`).toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });
const B = ({ children }: { children: React.ReactNode }) => <b className="text-[#e8eaed]">{children}</b>;

export function buatPanduanRingkasan(data: RingkasanKeuanganData): KontenPanduan {
  const k = data.kinerja;
  const a = k.lr.aktual, ob = k.orderBerjalan, pos = k.posisi;
  const bln = blnFmt(k.periode);

  return {
    judul: 'Ringkasan Keuangan',
    untukApa: (
      <>
        <p>
          Halaman pertama untuk melihat <B>kesehatan usaha dalam sekali pandang</B>: untung bulan ini, uang yang masih
          tertahan, dan PO yang perlu dicek.
        </p>
        <p>
          Semua angka diambil dari mesin hitung yang sama dengan <B>Kinerja Keuangan</B>. Untuk rincian, buka menu itu atau
          Laporan Per PO lewat tombol di bagian bawah.
        </p>
      </>
    ),
    langkah: [
      {
        judul: 'Pilih bulan',
        target: 'navigasi-bulan',
        isi: <p>Pakai tombol <B>Bulan lalu</B> / <B>Bulan berikutnya</B>. Sekarang tampil: <B>{bln}</B>.</p>,
      },
      {
        judul: 'Kinerja bulan ini',
        target: 'kinerja-bulan',
        isi: (
          <>
            <p>Hanya dari barang yang <B>sudah dikirim</B> di {bln}:</p>
            <ul className="list-disc space-y-0.5 pl-4">
              <li>Pendapatan <B>{rp(a.pendapatan)}</B> − HPP <B>{rp(a.hpp)}</B> = Laba kotor <B>{tanda(a.labaKotor)}</B> (margin {pct(a.labaKotor, a.pendapatan)})</li>
              <li>Laba kotor − beban usaha {rp(a.bebanUsaha)} = Laba bersih <B>{tanda(a.labaBersih)}</B> (margin {pct(a.labaBersih, a.pendapatan)})</li>
            </ul>
            {k.overheadSementara && <p className="text-xs text-[#9aa0a6]">Overhead bulan ini masih sementara, jadi HPP & laba bisa sedikit berubah sampai bulan tutup.</p>}
          </>
        ),
      },
      {
        judul: 'Posisi hari ini',
        target: 'posisi-hari-ini',
        isi: (
          <ul className="list-disc space-y-0.5 pl-4">
            <li>Order berjalan <B>{rp(ob.pendapatan)}</B> = nilai barang yang sudah dipotong tapi belum dikirim; perkiraan labanya <B>{tanda(ob.labaKotor)}</B>.</li>
            <li>{pos.uangMukaPelanggan > 0
              ? <>Uang muka pelanggan <B>{rp(pos.uangMukaPelanggan)}</B> = DP yang barangnya belum dikirim.</>
              : <>Piutang <B>{rp(pos.piutang)}</B> = uang yang masih harus dibayar pelanggan.</>}</li>
            <li>Upah terutang <B>{rp(pos.upahTerutang)}</B> = upah yang harus segera dibayar.</li>
            <li>Persediaan bahan <B>{rp(pos.persediaanBahan + pos.persediaanPembantu)}</B> = uang yang &quot;tertahan&quot; di stok.</li>
          </ul>
        ),
      },
      {
        judul: 'Lihat tren',
        target: 'tren',
        isi: <p>Batang hijau = pendapatan, kuning = HPP, garis biru = laba bersih. Kalau batang kuning makin mendekati hijau, untungnya makin tipis.</p>,
      },
      {
        judul: 'Cek daftar PO yang perlu perhatian',
        target: data.po_peringatan.length ? 'po-peringatan' : data.po_melebihi_patokan.length ? 'po-patokan' : undefined,
        isi: (
          <>
            <p><span className="text-red-400">Merah</span> = PO rugi atau margin-nya turun lebih dari 20% dari perkiraan HPP. <span className="text-amber-400">Kuning</span> = biaya produksi lebih besar dari patokan HPP (boros), belum tentu rugi.</p>
            <p className="text-xs text-[#9aa0a6]">
              {data.po_peringatan.length || data.po_melebihi_patokan.length
                ? `Saat ini: ${data.po_peringatan.length} PO merah, ${data.po_melebihi_patokan.length} PO kuning. Klik "Lihat Laporan Per PO" untuk mencari penyebabnya.`
                : 'Saat ini tidak ada PO yang perlu perhatian — kotaknya tidak muncul.'}
            </p>
          </>
        ),
      },
    ],
    istilah: [
      'pendapatan', 'hpp_lr', 'laba_kotor', 'beban_usaha', 'laba_bersih', 'overhead_sementara',
      'order_berjalan', 'uang_muka', 'piutang', 'upah_terutang', 'persediaan_bahan', 'persediaan_pembantu',
      'tren_bulanan', 'peringatan', 'melebihi_patokan',
    ],
    tanyaJawab: [
      {
        t: 'Kenapa pendapatan bulan ini kecil padahal produksi banyak?',
        j: <p>Pendapatan hanya dihitung dari barang yang sudah <B>dikirim</B>. Barang yang masih di produksi masuk <B>Order berjalan</B> dan baru jadi pendapatan setelah dikirim.</p>,
      },
      {
        t: 'Apa beda Laba kotor dan Laba bersih?',
        j: <p>Laba kotor = penjualan − biaya produksi. Laba bersih = laba kotor − biaya di luar produksi (beban operasional & overhead hari tanpa produksi).</p>,
      },
      {
        t: 'PO masuk daftar kuning, apakah rugi?',
        j: <p>Belum tentu. Kuning hanya berarti biayanya melebihi patokan HPP. Kalau harga jualnya jauh di atas HPP, PO itu tetap untung. PO yang rugi masuk daftar merah.</p>,
      },
      {
        t: 'Angka di sini beda dengan Kinerja Keuangan?',
        j: <p>Tidak — sumbernya sama. Bedanya, Ringkasan selalu per satu bulan (aktual), sedangkan Kinerja Keuangan bisa menampilkan &quot;sejak awal&quot; termasuk order berjalan.</p>,
      },
    ],
  };
}
