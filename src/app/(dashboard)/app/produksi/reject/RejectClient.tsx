'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  RotateCcw,
  ShoppingBag,
  Barcode,
  Calendar,
  Layers,
  Tag,
  Package,
  Plus,
} from 'lucide-react';

import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import KonfirmasiRejectModal from './KonfirmasiRejectModal';
import SelesaiReworkButton from './SelesaiReworkButton';
import InputRejectModal from './InputRejectModal';
import InputRejectKonsumenModal from './InputRejectKonsumenModal';
import { EmptyState } from '@/components/ui/EmptyState';
import type { RejectRow, AlasanRejectOption } from '@/lib/actions/produksi/reject.actions';
import type { SuratJalanRow } from '@/lib/actions/pengiriman/surat-jalan.actions';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RejectClientProps {
  konfirmasiList: RejectRow[];
  reworkList: RejectRow[];
  selesaiList: RejectRow[];
  konsumenList: RejectRow[];
  alasanList: AlasanRejectOption[];
  suratJalanList: SuratJalanRow[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function formatTahap(tahap: string): string {
  const map: Record<string, string> = {
    cutting: 'Cutting',
    jahit: 'Jahit',
    buang_benang: 'Buang Benang',
    lubang_kancing: 'Lubang Kancing',
    qc: 'QC',
    steam: 'Steam',
    packing: 'Packing',
    pengiriman: 'Pengiriman',
  };
  return map[tahap] ?? tahap;
}

// ---------------------------------------------------------------------------
// Sub-components: Badge khusus reject
// ---------------------------------------------------------------------------

function JenisBadge({ label }: { label: string }) {
  return (
    <span
      className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold"
      style={{
        background: 'rgba(229,193,123,0.12)',
        color: '#e5c17b',
        border: '1px solid rgba(229,193,123,0.25)',
      }}
    >
      {label}
    </span>
  );
}

function StatusPill({ label, variant }: { label: string; variant: 'warning' | 'rework' | 'done' }) {
  const styles: Record<string, React.CSSProperties> = {
    warning: { background: 'rgba(239,68,68,0.12)', color: '#f87171', border: '1px solid rgba(239,68,68,0.25)' },
    rework:  { background: 'rgba(251,191,36,0.12)', color: '#fbbf24', border: '1px solid rgba(251,191,36,0.25)' },
    done:    { background: 'rgba(52,211,153,0.12)', color: '#34d399', border: '1px solid rgba(52,211,153,0.25)' },
  };
  return (
    <span
      className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold"
      style={styles[variant]}
    >
      {label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Sub-component: Kartu Reject (konfirmasi & rework)
// ---------------------------------------------------------------------------

interface RejectCardProps {
  row: RejectRow;
  action: React.ReactNode;
}

function RejectCard({ row, action }: RejectCardProps) {
  return (
    <div
      className="rounded-xl p-4 flex flex-col gap-3 transition-all hover:border-[#e5c17b]/30"
      style={{
        background: '#1A1D1F',
        border: '1px solid #2A2D31',
      }}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <JenisBadge label={row.jenis_nama} />
            {row.bisa_diperbaiki ? (
              <StatusPill label="Bisa Rework" variant="rework" />
            ) : (
              <StatusPill label="Permanen" variant="warning" />
            )}
          </div>
          <p className="text-[15px] font-semibold text-[#e8eaed] leading-snug mt-0.5">
            {row.alasan_nama}
          </p>
        </div>
        <div className="shrink-0">{action}</div>
      </div>

      {/* Detail grid */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
        <InfoItem
          icon={<Package size={13} />}
          label="Qty Reject"
          value={`${row.qty_reject} pcs`}
          highlight
        />
        <InfoItem
          icon={<Layers size={13} />}
          label="Tahap"
          value={formatTahap(row.tahap_ditemukan)}
        />
        <InfoItem
          icon={<Barcode size={13} />}
          label="Barcode"
          value={row.barcode ?? '—'}
        />
        <InfoItem
          icon={<Calendar size={13} />}
          label="Tanggal"
          value={formatDate(row.created_at)}
        />
      </div>

      {/* Keterangan */}
      {row.keterangan && (
        <p className="text-[12px] text-[#9aa0a6] italic border-t border-[#2A2D31] pt-2">
          {row.keterangan}
        </p>
      )}
    </div>
  );
}

function InfoItem({
  icon,
  label,
  value,
  highlight = false,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="flex items-center gap-1 text-[11px] text-[#9aa0a6]">
        {icon}
        {label}
      </span>
      <span
        className={`text-[13px] font-medium ${
          highlight ? 'text-[#e5c17b]' : 'text-[#e8eaed]'
        }`}
      >
        {value}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-component: Row selesai (tampilan ringkas read-only)
// ---------------------------------------------------------------------------

function SelesaiRow({ row }: { row: RejectRow }) {
  return (
    <div
      className="flex items-center gap-4 rounded-lg px-4 py-3 transition-colors hover:bg-white/[0.02]"
      style={{ borderBottom: '1px solid #2A2D31' }}
    >
      <CheckCircle2 size={16} className="shrink-0 text-emerald-400" />
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-medium text-[#e8eaed] truncate">{row.alasan_nama}</p>
        <p className="text-[11px] text-[#9aa0a6]">
          {row.jenis_nama} · {formatTahap(row.tahap_ditemukan)} · {row.barcode ?? 'No bundle'}
        </p>
      </div>
      <div className="text-right shrink-0">
        <p className="text-[13px] font-semibold text-[#e5c17b]">{row.qty_reject} pcs</p>
        <p className="text-[11px] text-[#9aa0a6]">{formatDate(row.created_at)}</p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab: Count badge
// ---------------------------------------------------------------------------

function CountBadge({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <span
      className="ml-1.5 inline-flex items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-bold leading-none"
      style={{ background: '#e5c17b', color: '#0D0E10', minWidth: '16px' }}
    >
      {count}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Main Client Component
// ---------------------------------------------------------------------------

const TABS = [
  { value: 'konfirmasi', label: 'Perlu Konfirmasi' },
  { value: 'rework',     label: 'Rework' },
  { value: 'selesai',    label: 'Selesai' },
  { value: 'konsumen',   label: 'Reject Konsumen' },
] as const;

type TabValue = (typeof TABS)[number]['value'];

export default function RejectClient({
  konfirmasiList,
  reworkList,
  selesaiList,
  konsumenList,
  alasanList,
  suratJalanList,
}: RejectClientProps) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<TabValue>('konfirmasi');
  const [selectedRejectId, setSelectedRejectId] = useState<string | null>(null);
  const [showKonfirmasiModal, setShowKonfirmasiModal] = useState(false);
  const [showInputModal, setShowInputModal] = useState(false);
  const [showKonsumenModal, setShowKonsumenModal] = useState(false);

  return (
    <div className="space-y-5 pt-4">
      {/* ── Modal Konfirmasi ── */}
      {showKonfirmasiModal && selectedRejectId !== null && (
        <KonfirmasiRejectModal
          rejectId={selectedRejectId}
          onClose={() => setShowKonfirmasiModal(false)}
          onSuccess={() => {
            setShowKonfirmasiModal(false);
            router.refresh();
          }}
        />
      )}

      {/* ── Modal Input Reject ── */}
      {showInputModal && (
        <InputRejectModal
          alasanList={alasanList}
          onClose={() => setShowInputModal(false)}
          onSuccess={() => {
            setShowInputModal(false);
            router.refresh();
          }}
        />
      )}

      {/* ── Modal Reject Konsumen ── */}
      {showKonsumenModal && (
        <InputRejectKonsumenModal
          alasanList={alasanList}
          suratJalanList={suratJalanList}
          onClose={() => setShowKonsumenModal(false)}
          onSuccess={() => {
            setShowKonsumenModal(false);
            router.refresh();
          }}
        />
      )}

      {/* ── Tab Bar ── */}
      <Tabs
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as TabValue)}
      >
        <div className="flex items-center gap-3 flex-wrap">
          <TabsList
            className="h-auto p-1 gap-1"
            style={{ background: '#1A1D1F', border: '1px solid #2A2D31' }}
          >
          {TABS.map((tab) => {
            const count =
              tab.value === 'konfirmasi'
                ? konfirmasiList.length
                : tab.value === 'rework'
                  ? reworkList.length
                  : tab.value === 'selesai'
                    ? selesaiList.length
                    : 0;

            return (
              <TabsTrigger
                key={tab.value}
                value={tab.value}
                className="px-3 py-1.5 text-sm rounded-md"
              >
                {tab.value === 'konfirmasi' && <AlertTriangle size={13} className="mr-1" />}
                {tab.value === 'rework'     && <RotateCcw     size={13} className="mr-1" />}
                {tab.value === 'selesai'    && <CheckCircle2  size={13} className="mr-1" />}
                {tab.value === 'konsumen'   && <ShoppingBag   size={13} className="mr-1" />}
                {tab.label}
                <CountBadge count={count} />
              </TabsTrigger>
            );
          })}
          </TabsList>

          {/* ── Tombol Input Reject ── */}
          <Button
            size="sm"
            onClick={() => setShowInputModal(true)}
            className="ml-auto gap-1.5 font-semibold"
            style={{
              background: '#e5c17b',
              color: '#0D0E10',
              border: 'none',
            }}
          >
            <Plus className="h-4 w-4" />
            Input Reject
          </Button>
        </div>
        {/* ── Tab: Perlu Konfirmasi ── */}
        <TabsContent value="konfirmasi" className="mt-5">
          {konfirmasiList.length === 0 ? (
            <EmptyState
              icon={<ClipboardList size={32} strokeWidth={1.5} />}
              title="Tidak ada reject yang menunggu konfirmasi"
              description="Semua reject sudah dikonfirmasi atau belum ada laporan masuk."
            />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {konfirmasiList.map((row) => (
                <RejectCard
                  key={row.id}
                  row={row}
                  action={
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-[#e5c17b] border-[#e5c17b]/30 hover:bg-[#e5c17b]/10 hover:border-[#e5c17b]/60 whitespace-nowrap"
                      onClick={() => {
                        setSelectedRejectId(row.id);
                        setShowKonfirmasiModal(true);
                      }}
                    >
                      <Tag size={13} className="mr-1.5" />
                      Lihat & Konfirmasi
                    </Button>
                  }
                />
              ))}
            </div>
          )}
        </TabsContent>

        {/* ── Tab: Rework ── */}
        <TabsContent value="rework" className="mt-5">
          {reworkList.length === 0 ? (
            <EmptyState
              icon={<RotateCcw size={32} strokeWidth={1.5} />}
              title="Tidak ada item dalam proses rework"
              description="Item yang sedang dirework akan muncul di sini."
            />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {reworkList.map((row) => (
                <RejectCard
                  key={row.id}
                  row={row}
                  action={
                    <SelesaiReworkButton
                      rejectLogId={row.id}
                      nomorReject={row.nomor_reject ?? row.id}
                      onSuccess={() => router.refresh()}
                    />
                  }
                />
              ))}
            </div>
          )}
        </TabsContent>

        {/* ── Tab: Selesai ── */}
        <TabsContent value="selesai" className="mt-5">
          {selesaiList.length === 0 ? (
            <EmptyState
              icon={<CheckCircle2 size={32} strokeWidth={1.5} />}
              title="Belum ada reject yang selesai"
              description="Reject yang sudah dirework dan dikonfirmasi akan tercatat di sini."
            />
          ) : (
            <div
              className="rounded-xl overflow-hidden"
              style={{ background: '#1A1D1F', border: '1px solid #2A2D31' }}
            >
              {/* Header */}
              <div
                className="flex items-center gap-2 px-4 py-3"
                style={{ borderBottom: '1px solid #2A2D31', background: '#16181A' }}
              >
                <CheckCircle2 size={14} className="text-emerald-400" />
                <span className="text-[13px] font-semibold text-[#e8eaed]">
                  Riwayat Reject Selesai
                </span>
                <Badge
                  variant="outline"
                  className="ml-auto text-[11px]"
                  style={{ color: '#9aa0a6', borderColor: '#2A2D31' }}
                >
                  {selesaiList.length} item
                </Badge>
              </div>
              {/* Rows */}
              <div>
                {selesaiList.map((row) => (
                  <SelesaiRow key={row.id} row={row} />
                ))}
              </div>
            </div>
          )}
        </TabsContent>

        {/* ── Tab: Reject Konsumen ── */}
        <TabsContent value="konsumen" className="mt-5">
          <div className="space-y-5">

            {/* ── Header row: tombol + counter ── */}
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <ShoppingBag size={15} className="text-[#e5c17b]" />
                <span className="text-sm font-semibold text-[#e8eaed]">
                  Reject dari Konsumen
                </span>
                {konsumenList.length > 0 && (
                  <Badge
                    variant="outline"
                    className="text-[11px]"
                    style={{ color: '#e5c17b', borderColor: 'rgba(229,193,123,0.3)' }}
                  >
                    {konsumenList.length} item
                  </Badge>
                )}
              </div>
              <Button
                size="sm"
                onClick={() => setShowKonsumenModal(true)}
                className="gap-1.5 font-semibold"
                style={{
                  background: '#e5c17b',
                  color: '#0D0E10',
                  border: 'none',
                }}
              >
                <Plus className="h-4 w-4" />
                Input Reject Konsumen
              </Button>
            </div>

            {/* ── List ── */}
            {konsumenList.length === 0 ? (
              <EmptyState
                icon={<ShoppingBag size={32} strokeWidth={1.5} />}
                title="Belum ada reject konsumen"
                description="Reject retur dari konsumen akan muncul di sini setelah dicatat."
              />
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {konsumenList.map((row) => (
                  <RejectCard
                    key={row.id}
                    row={row}
                    action={
                      row.status === 'menunggu_konfirmasi' ? (
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-[#e5c17b] border-[#e5c17b]/30 hover:bg-[#e5c17b]/10 hover:border-[#e5c17b]/60 whitespace-nowrap"
                          onClick={() => {
                            setSelectedRejectId(row.id);
                            setShowKonfirmasiModal(true);
                          }}
                        >
                          <Tag size={13} className="mr-1.5" />
                          Lihat & Konfirmasi
                        </Button>
                      ) : (
                        <span
                          className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold"
                          style={{
                            background: 'rgba(52,211,153,0.12)',
                            color: '#34d399',
                            border: '1px solid rgba(52,211,153,0.25)',
                          }}
                        >
                          <CheckCircle2 size={11} className="mr-1" />
                          {row.status}
                        </span>
                      )
                    }
                  />
                ))}
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
