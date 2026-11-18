'use client';

import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import type { KinerjaData, KinerjaPO, Transaksi } from '@/lib/keuangan/kinerja.server';

export type JenisRincian =
  | 'pendapatan' | 'bahan' | 'upah' | 'overhead' | 'hpp' | 'labaKotor'
  | 'overheadTanpaProduksi' | 'bebanOperasional' | 'labaBersih';

const idr = (n: number) => 'Rp ' + Math.round(n).toLocaleString('id-ID');
const angka = (n: number) => Math.round(n).toLocaleString('id-ID');
const tgl = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
const bln = (ym: string) => new Date(`${ym}-01T00:00:00`).toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });

const JUDUL: Record<JenisRincian, string> = {
  pendapatan: 'Pendapatan',
  bahan: 'Bahan baku',
  upah: 'Upah produksi',
  overhead: 'Overhead produksi',
  hpp: 'Harga pokok penjualan (HPP)',
  labaKotor: 'Laba kotor',
  overheadTanpaProduksi: 'Overhead bulan tanpa produksi',
  bebanOperasional: 'Beban operasional',
  labaBersih: 'Laba bersih',
};

const APA_INI: Record<JenisRincian, string> = {
  pendapatan:
    'Nilai barang yang sudah dikirim ke pelanggan, dicatat saat Surat Jalan dibuat dan dicocokkan dengan validasi kantor ' +
    '(dikurangi reject). DP dari pelanggan belum dihitung sebagai pendapatan — DP baru menjadi pendapatan saat barangnya dikirim.',
  bahan:
    'Kain, puring, sleting dan aksesori yang benar-benar terpakai saat dipotong, dihitung dengan harga beli (FIFO). ' +
    'Bahan yang dibeli tapi belum dipakai tidak masuk sini — itu masih persediaan (aset).',
  upah:
    'Upah borongan penjahit dan tim produksi per tahap (cutting, jahit, lubang kancing, QC, steam, packing). ' +
    'Termasuk upah yang sudah dibayar, yang sudah dikerjakan tapi belum dibayar, dan perkiraan upah tahap yang belum dikerjakan (tarif HPP).',
  overhead:
    'Biaya pendukung produksi yang tidak bisa ditempelkan langsung ke satu potong baju: sewa rumah produksi, listrik, ' +
    'makan, gaji staff, bensin, gas dan peralatan. Tiap bulan diratakan per hari, lalu biaya tiap hari dibagi ke barang ' +
    'yang sedang diproses hari itu (sejak selesai cutting sampai selesai packing), sebanding jumlah pcs × overhead HPP per pcs produknya. ' +
    'Barang yang lama di produksi ikut menanggung lebih banyak. ' +
    'Bahan pembantu (benang, kancing, karet, plastik, label) dan overhead bertanda PO (mis. sampel) langsung masuk ke PO-nya. ' +
    'Angka bulan berjalan masih sementara — final setelah bulan tutup.',
  hpp:
    'Total biaya untuk membuat barang yang dijual: bahan baku + upah produksi + overhead produksi. ' +
    'Biaya barang yang belum dikirim belum menjadi HPP — masih tercatat sebagai barang dalam proses (aset).',
  labaKotor:
    'Pendapatan dikurangi HPP. Menunjukkan berapa yang tersisa dari penjualan setelah menutup biaya produksi. ' +
    'Persentasenya (margin kotor) adalah ukuran efisiensi produksi.',
  overheadTanpaProduksi:
    'Overhead pada hari-hari tanpa barang dalam proses (belum ada yang selesai cutting atau semua sudah selesai packing). ' +
    'Karena tidak ada barang yang bisa menanggungnya, biaya hari itu langsung menjadi beban bulan itu.',
  bebanOperasional:
    'Biaya di luar produksi (kategori Biaya Operasional dan Lainnya di Buku Kas), dibebankan di bulan terjadinya.',
  labaBersih:
    'Laba kotor dikurangi beban usaha. Ini keuntungan usaha sebelum pajak. ' +
    'Persentasenya (margin bersih) adalah bagian dari setiap rupiah penjualan yang menjadi keuntungan.',
};

const Tabel = ({ kepala, baris, kaki }: { kepala: string[]; baris: React.ReactNode[][]; kaki?: React.ReactNode[] }) => (
  <div className="rounded-lg border border-[#2A2D31] overflow-x-auto">
    <table className="w-full text-xs">
      <thead className="bg-[#16181A] text-[#9aa0a6]">
        <tr>{kepala.map((k, i) => <th key={i} className={`px-2.5 py-2 font-medium whitespace-nowrap ${i ? 'text-right' : 'text-left'}`}>{k}</th>)}</tr>
      </thead>
      <tbody>
        {baris.map((b, i) => (
          <tr key={i} className="border-t border-[#2A2D31]">
            {b.map((c, j) => <td key={j} className={`px-2.5 py-1.5 ${j ? 'text-right font-mono whitespace-nowrap' : ''}`}>{c}</td>)}
          </tr>
        ))}
      </tbody>
      {kaki && (
        <tfoot className="border-t border-[#3c4043] font-bold">
          <tr>{kaki.map((c, j) => <td key={j} className={`px-2.5 py-2 ${j ? 'text-right font-mono whitespace-nowrap' : ''}`}>{c}</td>)}</tr>
        </tfoot>
      )}
    </table>
  </div>
);

const SubJudul = ({ children }: { children: React.ReactNode }) => (
  <p className="text-xs font-bold text-[#e8eaed] mt-4 mb-1.5">{children}</p>
);

function DaftarTransaksi({ rows }: { rows: Transaksi[] }) {
  if (!rows.length) return <p className="text-xs text-[#9aa0a6]">Tidak ada transaksi.</p>;
  return (
    <Tabel kepala={['Tanggal · keterangan', 'Nominal']}
      baris={rows.map(t => [
        <span key="k"><span className="text-[#9aa0a6]">{tgl(t.tanggal)}</span> · {t.keterangan || t.kategori}
          {t.sub && <span className="block text-[10px] text-[#9aa0a6]">{t.kategori} › {t.sub}</span>}</span>,
        idr(t.nominal),
      ])}
      kaki={['Total', idr(rows.reduce((s, t) => s + t.nominal, 0))]} />
  );
}

/** Ringkasan transaksi overhead per kelompok (kategori › sub-kelompok) */
function KelompokOverhead({ rows, sewa }: { rows: Transaksi[]; sewa: number }) {
  const m = new Map<string, number>();
  rows.forEach(t => {
    const k = t.kategori === 'Biaya Overhead' ? (t.sub ?? 'Overhead lain-lain')
      : t.kategori === 'Bahan Pembantu' && t.sub ? `Bahan pembantu — ${t.sub.toLowerCase()}` : t.kategori;
    m.set(k, (m.get(k) ?? 0) + t.nominal);
  });
  if (sewa > 0) m.set('Sewa rumah produksi (per hari)', sewa);
  const list = [...m.entries()].sort((a, b) => b[1] - a[1]);
  const total = list.reduce((s, [, n]) => s + n, 0);
  return (
    <Tabel kepala={['Kelompok', 'Nominal', '%']}
      baris={list.map(([k, n]) => [k, idr(n), total > 0 ? `${Math.round((n / total) * 100)}%` : '–'])}
      kaki={['Total', idr(total), '100%']} />
  );
}

export default function RincianDialog({ jenis, data, onClose }: {
  jenis: JenisRincian | null; data: KinerjaData; onClose: () => void;
}) {
  const semua = data.periode === 'semua';
  const poAda = data.po.filter(p => p.pcs > 0);
  const perPcs = (n: number, p: KinerjaPO) => (p.pcs > 0 ? n / p.pcs : 0);
  const sisa = (p: KinerjaPO) => Math.max(0, p.pcs - p.pcs_kirim);

  /** Tabel biaya per PO: total biaya, per pcs, bagian yang dibebankan (terkirim) & yang masih di proses */
  const tabelBiayaPo = (judulKolom: string[], ambil: (p: KinerjaPO) => number[], totalBiaya: (p: KinerjaPO) => number) => {
    const kepala = ['PO', ...judulKolom, 'Per pcs', 'Terkirim (HPP)', ...(semua ? ['Belum dikirim'] : [])];
    const baris = poAda.map(p => {
      const t = totalBiaya(p), pp = perPcs(t, p);
      return [
        <span key="po" className="font-mono">{p.no_po}<span className="block text-[10px] text-[#9aa0a6] font-sans">{angka(p.pcs)} pcs dipotong</span></span>,
        ...ambil(p).map(n => idr(n)), idr(pp),
        `${idr(pp * p.pcs_kirim_periode)}`,
        ...(semua ? [idr(pp * sisa(p))] : []),
      ];
    });
    const sum = (f: (p: KinerjaPO) => number) => idr(poAda.reduce((s, p) => s + f(p), 0));
    const kaki = ['Total', ...judulKolom.map((_, i) => sum(p => ambil(p)[i])), '',
      sum(p => perPcs(totalBiaya(p), p) * p.pcs_kirim_periode),
      ...(semua ? [sum(p => perPcs(totalBiaya(p), p) * sisa(p))] : [])];
    return <Tabel kepala={kepala} baris={baris} kaki={kaki} />;
  };

  const isi = (): React.ReactNode => {
    switch (jenis) {
      case 'pendapatan': {
        const sjPo = poAda.reduce((s, p) => s + p.nilai_kirim_periode, 0);
        const selisih = data.pendapatanSj - sjPo;
        return (<>
          <SubJudul>Barang terkirim per PO</SubJudul>
          <Tabel kepala={['PO', 'Pcs terkirim', 'Nilai terkirim', ...(semua ? ['Belum dikirim (perkiraan)'] : [])]}
            baris={poAda.map(p => [
              <span key="po" className="font-mono">{p.no_po}<span className="block text-[10px] text-[#9aa0a6] font-sans">{p.klien}</span></span>,
              angka(p.pcs_kirim_periode), idr(p.nilai_kirim_periode),
              ...(semua ? [idr(Math.max(0, p.nilai_jual - p.nilai_kirim))] : []),
            ])}
            kaki={['Total', angka(poAda.reduce((s, p) => s + p.pcs_kirim_periode, 0)), idr(sjPo),
              ...(semua ? [idr(poAda.reduce((s, p) => s + Math.max(0, p.nilai_jual - p.nilai_kirim), 0))] : [])]} />
          {Math.round(selisih) !== 0 && (
            <p className="text-xs text-[#9aa0a6] mt-2">
              Penyesuaian validasi kantor & potongan reject: <span className="font-mono">{idr(selisih)}</span>
              {' '}→ pendapatan dari Surat Jalan {idr(data.pendapatanSj)}.
            </p>
          )}
          {data.pendapatanBelumValidasi > 0 && (
            <p className="text-xs text-amber-300 mt-1">{idr(data.pendapatanBelumValidasi)} dari Surat Jalan yang belum divalidasi kantor (masih memakai qty kirim).</p>
          )}
          {data.rincian.pendapatanLain.length > 0 && (<>
            <SubJudul>Pendapatan lain (Buku Kas)</SubJudul>
            <DaftarTransaksi rows={data.rincian.pendapatanLain} />
          </>)}
        </>);
      }
      case 'bahan':
        return (<>
          <SubJudul>Bahan terpakai per PO</SubJudul>
          {tabelBiayaPo(['Kain', 'Aksesori', 'Perkiraan sisa'], p => [p.kain, p.aksesori, p.sisa_bahan], p => p.kain + p.aksesori + p.sisa_bahan)}
          <p className="text-[11px] text-[#9aa0a6] mt-2">Perkiraan sisa = HPP aksesori untuk pcs yang belum dipasang / masih menunggu harga LOT, dan biaya lain yang belum tercatat.</p>
        </>);
      case 'upah':
        return (<>
          <SubJudul>Upah per PO</SubJudul>
          {tabelBiayaPo(['Dibayar', 'Terutang', 'Perkiraan sisa'],
            p => [p.upah_lunas, p.upah_belum_lunas, p.upah_sisa],
            p => p.upah_lunas + p.upah_belum_lunas + p.upah_sisa)}
          <p className="text-[11px] text-[#9aa0a6] mt-2">Perkiraan sisa = tarif upah di HPP × pcs, untuk tahap yang belum dikerjakan.</p>
        </>);
      case 'overhead':
        return (<>
          {data.rincian.overheadBulan.map(o => (
            <div key={o.bulan}>
              <SubJudul>{bln(o.bulan)} — {idr(o.total)} untuk {o.hari} hari{o.sementara ? ' (sementara, s/d hari ini)' : ''}</SubJudul>
              <p className="text-[11px] text-[#9aa0a6] mb-1.5">
                {idr(o.teralokasi)} melekat ke barang dalam proses ({angka(o.pcsHari)} pcs-hari
                {o.pcsHari > 0 ? ` ≈ ${idr(o.teralokasi / o.pcsHari)}/pcs/hari` : ''})
                {o.tanpaProduksi > 0 ? ` · ${idr(o.tanpaProduksi)} beban bulan (${o.hariTanpaProduksi} hari tanpa produksi)` : ''}
              </p>
              <KelompokOverhead rows={o.transaksi} sewa={o.sewa.reduce((s, x) => s + x.nominal, 0)} />
              {o.sewa.map(s => (
                <p key={s.nama} className="text-[11px] text-[#9aa0a6] mt-1">
                  {s.nama}: {s.hari} hari ({tgl(s.dari)} – {tgl(s.sampai)}) × {idr(s.perHari)}/hari = {idr(s.nominal)}
                </p>
              ))}
              <details className="mt-2">
                <summary className="text-[11px] text-sky-300 cursor-pointer">Lihat {o.transaksi.length} transaksi Buku Kas</summary>
                <div className="mt-2"><DaftarTransaksi rows={o.transaksi} /></div>
              </details>
              {o.langsung.length > 0 && (
                <details className="mt-1">
                  <summary className="text-[11px] text-sky-300 cursor-pointer">
                    Langsung ke PO: {idr(o.langsung.reduce((s, t) => s + t.nominal, 0))} (bahan pembantu & overhead bertanda PO)
                  </summary>
                  <div className="mt-2"><DaftarTransaksi rows={o.langsung} /></div>
                </details>
              )}
            </div>
          ))}
          <SubJudul>Overhead yang melekat ke tiap PO</SubJudul>
          <Tabel kepala={['PO', 'Pcs-hari', 'Pembantu', 'Langsung', 'Total', 'Per pcs', 'Terkirim (HPP)', ...(semua ? ['Belum dikirim'] : []), 'Perkiraan pembantu']}
            baris={poAda.map(p => [
              <span key="po" className="font-mono">{p.no_po}<span className="block text-[10px] text-[#9aa0a6] font-sans">{angka(p.pcs)} pcs dipotong</span></span>,
              idr(p.overhead_alokasi), idr(p.overhead_pembantu), idr(p.overhead_langsung_kas), idr(p.overhead),
              idr(perPcs(p.overhead, p)), idr(p.overhead_kirim_periode),
              ...(semua ? [idr(Math.max(0, p.overhead - p.overhead_kirim))] : []),
              p.sisa_pembantu > 0.5 ? idr(p.sisa_pembantu) : '—',
            ])}
            kaki={['Total', ...([
              (p: KinerjaPO) => p.overhead_alokasi, (p: KinerjaPO) => p.overhead_pembantu, (p: KinerjaPO) => p.overhead_langsung_kas,
              (p: KinerjaPO) => p.overhead,
            ].map(f => idr(poAda.reduce((s, p) => s + f(p), 0)))), '',
              idr(poAda.reduce((s, p) => s + p.overhead_kirim_periode, 0)),
              ...(semua ? [idr(poAda.reduce((s, p) => s + Math.max(0, p.overhead - p.overhead_kirim), 0))] : []),
              idr(poAda.reduce((s, p) => s + p.sisa_pembantu, 0))]} />
          <p className="text-[11px] text-[#9aa0a6] mt-2">Perkiraan pembantu = jatah HPP bahan pembantu untuk pcs yang belum selesai jahit; ikut dihitung di laba PO, belum di persediaan.</p>
          {data.overheadSementara && (
            <p className="text-[11px] text-amber-300 mt-2">Sementara: overhead bulan berjalan dihitung s/d hari ini dan bisa berubah sampai bulan tutup.</p>
          )}
        </>);
      case 'hpp':
      case 'labaKotor':
      case 'labaBersih': {
        const k = data.lr.total;
        const baris: [string, number][] = jenis === 'hpp'
          ? [['Bahan baku', k.bahan], ['Upah produksi', k.upah], ['Overhead produksi', k.overheadProduksi], ['HPP', k.hpp]]
          : jenis === 'labaKotor'
          ? [['Pendapatan', k.pendapatan], ['HPP', -k.hpp], ['Laba kotor', k.labaKotor]]
          : [['Laba kotor', k.labaKotor], ['Beban usaha', -k.bebanUsaha], ['Laba bersih', k.labaBersih]];
        return (<>
          <SubJudul>Perhitungan ({semua ? 'total termasuk order berjalan' : bln(data.periode)})</SubJudul>
          <Tabel kepala={['', 'Nominal']} baris={baris.map(([l, n]) => [l, n < 0 ? `(${idr(-n)})` : idr(n)])} />
        </>);
      }
      case 'overheadTanpaProduksi':
        return (<>
          {data.rincian.overheadBulan.filter(o => o.tanpaProduksi > 0).map(o => (
            <div key={o.bulan}>
              <SubJudul>{bln(o.bulan)} — {idr(o.tanpaProduksi)} ({o.hariTanpaProduksi} hari tanpa barang dalam proses, dari total {idr(o.total)})</SubJudul>
              <KelompokOverhead rows={o.transaksi} sewa={o.sewa.reduce((s, x) => s + x.nominal, 0)} />
            </div>
          ))}
        </>);
      case 'bebanOperasional':
        return (<><SubJudul>Transaksi</SubJudul><DaftarTransaksi rows={data.rincian.bebanOperasional} /></>);
      default:
        return null;
    }
  };

  return (
    <Dialog open={!!jenis} onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="bg-[#1A1D1F] border-[#2A2D31] text-[#e8eaed] sm:max-w-[760px] max-h-[85vh] overflow-y-auto">
        {jenis && (<>
          <DialogHeader>
            <DialogTitle>{JUDUL[jenis]}</DialogTitle>
            <DialogDescription className="text-[#9aa0a6]">
              {semua ? `Sejak ${tgl(data.sejak)}` : bln(data.periode)}
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-lg bg-sky-500/5 border border-sky-500/20 p-3">
            <p className="text-[10px] uppercase tracking-widest text-sky-300 font-bold mb-1">Apa ini?</p>
            <p className="text-sm text-[#e8eaed] leading-relaxed">{APA_INI[jenis]}</p>
          </div>
          <div className="text-[#e8eaed]">{isi()}</div>
        </>)}
      </DialogContent>
    </Dialog>
  );
}
