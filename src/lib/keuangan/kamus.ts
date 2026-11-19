/**
 * Kamus istilah menu Keuangan — SATU sumber untuk ikon ⓘ dan panel 📖 Panduan.
 * Pembaca: pemilik usaha (bukan akuntan) → bahasa sederhana.
 * Isi ditulis dari logika mesin sebenarnya (kinerja.server.ts, komponen-po.ts, laporan-po.actions.ts);
 * bila rumus di mesin berubah, perbarui juga di sini.
 */

export interface Istilah {
  judul: string;
  /** Artinya dalam bahasa sehari-hari */
  artinya: string;
  /** Cara menghitung (boleh kosong untuk istilah yang bukan angka) */
  rumus?: string;
  /** Nama menu asal angkanya (tanpa tautan) */
  sumber?: string;
}

export const KAMUS = {
  // ─── Jumlah barang ─────────────────────────────────────────────────────────
  qty_order: {
    judul: 'Order',
    artinya: 'Jumlah pcs yang dipesan klien di PO.',
    sumber: 'Purchase Order',
  },
  pcs_potong: {
    judul: 'Dipotong',
    artinya: 'Jumlah pcs yang benar-benar sudah dipotong di Cutting. Semua hitungan biaya & nilai jual di laporan ini memakai angka ini, bukan jumlah order.',
    sumber: 'Cutting',
  },
  pcs_kirim: {
    judul: 'Dikirim',
    artinya: 'Jumlah pcs yang sudah dikirim ke klien lewat Surat Jalan.',
    sumber: 'Pengiriman (Surat Jalan)',
  },

  // ─── Biaya ─────────────────────────────────────────────────────────────────
  perkiraan: {
    judul: 'Perkiraan biaya',
    artinya: 'Biaya produksi yang SEHARUSNYA keluar menurut patokan HPP. Ini angka pembanding, bukan uang yang sudah keluar.',
    rumus: 'HPP per pcs (sheet HPP) × pcs dipotong. Khusus upah yang sudah dibayar: memakai tarif yang dibayar saat itu, bukan tarif HPP sekarang.',
    sumber: 'Master HPP & Cutting',
  },
  aktual: {
    judul: 'Aktual sejauh ini',
    artinya: 'Biaya yang SUDAH benar-benar keluar atau sudah tercatat untuk PO ini sampai hari ini.',
    rumus: 'Kain + puring/sleting (harga beli stok, FIFO) + bahan pembantu yang terpakai + upah tercatat (sudah & belum dibayar) + overhead produksi.',
    sumber: 'Stok Bahan, Saldo Bahan Pembantu, Laporan Gaji, Biaya Overhead',
  },
  sisa: {
    judul: 'Sisa perkiraan',
    artinya: 'Biaya yang BELUM keluar karena pekerjaannya belum selesai (mis. belum dijahit/di-packing) atau harga aksesorinya belum masuk. Dihitung dari patokan HPP.',
    rumus: 'HPP komponen × pcs yang biayanya belum tercatat.',
    sumber: 'Master HPP',
  },
  hemat_boros: {
    judul: 'Hemat / Boros',
    artinya: 'Apakah biaya produksi lebih kecil (Hemat, hijau) atau lebih besar (Boros, merah) dari patokan HPP. Ini membandingkan BIAYA dengan HPP — bukan dengan harga jual. PO bisa "Hemat" tapi tetap rugi kalau harga jualnya di bawah HPP.',
    rumus: '(Aktual + Sisa) − Perkiraan. Hasil plus = Boros, minus = Hemat.',
  },
  fifo: {
    judul: 'FIFO',
    artinya: 'Cara menghitung harga bahan: stok yang masuk paling dulu dipakai paling dulu. Jadi harga kain di PO ini = harga beli gulungan yang benar-benar terpakai.',
    sumber: 'Stok Bahan',
  },
  overhead: {
    judul: 'Overhead produksi',
    artinya: 'Biaya umum produksi yang tidak bisa ditunjuk ke satu baju, mis. sewa rumah produksi, listrik, bahan pembantu. Dibagi ke semua PO yang sedang dikerjakan.',
    rumus: 'Overhead sebulan dibagi ke tiap PO sebanding pcs × lama hari barang itu ada di produksi bulan itu (metode pcs-hari), ditambah biaya di Buku Kas yang ditandai untuk PO ini.',
    sumber: 'Biaya Overhead & Buku Kas',
  },
  overhead_sementara: {
    judul: 'Overhead sementara',
    artinya: 'Overhead bulan ini belum final karena bulannya belum selesai — tagihan bisa bertambah dan pembagiannya bisa berubah. Angkanya tetap setelah bulan tutup.',
  },
  tarif_dibayar: {
    judul: 'Tarif = yang dibayar',
    artinya: 'Upah yang sudah dibayar dibandingkan dengan tarif yang dibayar saat itu. Kalau tarif di sheet HPP berubah belakangan, perubahan itu tidak dihitung sebagai hemat/boros.',
  },

  // ─── Penjualan & untung ────────────────────────────────────────────────────
  nilai_jual: {
    judul: 'Nilai jual',
    artinya: 'Total harga jual barang PO ini.',
    rumus: 'Harga jual per pcs × pcs dipotong. (Bila belum ada yang dipotong: harga jual × pcs order.)',
    sumber: 'Master Produk (harga jual)',
  },
  laba: {
    judul: 'Laba',
    artinya: 'Perkiraan untung PO ini kalau semua pekerjaan selesai. Selama PO belum final, sebagian biayanya masih perkiraan (Sisa).',
    rumus: 'Nilai jual − Aktual − Sisa perkiraan.',
    sumber: 'Kinerja Keuangan (angkanya selalu sama)',
  },
  margin: {
    judul: 'Margin',
    artinya: 'Laba dalam persen dari nilai jual. Margin 20% berarti dari tiap Rp 100.000 penjualan, untungnya Rp 20.000.',
    rumus: 'Laba ÷ Nilai jual × 100%.',
  },
  untung_hpp: {
    judul: 'Untung menurut HPP',
    artinya: 'Untung yang seharusnya didapat kalau biaya produksi persis sama dengan patokan HPP. Bisa minus kalau harga jual di bawah HPP.',
    rumus: 'Nilai jual − Perkiraan biaya.',
  },
  untung_sebenarnya: {
    judul: 'Untung sebenarnya',
    artinya: 'Untung memakai biaya yang benar-benar keluar (ditambah sisa perkiraan untuk pekerjaan yang belum selesai). Sama dengan kolom Laba.',
    rumus: 'Nilai jual − (Aktual + Sisa perkiraan).',
  },
  dibanding_hpp: {
    judul: 'Dibanding HPP',
    artinya: 'Seberapa jauh untung sebenarnya berbeda dari untung menurut HPP. "Lebih untung" = produksi lebih hemat dari patokan; "Kurang untung" = lebih boros.',
    rumus: 'Untung sebenarnya − Untung menurut HPP (= kebalikan Hemat/Boros).',
  },
  kesimpulan: {
    judul: 'Kesimpulan',
    artinya: 'Ringkasan otomatis PO ini: untung/rugi, dibanding patokan HPP, komponen penyebab terbesar (selisih ≥ Rp 1.000), dan masalah jumlah potong.',
  },
  peringatan: {
    judul: 'Peringatan ⚠',
    artinya: 'Muncul bila PO rugi, atau margin sebenarnya turun lebih dari 20% dibanding margin menurut HPP. Contoh: menurut HPP untung Rp 1 juta, sebenarnya hanya Rp 700 ribu → turun 30% → ⚠.',
  },
  kurang_potong: {
    judul: 'Kurang / lebih potong',
    artinya: 'Pcs dipotong lebih sedikit (kurang) atau lebih banyak (lebih) dari pesanan. Kurang potong = ada nilai jual yang tidak bisa ditagih.',
    rumus: 'Pcs dipotong − pcs pesan, per artikel/warna/size.',
    sumber: 'Purchase Order & Cutting',
  },

  // ─── Status ────────────────────────────────────────────────────────────────
  status_po: {
    judul: 'Status PO',
    artinya: 'Final = semua biaya sudah tercatat. Berjalan = masih ada tahap yang belum selesai, jadi sebagian biaya masih perkiraan. Menunggu harga = ada aksesori yang harga belinya belum dimasukkan. Belum dipotong = belum ada yang dipotong, belum ada angka.',
  },
  status_komponen: {
    judul: 'Status komponen',
    artinya: 'Final = biaya komponen ini sudah tercatat semua. Berjalan = sebagian belum. Menunggu harga = harga beli LOT belum diisi. Belum tercatat = biaya lain yang belum ada catatannya. Sementara = overhead bulan berjalan.',
  },

  // ─── Tab Detail PO ─────────────────────────────────────────────────────────
  tab_komponen: {
    judul: 'Per Komponen',
    artinya: 'Biaya PO ini dipecah per komponen HPP (kain, aksesori, bahan pembantu, upah per tahap, overhead). Lihat kolom Hemat/Boros untuk tahu komponen mana yang membuat biaya naik/turun.',
  },
  tab_qty: {
    judul: 'Qty Pesan vs Potong',
    artinya: 'Membandingkan jumlah pesan, dipotong, dan dikirim per artikel/warna/size. Berguna untuk mencari kurang potong.',
  },
  tab_rincian: {
    judul: 'Rincian Aktual',
    artinya: 'Daftar catatan biaya yang membentuk angka Aktual: pemakaian bahan, upah, overhead — lengkap dengan tanggalnya.',
  },
  tab_hpp_size: {
    judul: 'HPP per Size',
    artinya: 'Biaya aktual sejauh ini dibagi per warna & size, sehingga terlihat HPP per pcs tiap size. Overhead dibagi rata per pcs. Upah tahap yang belum dikerjakan belum termasuk.',
  },

  // ─── Kinerja Keuangan: periode & kolom ─────────────────────────────────────
  periode_kinerja: {
    judul: 'Periode',
    artinya: '"Sejak awal" = semua bulan sejak pencatatan periode baru, ditambah perkiraan order yang belum dikirim. Pilih satu bulan = hanya barang yang DIKIRIM di bulan itu (aktual), tanpa perkiraan.',
  },
  sudah_dikirim: {
    judul: 'Sudah dikirim (aktual)',
    artinya: 'Angka dari barang yang sudah benar-benar dikirim ke pelanggan. Ini laba yang sudah "terjadi".',
    sumber: 'Pengiriman (Surat Jalan)',
  },
  order_berjalan: {
    judul: 'Order berjalan (perkiraan)',
    artinya: 'Barang yang sudah dipotong tapi belum dikirim. Pendapatan & biayanya masih perkiraan, dengan anggapan semua barang nanti terkirim tanpa reject.',
    rumus: 'Pendapatan = nilai jual yang belum dikirim. Biaya = biaya per pcs PO × pcs yang belum dikirim.',
    sumber: 'Cutting, Purchase Order & mesin hitung Laporan Per PO',
  },

  // ─── Laba rugi ─────────────────────────────────────────────────────────────
  pendapatan: {
    judul: 'Pendapatan',
    artinya: 'Nilai barang yang sudah dikirim ke pelanggan, dihitung saat Surat Jalan dibuat (jumlahnya dicocokkan dengan validasi kantor), ditambah pendapatan lain di Buku Kas. DP dari pelanggan BELUM dihitung pendapatan — baru jadi pendapatan saat barangnya dikirim.',
    rumus: 'Nilai Surat Jalan + pendapatan lain − Retur & Reject.',
    sumber: 'Pengiriman (Surat Jalan), Buku Kas',
  },
  nilai_penjualan: {
    judul: 'Nilai penjualan',
    artinya: 'Total nilai jual semua barang: yang sudah dikirim (aktual) ditambah yang masih di produksi (order berjalan). Angka kecil di bawahnya = bagian yang sudah dikirim.',
    rumus: 'Pendapatan sudah dikirim + pendapatan order berjalan.',
  },
  retur_reject: {
    judul: 'Retur & Reject',
    artinya: 'Barang yang dikembalikan kantor karena reject, mengurangi pendapatan di tanggal reject dilaporkan. Bila barang diperbaiki & diterima lagi (kirim ulang), atau dibeli kantor dengan harga lebih murah, nilainya pulih di tanggal itu.',
    sumber: 'Laporan Reject Kantor',
  },
  bahan_baku: {
    judul: 'Bahan baku',
    artinya: 'Kain, puring, sleting dan aksesori yang terpakai untuk barang yang dijual, dengan harga beli (FIFO). Bahan yang dibeli tapi belum dipakai TIDAK masuk sini — itu masih persediaan (aset).',
    rumus: 'Biaya bahan per pcs PO × pcs yang dikirim.',
    sumber: 'Stok Bahan, Cutting',
  },
  upah_produksi: {
    judul: 'Upah produksi',
    artinya: 'Upah borongan per tahap (cutting, jahit, lubang kancing, QC, steam, packing) untuk barang yang dijual — yang sudah dibayar, yang sudah dikerjakan tapi belum dibayar, dan perkiraan upah tahap yang belum dikerjakan (tarif HPP).',
    rumus: 'Upah per pcs PO × pcs yang dikirim.',
    sumber: 'Laporan Gaji',
  },
  hpp_lr: {
    judul: 'Harga pokok penjualan (HPP)',
    artinya: 'Total biaya untuk membuat barang yang SUDAH dijual. Ini biaya sebenarnya, bukan patokan di sheet HPP. Biaya barang yang belum dikirim belum masuk sini — masih "barang dalam proses" (aset).',
    rumus: 'Bahan baku + Upah produksi + Overhead produksi.',
  },
  laba_kotor: {
    judul: 'Laba kotor',
    artinya: 'Sisa uang penjualan setelah menutup biaya produksi. Persentase di bawahnya (margin kotor) menunjukkan seberapa efisien produksi.',
    rumus: 'Pendapatan − HPP. Margin kotor = Laba kotor ÷ Pendapatan × 100%.',
  },
  overhead_tanpa_produksi: {
    judul: 'Overhead bulan tanpa produksi',
    artinya: 'Overhead pada hari-hari tanpa barang di produksi (belum ada yang selesai cutting, atau semua sudah selesai packing). Karena tidak ada barang yang bisa menanggungnya, biaya hari itu langsung jadi beban bulan itu.',
    sumber: 'Biaya Overhead',
  },
  beban_operasional: {
    judul: 'Beban operasional',
    artinya: 'Biaya di luar produksi (kategori Biaya Operasional & Lainnya di Buku Kas), dibebankan di bulan terjadinya.',
    sumber: 'Buku Kas',
  },
  beban_usaha: {
    judul: 'Beban usaha',
    artinya: 'Biaya yang tidak ikut ke barang, langsung mengurangi laba bulan itu.',
    rumus: 'Overhead bulan tanpa produksi + Beban operasional.',
  },
  laba_bersih: {
    judul: 'Laba bersih',
    artinya: 'Keuntungan usaha setelah semua biaya (sebelum pajak). Persentase di bawahnya (margin bersih) = berapa rupiah untung dari tiap Rp 100 penjualan.',
    rumus: 'Laba kotor − Beban usaha. Margin bersih = Laba bersih ÷ Pendapatan × 100%.',
  },

  // ─── Posisi aset & kewajiban ───────────────────────────────────────────────
  persediaan_bahan: {
    judul: 'Persediaan bahan baku',
    artinya: 'Nilai kain & bahan baku yang sudah dibeli tapi belum dipotong. Masih milik usaha (aset), belum jadi biaya.',
    rumus: 'Sisa tiap LOT × harga beli LOT itu.',
    sumber: 'Stok Bahan',
  },
  persediaan_pembantu: {
    judul: 'Persediaan bahan pembantu',
    artinya: 'Nilai benang, kancing, plastik, label dll. yang menurut catatan masih ada di rak (belum terpakai jatah HPP). Terdiri dari barang lama (setoran modal barang) dan belanja baru.',
    sumber: 'Saldo Bahan Pembantu',
  },
  barang_dalam_proses: {
    judul: 'Barang dalam proses',
    artinya: 'Biaya yang SUDAH keluar untuk barang yang belum dikirim (masih di produksi atau gudang). Akan jadi HPP saat barangnya dikirim.',
    rumus: '(Kain + aksesori + upah yang sudah dikerjakan) × bagian yang belum dikirim + overhead yang belum ikut terkirim. Upah tahap yang belum dikerjakan tidak termasuk.',
  },
  piutang: {
    judul: 'Piutang usaha',
    artinya: 'Uang yang masih harus dibayar pelanggan: barang sudah dikirim, pembayarannya belum masuk.',
    rumus: 'Nilai semua Surat Jalan (dipotong reject) − semua uang dari pelanggan di Buku Kas. Muncul bila hasilnya plus.',
    sumber: 'Pengiriman, Buku Kas',
  },
  uang_muka: {
    judul: 'Uang muka pelanggan',
    artinya: 'DP yang sudah diterima untuk barang yang belum dikirim. Ini masih "utang barang" ke pelanggan, belum jadi pendapatan. Akan lunas sendiri saat barang dikirim.',
    rumus: 'Semua uang dari pelanggan − nilai semua Surat Jalan. Muncul bila hasilnya plus (kebalikan Piutang).',
    sumber: 'Buku Kas, Pengiriman',
  },
  upah_terutang: {
    judul: 'Upah terutang',
    artinya: 'Upah pekerjaan yang sudah selesai dikerjakan tapi belum dibayar ke penjahit / tim.',
    sumber: 'Laporan Gaji',
  },
  total_aset: {
    judul: 'Total aset (di luar kas)',
    artinya: 'Semua yang dimiliki usaha selain uang tunai. Saldo kas tidak ditampilkan karena saldo awal sebelum periode baru belum tercatat. Sisa kontrak sewa juga tidak dihitung aset.',
    rumus: 'Persediaan bahan baku + Persediaan bahan pembantu + Barang dalam proses + Piutang.',
  },
  total_kewajiban: {
    judul: 'Total kewajiban',
    artinya: 'Semua yang masih harus diberikan usaha: barang untuk DP yang sudah diterima, dan upah yang belum dibayar.',
    rumus: 'Uang muka pelanggan + Upah terutang.',
  },

  // ─── Arus kas ──────────────────────────────────────────────────────────────
  arus_kas: {
    judul: 'Arus kas',
    artinya: 'Uang yang benar-benar masuk & keluar di Buku Kas. Beda dengan laba: beli bahan langsung mengurangi kas tapi baru jadi biaya saat dipakai; DP langsung menambah kas tapi baru jadi pendapatan saat barang dikirim.',
    sumber: 'Buku Kas',
  },
  setoran_modal: {
    judul: 'Setoran modal pemilik',
    artinya: 'Uang dari pemilik yang dimasukkan ke usaha. Menambah kas, tapi BUKAN pendapatan dan tidak menambah laba.',
    sumber: 'Buku Kas',
  },
  arus_kas_bersih: {
    judul: 'Arus kas bersih',
    artinya: 'Apakah uang tunai bertambah (plus) atau berkurang (minus) pada periode ini. Kumulatif = jumlah dari bulan pertama sampai bulan itu.',
    rumus: 'Total kas masuk − Total kas keluar.',
  },

  // ─── Laba per PO (Kinerja) ─────────────────────────────────────────────────
  status_kirim: {
    judul: 'Status kirim',
    artinya: 'Produksi = belum ada yang dikirim. Terkirim sebagian = sebagian sudah dikirim. Terkirim semua = semua pcs dipotong sudah dikirim dan tidak ada upah tahap yang tersisa.',
  },
  potong_kirim: {
    judul: 'Potong / kirim',
    artinya: 'Jumlah pcs yang sudah dipotong / jumlah pcs yang sudah dikirim.',
    sumber: 'Cutting, Pengiriman',
  },
  dp_diterima: {
    judul: 'DP diterima',
    artinya: 'Uang dari pelanggan di Buku Kas yang ditandai untuk PO ini (DP & pelunasan).',
    sumber: 'Buku Kas',
  },
  po_bahan: {
    judul: 'Bahan (per PO)',
    artinya: 'Biaya bahan untuk SEMUA pcs dipotong di PO ini: kain + aksesori yang sudah tercatat + perkiraan aksesori yang belum tercatat.',
    sumber: 'Stok Bahan, Master HPP',
  },
  po_upah: {
    judul: 'Upah (per PO)',
    artinya: 'Upah sudah dibayar + sudah dikerjakan tapi belum dibayar + perkiraan upah tahap yang belum dikerjakan (tarif HPP).',
    sumber: 'Laporan Gaji, Master HPP',
  },
  po_overhead: {
    judul: 'Overhead (per PO)',
    artinya: 'Bagian overhead produksi yang ditanggung PO ini (metode pcs-hari) + bahan pembantu yang terpakai + perkiraan bahan pembantu untuk pcs yang belum dijahit.',
    sumber: 'Biaya Overhead, Saldo Bahan Pembantu',
  },

  // ─── Ringkasan ─────────────────────────────────────────────────────────────
  tren_bulanan: {
    judul: 'Tren per bulan',
    artinya: 'Pendapatan (hijau), HPP (kuning) dan Laba bersih (garis biru) 6 bulan terakhir, hanya dari barang yang sudah dikirim. Bila batang kuning mendekati batang hijau, untungnya menipis.',
  },
  melebihi_patokan: {
    judul: 'PO melebihi patokan HPP',
    artinya: 'PO yang biaya produksinya (aktual + sisa perkiraan) lebih besar dari patokan sheet HPP — sama dengan "Boros" di Laporan Per PO. Selisih karena tarif upah HPP berubah tidak dihitung. Belum tentu rugi: cek labanya.',
    rumus: '(Aktual + Sisa) − Perkiraan biaya.',
    sumber: 'Laporan Per PO',
  },

  // ─── Buku Kas ──────────────────────────────────────────────────────────────
  kas_masuk: {
    judul: 'Total Masuk',
    artinya: 'Semua uang yang masuk pada bulan/filter yang dipilih: DP & pelunasan klien, pendapatan lain, setoran modal uang. Setoran modal barang (sisa bahan lama) tidak dihitung karena bukan uang.',
    rumus: 'Jumlah semua baris Masuk yang tampil.',
  },
  kas_keluar: {
    judul: 'Total Keluar',
    artinya: 'Semua uang yang keluar pada bulan/filter yang dipilih: belanja bahan, bahan pembantu, gaji, overhead, lainnya.',
    rumus: 'Jumlah semua baris Keluar yang tampil.',
  },
  saldo_kas_periode: {
    judul: 'Saldo Kas',
    artinya: 'Selisih uang masuk dan keluar HANYA untuk bulan/filter yang sedang dipilih — bukan isi dompet/rekening saat ini. Minus berarti bulan itu lebih banyak uang keluar daripada masuk. Saldo awal sebelum periode baru tidak tercatat.',
    rumus: 'Total Masuk − Total Keluar.',
  },
  kategori_kas: {
    judul: 'Kategori',
    artinya: 'Jenis transaksi. Kategori menentukan ke mana angkanya mengalir: Pembelian Bahan → persediaan (Stok Bahan); Bahan Pembantu → Saldo Bahan Pembantu; Biaya Overhead → Biaya Overhead & HPP; Pembayaran Gaji → Laporan Gaji; DP/Pelunasan Klien → piutang/uang muka; Setoran Modal → modal, bukan pendapatan; Lainnya → beban operasional.',
  },
  tag_po: {
    judul: 'Tag ke PO',
    artinya: 'Menandai transaksi untuk PO tertentu. DP/pelunasan bertanda PO masuk kolom "DP diterima" PO itu; biaya overhead bertanda PO dibebankan langsung ke PO itu (tidak dibagi ke PO lain).',
    sumber: 'Kinerja Keuangan, Laporan Per PO',
  },
  modal_barang: {
    judul: 'Setoran modal barang',
    artinya: 'Sisa bahan lama milik pemilik yang dimasukkan ke usaha. Dicatat sebagai pasangan Setoran Modal (masuk) + Pembelian Bahan (keluar) dengan nilai sama, jadi saldo kas tidak berubah — tidak ada uang yang benar-benar berpindah.',
  },
  gaji_otomatis: {
    judul: 'Baris gaji otomatis',
    artinya: 'Pembayaran gaji dicatat otomatis dari menu Gaji dan disatukan satu baris per tanggal bayar. Klik untuk melihat rincian per orang. Perbaikan dilakukan di menu Gaji, bukan di sini.',
    sumber: 'Gaji',
  },
  rekap_overhead_sub: {
    judul: 'Overhead per sub-kelompok',
    artinya: 'Jumlah uang Biaya Overhead yang keluar pada bulan ini, dikelompokkan per sub-kelompok (listrik, sewa, bensin, dll). "Tanpa sub-kelompok" perlu dirapikan di menu Biaya Overhead.',
  },

  // ─── Saldo Bahan Pembantu ──────────────────────────────────────────────────
  belanja_pembantu: {
    judul: 'Belanja bahan pembantu',
    artinya: 'Uang yang dibelanjakan untuk benang, kancing, plastik, label, dll. (kategori Bahan Pembantu di Buku Kas), ditambah bahan variasi yang dipotong dari stok kain sendiri.',
    sumber: 'Buku Kas',
  },
  jatah_hpp: {
    judul: 'Jatah HPP',
    artinya: 'Nilai bahan pembantu yang dianggap terpakai menurut patokan HPP. Dihitung saat barang selesai dijahit. Ini yang menjadi biaya produksi, bukan uang belanjanya.',
    rumus: 'Tarif bahan pembantu per pcs (sheet HPP) × pcs selesai jahit, per artikel.',
    sumber: 'Master HPP & Jahit',
  },
  pcs_dijahit: {
    judul: 'Pcs dijahit',
    artinya: 'Jumlah pcs yang sudah selesai jahit dan memakai bahan jenis ini. Angka kecil di bawahnya = tarif HPP per pcs; klik untuk rincian per artikel.',
    sumber: 'Jahit',
  },
  saldo_rak: {
    judul: 'Saldo / Persediaan di rak (catatan)',
    artinya: 'Nilai bahan pembantu yang SEHARUSNYA masih ada di rak menurut catatan. Tidak pernah minus. Karena tarif HPP sengaja dibuat sedikit di atas pemakaian nyata, isi rak sebenarnya biasanya sedikit lebih banyak.',
    rumus: '(Barang lama + Belanja) − Jatah HPP, dihitung urut tanggal.',
  },
  penghematan_pembantu: {
    judul: 'Penghematan',
    artinya: 'Jatah HPP yang tidak perlu dibelanjakan: saat jatah lebih besar dari saldo yang ada, kelebihannya dicatat sebagai penghematan (tambahan margin) dan sifatnya permanen — belanja berikutnya tidak menutupnya. Contoh: kancing dibawa klien, atau pemakaian lebih irit dari patokan.',
    rumus: 'Jatah HPP − saldo yang tersedia saat itu (bila hasilnya plus).',
  },
  barang_lama: {
    judul: 'Barang lama (saldo awal)',
    artinya: 'Bahan pembantu yang sudah ada di rak sebelum periode baru, dicatat dengan harga perkiraan sebagai setoran modal berupa barang. Tidak lewat Buku Kas. Jatah HPP menghabiskan barang lama lebih dulu, baru belanja baru.',
  },
  peringatan_belanja: {
    judul: 'Belanja saat saldo masih banyak ⚠',
    artinya: 'Belanja dilakukan padahal saldo sebelum belanja lebih besar dari jatah HPP 2 minggu terakhir. Bisa berarti tarif HPP kemurahan (pemakaian nyata lebih besar) atau belanja terlalu dini.',
  },

  // ─── Biaya Overhead ────────────────────────────────────────────────────────
  pcs_terkirim_oh: {
    judul: 'Pcs terkirim',
    artinya: 'Jumlah pcs yang dikirim lewat Surat Jalan pada rentang tanggal ini. Menjadi dasar patokan overhead.',
    sumber: 'Pengiriman (Surat Jalan)',
  },
  patokan_oh: {
    judul: 'Patokan HPP (overhead)',
    artinya: 'Uang overhead yang "boleh" keluar menurut sheet HPP untuk barang yang dikirim pada rentang ini.',
    rumus: 'Tarif overhead per pcs di HPP × pcs terkirim, per komponen.',
    sumber: 'Master HPP & Surat Jalan',
  },
  realisasi_oh: {
    judul: 'Realisasi',
    artinya: 'Uang overhead yang benar-benar keluar di Buku Kas pada rentang ini (dan ditanggung komponen HPP). Biaya kontrak (mis. sewa rumah) tidak dihitung saat dibayar, tetapi dibagi rata per hari selama masa kontrak.',
    sumber: 'Buku Kas & Biaya Tetap',
  },
  selisih_oh: {
    judul: 'Selisih (Hemat / Boros)',
    artinya: 'Hemat = uang overhead yang keluar lebih kecil dari patokan HPP; Boros = lebih besar. Bila belum ada barang dikirim, patokannya Rp 0 sehingga tampil Boros — itu belum berarti boros.',
    rumus: 'Patokan HPP − Realisasi.',
  },
  komponen_oh: {
    judul: 'Per komponen HPP',
    artinya: 'Overhead dikelompokkan sesuai komponen di sheet HPP. Batang = realisasi dibanding patokannya; batang merah penuh = melewati patokan. Klik untuk melihat sub-kelompok dan transaksinya.',
  },
  luar_hpp: {
    judul: 'Di luar patokan HPP',
    artinya: 'Overhead yang tetap keluar uang tetapi tidak punya jatah di sheet HPP. Tidak ikut dibandingkan dengan patokan, tapi tetap mengurangi laba.',
  },
  biaya_lain: {
    judul: 'Biaya lain',
    artinya: 'Pengeluaran kategori Biaya Operasional & Lainnya di Buku Kas — bukan overhead produksi. Di Kinerja Keuangan masuk Beban operasional.',
    sumber: 'Buku Kas',
  },
  biaya_tetap: {
    judul: 'Biaya tetap (kontrak)',
    artinya: 'Biaya yang dibayar sekaligus untuk jangka panjang (mis. kontrak rumah setahun). Supaya satu bulan tidak terlihat sangat boros, nilainya dibagi rata per hari selama masa kontrak. Sisa kontrak yang belum terpakai tidak dihitung sebagai aset.',
    rumus: 'Nilai kontrak ÷ jumlah hari kontrak × hari yang masuk rentang laporan.',
  },
  tren_overhead: {
    judul: 'Tren 6 bulan',
    artinya: 'Batang biru = uang overhead yang keluar per bulan; garis oranye = patokan HPP × pcs terkirim bulan itu. Batang di atas garis = bulan itu boros.',
  },
  perlu_dirapikan: {
    judul: 'Perlu dirapikan',
    artinya: 'Entri Biaya Overhead di Buku Kas (sejak 14 Nov 2026) yang belum diberi sub-kelompok, sehingga belum bisa dimasukkan ke komponen HPP yang tepat.',
  },

  // ─── Jurnal Produksi ───────────────────────────────────────────────────────
  jurnal_kain: {
    judul: 'Kain (cutting)',
    artinya: 'Nilai kain yang dipakai saat bundle selesai dipotong, memakai harga beli LOT kain yang terpakai (FIFO). Kain sisa yang dipakai ulang ditandai "(kain sisa)".',
    rumus: 'Qty kain terpakai × harga LOT-nya.',
    sumber: 'Cutting, Stok Bahan',
  },
  jurnal_aksesori_pembantu: {
    judul: 'Aksesori & Pembantu',
    artinya: 'Gabungan dua hal: (1) aksesori yang terpakai per bundle (puring, sleting, dll.) dan (2) JATAH bahan pembantu (kancing, karet, velcro, dll.) untuk pcs yang selesai dijahit, sebesar yang tertutup Saldo Bahan Pembantu. Jatah yang tidak tertutup saldo = penghematan (Rp 0). Uang belanja bahan pembantu hanya informasi — sama seperti Kinerja Keuangan.',
    rumus: 'Pemakaian aksesori × harga + jatah HPP bahan pembantu yang terpakai dari saldo.',
    sumber: 'Produksi (pemakaian aksesori & selesai jahit), Saldo Bahan Pembantu',
  },
  jurnal_belanja_pembantu: {
    judul: 'Belanja bahan pembantu (informasi)',
    artinya: 'Uang belanja bahan pembantu bertanda jenis di Buku Kas. Ditampilkan abu-abu saja: belanja ini menambah Saldo Bahan Pembantu, dan baru menjadi biaya lewat jatah HPP saat pcs selesai dijahit.',
    sumber: 'Buku Kas, Saldo Bahan Pembantu',
  },
  jurnal_upah: {
    judul: 'Upah',
    artinya: 'Upah borongan yang tercatat untuk pekerjaan PO periode baru, baik yang sudah maupun belum dibayar. Potongan upah karena reject tampil sebagai angka minus (merah).',
    rumus: 'Upah selesai + rework + pengembalian rework − potongan reject, menurut tanggal pekerjaan.',
    sumber: 'Laporan Gaji',
  },
  jurnal_overhead: {
    judul: 'Overhead',
    artinya: 'Biaya Overhead & Biaya Peralatan dari Buku Kas (termasuk bahan pembantu tanpa jenis) ditambah Biaya Tetap (kontrak yang dibagi rata per hari, sampai hari ini). Biaya Operasional & Lainnya TIDAK di sini — itu beban di luar produksi.',
    rumus: 'Overhead Buku Kas + Biaya Tetap.',
    sumber: 'Buku Kas, Biaya Overhead',
  },
  jurnal_operasional: {
    judul: 'Beban operasional (di luar produksi)',
    artinya: 'Biaya kategori Biaya Operasional & Lainnya di Buku Kas (mis. administrasi, transport kantor). Bukan biaya membuat barang, jadi tidak ikut Total Biaya Produksi; di Kinerja Keuangan muncul sebagai Beban operasional di bulan terjadinya.',
    sumber: 'Buku Kas',
  },
  jurnal_total: {
    judul: 'Total Biaya Produksi',
    artinya: 'Jumlah empat kartu biaya produksi pada rentang tanggal terpilih. Tidak ikut: pembelian bahan & belanja bahan pembantu (masuk stok/saldo dulu) serta beban operasional (di luar produksi).',
    rumus: 'Kain + Aksesori & Pembantu + Upah + Overhead.',
  },
  jurnal_penghubung: {
    judul: 'Dari Jurnal ke Laba Rugi',
    artinya: 'Jurnal mencatat biaya saat TERJADI; Laba Rugi baru memakai biaya saat barangnya DIKIRIM (HPP). Selisih keduanya pada dasarnya biaya yang masih menempel di barang yang belum dikirim (barang dalam proses).',
    rumus: 'Total Biaya Produksi − HPP barang terkirim − overhead tanpa produksi = selisih ≈ perubahan barang dalam proses. Perkiraan, karena HPP barang terkirim juga memuat biaya bulan sebelumnya dan perkiraan upah/bahan pembantu tahap yang belum dikerjakan.',
    sumber: 'Jurnal Produksi, Kinerja Keuangan',
  },
  jurnal_jenis: {
    judul: 'Jenis baris',
    artinya: 'Asal setiap baris jurnal. Semua baris dibuat otomatis dari menu asalnya — tidak ada yang diketik di sini. Arahkan kursor ke label jenis untuk melihat sumbernya. Untuk membetulkan angka, ubah di menu asalnya.',
  },
  jurnal_pembelian: {
    judul: 'Pembelian (informasi)',
    artinya: 'Belanja kain/aksesori kategori Pembelian Bahan di Buku Kas. Ditampilkan sebagai informasi (abu-abu) saja: barangnya masuk stok dulu, dan baru menjadi biaya di baris Kain/Aksesori saat dipakai.',
    sumber: 'Buku Kas, Stok Masuk',
  },

  // ─── Invoice & Tagihan ─────────────────────────────────────────────────────
  invoice_otomatis: {
    judul: 'Invoice',
    artinya: 'Tagihan ke klien yang dibuat otomatis setiap kali Surat Jalan biasa diterbitkan (satu Surat Jalan = satu invoice). Surat Jalan Kirim Ulang tidak membuat invoice baru.',
    sumber: 'Pengiriman (Surat Jalan)',
  },
  total_tagihan: {
    judul: 'Total Tagihan',
    artinya: 'Nilai yang ditagih ke klien untuk satu Surat Jalan. Bila ada reject dari kantor yang belum dikirim ulang, tulisan merah kecil di bawahnya menunjukkan potongannya.',
    rumus: 'Σ (pcs dikirim × harga jual produk) − potongan reject kantor.',
    sumber: 'Pengiriman (Surat Jalan), Reject Kantor',
  },
  potongan_reject: {
    judul: 'Potongan reject',
    artinya: 'Barang yang dikembalikan kantor (reject) dan belum dikirim ulang memotong tagihan. Saat barangnya diperbaiki dan dikirim ulang, potongannya hilang lagi. Bila ditandai "tidak bisa diperbaiki", potongan menjadi permanen.',
    rumus: 'Sisa pcs reject × harga jual.',
    sumber: 'Reject Kantor',
  },
  terbayar_invoice: {
    judul: 'Terbayar',
    artinya: 'Jumlah pembayaran yang dicatat lewat tombol "Catat Pembayaran" di menu ini. Catatan ini hanya untuk melacak tagihan — tidak otomatis masuk Buku Kas.',
    sumber: 'Invoice & Tagihan',
  },
  sisa_invoice: {
    judul: 'Sisa',
    artinya: 'Bagian tagihan yang belum dibayar klien. Merah = masih ada sisa, hijau = sudah nol.',
    rumus: 'Total Tagihan − Terbayar.',
  },
  status_invoice: {
    judul: 'Status invoice',
    artinya: 'Belum Bayar = belum ada pembayaran. DP / Sebagian = sudah dibayar sebagian. Lunas = pembayaran sudah menutup tagihan. Status berubah sendiri setiap kali pembayaran dicatat atau dihapus.',
  },
  piutang_invoice: {
    judul: 'Total Piutang Aktif',
    artinya: 'Jumlah sisa tagihan dari semua invoice yang belum lunas di daftar ini (mengikuti filter bulan/klien/status yang dipilih).',
    rumus: 'Σ Sisa invoice berstatus Belum Bayar dan DP / Sebagian.',
  },
  lunas_invoice: {
    judul: 'Total Lunas',
    artinya: 'Jumlah tagihan dari invoice yang sudah lunas di daftar ini.',
    rumus: 'Σ Total Tagihan invoice berstatus Lunas.',
  },
  jumlah_invoice: {
    judul: 'Total Invoice',
    artinya: 'Banyaknya invoice di daftar ini sesuai filter. Invoice PO lama (sebelum periode baru) tidak ditampilkan.',
  },

  // ─── Laporan Gaji ──────────────────────────────────────────────────────────
  upah_sudah_bayar: {
    judul: 'Upah sudah dibayar',
    artinya: 'Upah pekerjaan pada bulan terpilih yang sudah dibayar ke karyawan. Dikelompokkan menurut TANGGAL PEKERJAAN, bukan tanggal bayar — jadi upah kerja akhir Oktober yang dibayar awal November masuk ke Oktober.',
    rumus: 'Upah selesai + rework − potongan reject, berstatus lunas.',
    sumber: 'Penggajian (Rekap Gaji)',
  },
  upah_belum_bayar: {
    judul: 'Upah belum dibayar',
    artinya: 'Upah pekerjaan yang sudah selesai dikerjakan tapi belum dibayar. Ini utang ke karyawan; di Kinerja Keuangan muncul sebagai Upah terutang.',
    rumus: 'Upah selesai + rework − potongan reject, berstatus belum lunas.',
    sumber: 'Penggajian (Rekap Gaji)',
  },
  kasbon: {
    judul: 'Kasbon outstanding',
    artinya: 'Pinjaman karyawan yang belum lunas, per hari ini (tidak ikut filter bulan dan tidak ikut aturan PO periode baru). Kasbon bukan biaya produksi — uangnya akan kembali lewat potongan gaji.',
    rumus: 'Σ kasbon berstatus belum lunas.',
    sumber: 'Penggajian (Kasbon)',
  },
  history_gaji: {
    judul: 'History Pembayaran',
    artinya: 'Daftar setiap kali gaji dibayarkan, menurut TANGGAL BAYAR pada bulan terpilih. Jumlahnya adalah uang yang benar-benar diterima karyawan (sudah termasuk gaji pokok dan dikurangi potongan kasbon), jadi bisa berbeda dengan kartu Upah sudah dibayar.',
    sumber: 'Penggajian, Buku Kas',
  },

  // ─── Laporan Reject Kantor ─────────────────────────────────────────────────
  nilai_reject: {
    judul: 'Nilai Reject',
    artinya: 'Nilai semua barang yang dikembalikan kantor karena cacat, pada periode terpilih (menurut tanggal reject dilaporkan).',
    rumus: 'Pcs reject × harga di Surat Jalan.',
    sumber: 'Pengiriman → Reject Kantor',
  },
  pulih_reject: {
    judul: 'Sudah Pulih',
    artinya: 'Bagian nilai reject yang kembali menjadi uang: barang diperbaiki & dikirim ulang (pulih penuh), atau dibeli kantor dengan harga lebih murah (pulih sebesar harga belinya).',
    rumus: 'Pcs dikirim ulang × harga SJ + pcs dibeli kantor × harga beli kantor.',
  },
  gantung_reject: {
    judul: 'Masih Menggantung',
    artinya: 'Reject yang belum ada keputusannya (masih retur atau sedang diperbaiki). Nilai ini masih bisa pulih bila nanti dikirim ulang, atau menjadi kerugian bila tidak bisa diperbaiki.',
    rumus: 'Sisa pcs berstatus retur / diperbaiki × harga SJ.',
  },
  kerugian_pasti: {
    judul: 'Kerugian Pasti',
    artinya: 'Kerugian yang sudah tidak bisa kembali: barang yang tidak bisa diperbaiki (rugi penuh) dan selisih harga barang yang dibeli kantor lebih murah.',
    rumus: 'Pcs tidak bisa × harga SJ + pcs dibeli × (harga SJ − harga beli kantor).',
  },
  kerugian_bersih_reject: {
    judul: 'Kerugian Bersih Saat Ini',
    artinya: 'Total yang saat ini mengurangi pendapatan karena reject. Sama dengan baris Retur & Reject di Kinerja Keuangan (untuk kiriman PO periode baru).',
    rumus: 'Kerugian Pasti + Masih Menggantung (= Nilai Reject − Sudah Pulih).',
    sumber: 'Kinerja Keuangan',
  },
  dibeli_kantor: {
    judul: 'Dibeli kantor',
    artinya: 'Barang reject yang tidak dikembalikan, tetapi dibeli kantor dengan harga lebih murah. Kerugiannya hanya selisih harga.',
  },
  tidak_bisa_diperbaiki: {
    judul: 'Tidak bisa diperbaiki',
    artinya: 'Barang reject yang tidak bisa diperbaiki. Nilainya menjadi kerugian penuh dan potongan tagihannya permanen.',
  },
  tingkat_reject: {
    judul: 'Tingkat reject',
    artinya: 'Seberapa parah cacatnya: Minor, Mayor, atau Rusak parah — dipilih kantor saat mencatat reject. Berguna untuk melihat jenis cacat mana yang paling mahal.',
  },
  barang_lama_reject: {
    judul: 'Barang lama (di luar sistem)',
    artinya: 'Reject untuk barang yang dikirim sebelum memakai aplikasi ini, jadi tidak punya Surat Jalan. Tidak memotong invoice apa pun, tapi tetap dihitung kerugian.',
  },

  // ─── Laporan Potongan Reject ───────────────────────────────────────────────
  potongan_upah: {
    judul: 'Potongan upah',
    artinya: 'Upah yang dipotong dari karyawan yang dianggap bertanggung jawab atas barang reject (dicatat di menu Produksi → Reject). Besarnya mengikuti persen potongan alasan reject. Bila barangnya masih bisa diperbaiki (rework), potongan itu sifatnya DITAHAN dan dikembalikan saat rework selesai.',
    rumus: 'Persen potongan alasan reject × upah tahap karyawan itu untuk bundle tersebut. Bersih = potongan − pengembalian rework.',
    sumber: 'Produksi → Reject',
  },
  pengembalian_rework: {
    judul: 'Pengembalian rework',
    artinya: 'Potongan yang dikembalikan ke karyawan karena barangnya sudah selesai diperbaiki (tombol Selesai Rework di menu Produksi → Reject). Ditampilkan hijau dan mengurangi total potongan.',
    sumber: 'Produksi → Reject',
  },
  jumlah_kejadian: {
    judul: 'Jumlah Kejadian',
    artinya: 'Berapa kali potongan upah dicatat pada periode terpilih (pengembalian rework tidak dihitung sebagai kejadian). Satu kejadian = satu karyawan pada satu catatan reject.',
  },
  efek_potongan: {
    judul: 'Pengaruh ke keuangan',
    artinya: 'Potongan upah mengurangi biaya upah produksi (jadi menambah laba) dan mengurangi gaji yang dibayarkan ke karyawan pada pembayaran berikutnya.',
    sumber: 'Laporan Gaji, Jurnal Produksi',
  },
} satisfies Record<string, Istilah>;

export type KunciIstilah = keyof typeof KAMUS;
