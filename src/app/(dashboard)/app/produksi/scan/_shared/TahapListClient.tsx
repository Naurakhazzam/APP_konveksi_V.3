'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  Package, Clock, Loader2, CheckCircle, Search, Undo2, X, SkipForward, MinusCircle, AlertTriangle, Printer,
} from 'lucide-react';
import {
  getRiwayatSelesaiTahap, selesaiTahapBatch, batalSelesaiTahapBatch,
  type BundleTahapItem, type SelesaiTahapItem, type TahapBorongan,
} from '@/lib/actions/produksi/tahap-borongan.actions';
import { getAlasanQty } from '@/lib/actions/produksi/qty-approval.actions';
import { matchesBundleQuery } from '@/lib/search/bundle-search';
import { TAHAP_CONFIG } from '@/modules/produksi/constants/tahap';
import StagePagination from '@/components/produksi/StagePagination';
import RowMenu from '@/components/produksi/RowMenu';
import PrintHangTagLayout from '../packing/PrintHangTagLayout';

interface Props {
  tahap: TahapBorongan;
  initialAntrian: BundleTahapItem[];
  initialSelesai: { data: SelesaiTahapItem[]; total: number };
}

type Tab = 'antrian' | 'selesai';
const PAGE_SIZE = 20;

type HangTag = { noUrut: string; model_nama: string | null; warna: string; size: string; qty: number };
const keHangTag = (b: BundleTahapItem): HangTag => ({
  noUrut: b.barcode.split('-')[2] ?? b.barcode,
  model_nama: b.model_nama,
  warna: b.warna,
  size: b.size,
  qty: b.qty_per_bundle,
});

const formatWaktu = (s: string | null) =>
  !s ? '-' : new Date(s).toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

export default function TahapListClient({ tahap, initialAntrian, initialSelesai }: Props) {
  const router = useRouter();
  const label = TAHAP_CONFIG[tahap].label;
  const isPacking = tahap === 'packing';
  const [activeTab, setActiveTab] = useState<Tab>('antrian');

  // ── Hang tag (khusus Packing): dicetak otomatis setelah Selesai, bisa cetak ulang ──
  const [hangTag, setHangTag] = useState<HangTag[] | null>(null);
  const cetakHangTag = (bundles: BundleTahapItem[]) => {
    if (!isPacking || bundles.length === 0) return;
    setHangTag(bundles.map(keHangTag));
    setTimeout(() => { window.print(); setHangTag(null); }, 600);
  };
  const [cari, setCari] = useState('');

  // ── Antrian (semua baris dari server, disaring di sini) ──
  const antrianTampil = initialAntrian.filter(b => {
    if (!cari.trim()) return true;
    return matchesBundleQuery(b, cari) || b.penjahit_nama.toLowerCase().includes(cari.trim().toLowerCase());
  });
  const [pilihAntrian, setPilihAntrian] = useState<Set<string>>(new Set());

  useEffect(() => {
    const ada = new Set(initialAntrian.map(b => b.id));
    setPilihAntrian(p => new Set([...p].filter(id => ada.has(id))));
  }, [initialAntrian]);

  // ── Selesai (riwayat, paginasi & cari di server) ──
  const [selesaiData, setSelesaiData] = useState(initialSelesai.data);
  const [selesaiTotal, setSelesaiTotal] = useState(initialSelesai.total);
  const [selesaiPage, setSelesaiPage] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [pilihSelesai, setPilihSelesai] = useState<Map<string, SelesaiTahapItem>>(new Map());

  const muatSelesai = async (page: number, q: string) => {
    setIsLoading(true);
    try {
      const res = await getRiwayatSelesaiTahap(tahap, page, PAGE_SIZE, q || undefined);
      setSelesaiData(res.data);
      setSelesaiTotal(res.total);
      setSelesaiPage(page);
    } catch (e: any) {
      toast.error('Gagal mengambil data selesai: ' + e.message);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    setSelesaiData(initialSelesai.data);
    setSelesaiTotal(initialSelesai.total);
    setSelesaiPage(1);
  }, [initialSelesai]);

  useEffect(() => {
    if (activeTab !== 'selesai') return;
    const t = setTimeout(() => muatSelesai(1, cari.trim()), 350);
    return () => clearTimeout(t);
  }, [cari, activeTab]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Modal ──
  const [konfirmasi, setKonfirmasi] = useState<BundleTahapItem[] | null>(null);
  const [qtyKurang, setQtyKurang] = useState<BundleTahapItem | null>(null);
  const [batal, setBatal] = useState<SelesaiTahapItem[] | null>(null);

  const sesudahAksi = () => {
    setPilihAntrian(new Set());
    setPilihSelesai(new Map());
    router.refresh();
  };

  const handleCariEnter = () => {
    if (activeTab !== 'antrian') return;
    const kode = cari.trim().toLowerCase();
    if (!kode) return;
    const b = initialAntrian.find(x => x.barcode.toLowerCase() === kode);
    if (b) {
      setPilihAntrian(p => new Set(p).add(b.id));
      setCari('');
      toast.success(`${b.barcode} dipilih`);
    }
  };

  const gantiTab = (t: Tab) => {
    setActiveTab(t);
    if (t === 'antrian' && activeTab === 'selesai' && cari) muatSelesai(1, '');
  };

  const semuaAntrianTerpilih = antrianTampil.length > 0 && antrianTampil.every(b => pilihAntrian.has(b.id));
  const pilihSemuaAntrian = () => {
    const s = new Set(pilihAntrian);
    if (semuaAntrianTerpilih) antrianTampil.forEach(b => s.delete(b.id));
    else antrianTampil.forEach(b => s.add(b.id));
    setPilihAntrian(s);
  };

  // Packing: semua baris bisa dicentang (untuk cetak ulang hang tag);
  // tahap lain hanya yang masih bisa dibatalkan.
  const selesaiBisaPilih = isPacking ? selesaiData : selesaiData.filter(b => b.bisa_batal);
  const semuaSelesaiTerpilih = selesaiBisaPilih.length > 0 && selesaiBisaPilih.every(b => pilihSelesai.has(b.id));
  const pilihSemuaSelesai = () => {
    setPilihSelesai(prev => {
      const m = new Map(prev);
      if (semuaSelesaiTerpilih) selesaiBisaPilih.forEach(b => m.delete(b.id));
      else selesaiBisaPilih.forEach(b => m.set(b.id, b));
      return m;
    });
  };
  const pilihanSelesai = [...pilihSelesai.values()];
  const pilihanBisaBatal = pilihanSelesai.every(b => b.bisa_batal);
  const toggleSelesai = (item: SelesaiTahapItem) => {
    setPilihSelesai(prev => {
      const m = new Map(prev);
      if (m.has(item.id)) m.delete(item.id); else m.set(item.id, item);
      return m;
    });
  };

  const TH = ({ children, className = '' }: { children?: React.ReactNode; className?: string }) => (
    <th className={`sticky top-0 z-20 px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-[#9aa0a6] bg-[#16181A] border-b border-[#2A2D31] ${className}`}>
      {children}
    </th>
  );

  const Kotak = ({ checked, onChange, disabled }: { checked: boolean; onChange: () => void; disabled?: boolean }) => (
    <input
      type="checkbox"
      checked={checked}
      onChange={onChange}
      disabled={disabled}
      className="accent-[#e5c17b] w-4 h-4 rounded border-[#2A2D31] cursor-pointer disabled:opacity-25 disabled:cursor-not-allowed"
    />
  );

  const Kosong = ({ cols, teks }: { cols: number; teks: string }) => (
    <tr>
      <td colSpan={cols} className="px-4 py-12 text-center text-[#9aa0a6]">
        <Package className="w-8 h-8 mx-auto mb-2 opacity-20" />
        {cari ? `Tidak ada yang cocok dengan "${cari}"` : teks}
      </td>
    </tr>
  );

  const KolomBundle = ({ b }: { b: BundleTahapItem }) => (
    <>
      <td className="px-4 py-3">
        <span className="font-mono font-bold text-[#e5c17b]">{b.no_po}</span>
        <div className="text-[10px] text-[#9aa0a6]">{b.klien_nama}</div>
      </td>
      <td className="px-4 py-3 font-medium text-[#e8eaed]">{b.model_nama ?? '-'}</td>
      <td className="px-4 py-3 text-[#9aa0a6]">{b.warna} <span className="mx-1">/</span> {b.size}</td>
      <td className="px-4 py-3 font-mono text-xs text-[#9aa0a6]">{b.barcode}</td>
      <td className="px-4 py-3 font-mono text-[#e8eaed]">
        {b.qty_per_bundle} <span className="text-[10px] text-[#9aa0a6]">pcs</span>
      </td>
      <td className="px-4 py-3 text-xs text-[#9aa0a6]">{b.penjahit_nama}</td>
    </>
  );

  const TabBtn = ({ t, teks, n }: { t: Tab; teks: string; n: number }) => (
    <button
      onClick={() => gantiTab(t)}
      className={`px-5 py-2 rounded-lg text-xs font-bold transition-all ${
        activeTab === t ? 'bg-[#e5c17b] text-[#0D0E10]' : 'text-[#9aa0a6] hover:text-[#e8eaed]'
      }`}
    >
      {teks} <span className="ml-1 opacity-50">({n})</span>
    </button>
  );

  const pilihanAntrian = initialAntrian.filter(b => pilihAntrian.has(b.id));

  return (
    <div className="mt-2 pt-6 border-t border-[#2A2D31]">
      <div className="mb-5 px-1">
        <h2 className="text-xl font-bold text-[#e8eaed]">Monitoring {label}</h2>
        <p className="text-[#9aa0a6] text-[13px] mt-1.5">
          Centang bundle (atau scan barcode di kolom cari) → Selesaikan. Qty penuh otomatis; bundle yang kurang
          diselesaikan lewat menu ⋯.{isPacking && ' Hang tag langsung dicetak setelah disimpan; cetak ulang dari tab Selesai.'}
        </p>
      </div>

      <div className="space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center gap-3">
          <div className="flex p-1 bg-[#1A1D1F] rounded-xl border border-[#2A2D31] w-fit">
            <TabBtn t="antrian" teks="ANTRIAN" n={initialAntrian.length} />
            <TabBtn t="selesai" teks="SELESAI" n={selesaiTotal} />
          </div>
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#9aa0a6]" />
            <input
              value={cari}
              onChange={e => setCari(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleCariEnter()}
              placeholder={activeTab === 'antrian' ? 'Scan barcode (langsung dicentang) atau cari PO, artikel, warna…' : 'Cari PO, artikel, warna, penjahit…'}
              className="w-full h-10 bg-[#16181A] border border-[#2A2D31] rounded-xl pl-9 pr-9 text-sm text-[#e8eaed] outline-none focus:ring-1 focus:ring-[#e5c17b] placeholder:text-[#9aa0a6]"
            />
            {cari && (
              <button onClick={() => setCari('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#9aa0a6] hover:text-[#e8eaed]">
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-3 min-h-[36px]">
          {activeTab === 'antrian' && pilihAntrian.size > 0 && (
            <>
              <button
                onClick={() => setPilihAntrian(new Set())}
                className="text-xs font-semibold text-[#9aa0a6] hover:text-[#e8eaed] px-2"
              >
                Batal pilih
              </button>
              <button
                onClick={() => setKonfirmasi(pilihanAntrian)}
                className="flex items-center gap-2 bg-green-600 hover:bg-green-500 text-white h-9 px-4 rounded-lg text-sm font-bold shadow-lg"
              >
                <CheckCircle className="w-4 h-4" /> Selesaikan ({pilihAntrian.size})
              </button>
            </>
          )}
          {activeTab === 'selesai' && pilihSelesai.size > 0 && (
            <>
              <button
                onClick={() => setPilihSelesai(new Map())}
                className="text-xs font-semibold text-[#9aa0a6] hover:text-[#e8eaed] px-2"
              >
                Batal pilih
              </button>
              <button
                onClick={() => setBatal(pilihanSelesai)}
                disabled={!pilihanBisaBatal}
                title={pilihanBisaBatal ? undefined : 'Ada bundle yang sudah masuk surat jalan'}
                className="flex items-center gap-2 h-9 px-3 rounded-lg border border-orange-500/40 text-orange-400 text-xs font-bold hover:bg-orange-500/10 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Undo2 className="w-4 h-4" /> Batalkan Selesai ({pilihSelesai.size})
              </button>
              {isPacking && (
                <button
                  onClick={() => {
                    cetakHangTag(pilihanSelesai);
                    toast.success(`Mencetak ulang hang tag ${pilihSelesai.size} bundle`);
                    setPilihSelesai(new Map());
                  }}
                  className="flex items-center gap-2 bg-[#e5c17b] hover:bg-[#d4b06a] text-[#0D0E10] h-9 px-4 rounded-lg text-sm font-bold"
                >
                  <Printer className="w-4 h-4" /> Print Ulang Hang Tag ({pilihSelesai.size})
                </button>
              )}
            </>
          )}
        </div>

        <div className="bg-[#1A1D1F] border border-[#2A2D31] rounded-2xl overflow-hidden shadow-sm relative">
          {isLoading && (
            <div className="absolute inset-0 bg-[#0D0E10]/40 backdrop-blur-[1px] z-30 flex items-center justify-center">
              <Loader2 className="w-8 h-8 text-[#e5c17b] animate-spin" />
            </div>
          )}

          <div className="overflow-auto max-h-[65vh]">
            {activeTab === 'antrian' ? (
              <table className="w-full text-sm border-separate border-spacing-0">
                <thead>
                  <tr>
                    <TH className="w-12 text-center"><Kotak checked={semuaAntrianTerpilih} onChange={pilihSemuaAntrian} /></TH>
                    <TH>No.</TH>
                    <TH>No. PO</TH>
                    <TH>Artikel</TH>
                    <TH>Warna / Size</TH>
                    <TH>Barcode</TH>
                    <TH>QTY</TH>
                    <TH>Penjahit</TH>
                    <TH>Masuk</TH>
                    <TH className="w-14" />
                  </tr>
                </thead>
                <tbody className="[&_td]:border-b [&_td]:border-[#2A2D31]">
                  {antrianTampil.length === 0 ? <Kosong cols={10} teks={`Tidak ada antrian ${label}`} /> : antrianTampil.map((item, idx) => (
                    <tr key={item.id} className={`transition-colors ${pilihAntrian.has(item.id) ? 'bg-green-500/5' : 'hover:bg-[#2A2D31]/40'}`}>
                      <td className="px-4 py-3 text-center">
                        <Kotak
                          checked={pilihAntrian.has(item.id)}
                          onChange={() => setPilihAntrian(p => {
                            const s = new Set(p);
                            if (s.has(item.id)) s.delete(item.id); else s.add(item.id);
                            return s;
                          })}
                        />
                      </td>
                      <td className="px-4 py-3 text-xs font-bold text-[#9aa0a6]">{idx + 1}</td>
                      <KolomBundle b={item} />
                      <td className="px-4 py-3 text-xs text-[#9aa0a6] whitespace-nowrap">{formatWaktu(item.waktu)}</td>
                      <td className="px-4 py-3">
                        <RowMenu items={[
                          { label: 'Selesaikan semua', icon: <CheckCircle className="w-3.5 h-3.5" />, onClick: () => setKonfirmasi([item]) },
                          { label: 'Selesaikan, qty kurang…', icon: <MinusCircle className="w-3.5 h-3.5" />, onClick: () => setQtyKurang(item), disabled: item.qty_per_bundle <= 1 },
                        ]} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <table className="w-full text-sm border-separate border-spacing-0">
                <thead>
                  <tr>
                    <TH className="w-12 text-center">
                      <Kotak checked={semuaSelesaiTerpilih} onChange={pilihSemuaSelesai} disabled={selesaiBisaPilih.length === 0} />
                    </TH>
                    <TH>No.</TH>
                    <TH>No. PO</TH>
                    <TH>Artikel</TH>
                    <TH>Warna / Size</TH>
                    <TH>Barcode</TH>
                    <TH>QTY</TH>
                    <TH>Penjahit</TH>
                    <TH>Selesai</TH>
                    <TH>Posisi Sekarang</TH>
                    <TH className="w-14" />
                  </tr>
                </thead>
                <tbody className="[&_td]:border-b [&_td]:border-[#2A2D31]">
                  {selesaiData.length === 0 ? <Kosong cols={11} teks={`Belum ada bundle yang selesai ${label}`} /> : selesaiData.map((item, idx) => (
                    <tr key={item.id} className={`transition-colors ${pilihSelesai.has(item.id) ? 'bg-orange-500/5' : 'hover:bg-[#2A2D31]/40'}`}>
                      <td className="px-4 py-3 text-center">
                        <Kotak checked={pilihSelesai.has(item.id)} onChange={() => toggleSelesai(item)} disabled={!isPacking && !item.bisa_batal} />
                      </td>
                      <td className="px-4 py-3 text-xs font-bold text-[#9aa0a6]">{(selesaiPage - 1) * PAGE_SIZE + idx + 1}</td>
                      <KolomBundle b={item} />
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5 text-[#9aa0a6] text-xs whitespace-nowrap">
                          <Clock size={12} /> {formatWaktu(item.waktu)}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs">
                        <div className="text-[#e8eaed] font-medium whitespace-nowrap">{item.posisi}</div>
                        {item.dilewati.length > 0 && (
                          <div className="flex items-center gap-1 text-[10px] text-sky-400 mt-0.5 whitespace-nowrap">
                            <SkipForward className="w-3 h-3" /> Lewati {item.dilewati.join(' & ')}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <RowMenu items={[
                          ...(isPacking ? [{
                            label: 'Print ulang hang tag', icon: <Printer className="w-3.5 h-3.5" />,
                            onClick: () => { cetakHangTag([item]); toast.success(`Mencetak ulang hang tag ${item.barcode}`); },
                          }] : []),
                          {
                            label: 'Batalkan selesai', icon: <Undo2 className="w-3.5 h-3.5" />, danger: true,
                            disabled: !item.bisa_batal,
                            hint: item.bisa_batal ? undefined
                              : isPacking ? 'Sudah masuk surat jalan'
                              : 'Sudah masuk tahap berikutnya — batalkan dari menu tahap itu dulu',
                            onClick: () => setBatal([item]),
                          },
                        ]} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {activeTab === 'selesai' && (
            <div className="p-4 border-t border-[#2A2D31]">
              <StagePagination page={selesaiPage} totalPages={Math.ceil(selesaiTotal / PAGE_SIZE)} onPageChange={p => muatSelesai(p, cari.trim())} />
            </div>
          )}
        </div>
      </div>

      {konfirmasi && (
        <ModalSelesai
          tahap={tahap}
          bundles={konfirmasi}
          onClose={() => setKonfirmasi(null)}
          onSuccess={b => { setKonfirmasi(null); sesudahAksi(); cetakHangTag(b); }}
        />
      )}
      {qtyKurang && (
        <ModalQtyKurang
          tahap={tahap}
          bundle={qtyKurang}
          onClose={() => setQtyKurang(null)}
          onSuccess={b => { setQtyKurang(null); sesudahAksi(); cetakHangTag(b); }}
        />
      )}
      {batal && (
        <ModalBatal
          tahap={tahap}
          bundles={batal}
          onClose={() => setBatal(null)}
          onSuccess={() => { setBatal(null); sesudahAksi(); muatSelesai(1, cari.trim()); }}
        />
      )}
      {hangTag && hangTag.length > 0 && <PrintHangTagLayout bundles={hangTag} />}
    </div>
  );
}

// ── Modal ─────────────────────────────────────────────────────────────────

function Bingkai({ judul, sub, onClose, sibuk, children, footer }: {
  judul: React.ReactNode; sub: string; onClose: () => void; sibuk: boolean;
  children: React.ReactNode; footer: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 bg-black/75 flex items-center justify-center z-50 p-4">
      <div className="bg-[#1A1D1F] border border-[#2A2D31] rounded-2xl w-full max-w-lg shadow-2xl flex flex-col max-h-[90vh]">
        <div className="px-6 py-5 border-b border-[#2A2D31] flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-[#e8eaed] flex items-center gap-2">{judul}</h2>
            <p className="text-sm text-[#9aa0a6] mt-1">{sub}</p>
          </div>
          <button
            onClick={onClose}
            disabled={sibuk}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-[#9aa0a6] hover:text-[#e8eaed] hover:bg-[#2A2D31]"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-6 space-y-4">{children}</div>
        <div className="px-6 py-4 border-t border-[#2A2D31] flex justify-end gap-3 bg-[#16181A] rounded-b-2xl">{footer}</div>
      </div>
    </div>
  );
}

function DaftarRingkas({ bundles }: { bundles: BundleTahapItem[] }) {
  return (
    <div className="border border-[#2A2D31] rounded-xl overflow-hidden bg-[#16181A] max-h-56 overflow-y-auto">
      <table className="w-full text-sm">
        <tbody className="divide-y divide-[#2A2D31]">
          {bundles.map(b => (
            <tr key={b.id}>
              <td className="px-4 py-2 font-mono text-xs text-[#e5c17b]">{b.barcode}</td>
              <td className="px-4 py-2 text-xs text-[#e8eaed]">{b.model_nama ?? '-'} · {b.warna}/{b.size}</td>
              <td className="px-4 py-2 text-right text-xs font-bold text-[#e8eaed]">{b.qty_per_bundle}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const BtnTutup = ({ onClick, disabled }: { onClick: () => void; disabled: boolean }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    className="px-5 py-2.5 rounded-xl border border-[#2A2D31] text-sm font-bold text-[#e8eaed] hover:bg-[#2A2D31]"
  >
    Tutup
  </button>
);

function ModalSelesai({ tahap, bundles, onClose, onSuccess }: {
  tahap: TahapBorongan; bundles: BundleTahapItem[]; onClose: () => void;
  /** Dipanggil dengan bundle yang tersimpan — dipakai cetak hang tag Packing. */
  onSuccess: (selesai: BundleTahapItem[]) => void;
}) {
  const [sibuk, setSibuk] = useState(false);
  const label = TAHAP_CONFIG[tahap].label;
  const totalPcs = bundles.reduce((s, b) => s + b.qty_per_bundle, 0);

  const simpan = async () => {
    setSibuk(true);
    try {
      const res = await selesaiTahapBatch(tahap, bundles.map(b => ({ bundle_id: b.id })));
      toast.success(`${res.jumlah} bundle selesai ${label}`);
      onSuccess(bundles);
    } catch (e: any) {
      toast.error(`Gagal, tidak ada yang tersimpan: ${e.message}`);
      setSibuk(false);
    }
  };

  return (
    <Bingkai
      judul={<><CheckCircle className="w-5 h-5 text-green-500" /> Selesaikan {label}</>}
      sub={`${bundles.length} bundle · ${totalPcs} pcs · qty penuh`}
      onClose={onClose}
      sibuk={sibuk}
      footer={<>
        <BtnTutup onClick={onClose} disabled={sibuk} />
        <button
          onClick={simpan}
          disabled={sibuk}
          autoFocus
          className="flex items-center gap-2 bg-green-600 hover:bg-green-500 text-white px-5 py-2.5 rounded-xl text-sm font-bold disabled:opacity-50"
        >
          {sibuk ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
          {sibuk ? 'Menyimpan...' : `Selesaikan ${bundles.length} Bundle`}
        </button>
      </>}
    >
      <DaftarRingkas bundles={bundles} />
      <p className="text-xs text-[#9aa0a6]">
        Ada yang qty-nya kurang? Tutup, lalu pakai menu ⋯ → <span className="text-[#e8eaed]">Selesaikan, qty kurang…</span> untuk bundle itu.
      </p>
    </Bingkai>
  );
}

function ModalQtyKurang({ tahap, bundle, onClose, onSuccess }: {
  tahap: TahapBorongan; bundle: BundleTahapItem; onClose: () => void;
  onSuccess: (selesai: BundleTahapItem[]) => void;
}) {
  const [sibuk, setSibuk] = useState(false);
  const [qty, setQty] = useState(Math.max(bundle.qty_per_bundle - 1, 1));
  const [alasanId, setAlasanId] = useState('');
  const [alasanList, setAlasanList] = useState<{ id: string; label: string }[]>([]);
  const label = TAHAP_CONFIG[tahap].label;

  useEffect(() => {
    getAlasanQty().then(setAlasanList).catch(() => toast.error('Gagal memuat daftar alasan'));
  }, []);

  const valid = qty >= 1 && qty < bundle.qty_per_bundle && !!alasanId;

  const simpan = async () => {
    if (!valid) return;
    setSibuk(true);
    try {
      await selesaiTahapBatch(tahap, [{ bundle_id: bundle.id, qty, alasan_qty_id: alasanId }]);
      toast.success(`${bundle.barcode} selesai ${label} — ${qty} pcs`);
      onSuccess([{ ...bundle, qty_per_bundle: qty }]);
    } catch (e: any) {
      toast.error(`Gagal: ${e.message}`);
      setSibuk(false);
    }
  };

  return (
    <Bingkai
      judul={<><MinusCircle className="w-5 h-5 text-orange-400" /> Selesaikan, qty kurang</>}
      sub={`${bundle.barcode} · ${bundle.model_nama ?? '-'} ${bundle.warna}/${bundle.size} · masuk ${bundle.qty_per_bundle} pcs`}
      onClose={onClose}
      sibuk={sibuk}
      footer={<>
        <BtnTutup onClick={onClose} disabled={sibuk} />
        <button
          onClick={simpan}
          disabled={sibuk || !valid}
          className="flex items-center gap-2 bg-green-600 hover:bg-green-500 text-white px-5 py-2.5 rounded-xl text-sm font-bold disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {sibuk ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
          {sibuk ? 'Menyimpan...' : 'Selesaikan'}
        </button>
      </>}
    >
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <label className="text-[10px] font-black uppercase tracking-[0.2em] text-[#e5c17b]">Qty selesai *</label>
          <input
            type="number"
            min={1}
            max={bundle.qty_per_bundle - 1}
            value={qty}
            onChange={e => setQty(parseInt(e.target.value) || 0)}
            autoFocus
            className="w-full bg-[#16181A] border border-[#2A2D31] rounded-xl px-4 py-3 text-lg font-bold text-center text-[#e8eaed] outline-none focus:ring-1 focus:ring-[#e5c17b]"
          />
          <p className="text-[11px] text-[#9aa0a6]">Kurang {Math.max(bundle.qty_per_bundle - qty, 0)} pcs</p>
        </div>
        <div className="space-y-2">
          <label className="text-[10px] font-black uppercase tracking-[0.2em] text-[#e5c17b]">Alasan *</label>
          <select
            value={alasanId}
            onChange={e => setAlasanId(e.target.value)}
            className="w-full bg-[#16181A] border border-[#2A2D31] rounded-xl px-3 py-3 text-sm text-[#e8eaed] outline-none focus:ring-1 focus:ring-[#e5c17b]"
          >
            <option value="">— Pilih alasan —</option>
            {alasanList.map(a => <option key={a.id} value={a.id}>{a.label}</option>)}
          </select>
        </div>
      </div>
      {qty >= bundle.qty_per_bundle && (
        <p className="text-xs text-orange-400 flex items-center gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5" /> Qty penuh — pakai "Selesaikan semua" saja.
        </p>
      )}
    </Bingkai>
  );
}

function ModalBatal({ tahap, bundles, onClose, onSuccess }: {
  tahap: TahapBorongan; bundles: SelesaiTahapItem[]; onClose: () => void; onSuccess: () => void;
}) {
  const [sibuk, setSibuk] = useState(false);
  const [alasan, setAlasan] = useState('');
  const label = TAHAP_CONFIG[tahap].label;
  const totalPcs = bundles.reduce((s, b) => s + b.qty_per_bundle, 0);

  const simpan = async () => {
    if (!alasan.trim()) return;
    setSibuk(true);
    try {
      const res = await batalSelesaiTahapBatch(tahap, bundles.map(b => b.id), alasan.trim());
      toast.success(`${res.jumlah} bundle dikembalikan ke Antrian ${label}`);
      onSuccess();
    } catch (e: any) {
      toast.error(`Gagal, tidak ada yang berubah: ${e.message}`);
      setSibuk(false);
    }
  };

  return (
    <Bingkai
      judul={<><Undo2 className="w-5 h-5 text-orange-400" /> Batalkan Selesai {label}</>}
      sub={`${bundles.length} bundle · ${totalPcs} pcs · Selesai → kembali ke Antrian`}
      onClose={onClose}
      sibuk={sibuk}
      footer={<>
        <BtnTutup onClick={onClose} disabled={sibuk} />
        <button
          onClick={simpan}
          disabled={sibuk || !alasan.trim()}
          className="flex items-center gap-2 bg-orange-600 hover:bg-orange-500 text-white px-5 py-2.5 rounded-xl text-sm font-bold disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {sibuk ? <Loader2 className="w-4 h-4 animate-spin" /> : <Undo2 className="w-4 h-4" />}
          {sibuk ? 'Memproses...' : `Batalkan ${bundles.length} Bundle`}
        </button>
      </>}
    >
      <DaftarRingkas bundles={bundles} />
      <div className="rounded-xl border border-orange-500/30 bg-orange-500/5 p-4 space-y-1.5">
        <p className="text-xs font-bold text-orange-400 flex items-center gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5" /> Yang terjadi:
        </p>
        <p className="text-xs text-[#e8eaed]">• Bundle kembali ke tab Antrian {label}.</p>
        <p className="text-xs text-[#e8eaed]">• Upah {label} bundle ini dibatalkan (ditolak bila upahnya sudah dibayar).</p>
        {tahap === 'packing'
          ? <p className="text-xs text-[#e8eaed]">• Hang tag dicetak lagi saat bundle diselesaikan ulang.</p>
          : <p className="text-xs text-[#e8eaed]">• Stok aksesori tahap ini (mis. kancing) dikembalikan.</p>}
      </div>
      <div className="space-y-2">
        <label className="text-[10px] font-black uppercase tracking-[0.2em] text-[#e5c17b]">Alasan *</label>
        <input
          type="text"
          value={alasan}
          onChange={e => setAlasan(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && simpan()}
          disabled={sibuk}
          autoFocus
          placeholder="mis. salah centang bundle"
          className="w-full bg-[#16181A] border border-[#2A2D31] rounded-xl px-4 py-3 text-sm text-[#e8eaed] outline-none focus:ring-1 focus:ring-[#e5c17b]"
        />
      </div>
    </Bingkai>
  );
}
