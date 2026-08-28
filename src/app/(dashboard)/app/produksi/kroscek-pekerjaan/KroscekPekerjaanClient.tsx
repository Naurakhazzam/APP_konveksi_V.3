'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { toast } from 'sonner';
import { ChevronLeft, ChevronRight, Loader2, X, Users, Shirt, ClipboardList, Printer } from 'lucide-react';
import {
  getHasilKerjaPekerja,
  getRincianHasilKerja,
  type HasilKerjaPekerja,
  type RincianHasilKerja,
} from '@/lib/actions/produksi/kroscek-pekerjaan.actions';
import { getAksesoriForKartuKerja } from '@/lib/actions/produksi/model-aksesori.actions';
import PrintKartuKerjaLayout, {
  type KartuBundle, type AksesoriItem,
} from '@/app/(dashboard)/app/produksi/antrian-cutting/PrintKartuKerjaLayout';

const TAHAP_LABEL: Record<string, string> = {
  cutting: 'Cutting',
  jahit: 'Jahit',
  lubang_kancing: 'Lubang Kancing',
  buang_benang: 'Buang Benang',
  qc: 'QC',
  steam: 'Steam',
  packing: 'Packing',
};

const tanggalPanjang = (iso: string) =>
  new Date(iso).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });

const tanggalPendek = (iso: string) =>
  new Date(iso).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });

function geserMinggu(dari: string, sampai: string, n: number) {
  const geser = (s: string) => {
    const d = new Date(s + 'T00:00:00');
    d.setDate(d.getDate() + n * 7);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  return { dari: geser(dari), sampai: geser(sampai) };
}

export default function KroscekPekerjaanClient({
  initialData, dari: dariAwal, sampai: sampaiAwal,
}: {
  initialData: HasilKerjaPekerja[];
  dari: string;
  sampai: string;
}) {
  const [periode, setPeriode] = useState({ dari: dariAwal, sampai: sampaiAwal });
  const [data, setData] = useState<HasilKerjaPekerja[]>(initialData);
  const [isLoading, setIsLoading] = useState(false);
  const [terpilih, setTerpilih] = useState<HasilKerjaPekerja | null>(null);

  // Data cetak sengaja ditahan di sini, bukan di dalam modal. Modal itu
  // `position: fixed` setinggi layar; kalau layout cetak dirender di dalamnya,
  // kartu yang lebih panjang dari viewport ikut terpotong saat dicetak.
  const [cetakData, setCetakData] = useState<KartuBundle[] | null>(null);
  const [sedangCetak, setSedangCetak] = useState<string | null>(null);

  const mingguIni = periode.dari === dariAwal;

  /**
   * Cetak ulang SK bundle langsung dari layar kroscek — untuk bundle yang
   * kartu fisiknya hilang, supaya tim tidak perlu balik ke Antrian Cutting.
   *
   * Memakai layout kartu kerja yang sama persis dengan cetakan aslinya, jadi
   * hasilnya bukan dokumen baru yang mirip, melainkan kartu yang sama.
   */
  const cetakSK = async (baris: RincianHasilKerja[], penanda: string, namaPekerja: string) => {
    const layak = baris.filter(r => r.bundle_id && r.po_item_id);
    if (layak.length === 0) {
      toast.error('Data bundle tidak lengkap, SK tidak bisa dicetak');
      return;
    }

    setSedangCetak(penanda);
    try {
      const aksesoriMap = await getAksesoriForKartuKerja(layak.map(r => r.po_item_id));

      const kartu: KartuBundle[] = layak.map(r => {
        const aks: AksesoriItem[] = (aksesoriMap[r.po_item_id] ?? []).map((item: any) => ({
          nama: item.inventory_item_nama,
          qty_per_pcs: item.qty_per_pcs,
          satuan: item.satuan,
          tahap_pakai: item.tahap_pakai,
        }));
        const cocok = r.barcode.match(/bdl(\d+)/i);
        return {
          id: r.bundle_id, barcode: r.barcode, no_urut: cocok ? parseInt(cocok[1], 10) : 0,
          po_id: '', po_item_id: r.po_item_id, no_po: r.no_po,
          tanggal_order: '', tanggal_target: '', po_catatan: null,
          klien_nama: r.klien_nama, model_nama: r.model_nama,
          warna: r.warna, size: r.size,
          qty_per_bundle: r.qty,
          aksesori: aks, nama_penjahit: namaPekerja,
        };
      });

      setCetakData(kartu);
      setTimeout(() => {
        window.print();
        setCetakData(null);
        setSedangCetak(null);
      }, 500);
    } catch (e: any) {
      toast.error(e.message ?? 'Gagal menyiapkan SK');
      setSedangCetak(null);
    }
  };

  const muat = useCallback(async (p: { dari: string; sampai: string }) => {
    setIsLoading(true);
    try {
      setData(await getHasilKerjaPekerja(p.dari, p.sampai));
    } catch (e: any) {
      toast.error(e.message ?? 'Gagal memuat data');
    } finally {
      setIsLoading(false);
    }
  }, []);

  const pindah = (n: number) => {
    const p = geserMinggu(periode.dari, periode.sampai, n);
    setPeriode(p);
    muat(p);
  };

  const total = useMemo(() => ({
    pekerja: data.length,
    pcs: data.reduce((s, d) => s + d.total_pcs, 0),
    pekerjaan: data.reduce((s, d) => s + d.jumlah_pekerjaan, 0),
  }), [data]);

  return (
    <div className="space-y-5">
      {/* Navigasi minggu */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button
            onClick={() => pindah(-1)}
            disabled={isLoading}
            className="p-2 rounded-lg border border-[#2A2D31] text-[#9aa0a6] hover:text-[#e8eaed] hover:bg-[#2A2D31] transition-colors disabled:opacity-40"
            title="Minggu sebelumnya"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <div className="px-3">
            <div className="text-sm font-semibold text-[#e8eaed]">
              {tanggalPendek(periode.dari)} – {tanggalPanjang(periode.sampai)}
            </div>
            <div className="text-[10px] text-[#9aa0a6] mt-0.5">
              {mingguIni ? 'Siklus gaji berjalan' : 'Siklus gaji'} · Sabtu – Jumat
            </div>
          </div>
          <button
            onClick={() => pindah(1)}
            disabled={isLoading || mingguIni}
            className="p-2 rounded-lg border border-[#2A2D31] text-[#9aa0a6] hover:text-[#e8eaed] hover:bg-[#2A2D31] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            title={mingguIni ? 'Sudah di minggu terkini' : 'Minggu berikutnya'}
          >
            <ChevronRight className="w-4 h-4" />
          </button>
          {!mingguIni && (
            <button
              onClick={() => { setPeriode({ dari: dariAwal, sampai: sampaiAwal }); muat({ dari: dariAwal, sampai: sampaiAwal }); }}
              className="ml-1 text-[10px] text-[#e5c17b] underline underline-offset-2 hover:text-[#f0d194]"
            >
              Kembali ke minggu ini
            </button>
          )}
        </div>
        {isLoading && (
          <span className="flex items-center gap-2 text-xs text-[#9aa0a6]">
            <Loader2 className="w-3.5 h-3.5 animate-spin text-[#e5c17b]" /> Memuat...
          </span>
        )}
      </div>

      {/* Ringkasan periode */}
      <div className="grid grid-cols-3 gap-3">
        <KartuTotal icon={<Users className="w-4 h-4" />} label="Pekerja Aktif" nilai={String(total.pekerja)} />
        <KartuTotal icon={<Shirt className="w-4 h-4" />} label="Total Dikerjakan" nilai={`${total.pcs.toLocaleString('id-ID')} pcs`} />
        <KartuTotal icon={<ClipboardList className="w-4 h-4" />} label="Jumlah Pekerjaan" nilai={`${total.pekerjaan}×`} />
      </div>

      {data.length === 0 ? (
        <div className="rounded-xl border border-[#2A2D31] bg-[#1A1D1F] px-4 py-16 text-center">
          <div className="text-[#9aa0a6] text-sm">Tidak ada pekerjaan yang perlu dikroscek</div>
          <p className="text-[10px] text-[#9aa0a6]/50 mt-1">
            Semua sudah selesai dan terbayar. Coba lihat minggu sebelumnya lewat tombol panah.
          </p>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {data.map(p => (
            <button
              key={p.karyawan_id}
              onClick={() => setTerpilih(p)}
              className="text-left bg-[#1A1D1F] border border-[#2A2D31] rounded-xl p-4 hover:border-[#e5c17b]/50 hover:bg-[#1E2124] transition-colors group"
            >
              <div className="mb-3">
                <div className="font-bold text-[#e8eaed] truncate group-hover:text-[#e5c17b] transition-colors">
                  {p.nama}
                </div>
                <div className="text-[10px] text-[#9aa0a6] mt-0.5">{p.jabatan}</div>
              </div>

              <div className="flex items-end gap-4 mb-3">
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-[#9aa0a6]">Dikerjakan</div>
                  <div className="text-2xl font-bold text-[#e5c17b] leading-tight">
                    {p.total_pcs.toLocaleString('id-ID')}
                    <span className="text-[10px] font-normal text-[#9aa0a6] ml-1">pcs</span>
                  </div>
                </div>
                <div className="pb-1">
                  <div className="text-[10px] uppercase tracking-wider text-[#9aa0a6]">Pekerjaan</div>
                  <div className="text-sm font-bold text-[#e8eaed]">{p.jumlah_pekerjaan}×</div>
                </div>
              </div>

              <div className="flex flex-wrap gap-1.5 mb-3">
                {p.jml_sedang_dikerjakan > 0 && (
                  <span className="text-[9px] font-bold uppercase tracking-wider px-2 py-1 rounded-full bg-sky-500/10 text-sky-300 border border-sky-500/20">
                    {p.jml_sedang_dikerjakan} sedang dikerjakan
                  </span>
                )}
                {p.jml_belum_dibayar > 0 && (
                  <span className="text-[9px] font-bold uppercase tracking-wider px-2 py-1 rounded-full bg-orange-500/10 text-orange-400 border border-orange-500/20">
                    {p.jml_belum_dibayar} selesai, belum dibayar
                  </span>
                )}
              </div>

              <div className="flex items-center justify-between gap-2 pt-3 border-t border-[#2A2D31]">
                <div className="flex flex-wrap gap-1">
                  {p.daftar_tahap.slice(0, 3).map(t => (
                    <span key={t} className="text-[9px] text-[#9aa0a6] bg-[#2A2D31]/60 px-1.5 py-0.5 rounded">
                      {TAHAP_LABEL[t] ?? t}
                    </span>
                  ))}
                  {p.daftar_tahap.length > 3 && (
                    <span className="text-[9px] text-[#9aa0a6]">+{p.daftar_tahap.length - 3}</span>
                  )}
                </div>
                <span className="text-[10px] text-[#9aa0a6] group-hover:text-[#e5c17b] transition-colors shrink-0">
                  lihat rincian →
                </span>
              </div>
            </button>
          ))}
        </div>
      )}

      {terpilih && (
        <ModalRincian
          pekerja={terpilih}
          periode={periode}
          onClose={() => setTerpilih(null)}
          onCetakSK={cetakSK}
          sedangCetak={sedangCetak}
        />
      )}

      {cetakData && cetakData.length > 0 && (
        <PrintKartuKerjaLayout
          bundles={cetakData}
          tglCetak={new Date().toLocaleString('id-ID', {
            day: '2-digit', month: 'short', year: 'numeric',
            hour: '2-digit', minute: '2-digit',
          })}
        />
      )}
    </div>
  );
}

function KartuTotal({ icon, label, nilai }: { icon: React.ReactNode; label: string; nilai: string }) {
  return (
    <div className="bg-[#1A1D1F] border border-[#2A2D31] rounded-xl p-4">
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest font-bold text-[#9aa0a6]">
        {icon}
        {label}
      </div>
      <div className="text-xl font-bold mt-2 text-[#e8eaed]">{nilai}</div>
    </div>
  );
}

function ModalRincian({
  pekerja, periode, onClose, onCetakSK, sedangCetak,
}: {
  pekerja: HasilKerjaPekerja;
  periode: { dari: string; sampai: string };
  onClose: () => void;
  onCetakSK: (baris: RincianHasilKerja[], penanda: string, namaPekerja: string) => void;
  sedangCetak: string | null;
}) {
  const [rincian, setRincian] = useState<RincianHasilKerja[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let batal = false;
    getRincianHasilKerja(pekerja.karyawan_id, periode.dari, periode.sampai)
      .then(d => { if (!batal) setRincian(d); })
      .catch(e => { if (!batal) toast.error(e.message ?? 'Gagal memuat rincian'); })
      .finally(() => { if (!batal) setIsLoading(false); });
    return () => { batal = true; };
  }, [pekerja.karyawan_id, periode.dari, periode.sampai]);


  return (
    <div className="fixed inset-0 bg-black/75 flex items-center justify-center z-50 p-4">
      <div className="bg-[#1A1D1F] border border-[#2A2D31] rounded-xl w-full max-w-4xl shadow-2xl max-h-[90vh] flex flex-col">
        <div className="px-6 py-4 border-b border-[#2A2D31] flex items-start justify-between gap-4">
          <div>
            <h3 className="text-base font-bold text-[#e8eaed]">{pekerja.nama}</h3>
            <p className="text-xs text-[#9aa0a6] mt-0.5">
              {pekerja.jabatan}
              <span className="mx-1.5 text-[#2A2D31]">|</span>
              {tanggalPendek(periode.dari)} – {tanggalPanjang(periode.sampai)}
              <span className="mx-1.5 text-[#2A2D31]">|</span>
              <span className="text-[#e5c17b] font-semibold">{pekerja.total_pcs.toLocaleString('id-ID')} pcs</span>
            </p>
          </div>
          <button onClick={onClose} className="text-[#9aa0a6] hover:text-[#e8eaed] transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="overflow-y-auto flex-1">
          {isLoading ? (
            <div className="flex items-center justify-center gap-2 py-16 text-[#9aa0a6] text-sm">
              <Loader2 className="w-5 h-5 animate-spin text-[#e5c17b]" />
              Memuat rincian pekerjaan...
            </div>
          ) : rincian.length === 0 ? (
            <div className="py-16 text-center text-sm text-[#9aa0a6]">
              Tidak ada rincian pekerjaan pada periode ini.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-[#0D0E10] text-[10px] uppercase tracking-widest text-[#9aa0a6] sticky top-0">
                <tr>
                  <th className="px-4 py-3 text-left font-bold">Tanggal</th>
                  <th className="px-4 py-3 text-left font-bold">Artikel</th>
                  <th className="px-4 py-3 text-left font-bold">PO</th>
                  <th className="px-4 py-3 text-left font-bold">Tahap</th>
                  <th className="px-4 py-3 text-center font-bold">Qty</th>
                  <th className="px-4 py-3 text-center font-bold">Keadaan</th>
                  <th className="px-4 py-3 text-center font-bold">SK</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#2A2D31]">
                {rincian.map(r => (
                  <tr key={r.id} className="hover:bg-[#1E2124] transition-colors">
                    <td className="px-4 py-3 text-xs text-[#9aa0a6] whitespace-nowrap">
                      {tanggalPendek(r.tanggal)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-xs font-medium text-[#e8eaed]">{r.model_nama}</div>
                      <div className="text-[10px] text-[#9aa0a6] mt-0.5">
                        {r.warna} · {r.size}
                        <span className="mx-1.5 text-[#2A2D31]">|</span>
                        <span className="font-mono">{r.barcode}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-mono text-xs text-[#e5c17b]">{r.no_po}</div>
                      <div className="text-[10px] text-[#9aa0a6] mt-0.5">{r.klien_nama}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-[10px] text-[#9aa0a6] bg-[#2A2D31]/60 px-2 py-0.5 rounded">
                        {TAHAP_LABEL[r.tahap] ?? r.tahap}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center text-sm font-bold text-[#e8eaed]">
                      {r.qty}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {r.keadaan === 'sedang_dikerjakan' ? (
                        <span className="text-[9px] font-bold uppercase tracking-wider px-2 py-1 rounded-full bg-sky-500/10 text-sky-300 border border-sky-500/20 whitespace-nowrap">
                          Sedang dikerjakan
                        </span>
                      ) : (
                        <span className="text-[9px] font-bold uppercase tracking-wider px-2 py-1 rounded-full bg-orange-500/10 text-orange-400 border border-orange-500/20 whitespace-nowrap">
                          Selesai
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <button
                        onClick={() => onCetakSK([r], r.barcode, pekerja.nama)}
                        disabled={sedangCetak !== null}
                        title={`Cetak ulang SK ${r.barcode}`}
                        className="inline-flex items-center justify-center p-1.5 rounded-lg text-[#9aa0a6] hover:text-[#e5c17b] hover:bg-[#2A2D31] transition-colors disabled:opacity-40"
                      >
                        {sedangCetak === r.barcode
                          ? <Loader2 className="w-4 h-4 animate-spin text-[#e5c17b]" />
                          : <Printer className="w-4 h-4" />}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="px-6 py-3 border-t border-[#2A2D31] flex items-center justify-between gap-3">
          <span className="text-[10px] text-[#9aa0a6]">{rincian.length} pekerjaan tercatat</span>
          <div className="flex items-center gap-3">
            {rincian.length > 0 && (
              <button
                onClick={() => onCetakSK(rincian, 'semua', pekerja.nama)}
                disabled={sedangCetak !== null}
                className="flex items-center gap-2 px-4 h-9 rounded-lg bg-[#e5c17b] hover:bg-[#f0d194] text-[#16181A] text-sm font-bold transition-colors disabled:opacity-50"
              >
                {sedangCetak === 'semua'
                  ? <Loader2 className="w-4 h-4 animate-spin" />
                  : <Printer className="w-4 h-4" />}
                Cetak Semua SK ({rincian.length})
              </button>
            )}
            <button
              onClick={onClose}
              className="px-4 h-9 rounded-lg border border-[#2A2D31] text-[#e8eaed] text-sm hover:bg-[#2A2D31] transition-colors"
            >
              Tutup
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
