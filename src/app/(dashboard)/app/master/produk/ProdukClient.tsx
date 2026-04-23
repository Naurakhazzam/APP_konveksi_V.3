'use client';

import React, { useState, useCallback, useEffect } from 'react';
import { Database, Folder, ChevronLeft, Plus, Upload, Download } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/EmptyState';
import { TabelProduk, type ProdukRow } from './TabelProduk';
import { FormTambahProduk } from './FormTambahProduk';
import { HppEditorPanel } from './HppEditorPanel';
import { ImportCSVModal } from './ImportCSVModal';
import { getProduk } from '@/lib/actions/master/produk.actions';
import { getProdukForExport } from '@/lib/actions/master/produk-csv.actions';
import { permissions } from '@/lib/auth/permissions';

// ─────────────────────────────────────────────────────────────────────────────
// Types (plain objects dari Server Component — tidak boleh ada method/class)
// ─────────────────────────────────────────────────────────────────────────────

export interface KategoriItem {
  id: string;
  nama: string;
}

export interface ModelItem {
  id: string;
  nama: string;
  kategori_id: string;
  jumlah_produk: number;
}

export interface SizeItem {
  id: string;
  nama: string;
  urutan: number;
}

export interface WarnaItem {
  id: string;
  nama: string;
  kode_hex: string | null;
}

export interface KomponenItem {
  id: string;
  nama: string;
  kategori: string;
  aktif: boolean;
  satuan: { nama: string } | null;
}

export interface ProdukClientProps {
  isOwner: boolean;
  canSeeFinance?: boolean;
  masterKategori: KategoriItem[];
  masterModel: ModelItem[];
  masterSize: SizeItem[];
  masterWarna: WarnaItem[];
  masterKomponen: KomponenItem[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components: Kartu Kategori & Model
// ─────────────────────────────────────────────────────────────────────────────

function KategoriCard({ kategori, modelCount, onClick }: { kategori: KategoriItem; modelCount: number; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="group flex flex-col gap-3 rounded-xl border border-[#2A2D31] bg-[#16181A] p-5 text-left transition-all duration-200 hover:border-[#e5c17b]/40 hover:bg-[#1E2124] hover:shadow-[0_0_16px_rgba(229,193,123,0.06)] focus:outline-none focus:ring-1 focus:ring-[#e5c17b]/40"
    >
      <div className="flex items-center justify-between">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#e5c17b]/10 text-[#e5c17b] transition-colors group-hover:bg-[#e5c17b]/20">
          <Database size={20} />
        </div>
        <span className="text-xs text-[#5f6368] group-hover:text-[#9aa0a6]">
          {modelCount} model
        </span>
      </div>
      <div>
        <p className="font-semibold text-[#e8eaed] group-hover:text-white">{kategori.nama}</p>
        <p className="mt-0.5 text-xs text-[#777e85]">Klik untuk buka model →</p>
      </div>
    </button>
  );
}

function ModelCard({ model, onClick }: { model: ModelItem; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="group flex flex-col gap-3 rounded-xl border border-[#2A2D31] bg-[#16181A] p-5 text-left transition-all duration-200 hover:border-[#60a5fa]/40 hover:bg-[#1E2124] hover:shadow-[0_0_16px_rgba(96,165,250,0.06)] focus:outline-none focus:ring-1 focus:ring-[#60a5fa]/40"
    >
      <div className="flex items-center justify-between">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#60a5fa]/10 text-[#60a5fa] transition-colors group-hover:bg-[#60a5fa]/20">
          <Folder size={20} />
        </div>
        <span className="text-xs text-[#5f6368] group-hover:text-[#9aa0a6]">
          {model.jumlah_produk} SKU
        </span>
      </div>
      <div>
        <p className="font-semibold text-[#e8eaed] group-hover:text-white">{model.nama}</p>
        <p className="mt-0.5 text-xs text-[#777e85]">Klik untuk lihat SKU →</p>
      </div>
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Breadcrumb
// ─────────────────────────────────────────────────────────────────────────────

function Breadcrumb({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-lg border border-[#2A2D31] bg-[#16181A] px-3 py-1.5 text-sm text-[#9aa0a6] transition-colors hover:border-[#e5c17b]/30 hover:text-[#e5c17b]"
    >
      <ChevronLeft size={14} />
      {label}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main ProdukClient
// ─────────────────────────────────────────────────────────────────────────────

export function ProdukClient({
  isOwner,
  canSeeFinance = false,
  masterKategori,
  masterModel,
  masterSize,
  masterWarna,
  masterKomponen,
}: ProdukClientProps) {
  // viewPath[]: [] = level 0 (kategori), [katId] = level 1 (model), [katId, modelId] = level 2 (SKU)
  const router = useRouter();
  const [viewPath, setViewPath] = useState<string[]>([]);
  const [selectedProdukId, setSelectedProdukId] = useState<string | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [exportLoading, setExportLoading] = useState(false);
  const [produkList, setProdukList] = useState<ProdukRow[]>([]);
  const [loadingProduk, setLoadingProduk] = useState(false);

  const handleExport = async () => {
    setExportLoading(true);
    try {
      const csv = await getProdukForExport();
      const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `produk-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a); a.click();
      document.body.removeChild(a); URL.revokeObjectURL(url);
    } catch (err: any) { alert('Gagal export: ' + err.message); }
    finally { setExportLoading(false); }
  };

  const currentModelId = viewPath[1] ?? null;

  // Fetch produk saat masuk level 2
  useEffect(() => {
    if (!currentModelId) { setProdukList([]); return; }
    setLoadingProduk(true);
    getProduk(currentModelId)
      .then((data) => setProdukList(data as ProdukRow[]))
      .catch(console.error)
      .finally(() => setLoadingProduk(false));
  }, [currentModelId]);

  const currentKategoriId = viewPath[0] ?? null;

  const currentKategori = masterKategori.find((k) => k.id === currentKategoriId) ?? null;
  const currentModel    = masterModel.find((m) => m.id === currentModelId) ?? null;

  const modelsInKategori = masterModel.filter((m) => m.kategori_id === currentKategoriId);
  const modelCountForKategori = useCallback(
    (katId: string) => masterModel.filter((m) => m.kategori_id === katId).length,
    [masterModel],
  );

  // ── LEVEL 0: grid kartu kategori ──────────────────────────────────────────
  const renderLevel0 = () => (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className="text-sm font-medium text-[#9aa0a6]">Semua Kategori Produk</h3>
        {isOwner && (
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setIsImportOpen(true)}
              className="h-9 border-[#2A2D31] bg-transparent text-[#9aa0a6] hover:bg-[#2A2D31] hover:text-[#e8eaed] gap-2">
              <Upload size={15} /> Import CSV
            </Button>
            <Button variant="outline" size="sm" onClick={handleExport} disabled={exportLoading}
              className="h-9 border-[#2A2D31] bg-transparent text-[#9aa0a6] hover:bg-[#2A2D31] hover:text-[#e8eaed] gap-2">
              <Download size={15} /> {exportLoading ? 'Mengunduh...' : 'Export CSV'}
            </Button>
            <Button onClick={() => setIsFormOpen(true)}
              className="bg-[#e5c17b] text-[#2b2318] hover:bg-[#e5c17b]/90 h-9">
              <Plus className="mr-2 h-4 w-4" /> Tambah Produk
            </Button>
          </div>
        )}
      </div>

      {masterKategori.length === 0 ? (
        <EmptyState
          icon={<Database className="h-10 w-10" />}
          title="Belum Ada Kategori"
          description="Tambahkan kategori produk di Master Detail terlebih dahulu sebelum membuat SKU."
        />
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {masterKategori.map((kat) => (
            <KategoriCard
              key={kat.id}
              kategori={kat}
              modelCount={modelCountForKategori(kat.id)}
              onClick={() => setViewPath([kat.id])}
            />
          ))}
        </div>
      )}
    </div>
  );

  // ── LEVEL 1: grid kartu model dalam kategori ───────────────────────────────
  const renderLevel1 = () => (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <Breadcrumb label="Semua Kategori" onClick={() => setViewPath([])} />
          <span className="text-[#5f6368] text-sm">/</span>
          <span className="text-sm font-semibold text-[#e8eaed]">{currentKategori?.nama}</span>
        </div>
        {isOwner && (
          <Button
            onClick={() => setIsFormOpen(true)}
            className="bg-[color:var(--accent-gold,#e5c17b)] text-[#2b2318] hover:bg-[#e5c17b]/90 h-9"
          >
            <Plus className="mr-2 h-4 w-4" />
            Tambah Produk
          </Button>
        )}
      </div>

      {modelsInKategori.length === 0 ? (
        <EmptyState
          icon={<Folder className="h-10 w-10" />}
          title="Belum Ada Model"
          description={`Kategori "${currentKategori?.nama}" belum memiliki model. Tambahkan di Master Detail.`}
        />
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {modelsInKategori.map((model) => (
            <ModelCard
              key={model.id}
              model={model}
              onClick={() => setViewPath([currentKategoriId!, model.id])}
            />
          ))}
        </div>
      )}
    </div>
  );

  // ── LEVEL 2: tabel SKU dalam model ────────────────────────────────────────
  const renderLevel2 = () => (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <Breadcrumb label="Semua Kategori" onClick={() => setViewPath([])} />
          <span className="text-[#5f6368] text-sm">/</span>
          <button
            onClick={() => setViewPath([currentKategoriId!])}
            className="text-sm text-[#9aa0a6] hover:text-[#e5c17b] transition-colors"
          >
            {currentKategori?.nama}
          </button>
          <span className="text-[#5f6368] text-sm">/</span>
          <span className="text-sm font-semibold text-[#e8eaed]">{currentModel?.nama}</span>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-[#e5c17b] hover:text-[#e5c17b] hover:bg-[#e5c17b]/10 gap-1.5 ml-2 border border-[#e5c17b]/20"
            onClick={() => router.push(`/app/master/model/${currentModelId}`)}
          >
            <Database size={14} />
            Setup Aksesori & Model
          </Button>
        </div>
        {isOwner && (
          <Button
            onClick={() => setIsFormOpen(true)}
            className="bg-[color:var(--accent-gold,#e5c17b)] text-[#2b2318] hover:bg-[#e5c17b]/90 h-9"
          >
            <Plus className="mr-2 h-4 w-4" />
            Tambah SKU Baru
          </Button>
        )}
      </div>

      {/* TabelProduk — Level 2 */}
      {loadingProduk ? (
        <div className="flex h-40 items-center justify-center rounded-xl border border-[#2A2D31] bg-[#16181A]">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-[#e5c17b] border-t-transparent" />
        </div>
      ) : (
        <TabelProduk
          produkList={produkList}
          onSelect={setSelectedProdukId}
          selectedId={selectedProdukId}
          canSeeFinance={canSeeFinance}
          canEdit={isOwner}
        />
      )}
    </div>
  );

  // ── RENDER ─────────────────────────────────────────────────────────────────
  const renderExplorer = () => {
    if (viewPath.length === 0) return renderLevel0();
    if (viewPath.length === 1) return renderLevel1();
    return renderLevel2();
  };

  const activeProduk = produkList.find((p) => p.id === selectedProdukId);

  return (
    <div className="flex flex-col xl:flex-row gap-6 items-start">
      <div className="flex-1 space-y-2 w-full">
        {/* Indikator path aktif */}
        {viewPath.length > 0 && (
          <div className="flex items-center gap-1 rounded-lg border border-[#2A2D31] bg-[#0D0E10] px-3 py-1.5 w-fit">
            <span className="text-xs text-[#5f6368]">📂</span>
            <span className="text-xs text-[#777e85] font-mono">
              {['Produk', currentKategori?.nama, currentModel?.nama].filter(Boolean).join(' / ')}
            </span>
          </div>
        )}

        {/* Explorer Hierarki */}
        {renderExplorer()}
      </div>

      {/* Editor Panel dikanan saat di Model view, muncul di bawah pada mobile */}
      {viewPath.length === 2 && (
        <div className="w-full xl:w-[450px] shrink-0 rounded-xl border border-[#2A2D31] bg-[#16181A] shadow-xl xl:sticky xl:top-[88px] xl:h-[calc(100vh-120px)] overflow-hidden">
          {selectedProdukId && activeProduk ? (
            <HppEditorPanel
              produkId={activeProduk.id}
              produkInfo={{
                sku_internal: activeProduk.sku_internal,
                sku_klien: activeProduk.sku_klien,
                harga_jual: activeProduk.harga_jual,
              }}
              hppKomponenList={masterKomponen}
              canSeeFinance={canSeeFinance}
            />
          ) : (
             <div className="flex h-full flex-col items-center justify-center p-6 text-center text-[#9aa0a6]">
               <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-[#1A1D1F] border border-[#2A2D31]">
                 <span className="text-2xl">📋</span>
               </div>
               <h4 className="mb-2 font-semibold text-[#e8eaed]">Pilih SKU Produk</h4>
               <p className="text-sm">Klik pada salah satu baris produk di tabel untuk mulai meracik komponen BOM &amp; HPP.</p>
             </div>
          )}
        </div>
      )}

      {/* FormTambahProduk Dialog */}
      <FormTambahProduk
        open={isFormOpen}
        onClose={() => setIsFormOpen(false)}
        modelList={masterModel}
        sizeList={masterSize}
        warnaList={masterWarna}
      />

      {/* ImportCSVModal */}
      <ImportCSVModal
        open={isImportOpen}
        onClose={() => setIsImportOpen(false)}
        onSuccess={() => { setIsImportOpen(false); router.refresh(); }}
      />
    </div>
  );
}
