import React from 'react';
import type { KontenPanduan } from '@/components/keuangan/panduan/Panduan';
import type { SaldoPembantuData } from '@/lib/actions/keuangan/saldo-pembantu.actions';

const rp = (n: number) => 'Rp ' + Math.round(Math.abs(n)).toLocaleString('id-ID');
const B = ({ children }: { children: React.ReactNode }) => <b className="text-[#e8eaed]">{children}</b>;

export function buatPanduanSaldoPembantu(data: SaldoPembantuData): KontenPanduan {
  // Contoh dari data sendiri: jenis dengan jatah terbesar yang punya barang
  const contoh = data.jenis.filter(j => !j.tanpa_barang).sort((a, b) => b.total_jatah - a.total_jatah)[0];
  const sisaBelanja = Math.max(0, data.total_saldo - data.total_sisa_modal);
  const jmlPeringatan = data.mutasi.filter(m => m.tipe === 'beli' && m.peringatan).length;

  return {
    judul: 'Saldo Bahan Pembantu',
    untukApa: (
      <>
        <p>
          Bahan pembantu (benang, kancing, plastik, label, dll.) dibeli borongan dan dipakai sedikit-sedikit, jadi tidak
          dihitung per gulung seperti kain. Menu ini mencatatnya dengan <B>sistem saldo</B>:
        </p>
        <ul className="list-disc space-y-0.5 pl-4">
          <li>Belanja (dan barang lama) <B>menambah</B> saldo.</li>
          <li>Setiap pcs selesai dijahit <B>mengurangi</B> saldo sebesar jatah di sheet HPP. Jatah inilah yang menjadi biaya produksi.</li>
          <li>Bila jatah melebihi saldo, kelebihannya dicatat sebagai <B>penghematan</B> (tambahan untung).</li>
        </ul>
        <p>Tidak perlu hitung fisik isi rak — saldo adalah perkiraan yang <i>seharusnya</i> ada.</p>
      </>
    ),
    langkah: [
      {
        judul: 'Baca empat kartu di atas',
        target: 'kartu-pembantu',
        isi: (
          <ul className="list-disc space-y-0.5 pl-4">
            <li>Belanja <B>{rp(data.total_beli)}</B> + barang lama <B>{rp(data.total_modal)}</B> = semua bahan yang pernah masuk.</li>
            <li>Jatah HPP <B>{rp(data.total_jatah)}</B> = nilai yang sudah dianggap terpakai (jadi biaya).</li>
            <li>Persediaan di rak <B>{rp(data.total_saldo)}</B> (barang lama {rp(data.total_sisa_modal)} + belanja baru {rp(sisaBelanja)}) = aset.</li>
            <li>Penghematan <B>{rp(data.total_penghematan)}</B> = jatah yang tidak perlu dibelanjakan.</li>
          </ul>
        ),
      },
      {
        judul: 'Cek peringatan belanja',
        target: jmlPeringatan ? 'peringatan-belanja' : undefined,
        isi: jmlPeringatan
          ? <p>Ada <B>{jmlPeringatan} belanja</B> yang dilakukan saat saldo masih lebih besar dari kebutuhan 2 minggu. Periksa apakah tarif HPP-nya terlalu murah, atau belanjanya terlalu cepat.</p>
          : <p>Saat ini tidak ada belanja yang mencurigakan, jadi kotak kuningnya tidak muncul.</p>,
      },
      {
        judul: 'Baca tabel Saldo per Jenis',
        target: 'tabel-saldo-jenis',
        isi: contoh ? (
          <>
            <p>Contoh <B>{contoh.nama}</B>: {contoh.pcs.toLocaleString('id-ID')} pcs dijahit → jatah <B>{rp(contoh.total_jatah)}</B>.</p>
            <p>
              Barang lama {rp(contoh.total_modal)} + belanja {rp(contoh.total_beli)} − jatah = saldo <B>{rp(contoh.saldo)}</B>
              {contoh.penghematan > 0 && <>; jatah yang melebihi saldo jadi penghematan <B>{rp(contoh.penghematan)}</B></>}.
            </p>
            <p className="text-xs text-[#9aa0a6]">Klik angka Pcs Dijahit untuk melihat rincian per artikel dan tarifnya.</p>
          </>
        ) : <p>Setiap baris = satu jenis bahan. Klik angka Pcs Dijahit untuk rincian per artikel.</p>,
      },
      {
        judul: 'Tab lainnya',
        target: 'tab-pembantu',
        isi: (
          <ul className="list-disc space-y-0.5 pl-4">
            <li><B>Barang Lama</B> — bahan yang sudah ada sebelum periode baru (harga perkiraan).</li>
            <li><B>Penghematan</B> — penghematan per bulan per jenis.</li>
            <li><B>Riwayat</B> — urutan belanja & jatah per tanggal, lengkap dengan saldo setelahnya.</li>
          </ul>
        ),
      },
    ],
    istilah: [
      'belanja_pembantu', 'barang_lama', 'pcs_dijahit', 'jatah_hpp', 'saldo_rak',
      'penghematan_pembantu', 'peringatan_belanja', 'persediaan_pembantu',
    ],
    tanyaJawab: [
      {
        t: 'Kenapa belanja bahan pembantu tidak langsung jadi biaya?',
        j: <p>Karena bahan yang dibeli belum tentu langsung terpakai. Yang menjadi biaya hanya <B>jatah HPP</B> untuk barang yang sudah dijahit; sisanya masih aset (persediaan di rak).</p>,
      },
      {
        t: 'Penghematan muncul padahal saya belanja lagi minggu depannya. Kenapa tidak tertutup?',
        j: <p>Penghematan dicatat permanen saat itu juga. Belanja berikutnya seluruhnya menambah saldo baru. Karena itu <B>tanggal belanja di Buku Kas harus tanggal sebenarnya</B>.</p>,
      },
      {
        t: 'Isi rak sebenarnya lebih banyak dari saldo, apakah salah?',
        j: <p>Wajar. Tarif HPP sengaja dibuat sedikit di atas pemakaian nyata, jadi barang di rak biasanya lebih banyak dari catatan.</p>,
      },
      {
        t: 'Kancing dibawa klien, bagaimana pencatatannya?',
        j: <p>Tidak perlu dicatat. Jatah kancing tetap dihitung dari HPP; karena tidak ada belanja, jatahnya menjadi penghematan (tambahan margin).</p>,
      },
    ],
  };
}
