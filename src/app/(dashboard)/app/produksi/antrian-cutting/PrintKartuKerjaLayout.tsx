'use client';

import React from 'react';
import type { AntrianBundle } from '@/lib/actions/produksi/antrian.actions';

export interface AksesoriItem {
  nama: string;
  qty_per_pcs: number;
  satuan: string;
  tahap_pakai: string;
}

export interface KartuBundle extends AntrianBundle {
  aksesori: AksesoriItem[];
  nama_penjahit?: string;
}

interface Props {
  bundles: KartuBundle[];
  tglCetak: string;
}

const s = {
  page: {
    fontFamily: 'Arial, sans-serif',
    fontSize: '10px',
    color: '#111',
    backgroundColor: '#fff',
    padding: '20px',
    boxSizing: 'border-box' as const,
    position: 'relative' as const,
  },
  headerDark: {
    backgroundColor: '#222',
    color: '#fff',
    padding: '6px',
    fontWeight: 'bold' as const,
    border: '1px solid #666',
    textAlign: 'center' as const,
  },
  headerLight: {
    backgroundColor: '#e8e8e8',
    color: '#111',
    padding: '4px',
    fontWeight: 'bold' as const,
    border: '1px solid #666',
  },
  cell: {
    border: '1px solid #999',
    padding: '4px 6px',
  },
  cellCenter: {
    border: '1px solid #999',
    padding: '4px 6px',
    textAlign: 'center' as const,
  },
  manualLine: {
    borderBottom: '1px solid #333',
    display: 'inline-block',
    width: '90%',
    height: '13px',
  },
  badgeBorder: {
    border: '1px solid #111',
    backgroundColor: '#fff',
    color: '#111',
    fontWeight: 'bold' as const,
    padding: '2px 4px',
    fontSize: '9px',
    display: 'inline-block',
    marginRight: '6px',
  },
  circleNum: {
    display: 'inline-block',
    width: '14px',
    height: '14px',
    backgroundColor: '#111',
    color: '#fff',
    borderRadius: '50%',
    textAlign: 'center' as const,
    lineHeight: '14px',
    fontSize: '9px',
    fontWeight: 'bold' as const,
    marginRight: '6px',
  }
};

export default function PrintKartuKerjaLayout({ bundles, tglCetak }: Props) {
  if (!bundles || bundles.length === 0) return null;

  return (
    <div className="kartu-kerja-print-root hidden print:block" style={{ backgroundColor: '#fff' }}>
      <style>{`
        @media print {
          @page { margin: 1cm; size: A4 portrait; }
          * {
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
            color-adjust: exact !important;
          }
          html, body {
            height: auto !important;
            overflow: visible !important;
            background: #fff !important;
          }
          /* Sembunyikan elemen dashboard */
          body * { visibility: hidden; }
          .kartu-kerja-print-root, .kartu-kerja-print-root * { visibility: visible; }
          .kartu-kerja-print-root {
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
          }
          .page-break {
            page-break-after: always;
            break-after: page;
          }
          table { border-collapse: collapse; width: 100%; }
        }
      `}</style>

      {bundles.map((bundle, index) => {
        const isLast = index === bundles.length - 1;
        
        return (
          <div key={bundle.id} className={isLast ? '' : 'page-break'} style={s.page}>
            {/* 1. Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
              <div>
                <div style={{ fontSize: '18px', fontWeight: '900', letterSpacing: '2px' }}>STITCHLYX</div>
                <div style={{ fontSize: '9px', color: '#555', marginBottom: '8px' }}>Sistem Manajemen Produksi Konveksi</div>
                <div style={{ fontSize: '16px', fontWeight: 'bold' }}>KARTU KERJA & SERAH TERIMA</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                {/* Simulasi Barcode Visual */}
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '2px', marginBottom: '4px', height: '30px' }}>
                  {[2, 4, 1, 3, 2, 5, 1, 2, 4, 2].map((w, i) => (
                    <div key={i} style={{ width: w + 'px', backgroundColor: '#111', height: '100%' }}></div>
                  ))}
                </div>
                <div style={{ fontSize: '12px', fontWeight: 'bold', fontFamily: 'monospace' }}>{bundle.barcode}</div>
                <div style={{ fontSize: '10px', color: '#555', marginTop: '4px' }}>No. Bundle: <span style={{ fontWeight: 'bold', color: '#111' }}>{bundle.no_urut}</span></div>
              </div>
            </div>

            {/* 2. Info Grid */}
            <table style={{ marginBottom: '16px', border: '2px solid #111' }}>
              <tbody>
                <tr>
                  <td style={{ ...s.headerLight, width: '33%' }}>No PO</td>
                  <td style={{ ...s.headerLight, width: '33%' }}>Klien</td>
                  <td style={{ ...s.headerLight, width: '33%' }}>Tgl Cetak</td>
                </tr>
                <tr>
                  <td style={{ ...s.cell, fontSize: '12px', fontWeight: 'bold' }}>{bundle.no_po}</td>
                  <td style={{ ...s.cell, fontSize: '12px', fontWeight: 'bold' }}>{bundle.klien_nama}</td>
                  <td style={{ ...s.cell, fontSize: '12px', fontWeight: 'bold' }}>{tglCetak}</td>
                </tr>
                <tr>
                  <td style={{ ...s.headerLight }}>Model</td>
                  <td style={{ ...s.headerLight }}>Warna / Size</td>
                  <td style={{ ...s.headerLight }}>QTY Bundle</td>
                </tr>
                <tr>
                  <td style={{ ...s.cell, fontSize: '12px', fontWeight: 'bold' }}>{bundle.model_nama ?? '-'}</td>
                  <td style={{ ...s.cell, fontSize: '12px', fontWeight: 'bold' }}>{bundle.warna} / {bundle.size}</td>
                  <td style={{ ...s.cellCenter, fontSize: '16px', fontWeight: '900' }}>{bundle.qty_per_bundle} <span style={{ fontSize: '10px', fontWeight: 'normal' }}>pcs</span></td>
                </tr>
              </tbody>
            </table>

            {/* 3. Dua Kolom Sejajar */}
            <div style={{ display: 'flex', gap: '16px', marginBottom: '16px' }}>
              {/* Kiri: Aksesori */}
              <div style={{ flex: 1 }}>
                <table>
                  <thead>
                    <tr>
                      <th colSpan={4} style={s.headerDark}>KEBUTUHAN AKSESORI</th>
                    </tr>
                    <tr>
                      <th style={s.headerLight}>Item</th>
                      <th style={{ ...s.headerLight, textAlign: 'center' }}>QTY/pcs</th>
                      <th style={{ ...s.headerLight, textAlign: 'center' }}>Total</th>
                      <th style={s.headerLight}>Satuan</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bundle.aksesori && bundle.aksesori.length > 0 ? (
                      bundle.aksesori.map((aks, idx) => (
                        <tr key={idx}>
                          <td style={s.cell}>{aks.nama}</td>
                          <td style={s.cellCenter}>{aks.qty_per_pcs}</td>
                          <td style={{ ...s.cellCenter, fontWeight: 'bold' }}>{aks.qty_per_pcs * bundle.qty_per_bundle}</td>
                          <td style={s.cell}>{aks.satuan}</td>
                        </tr>
                      ))
                    ) : (
                      <>
                        <tr><td colSpan={4} style={{ ...s.cellCenter, height: '24px' }}></td></tr>
                        <tr><td colSpan={4} style={{ ...s.cellCenter, height: '24px' }}></td></tr>
                        <tr><td colSpan={4} style={{ ...s.cellCenter, height: '24px' }}></td></tr>
                      </>
                    )}
                    {/* Baris manual untuk benang */}
                    <tr>
                      <td style={s.cell}>Benang (manual)</td>
                      <td style={s.cellCenter}><span style={s.manualLine}></span></td>
                      <td style={s.cellCenter}><span style={s.manualLine}></span></td>
                      <td style={s.cell}>cones/roll</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* Kanan: Operator */}
              <div style={{ flex: 1 }}>
                <table>
                  <thead>
                    <tr>
                      <th colSpan={2} style={s.headerDark}>NAMA OPERATOR PER TAHAP</th>
                    </tr>
                    <tr>
                      <th style={{ ...s.headerLight, width: '40%' }}>Tahap</th>
                      <th style={s.headerLight}>Nama Operator</th>
                    </tr>
                  </thead>
                  <tbody>
                    {['Jahit', 'Buang Benang', 'Lubang Kancing', 'QC', 'Steam', 'Packing'].map((tahap) => {
                      const isiNama = tahap === 'Jahit' && bundle.nama_penjahit ? bundle.nama_penjahit : null;
                      return (
                        <tr key={tahap}>
                          <td style={{ ...s.cell, fontWeight: 'bold' }}>{tahap}</td>
                          <td style={s.cellCenter}>
                            {isiNama ? <span style={{ fontWeight: 'bold', fontSize: '11px' }}>{isiNama}</span> : <span style={s.manualLine}></span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* 4. Tabel Tracking Produksi */}
            <table style={{ marginBottom: '16px' }}>
              <thead>
                <tr>
                  <th colSpan={8} style={s.headerDark}>TRACKING PRODUKSI & SERAH TERIMA</th>
                </tr>
                <tr>
                  <th style={s.headerLight}>Tahap</th>
                  <th style={{ ...s.headerLight, textAlign: 'center' }}>QTY Mulai</th>
                  <th style={{ ...s.headerLight, textAlign: 'center' }}>QTY Selesai</th>
                  <th style={{ ...s.headerLight, textAlign: 'center' }}>Reject (pcs)</th>
                  <th style={{ ...s.headerLight, width: '20%' }}>Alasan Reject</th>
                  <th style={{ ...s.headerLight, width: '15%' }}>Penanggung Jawab</th>
                  <th style={{ ...s.headerLight, textAlign: 'center' }}>TTD Terima</th>
                  <th style={{ ...s.headerLight, textAlign: 'center' }}>TTD Selesai</th>
                </tr>
              </thead>
              <tbody>
                {['Cutting', 'Jahit', 'Buang Benang', 'Lubang Kancing', 'QC', 'Steam', 'Packing'].map((tahap) => {
                  const isCutting = tahap === 'Cutting';
                  return (
                    <tr key={tahap}>
                      <td style={{ ...s.cell, fontWeight: 'bold', height: '28px' }}>{tahap}</td>
                      <td style={s.cellCenter}>{isCutting ? '' : ''}</td>
                      <td style={{ ...s.cellCenter, fontWeight: isCutting ? 'bold' : 'normal', fontSize: isCutting ? '12px' : '10px' }}>
                        {isCutting ? bundle.qty_per_bundle : ''}
                      </td>
                      <td style={s.cellCenter}></td>
                      <td style={s.cell}></td>
                      <td style={s.cell}></td>
                      <td style={s.cellCenter}></td>
                      <td style={s.cellCenter}></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {/* 5. Aturan Reject & Potongan Gaji */}
            <div style={{ border: '2px solid #111', padding: '12px', marginBottom: '16px' }}>
              <div style={{ fontWeight: '900', fontSize: '12px', marginBottom: '8px', borderBottom: '1px solid #999', paddingBottom: '4px' }}>
                ATURAN REJECT & POTONGAN GAJI
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start' }}>
                  <span style={s.circleNum}>1</span>
                  <span>QTY Mulai setiap tahap = QTY Selesai tahap sebelumnya. Wajib ditulis sebelum mulai kerja.</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'flex-start' }}>
                  <span style={s.circleNum}>2</span>
                  <div>
                    <span style={s.badgeBorder}>REWORK</span>
                    Barang reject bisa diperbaiki: gaji DITAHAN sampai perbaikan selesai dan lulus QC.
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'flex-start' }}>
                  <span style={s.circleNum}>3</span>
                  <div>
                    <span style={s.badgeBorder}>POTONG 50%</span>
                    Reject tidak bisa dirework (cacat permanen oleh operator): gaji dipotong 50% dari upah bundle tersebut.
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'flex-start' }}>
                  <span style={s.circleNum}>4</span>
                  <div>
                    <span style={s.badgeBorder}>TIDAK DIPOTONG</span>
                    Reject akibat cacat bahan baku (kain/aksesori dari gudang): tidak ada potongan gaji, dicatat sebagai klaim gudang.
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'flex-start' }}>
                  <span style={s.circleNum}>5</span>
                  <span>Kolom Penanggung Jawab & Alasan Reject wajib diisi jika ada reject. TTD Selesai = persetujuan serah terima ke tahap berikutnya.</span>
                </div>
              </div>
            </div>

            {/* 6. Footer */}
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '9px', color: '#555', borderTop: '1px solid #999', paddingTop: '8px', marginTop: 'auto' }}>
              <div>Dicetak: {tglCetak}</div>
              <div style={{ fontWeight: 'bold', color: '#111' }}>STX-001</div>
              <div>Kartu ini mengikuti bundle sampai PACKING</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
