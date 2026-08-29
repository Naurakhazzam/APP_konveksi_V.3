'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { toast } from 'sonner';
import {
  ChevronLeft, ChevronRight, Loader2, X, Users, Shirt, Wallet, AlertCircle, Scissors,
} from 'lucide-react';
import {
  getOverviewPekerja,
  getDetailPekerja,
  lunaskanUpahPekerja,
  type RingkasanPekerja,
  type DetailPekerjaan,
} from '@/lib/actions/penggajian/overview-pekerja.actions';

const rupiah = (n: number) => 'Rp' + n.toLocaleString('id-ID');

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

/** Geser rentang mingguan sebanyak n minggu (boleh negatif). */
function geserMinggu(dari: string, sampai: string, n: number) {
  const geser = (s: string) => {
    const d = new Date(s + 'T00:00:00');
    d.setDate(d.getDate() + n * 7);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  return { dari: geser(dari), sampai: geser(sampai) };
}

export default function OverviewPekerjaClient({
  initialData, dari: dariAwal, sampai: sampaiAwal,
}: {
  initialData: RingkasanPekerja[];
  dari: string;
  sampai: string;
}) {
  const [periode, setPeriode] = useState({ dari: dariAwal, sampai: sampaiAwal });
  const [data, setData] = useState<RingkasanPekerja[]>(initialData);
  const [isLoading, setIsLoading] = useState(false);
  const [terpilih, setTerpilih] = useState<RingkasanPekerja | null>(null);

  const mingguIni = periode.dari === dariAwal;

  const muat = useCallback(async (p: { dari: string; sampai: string }) => {
    setIsLoading(true);
    try {
      setData(await getOverviewPekerja(p.dari, p.sampai));
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
    upah: data.reduce((s, d) => s + d.total_upah, 0),
    belumLunas: data.reduce((s, d) => s + d.upah_belum_lunas, 0),
    sedangDikerjakan: data.reduce((s, d) => s + d.jml_sedang_dikerjakan, 0),
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
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KartuTotal icon={<Users className="w-4 h-4" />} label="Pekerja" nilai={String(total.pekerja)} />
        <KartuTotal icon={<Shirt className="w-4 h-4" />} label="Total Dikerjakan" nilai={`${total.pcs.toLocaleString('id-ID')} pcs`} />
        <KartuTotal icon={<Wallet className="w-4 h-4" />} label="Sedang Dikerjakan" nilai={`${total.sedangDikerjakan}×`} />
        <KartuTotal
          icon={<AlertCircle className="w-4 h-4" />}
          label="Perlu Dibayar"
          nilai={rupiah(total.belumLunas)}
          waspada={total.belumLunas > 0}
        />
      </div>

      {/* Kartu per pekerja */}
      {data.length === 0 ? (
        <div className="rounded-xl border border-[#2A2D31] bg-[#1A1D1F] px-4 py-16 text-center">
          <div className="text-[#9aa0a6] text-sm">Tidak ada upah yang perlu dibayar</div>
          <p className="text-[10px] text-[#9aa0a6]/50 mt-1">
            Semua sudah lunas. Coba lihat minggu sebelumnya lewat tombol panah.
          </p>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {data.map(p => {
            return (
              <button
                key={p.karyawan_id}
                onClick={() => setTerpilih(p)}
                className="text-left bg-[#1A1D1F] border border-[#2A2D31] rounded-xl p-4 hover:border-[#e5c17b]/50 hover:bg-[#1E2124] transition-colors group"
              >
                <div className="flex items-start justify-between gap-2 mb-3">
                  <div className="min-w-0">
                    <div className="font-bold text-[#e8eaed] truncate group-hover:text-[#e5c17b] transition-colors">
                      {p.nama}
                    </div>
                    <div className="text-[10px] text-[#9aa0a6] mt-0.5">{p.jabatan}</div>
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    {p.jml_belum_dibayar > 0 && (
                      <span className="text-[9px] font-bold uppercase tracking-wider px-2 py-1 rounded-full bg-orange-500/10 text-orange-400 border border-orange-500/20 whitespace-nowrap">
                        {p.jml_belum_dibayar} belum dibayar
                      </span>
                    )}
                    {p.jml_sedang_dikerjakan > 0 && (
                      <span className="text-[9px] font-bold uppercase tracking-wider px-2 py-1 rounded-full bg-sky-500/10 text-sky-300 border border-sky-500/20 whitespace-nowrap">
                        {p.jml_sedang_dikerjakan} sedang dikerjakan
                      </span>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 mb-3">
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-[#9aa0a6]">Dikerjakan</div>
                    <div className="text-lg font-bold text-[#e8eaed]">
                      {p.total_pcs.toLocaleString('id-ID')}
                      <span className="text-[10px] font-normal text-[#9aa0a6] ml-1">pcs</span>
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-[#9aa0a6]">Perlu Dibayar</div>
                    <div className="text-lg font-bold text-[#e5c17b]">{rupiah(p.total_upah)}</div>
                  </div>
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
                    {p.jumlah_pekerjaan}× · lihat rincian →
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {terpilih && (
        <ModalDetail
          pekerja={terpilih}
          periode={periode}
          onClose={() => setTerpilih(null)}
          onLunas={() => { setTerpilih(null); muat(periode); }}
        />
      )}
    </div>
  );
}

function KartuTotal({
  icon, label, nilai, waspada,
}: {
  icon: React.ReactNode; label: string; nilai: string; waspada?: boolean;
}) {
  return (
    <div className="bg-[#1A1D1F] border border-[#2A2D31] rounded-xl p-4">
      <div className={`flex items-center gap-2 text-[10px] uppercase tracking-widest font-bold ${
        waspada ? 'text-orange-400' : 'text-[#9aa0a6]'
      }`}>
        {icon}
        {label}
      </div>
      <div className={`text-xl font-bold mt-2 ${waspada ? 'text-orange-400' : 'text-[#e8eaed]'}`}>
        {nilai}
      </div>
    </div>
  );
}

// ─── Jendela rincian ─────────────────────────────────────────────────────────

function ModalDetail({
  pekerja, periode, onClose, onLunas,
}: {
  pekerja: RingkasanPekerja;
  periode: { dari: string; sampai: string };
  onClose: () => void;
  onLunas: () => void;
}) {
  const [rincian, setRincian] = useState<DetailPekerjaan[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [konfirmasiLunas, setKonfirmasiLunas] = useState(false);
  const [sedangLunas, setSedangLunas] = useState(false);

  const prosesLunas = async () => {
    setSedangLunas(true);
    try {
      const hasil = await lunaskanUpahPekerja(pekerja.karyawan_id, periode.dari, periode.sampai);
      toast.success(
        `${hasil.nama} dilunaskan — ${hasil.jumlah_entri} pekerjaan, ${rupiah(hasil.total)}`,
      );
      onLunas();
    } catch (e: any) {
      toast.error(e.message ?? 'Gagal melunaskan upah');
      setSedangLunas(false);
    }
  };

  useEffect(() => {
    let batal = false;
    getDetailPekerja(pekerja.karyawan_id, periode.dari, periode.sampai)
      .then(d => { if (!batal) setRincian(d); })
      .catch(e => { if (!batal) toast.error(e.message ?? 'Gagal memuat rincian'); })
      .finally(() => { if (!batal) setIsLoading(false); });
    return () => { batal = true; };
  }, [pekerja.karyawan_id, periode.dari, periode.sampai]);

  return (
    <div className="fixed inset-0 bg-black/75 flex items-center justify-center z-50 p-4">
      <div className="relative bg-[#1A1D1F] border border-[#2A2D31] rounded-xl w-full max-w-4xl shadow-2xl max-h-[90vh] flex flex-col">
        {/* Kepala */}
        <div className="px-6 py-4 border-b border-[#2A2D31] flex items-start justify-between gap-4">
          <div>
            <h3 className="text-base font-bold text-[#e8eaed]">{pekerja.nama}</h3>
            <p className="text-xs text-[#9aa0a6] mt-0.5">
              {pekerja.jabatan}
              <span className="mx-1.5 text-[#2A2D31]">|</span>
              {tanggalPendek(periode.dari)} – {tanggalPanjang(periode.sampai)}
            </p>
          </div>
          <button onClick={onClose} className="text-[#9aa0a6] hover:text-[#e8eaed] transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Ringkasan */}
        <div className="px-6 py-3 border-b border-[#2A2D31] grid grid-cols-3 gap-4 bg-[#16181A]">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-[#9aa0a6]">Dikerjakan</div>
            <div className="text-sm font-bold text-[#e8eaed]">{pekerja.total_pcs.toLocaleString('id-ID')} pcs</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-[#9aa0a6]">Perlu Dibayar</div>
            <div className="text-sm font-bold text-orange-400">{rupiah(pekerja.total_upah)}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-[#9aa0a6]">Sedang Dikerjakan</div>
            <div className="text-sm font-bold text-sky-300">
              {pekerja.jml_sedang_dikerjakan > 0 ? `${pekerja.jml_sedang_dikerjakan} pekerjaan` : '—'}
            </div>
          </div>
        </div>

        {/* Daftar pekerjaan */}
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
                  <th className="px-4 py-3 text-right font-bold">Harga/Pcs</th>
                  <th className="px-4 py-3 text-right font-bold">Upah</th>
                  <th className="px-4 py-3 text-center font-bold">Bayar</th>
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
                    <td className="px-4 py-3 text-center text-xs font-semibold text-[#e8eaed]">
                      {r.qty}
                    </td>
                    <td className="px-4 py-3 text-right text-xs text-[#9aa0a6] whitespace-nowrap">
                      {r.harga_per_pcs > 0 ? rupiah(r.harga_per_pcs) : '—'}
                    </td>
                    <td className="px-4 py-3 text-right text-xs font-semibold text-[#e5c17b] whitespace-nowrap">
                      {rupiah(r.upah)}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {r.keadaan === 'sedang_dikerjakan' ? (
                        <span className="text-[9px] font-bold uppercase tracking-wider px-2 py-1 rounded-full bg-sky-500/10 text-sky-300 border border-sky-500/20 whitespace-nowrap">
                          Sedang dikerjakan
                        </span>
                      ) : (
                        <span className="text-[9px] font-bold uppercase tracking-wider px-2 py-1 rounded-full bg-orange-500/10 text-orange-400 border border-orange-500/20 whitespace-nowrap">
                          Perlu dibayar
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="px-6 py-3 border-t border-[#2A2D31] flex items-center justify-between gap-3">
          <span className="text-[10px] text-[#9aa0a6] flex items-center gap-1.5">
            <Scissors className="w-3 h-3" />
            {rincian.length} pekerjaan tercatat
          </span>
          <div className="flex items-center gap-3">
            {pekerja.total_upah > 0 && (
              <button
                onClick={() => setKonfirmasiLunas(true)}
                disabled={sedangLunas}
                className="flex items-center gap-2 px-4 h-9 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold transition-colors disabled:opacity-50"
              >
                {sedangLunas
                  ? <Loader2 className="w-4 h-4 animate-spin" />
                  : <Wallet className="w-4 h-4" />}
                Tandai Lunas
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

        {konfirmasiLunas && (
          <div className="absolute inset-0 bg-black/80 flex items-center justify-center p-4 rounded-xl">
            <div className="bg-[#1A1D1F] border border-[#2A2D31] rounded-xl w-full max-w-sm p-5">
              <h4 className="text-base font-bold text-[#e8eaed] mb-2">Lunaskan upah {pekerja.nama}?</h4>
              <div className="bg-[#16181A] border border-[#2A2D31] rounded-lg px-4 py-3 text-sm text-[#e8eaed] mb-4">
                <span className="font-bold text-emerald-400">{rupiah(pekerja.total_upah)}</span>{' '}
                dari {pekerja.jml_belum_dibayar + pekerja.jml_sedang_dikerjakan} pekerjaan akan ditandai sudah dibayar.
                {pekerja.jml_sedang_dikerjakan > 0 && (
                  <p className="text-[10px] text-sky-300 mt-2">
                    Termasuk {pekerja.jml_sedang_dikerjakan} pekerjaan yang masih berjalan
                    ({rupiah(pekerja.upah_perkiraan)}) — dibayar dimuka sekarang, jadi tidak
                    akan tertagih lagi minggu depan saat selesai.
                  </p>
                )}
                <p className="text-[10px] text-[#9aa0a6] mt-2">
                  Setelah ini {pekerja.nama} tidak lagi muncul di halaman ini.
                </p>
              </div>
              <div className="flex items-center justify-end gap-3">
                <button
                  onClick={() => setKonfirmasiLunas(false)}
                  disabled={sedangLunas}
                  className="px-4 h-9 rounded-lg border border-[#2A2D31] text-[#e8eaed] text-sm hover:bg-[#2A2D31] transition-colors disabled:opacity-50"
                >
                  Batal
                </button>
                <button
                  onClick={prosesLunas}
                  disabled={sedangLunas}
                  className="flex items-center gap-2 px-4 h-9 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold transition-colors disabled:opacity-50"
                >
                  {sedangLunas
                    ? <Loader2 className="w-4 h-4 animate-spin" />
                    : <Wallet className="w-4 h-4" />}
                  Ya, Lunaskan
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
