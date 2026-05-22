'use client';

import React, { useState, useMemo } from 'react';
import { toast } from 'sonner';
import {
  ChevronDown, ChevronRight, CheckCircle2, AlertTriangle,
  Clock, Loader2, ShieldCheck, X,
} from 'lucide-react';
import type {
  SuratJalanSiapValidasi,
  SuratJalanItemValidasi,
  ValidasiItemInput,
} from '@/lib/actions/pengiriman/validasi-pengiriman.actions';
import {
  submitValidasiPengiriman,
  approveQtyLebihPengiriman,
} from '@/lib/actions/pengiriman/validasi-pengiriman.actions';
import type { AlasanRejectOption } from '@/lib/actions/produksi/reject.actions';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Props {
  initialSjList: SuratJalanSiapValidasi[];
  alasanList: AlasanRejectOption[];
}

interface PendingApproval {
  approval_id: string;
  barcode: string;
  qty_lebih: number;
  nilai_lebih: number;
}

// ─── Status Badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    dikirim:       { label: 'Menunggu Validasi', cls: 'bg-blue-900/30 text-blue-300 border-blue-700/40' },
    tervalidasi:   { label: 'Tervalidasi ✓',    cls: 'bg-emerald-900/30 text-emerald-300 border-emerald-700/40' },
    selisih_kurang:{ label: 'Selisih Kurang ⚠',  cls: 'bg-red-900/30 text-red-300 border-red-700/40' },
    selisih_lebih: { label: 'Pending Approval',  cls: 'bg-amber-900/30 text-amber-300 border-amber-700/40' },
  };
  const { label, cls } = map[status] ?? { label: status, cls: 'bg-[#2A2D31] text-[#9aa0a6] border-[#2A2D31]' };
  return (
    <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border ${cls}`}>
      {label}
    </span>
  );
}

// ─── Selisih Cell ─────────────────────────────────────────────────────────────

function SelisihCell({ kirim, diterima }: { kirim: number; diterima: number | null }) {
  if (diterima === null) return <span className="text-[#9aa0a6] text-xs">—</span>;
  const diff = diterima - kirim;
  if (diff === 0) return <span className="text-emerald-400 text-xs font-bold">✓ 0</span>;
  if (diff < 0) return (
    <span className="text-red-400 text-xs font-bold">
      {diff}
      <span className="block text-[9px] font-normal mt-0.5 text-red-500">→ catat reject</span>
    </span>
  );
  return (
    <span className="text-amber-400 text-xs font-bold">
      +{diff}
      <span className="block text-[9px] font-normal mt-0.5 text-amber-500">→ perlu approval</span>
    </span>
  );
}

// ─── PIN Modal ────────────────────────────────────────────────────────────────

function PinApprovalModal({
  pending,
  onApprove,
  onSkip,
}: {
  pending: PendingApproval;
  onApprove: (pin: string) => Promise<void>;
  onSkip: () => void;
}) {
  const [pin, setPin] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    if (!pin) { toast.error('Masukkan PIN terlebih dahulu'); return; }
    setLoading(true);
    try {
      await onApprove(pin);
    } finally {
      setLoading(false);
      setPin('');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-[#1A1D1F] border border-[#2A2D31] rounded-2xl p-6 w-full max-w-sm shadow-2xl animate-in zoom-in-95 duration-200">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-900/30 flex items-center justify-center">
              <ShieldCheck className="w-5 h-5 text-amber-400" />
            </div>
            <div>
              <div className="text-sm font-bold text-[#e8eaed]">Approval Kelebihan QTY</div>
              <div className="text-[10px] text-[#9aa0a6] mt-0.5">Verifikasi PIN owner</div>
            </div>
          </div>
          <button onClick={onSkip} className="text-[#9aa0a6] hover:text-[#e8eaed] transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="bg-[#0D0E10] rounded-xl p-3 mb-4 space-y-1 text-xs">
          <div className="text-[#9aa0a6]">Bundle: <span className="text-[#e8eaed] font-mono">{pending.barcode}</span></div>
          <div className="text-[#9aa0a6]">
            Kelebihan:{' '}
            <span className="text-amber-400 font-bold">+{pending.qty_lebih} pcs</span>
          </div>
          {pending.nilai_lebih > 0 && (
            <div className="text-[#9aa0a6]">
              Nilai tambah:{' '}
              <span className="text-emerald-400 font-bold">
                Rp {pending.nilai_lebih.toLocaleString('id-ID')}
              </span>
            </div>
          )}
        </div>

        <div className="mb-4">
          <label className="block text-[10px] font-bold uppercase tracking-widest text-[#9aa0a6] mb-1.5">
            PIN Owner
          </label>
          <input
            type="password"
            value={pin}
            onChange={e => setPin(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSubmit()}
            placeholder="••••••"
            className="w-full bg-[#0D0E10] border border-[#2A2D31] text-[#e8eaed] rounded-xl px-4 py-3 text-sm text-center tracking-[0.4em] focus:outline-none focus:border-[#e5c17b] transition-colors"
            autoFocus
          />
        </div>

        <div className="flex gap-2">
          <button
            onClick={onSkip}
            disabled={loading}
            className="flex-1 py-2.5 rounded-xl border border-[#2A2D31] text-xs font-semibold text-[#9aa0a6] hover:bg-[#2A2D31] transition-colors disabled:opacity-40"
          >
            Lewati
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading || !pin}
            className="flex-1 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-500 text-xs font-bold text-white transition-colors disabled:opacity-40 flex items-center justify-center gap-2"
          >
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ShieldCheck className="w-3.5 h-3.5" />}
            Approve
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Validasi Form (per SJ) ───────────────────────────────────────────────────

function ValidasiForm({
  sj,
  alasanList,
  onDone,
}: {
  sj: SuratJalanSiapValidasi;
  alasanList: AlasanRejectOption[];
  onDone: () => void;
}) {
  // qty_diterima per item (keyed by surat_jalan_item_id)
  const [qtys, setQtys] = useState<Record<string, number>>(() => {
    const init: Record<string, number> = {};
    sj.items.forEach(it => { init[it.surat_jalan_item_id] = it.qty_kirim; });
    return init;
  });
  // alasan per item (untuk yang kurang)
  const [alasans, setAlasans] = useState<Record<string, string>>({});
  const [catatan, setCatatan] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Pending approval queue setelah submit
  const [pendingApprovals, setPendingApprovals] = useState<PendingApproval[]>([]);
  const [currentApprovalIdx, setCurrentApprovalIdx] = useState(0);

  const selisih = (itemId: string, qtyKirim: number) => {
    const diterima = qtys[itemId] ?? qtyKirim;
    return diterima - qtyKirim;
  };

  const hasAnyKurang = sj.items.some(it => selisih(it.surat_jalan_item_id, it.qty_kirim) < 0);

  const handleSubmit = async () => {
    // Validasi: item kurang wajib pilih alasan
    const missingAlasan = sj.items.filter(it => {
      const s = selisih(it.surat_jalan_item_id, it.qty_kirim);
      return s < 0 && !alasans[it.surat_jalan_item_id];
    });
    if (missingAlasan.length > 0) {
      toast.error(`Pilih alasan reject untuk ${missingAlasan.length} item yang kurang`);
      return;
    }

    setSubmitting(true);
    try {
      const items: ValidasiItemInput[] = sj.items.map(it => ({
        surat_jalan_item_id: it.surat_jalan_item_id,
        qty_diterima: qtys[it.surat_jalan_item_id] ?? it.qty_kirim,
        alasan_reject_id: alasans[it.surat_jalan_item_id] ?? null,
      }));

      const result = await submitValidasiPengiriman(sj.id, items, catatan);

      if (result.has_lebih && result.approval_ids?.length > 0) {
        // Build pending approval list untuk modal PIN
        const queue: PendingApproval[] = result.approval_ids.map((approval_id, idx) => {
          const lebihItem = sj.items.filter(
            it => selisih(it.surat_jalan_item_id, it.qty_kirim) > 0
          )[idx];
          const qtyL = lebihItem ? (qtys[lebihItem.surat_jalan_item_id] - lebihItem.qty_kirim) : 0;
          return {
            approval_id,
            barcode: lebihItem?.barcode ?? '-',
            qty_lebih: qtyL,
            nilai_lebih: qtyL * (lebihItem?.harga_satuan ?? 0),
          };
        });
        setPendingApprovals(queue);
        setCurrentApprovalIdx(0);
        toast.info('Validasi disimpan. Diperlukan approval untuk qty lebih.');
      } else {
        toast.success('Validasi berhasil disimpan!');
        onDone();
      }
    } catch (err: any) {
      toast.error(err.message || 'Gagal submit validasi');
    } finally {
      setSubmitting(false);
    }
  };

  const handleApprove = async (pin: string) => {
    const current = pendingApprovals[currentApprovalIdx];
    try {
      await approveQtyLebihPengiriman(current.approval_id, pin, 'approved');
      toast.success(`Kelebihan ${current.barcode} disetujui`);
      if (currentApprovalIdx + 1 < pendingApprovals.length) {
        setCurrentApprovalIdx(i => i + 1);
      } else {
        setPendingApprovals([]);
        toast.success('Semua approval selesai!');
        onDone();
      }
    } catch (err: any) {
      toast.error(err.message || 'Gagal approve');
    }
  };

  const handleSkipApproval = () => {
    if (currentApprovalIdx + 1 < pendingApprovals.length) {
      setCurrentApprovalIdx(i => i + 1);
    } else {
      setPendingApprovals([]);
      onDone();
    }
  };

  return (
    <>
      {/* PIN Modal */}
      {pendingApprovals.length > 0 && (
        <PinApprovalModal
          pending={pendingApprovals[currentApprovalIdx]}
          onApprove={handleApprove}
          onSkip={handleSkipApproval}
        />
      )}

      <div className="mt-4 border-t border-[#2A2D31] pt-4 space-y-4">
        {/* Tabel validasi */}
        <div className="overflow-x-auto rounded-lg border border-[#2A2D31]">
          <table className="w-full text-sm text-left">
            <thead className="text-[10px] text-[#9aa0a6] uppercase bg-[#0D0E10] border-b border-[#2A2D31]">
              <tr>
                <th className="px-3 py-2.5">Barcode</th>
                <th className="px-3 py-2.5">Model / Warna / Size</th>
                <th className="px-3 py-2.5">PO</th>
                <th className="px-3 py-2.5 text-right">Qty Kirim</th>
                <th className="px-3 py-2.5 text-center w-28">Qty Diterima</th>
                <th className="px-3 py-2.5 text-center">Selisih</th>
                <th className="px-3 py-2.5">Alasan (jika kurang)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#2A2D31]/60">
              {sj.items.map(it => {
                const s = selisih(it.surat_jalan_item_id, it.qty_kirim);
                const rowBg = s < 0
                  ? 'bg-red-950/10'
                  : s > 0
                  ? 'bg-amber-950/10'
                  : '';

                return (
                  <tr key={it.surat_jalan_item_id} className={`transition-colors ${rowBg}`}>
                    <td className="px-3 py-2">
                      <span className="font-mono text-xs text-[#9aa0a6]">{it.barcode}</span>
                    </td>
                    <td className="px-3 py-2">
                      <div className="text-xs font-medium text-[#e8eaed]">{it.model_nama || '-'}</div>
                      <div className="text-[10px] text-[#9aa0a6]">{it.warna} · {it.size}</div>
                    </td>
                    <td className="px-3 py-2">
                      <span className="text-[10px] font-mono text-[#e5c17b]">{it.no_po}</span>
                    </td>
                    <td className="px-3 py-2 text-right text-xs font-bold text-[#e8eaed]">
                      {it.qty_kirim}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <input
                        type="number"
                        min={0}
                        value={qtys[it.surat_jalan_item_id] ?? it.qty_kirim}
                        onChange={e => setQtys(prev => ({
                          ...prev,
                          [it.surat_jalan_item_id]: Math.max(0, parseInt(e.target.value) || 0),
                        }))}
                        className="w-20 bg-[#0D0E10] border border-[#2A2D31] text-[#e8eaed] rounded-lg px-2 py-1.5 text-xs text-center focus:outline-none focus:border-[#e5c17b] transition-colors"
                      />
                    </td>
                    <td className="px-3 py-2 text-center">
                      <SelisihCell kirim={it.qty_kirim} diterima={qtys[it.surat_jalan_item_id] ?? it.qty_kirim} />
                    </td>
                    <td className="px-3 py-2">
                      {s < 0 ? (
                        <select
                          value={alasans[it.surat_jalan_item_id] ?? ''}
                          onChange={e => setAlasans(prev => ({
                            ...prev,
                            [it.surat_jalan_item_id]: e.target.value,
                          }))}
                          className="w-full bg-[#0D0E10] border border-red-800/40 text-[#e8eaed] rounded-lg px-2 py-1.5 text-[10px] focus:outline-none focus:border-red-500 transition-colors"
                        >
                          <option value="">— Pilih Alasan —</option>
                          {alasanList.map(a => (
                            <option key={a.id} value={a.id}>
                              {a.jenis_nama} — {a.nama}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className="text-[10px] text-[#9aa0a6]">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Catatan + warning */}
        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-widest text-[#9aa0a6] mb-1.5">
              Catatan Validasi (opsional)
            </label>
            <input
              type="text"
              value={catatan}
              onChange={e => setCatatan(e.target.value)}
              placeholder="Catatan kondisi barang, keterangan, dll..."
              className="w-full bg-[#0D0E10] border border-[#2A2D31] text-[#e8eaed] rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-[#e5c17b] transition-colors"
            />
          </div>
          {hasAnyKurang && (
            <div className="flex items-start gap-2 bg-red-950/20 border border-red-800/30 rounded-xl p-3">
              <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
              <p className="text-xs text-red-300">
                Item dengan qty kurang akan dicatat sebagai <strong>reject pengiriman</strong> dengan alasan yang dipilih.
              </p>
            </div>
          )}
        </div>

        {/* Submit button */}
        <div className="flex justify-end">
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="px-8 py-2.5 bg-[#e5c17b] hover:bg-[#d4b06a] text-[#0D0E10] rounded-xl text-sm font-black uppercase tracking-widest transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            {submitting
              ? <><Loader2 className="w-4 h-4 animate-spin" /> Memproses...</>
              : <><CheckCircle2 className="w-4 h-4" /> Submit Validasi</>
            }
          </button>
        </div>
      </div>
    </>
  );
}

// ─── SJ Card ──────────────────────────────────────────────────────────────────

function SJCard({
  sj,
  alasanList,
  isExpanded,
  onToggle,
}: {
  sj: SuratJalanSiapValidasi;
  alasanList: AlasanRejectOption[];
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const [done, setDone] = useState(false);

  return (
    <div className={`bg-[#1A1D1F] border rounded-xl overflow-hidden transition-colors ${
      isExpanded ? 'border-[#e5c17b]/30' : 'border-[#2A2D31]'
    }`}>
      {/* Card header — klik untuk expand */}
      <button
        onClick={onToggle}
        className="w-full text-left px-5 py-4 flex items-center justify-between gap-4 hover:bg-[#0D0E10]/30 transition-colors"
      >
        <div className="flex items-center gap-4 flex-1 min-w-0">
          <div className="shrink-0">
            {sj.status === 'tervalidasi'
              ? <CheckCircle2 className="w-5 h-5 text-emerald-400" />
              : sj.status === 'selisih_kurang'
              ? <AlertTriangle className="w-5 h-5 text-red-400" />
              : sj.status === 'selisih_lebih'
              ? <AlertTriangle className="w-5 h-5 text-amber-400" />
              : <Clock className="w-5 h-5 text-blue-400" />
            }
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-bold text-[#e8eaed] text-sm">{sj.nomor_sj}</span>
              <StatusBadge status={done ? 'tervalidasi' : sj.status} />
            </div>
            <div className="text-[10px] text-[#9aa0a6] mt-0.5">
              {sj.klien_nama}
              <span className="mx-1.5 text-[#2A2D31]">·</span>
              {new Date(sj.tanggal).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}
              <span className="mx-1.5 text-[#2A2D31]">·</span>
              {sj.total_bundle} bundle · {sj.total_qty_kirim} pcs
            </div>
          </div>
        </div>
        {!done && (
          isExpanded
            ? <ChevronDown className="w-4 h-4 text-[#9aa0a6] shrink-0" />
            : <ChevronRight className="w-4 h-4 text-[#9aa0a6] shrink-0" />
        )}
      </button>

      {/* Form validasi — muncul saat expanded */}
      {isExpanded && !done && (
        <div className="px-5 pb-5">
          <ValidasiForm
            sj={sj}
            alasanList={alasanList}
            onDone={() => setDone(true)}
          />
        </div>
      )}

      {done && (
        <div className="px-5 pb-4">
          <div className="flex items-center gap-2 text-xs text-emerald-400 bg-emerald-900/20 border border-emerald-800/30 rounded-lg px-3 py-2">
            <CheckCircle2 className="w-4 h-4" />
            Validasi berhasil disimpan
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main Client Component ────────────────────────────────────────────────────

export default function ValidasiClient({ initialSjList, alasanList }: Props) {
  const [expandedId, setExpandedId] = useState<string | null>(
    initialSjList.length === 1 ? initialSjList[0].id : null
  );

  if (initialSjList.length === 0) {
    return (
      <div className="bg-[#1A1D1F] border border-[#2A2D31] rounded-xl p-12 text-center">
        <CheckCircle2 className="w-12 h-12 text-emerald-400 mx-auto mb-3" />
        <p className="text-[#e8eaed] font-semibold">Semua Pengiriman Sudah Tervalidasi</p>
        <p className="text-sm text-[#9aa0a6] mt-1">Tidak ada surat jalan yang menunggu konfirmasi penerimaan.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="text-xs text-[#9aa0a6]">
        {initialSjList.length} surat jalan menunggu validasi — klik untuk mengisi form
      </div>

      {initialSjList.map(sj => (
        <SJCard
          key={sj.id}
          sj={sj}
          alasanList={alasanList}
          isExpanded={expandedId === sj.id}
          onToggle={() => setExpandedId(prev => prev === sj.id ? null : sj.id)}
        />
      ))}
    </div>
  );
}
