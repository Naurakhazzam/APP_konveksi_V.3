'use client';

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { AlertTriangle, Calculator, Loader2, PackageSearch, RotateCcw, Truck, X } from 'lucide-react';
import type {
  JawabanSelisih, SelisihKirimRow, SelisihKirimStatus,
} from '@/lib/actions/pengiriman/selisih-kirim.actions';
import { batalJawabSelisihKirim, jawabSelisihKirim } from '@/lib/actions/pengiriman/selisih-kirim.actions';

const idr = (n: number) => 'Rp ' + Math.round(n).toLocaleString('id-ID');
const tgl = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }) : '-';

const STATUS_INFO: Record<SelisihKirimStatus, { label: string; cls: string }> = {
  menunggu:     { label: 'Menunggu penjelasan', cls: 'bg-red-900/30 text-red-300 border-red-700/40' },
  ketinggalan:  { label: 'Ketinggalan',         cls: 'bg-blue-900/30 text-blue-300 border-blue-700/40' },
  hilang:       { label: 'Hilang / rusak',      cls: 'bg-zinc-800 text-zinc-300 border-zinc-600/40' },
  salah_hitung: { label: 'Kantor salah hitung', cls: 'bg-amber-900/30 text-amber-300 border-amber-700/40' },
};

const PILIHAN: { value: JawabanSelisih; label: string; desc: string; icon: React.ElementType }[] = [
  {
    value: 'ketinggalan', label: 'Ketinggalan', icon: Truck,
    desc: 'Barangnya masih di konveksi. Pcs kembali ke daftar Buat Surat Jalan dan dikirim dengan surat jalan baru (ditagih di invoice baru).',
  },
  {
    value: 'hilang', label: 'Hilang / rusak di konveksi', icon: PackageSearch,
    desc: 'Barangnya tidak ada lagi. Ditutup permanen — tidak dikirim dan tidak ditagih. Wajib tulis keterangan.',
  },
  {
    value: 'salah_hitung', label: 'Kantor salah hitung', icon: Calculator,
    desc: 'Barangnya sebenarnya sampai. Surat jalan kembali ke Validasi Kirim supaya kantor menghitung ulang.',
  },
];

function StatusPill({ status }: { status: SelisihKirimStatus }) {
  const s = STATUS_INFO[status];
  return (
    <span className={`inline-flex whitespace-nowrap text-[10px] font-bold px-2 py-0.5 rounded border ${s.cls}`}>
      {s.label}
    </span>
  );
}

function JawabModal({ row, onClose, onDone }: { row: SelisihKirimRow; onClose: () => void; onDone: () => void }) {
  const [jawaban, setJawaban] = useState<JawabanSelisih | null>(null);
  const [ket, setKet] = useState('');
  const [busy, setBusy] = useState(false);

  const simpan = async () => {
    if (!jawaban) { toast.error('Pilih penjelasannya dulu'); return; }
    if (jawaban === 'hilang' && !ket.trim()) { toast.error('Tulis keterangan kenapa hilang/rusak'); return; }
    setBusy(true);
    try {
      await jawabSelisihKirim(row.id, jawaban, ket);
      toast.success(
        jawaban === 'ketinggalan' ? `${row.qty} pcs kembali ke daftar Buat Surat Jalan.`
        : jawaban === 'salah_hitung' ? `${row.nomor_sj} kembali ke Validasi Kirim.`
        : 'Selisih ditutup sebagai hilang/rusak.',
      );
      onDone();
    } catch (e: any) {
      toast.error(e.message || 'Gagal menyimpan');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-[#1A1D1F] border border-[#2A2D31] rounded-2xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-2xl">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h3 className="text-base font-bold text-[#e8eaed]">Jelaskan selisih {row.qty} pcs</h3>
            <p className="text-xs text-[#9aa0a6] mt-1">
              {row.nomor_sj} · {row.model_nama} {row.warna} {row.size} ({row.barcode}) — kirim {row.qty_kirim}, diterima {row.qty_diterima}
            </p>
          </div>
          <button onClick={onClose} className="text-[#9aa0a6] hover:text-[#e8eaed]"><X className="w-4 h-4" /></button>
        </div>

        <div className="space-y-2">
          {PILIHAN.map(p => {
            const Icon = p.icon;
            const aktif = jawaban === p.value;
            return (
              <button
                key={p.value}
                type="button"
                onClick={() => setJawaban(p.value)}
                className={`w-full text-left flex gap-3 rounded-xl border p-3 transition-colors ${
                  aktif ? 'border-[#e5c17b] bg-[#e5c17b]/10' : 'border-[#2A2D31] hover:border-[#9aa0a6]/50'
                }`}
              >
                <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${aktif ? 'text-[#e5c17b]' : 'text-[#9aa0a6]'}`} />
                <div>
                  <div className="text-sm font-semibold text-[#e8eaed]">{p.label}</div>
                  <div className="text-xs text-[#9aa0a6] mt-0.5">{p.desc}</div>
                </div>
              </button>
            );
          })}
        </div>

        <label className="block text-[10px] font-bold uppercase tracking-widest text-[#9aa0a6] mt-4 mb-1.5">
          Keterangan {jawaban === 'hilang' ? '(wajib)' : '(opsional)'}
        </label>
        <textarea
          value={ket}
          onChange={e => setKet(e.target.value)}
          rows={2}
          className="w-full bg-[#0D0E10] border border-[#2A2D31] text-[#e8eaed] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#e5c17b]"
          placeholder={jawaban === 'hilang' ? 'Mis. 2 pcs sobek saat packing, dibuang' : ''}
        />

        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="px-4 py-2 text-sm text-[#9aa0a6] hover:text-[#e8eaed]">Batal</button>
          <button
            onClick={simpan}
            disabled={busy || !jawaban}
            className="px-4 py-2 text-sm font-bold rounded-lg bg-[#e5c17b] text-[#0D0E10] hover:bg-[#d4b06a] disabled:opacity-50 inline-flex items-center gap-2"
          >
            {busy && <Loader2 className="w-4 h-4 animate-spin" />} Simpan
          </button>
        </div>
      </div>
    </div>
  );
}

export default function SelisihKirimClient({ rows, role }: { rows: SelisihKirimRow[]; role: string | null }) {
  const router = useRouter();
  const [tab, setTab] = useState<'menunggu' | 'selesai'>('menunggu');
  const [jawabRow, setJawabRow] = useState<SelisihKirimRow | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const isOwner = role === 'owner';
  const lihatNilai = role === 'owner' || role === 'admin_keuangan';

  const menunggu = useMemo(() => rows.filter(r => r.status === 'menunggu'), [rows]);
  const selesai = useMemo(() => rows.filter(r => r.status !== 'menunggu'), [rows]);
  const tampil = tab === 'menunggu' ? menunggu : selesai;

  const totalPcsMenunggu = menunggu.reduce((s, r) => s + r.qty, 0);
  const totalNilaiMenunggu = menunggu.reduce((s, r) => s + r.qty * r.harga_satuan, 0);

  const batal = async (r: SelisihKirimRow) => {
    setBusyId(r.id);
    try {
      await batalJawabSelisihKirim(r.id);
      toast.success('Jawaban dibatalkan — kembali menunggu penjelasan.');
      router.refresh();
    } catch (e: any) {
      toast.error(e.message || 'Gagal membatalkan');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2 bg-[#1A1D1F] border border-[#2A2D31] rounded-xl p-3">
        <AlertTriangle className="w-4 h-4 text-[#e5c17b] shrink-0 mt-0.5" />
        <p className="text-xs text-[#9aa0a6]">
          Pcs yang kurang <strong className="text-[#e8eaed]">tidak ditagih</strong> di invoice surat jalannya.
          {isOwner
            ? ' Jelaskan setiap selisih supaya tidak ada barang yang hilang dari catatan.'
            : ' Penjelasan selisih diisi oleh owner.'}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {(['menunggu', 'selesai'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 rounded-lg text-xs font-bold border transition-colors ${
              tab === t ? 'bg-[#e5c17b] text-[#0D0E10] border-[#e5c17b]' : 'bg-[#1A1D1F] text-[#9aa0a6] border-[#2A2D31] hover:text-[#e8eaed]'
            }`}
          >
            {t === 'menunggu' ? `Menunggu penjelasan (${menunggu.length})` : `Sudah dijelaskan (${selesai.length})`}
          </button>
        ))}
        {tab === 'menunggu' && menunggu.length > 0 && (
          <span className="text-xs text-[#9aa0a6] ml-auto">
            {totalPcsMenunggu} pcs{lihatNilai && <> · {idr(totalNilaiMenunggu)} belum ditagih</>}
          </span>
        )}
      </div>

      <div className="bg-[#1A1D1F] border border-[#2A2D31] rounded-2xl overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="text-[10px] text-[#9aa0a6] uppercase bg-[#0D0E10] border-b border-[#2A2D31]">
            <tr>
              <th className="px-3 py-2.5">Surat Jalan</th>
              <th className="px-3 py-2.5">Barang</th>
              <th className="px-3 py-2.5 text-right">Kirim</th>
              <th className="px-3 py-2.5 text-right">Diterima</th>
              <th className="px-3 py-2.5 text-right">Kurang</th>
              {lihatNilai && <th className="px-3 py-2.5 text-right">Nilai</th>}
              <th className="px-3 py-2.5">Status</th>
              <th className="px-3 py-2.5"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#2A2D31]/60">
            {tampil.length === 0 && (
              <tr>
                <td colSpan={lihatNilai ? 8 : 7} className="px-3 py-10 text-center text-[#9aa0a6]">
                  {tab === 'menunggu' ? 'Tidak ada selisih yang menunggu penjelasan.' : 'Belum ada selisih yang dijelaskan.'}
                </td>
              </tr>
            )}
            {tampil.map(r => (
              <tr key={r.id} className="align-top">
                <td className="px-3 py-2.5">
                  <Link href={`/app/pengiriman/riwayat/${r.surat_jalan_id}`} className="font-mono text-[#e5c17b] hover:underline">
                    {r.nomor_sj}
                  </Link>
                  <div className="text-[10px] text-[#9aa0a6]">{r.klien_nama} · kirim {tgl(r.tanggal_sj)}</div>
                  <div className="text-[10px] text-[#9aa0a6]">validasi {tgl(r.tanggal_validasi)}</div>
                </td>
                <td className="px-3 py-2.5">
                  <div className="font-medium text-[#e8eaed]">{r.model_nama}</div>
                  <div className="text-[10px] text-[#9aa0a6]">{r.warna} · {r.size}</div>
                  <div className="text-[10px] font-mono text-[#9aa0a6]">{r.no_po} · {r.barcode}</div>
                </td>
                <td className="px-3 py-2.5 text-right text-[#e8eaed]">{r.qty_kirim}</td>
                <td className="px-3 py-2.5 text-right text-[#e8eaed]">{r.qty_diterima}</td>
                <td className="px-3 py-2.5 text-right font-bold text-red-300">−{r.qty}</td>
                {lihatNilai && <td className="px-3 py-2.5 text-right text-[#9aa0a6]">{idr(r.qty * r.harga_satuan)}</td>}
                <td className="px-3 py-2.5">
                  <StatusPill status={r.status} />
                  {r.status === 'ketinggalan' && (
                    <div className="text-[10px] mt-1 text-[#9aa0a6]">
                      {r.sj_pengganti
                        ? <>dikirim ulang: <Link href={`/app/pengiriman/riwayat/${r.sj_pengganti.id}`} className="font-mono text-[#e5c17b] hover:underline">{r.sj_pengganti.nomor_sj}</Link></>
                        : 'belum dikirim ulang — ada di Buat Surat Jalan'}
                    </div>
                  )}
                  {r.keterangan && <div className="text-[10px] mt-1 text-[#9aa0a6] max-w-[220px]">“{r.keterangan}”</div>}
                  {r.dijawab_at && <div className="text-[10px] text-[#9aa0a6]/70">dijawab {tgl(r.dijawab_at)}</div>}
                </td>
                <td className="px-3 py-2.5 text-right whitespace-nowrap">
                  {isOwner && r.status === 'menunggu' && (
                    <button
                      onClick={() => setJawabRow(r)}
                      className="px-3 py-1.5 rounded-lg text-[11px] font-bold bg-[#e5c17b] text-[#0D0E10] hover:bg-[#d4b06a]"
                    >
                      Jelaskan
                    </button>
                  )}
                  {isOwner && (r.status === 'hilang' || (r.status === 'ketinggalan' && !r.sj_pengganti)) && (
                    <button
                      onClick={() => batal(r)}
                      disabled={busyId === r.id}
                      title="Batalkan jawaban (kembali menunggu)"
                      className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg text-[11px] text-[#9aa0a6] hover:text-[#e8eaed] border border-[#2A2D31] disabled:opacity-50"
                    >
                      {busyId === r.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />}
                      Batalkan
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {jawabRow && (
        <JawabModal
          row={jawabRow}
          onClose={() => setJawabRow(null)}
          onDone={() => { setJawabRow(null); router.refresh(); }}
        />
      )}
    </div>
  );
}
