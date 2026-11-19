import React from 'react';
import type { KontenPanduan } from '@/components/keuangan/panduan/Panduan';
import type { KinerjaData } from '@/lib/keuangan/kinerja.server';

const rp = (n: number) => 'Rp ' + Math.round(Math.abs(n)).toLocaleString('id-ID');
const tanda = (n: number) => (Math.round(n) < 0 ? '−' : '') + rp(n);
const pct = (a: number, b: number) => (b > 0 ? `${((a / b) * 100).toLocaleString('id-ID', { maximumFractionDigits: 1 })}%` : '–');
const B = ({ children }: { children: React.ReactNode }) => <b className="text-[#e8eaed]">{children}</b>;

export function buatPanduanKinerja(data: KinerjaData): KontenPanduan {
  const { lr, posisi, arusKas } = data;
  const t = lr.total, a = lr.aktual, bj = lr.berjalan;
  const semua = data.periode === 'semua';
  const contoh = data.po.find(p => p.nilai_jual > 0 && p.status !== 'terkirim') ?? data.po.find(p => p.nilai_jual > 0) ?? null;

  return {
    judul: 'Kinerja Keuangan',
    untukApa: (
      <>
        <p>Laporan keuangan utama usaha, dalam 4 bagian:</p>
        <ol className="list-decimal space-y-0.5 pl-5">
          <li><B>Laba Rugi</B> — untung berapa dari barang yang dijual?</li>
          <li><B>Posisi Aset & Kewajiban</B> — apa yang dimiliki usaha, dan apa yang masih harus dibayar/diberikan?</li>
          <li><B>Arus Kas</B> — uang tunai benar-benar masuk & keluar berapa?</li>
          <li><B>Laba per PO</B> — PO mana yang menyumbang untung/rugi?</li>
        </ol>
        <p>
          Prinsip utamanya: <B>untung dihitung saat barang dikirim</B>, bukan saat uang masuk. Jadi laba bisa plus
          walaupun kas minus (misalnya baru beli banyak kain), dan sebaliknya.
        </p>
      </>
    ),
    langkah: [
      {
        judul: 'Pilih periode',
        target: 'periode',
        isi: (
          <p>
            Tombol <B>Sejak …</B> menampilkan semua bulan ditambah perkiraan order yang belum dikirim. Klik nama bulan untuk
            melihat hanya barang yang <B>dikirim di bulan itu</B>. Sekarang terpilih: <B>{semua ? 'Sejak awal periode' : 'satu bulan'}</B>.
          </p>
        ),
      },
      {
        judul: 'Lihat 4 angka utama',
        target: 'kpi',
        isi: (
          <ul className="list-disc space-y-0.5 pl-4">
            <li>{semua ? 'Nilai penjualan' : 'Pendapatan'} <B>{rp(t.pendapatan)}</B>{semua && bj ? <> — {rp(a.pendapatan)} sudah dikirim, {rp(bj.pendapatan)} masih order berjalan</> : null}.</li>
            <li>Laba kotor <B>{tanda(t.labaKotor)}</B> (margin {pct(t.labaKotor, t.pendapatan)}) = sisa setelah biaya produksi.</li>
            <li>Laba bersih <B>{tanda(t.labaBersih)}</B> (margin {pct(t.labaBersih, t.pendapatan)}) = sisa setelah semua biaya.</li>
            <li>{posisi.uangMukaPelanggan > 0
              ? <>Uang muka pelanggan <B>{rp(posisi.uangMukaPelanggan)}</B> = DP yang barangnya belum dikirim.</>
              : <>Piutang <B>{rp(posisi.piutang)}</B> = barang sudah dikirim, belum dibayar.</>}</li>
          </ul>
        ),
      },
      {
        judul: 'Baca Laporan Laba Rugi dari atas ke bawah',
        target: 'laba-rugi',
        isi: (
          <>
            <p>Bacanya seperti pengurangan bersusun:</p>
            <ul className="list-disc space-y-0.5 pl-4">
              <li>Pendapatan <B>{rp(t.pendapatan)}</B></li>
              <li>dikurangi HPP (bahan {rp(t.bahan)} + upah {rp(t.upah)} + overhead {rp(t.overheadProduksi)}) = <B>{rp(t.hpp)}</B></li>
              <li>= Laba kotor <B>{tanda(t.labaKotor)}</B></li>
              <li>dikurangi beban usaha <B>{rp(t.bebanUsaha)}</B></li>
              <li>= Laba bersih <B>{tanda(t.labaBersih)}</B></li>
            </ul>
            {bj && <p>Kolom <B>Sudah dikirim</B> = angka nyata; kolom <B>Order berjalan</B> (abu-abu) = perkiraan barang yang belum dikirim; <B>Total</B> = keduanya.</p>}
            <p className="text-xs text-[#9aa0a6]">Angka dalam kurung, mis. (Rp 100.000), berarti minus/pengurang. Klik nama baris (bergaris titik) untuk melihat rincian transaksinya.</p>
          </>
        ),
      },
      ...(data.lrPerBulan.length > 0 ? [{
        judul: 'Bandingkan antar bulan',
        target: 'lr-bulanan',
        isi: <p>Tabel di bawah Laba Rugi berisi angka <B>aktual</B> tiap bulan. Klik nama bulan untuk membuka laporan bulan itu saja.</p>,
      }] : []),
      {
        judul: 'Cek Posisi Aset & Kewajiban',
        target: 'posisi',
        isi: (
          <>
            <p>Selalu per <B>hari ini</B>, tidak ikut pilihan periode.</p>
            <ul className="list-disc space-y-0.5 pl-4">
              <li>Aset (yang dimiliki, di luar uang tunai) <B>{rp(posisi.totalAset)}</B>: kain di gudang, bahan pembantu di rak, biaya barang yang masih di produksi{posisi.piutang > 0 ? ', piutang' : ''}.</li>
              <li>Kewajiban (yang masih harus diberikan) <B>{rp(posisi.totalKewajiban)}</B>: barang untuk DP yang sudah diterima + upah belum dibayar.</li>
            </ul>
            <p className="text-xs text-[#9aa0a6]">Klik baris yang ada tanda ▸ untuk melihat rinciannya.</p>
          </>
        ),
      },
      {
        judul: 'Cek Arus Kas',
        target: 'arus-kas',
        isi: (
          <>
            <p>
              Kas masuk <B>{rp(arusKas.totalMasuk)}</B> − kas keluar <B>{rp(arusKas.totalKeluar)}</B> = arus kas bersih{' '}
              <B>{tanda(arusKas.bersih)}</B>.
            </p>
            <p>
              Kalau arus kas minus tapi laba plus, biasanya uang sedang &quot;tertahan&quot; di stok kain atau barang dalam proses —
              bukan berarti rugi.
            </p>
          </>
        ),
      },
      {
        judul: contoh ? `Laba per PO — contoh ${contoh.no_po}` : 'Laba per PO',
        target: 'laba-po',
        isi: contoh ? (
          <>
            <p>{contoh.no_po} ({contoh.klien}): dipotong {contoh.pcs.toLocaleString('id-ID')} pcs, sudah dikirim {contoh.pcs_kirim.toLocaleString('id-ID')} pcs.</p>
            <ul className="list-disc space-y-0.5 pl-4">
              <li>Nilai jual <B>{rp(contoh.nilai_jual)}</B></li>
              <li>dikurangi bahan <B>{rp(contoh.kain + contoh.aksesori + contoh.sisa_bahan)}</B>, upah <B>{rp(contoh.upah_lunas + contoh.upah_belum_lunas + contoh.upah_sisa)}</B>, overhead <B>{rp(contoh.overhead + contoh.sisa_pembantu)}</B></li>
              <li>= laba <B>{tanda(contoh.laba)}</B> (margin {pct(contoh.laba, contoh.nilai_jual)})</li>
            </ul>
            <p className="text-xs text-[#9aa0a6]">Laba ini sama persis dengan Laporan Per PO. Klik nomor PO untuk melihat posisi barang di tiap tahap. Arahkan kursor ke angka Bahan/Upah/Overhead untuk melihat pecahannya.</p>
          </>
        ) : <p>Belum ada PO yang dipotong. Tiap baris: Nilai jual − Bahan − Upah − Overhead = Laba.</p>,
      },
    ],
    istilah: [
      'periode_kinerja', 'sudah_dikirim', 'order_berjalan',
      'pendapatan', 'nilai_penjualan', 'retur_reject', 'bahan_baku', 'upah_produksi', 'overhead', 'overhead_sementara', 'hpp_lr', 'laba_kotor',
      'overhead_tanpa_produksi', 'beban_operasional', 'beban_usaha', 'laba_bersih',
      'persediaan_bahan', 'persediaan_pembantu', 'barang_dalam_proses', 'piutang', 'total_aset',
      'uang_muka', 'upah_terutang', 'total_kewajiban',
      'arus_kas', 'setoran_modal', 'arus_kas_bersih',
      'status_kirim', 'potong_kirim', 'dp_diterima', 'po_bahan', 'po_upah', 'po_overhead', 'laba', 'fifo',
    ],
    tanyaJawab: [
      {
        t: 'Kenapa laba plus tapi uang di kas sedikit?',
        j: <p>Laba dihitung dari barang yang <B>dikirim</B>, kas dari uang yang <B>benar-benar masuk</B>. Uang bisa tertahan di stok kain, barang yang masih di produksi, atau piutang yang belum dibayar pelanggan.</p>,
      },
      {
        t: 'DP sudah masuk, kenapa tidak jadi pendapatan?',
        j: <p>DP adalah uang untuk barang yang belum dikirim — masih &quot;utang barang&quot; ke pelanggan (Uang muka pelanggan). Begitu barangnya dikirim lewat Surat Jalan, nilainya pindah jadi pendapatan.</p>,
      },
      {
        t: 'Beli kain banyak bulan ini, kenapa laba tidak turun?',
        j: <p>Kain yang baru dibeli masih <B>persediaan</B> (aset). Baru jadi biaya saat dipotong dan barangnya dikirim. Pembeliannya tetap terlihat di Arus Kas.</p>,
      },
      {
        t: 'HPP di sini sama dengan HPP di sheet?',
        j: <p>Tidak. HPP di sheet adalah <B>patokan</B> biaya per pcs. HPP di Laba Rugi adalah <B>biaya sebenarnya</B> barang yang sudah dikirim. Perbandingan keduanya ada di Laporan Per PO (Hemat/Boros).</p>,
      },
      {
        t: 'Kenapa angka bulan ini masih bisa berubah?',
        j: <p>Overhead bulan berjalan masih <B>sementara</B> (dihitung sampai hari ini), dan order berjalan masih perkiraan. Angka tetap setelah bulan tutup dan barang terkirim.</p>,
      },
      {
        t: 'Kenapa saldo kas tidak ditampilkan?',
        j: <p>Saldo uang sebelum awal periode baru belum dicatat, jadi saldo kas belum bisa dihitung dengan benar. Yang ditampilkan hanya arus masuk & keluarnya.</p>,
      },
    ],
  };
}
