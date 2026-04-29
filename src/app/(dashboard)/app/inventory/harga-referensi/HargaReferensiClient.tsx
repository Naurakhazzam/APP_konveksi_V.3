'use client';

import { useState, useMemo, useRef } from 'react';
import {
  Search, DollarSign, CheckCircle2, AlertCircle,
  Pencil, Check, X, Settings2, ArrowRight,
} from 'lucide-react';
import { toast } from 'sonner';
import { Input }  from '@/components/ui/input';
import { Badge }  from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label }  from '@/components/ui/label';
import {
  Table, TableBody, TableCell,
  TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogHeader,
  DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import {
  HargaReferensiItem,
  updateHargaReferensi,
  updateKonversiSatuan,
} from '@/lib/actions/inventory/item.actions';

interface Props { items: HargaReferensiItem[] }

export default function HargaReferensiClient({ items }: Props) {
  const [localItems, setLocalItems]   = useState<HargaReferensiItem[]>(items);
  const [searchQuery, setSearchQuery] = useState('');

  // inline edit harga
  const [editingId,  setEditingId]  = useState<string | null>(null);
  const [editValue,  setEditValue]  = useState('');
  const [savingId,   setSavingId]   = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // modal konversi
  const [konversiItem,       setKonversiItem]       = useState<HargaReferensiItem | null>(null);
  const [konversiSatuanBeli, setKonversiSatuanBeli] = useState('');
  const [konversiFaktor,     setKonversiFaktor]     = useState('');
  const [konversiHargaBeli,  setKonversiHargaBeli]  = useState('');
  const [konversiSaving,     setKonversiSaving]     = useState(false);

  // ── derived ─────────────────────────────────────────────────
  const filteredItems = useMemo(() => {
    const q = searchQuery.toLowerCase();
    return localItems.filter(i => i.nama.toLowerCase().includes(q));
  }, [localItems, searchQuery]);

  const sudahDiisi = localItems.filter(i => i.harga_referensi > 0).length;
  const belumDiisi = localItems.length - sudahDiisi;
  const pctDiisi   = localItems.length > 0
    ? Math.round((sudahDiisi / localItems.length) * 100) : 0;

  // ── inline edit handlers ─────────────────────────────────────
  const startEdit = (item: HargaReferensiItem) => {
    setEditingId(item.id);
    setEditValue(item.harga_referensi > 0 ? String(item.harga_referensi) : '');
    setTimeout(() => inputRef.current?.focus(), 50);
  };
  const cancelEdit = () => { setEditingId(null); setEditValue(''); };

  const saveEdit = async (id: string) => {
    const harga = parseFloat(editValue.replace(/[^0-9.]/g, ''));
    if (isNaN(harga) || harga < 0) { toast.error('Harga tidak valid'); return; }
    setSavingId(id);
    try {
      await updateHargaReferensi(id, harga);
      setLocalItems(prev => prev.map(i => i.id === id ? { ...i, harga_referensi: harga } : i));
      toast.success('Harga referensi diperbarui');
      cancelEdit();
    } catch (err: any) {
      toast.error(err.message || 'Gagal menyimpan');
    } finally { setSavingId(null); }
  };

  const handleKeyDown = (e: React.KeyboardEvent, id: string) => {
    if (e.key === 'Enter')  saveEdit(id);
    if (e.key === 'Escape') cancelEdit();
  };

  // ── konversi modal handlers ──────────────────────────────────
  const openKonversi = (item: HargaReferensiItem) => {
    setKonversiItem(item);
    setKonversiSatuanBeli(item.satuan_beli ?? '');
    setKonversiFaktor(item.faktor_konversi != null ? String(item.faktor_konversi) : '');
    // reverse-calc: harga beli = harga_referensi × faktor
    const hargaBeli = item.harga_referensi > 0 && item.faktor_konversi
      ? item.harga_referensi * item.faktor_konversi : 0;
    setKonversiHargaBeli(hargaBeli > 0 ? String(hargaBeli) : '');
  };

  const closeKonversi = () => {
    setKonversiItem(null);
    setKonversiSatuanBeli('');
    setKonversiFaktor('');
    setKonversiHargaBeli('');
  };

  // auto-hitung harga_referensi dari harga beli ÷ faktor
  const hargaReferensiPreview = useMemo(() => {
    const f = parseFloat(konversiFaktor);
    const h = parseFloat(konversiHargaBeli);
    if (!isNaN(f) && f > 0 && !isNaN(h) && h > 0) {
      return Math.round(h / f);
    }
    return null;
  }, [konversiFaktor, konversiHargaBeli]);

  const saveKonversi = async () => {
    if (!konversiItem) return;
    const faktor = parseFloat(konversiFaktor);
    if (konversiSatuanBeli && (isNaN(faktor) || faktor <= 0)) {
      toast.error('Faktor konversi harus > 0');
      return;
    }
    // harga_referensi: pakai preview kalau ada, otherwise harga_referensi lama
    const hargaRef = hargaReferensiPreview ?? konversiItem.harga_referensi;

    setKonversiSaving(true);
    try {
      await updateKonversiSatuan(
        konversiItem.id,
        konversiSatuanBeli || null,
        konversiSatuanBeli ? faktor : null,
        hargaRef,
      );
      setLocalItems(prev => prev.map(i =>
        i.id === konversiItem.id
          ? {
              ...i,
              satuan_beli    : konversiSatuanBeli || null,
              faktor_konversi: konversiSatuanBeli ? faktor : null,
              harga_referensi: hargaRef,
            }
          : i
      ));
      toast.success('Pengaturan konversi disimpan');
      closeKonversi();
    } catch (err: any) {
      toast.error(err.message || 'Gagal menyimpan');
    } finally { setKonversiSaving(false); }
  };

  // ── render ───────────────────────────────────────────────────
  return (
    <div className="space-y-6">

      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[#e8eaed]">Harga Referensi & Konversi Satuan</h1>
          <p className="text-sm text-[#9aa0a6] mt-1">
            Harga fallback + konversi satuan beli → pakai untuk semua item inventory
          </p>
        </div>
        <div className="relative group">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#9aa0a6] group-focus-within:text-[#e5c17b] transition-colors" />
          <Input
            placeholder="Cari nama item..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 w-64 bg-[#1A1D1F] border-[#2A2D31] focus:border-[#e5c17b] focus:ring-[#e5c17b]/20"
          />
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-[#1A1D1F] border border-[#2A2D31] rounded-2xl p-5">
          <div className="flex items-center gap-4">
            <div className="h-12 w-12 rounded-xl bg-[#2A2D31] flex items-center justify-center text-[#e5c17b]">
              <DollarSign size={24} />
            </div>
            <div>
              <p className="text-xs font-medium text-[#9aa0a6] uppercase tracking-wider">Total Item</p>
              <p className="text-2xl font-bold text-[#e8eaed]">{localItems.length}</p>
            </div>
          </div>
        </div>

        <div className="bg-[#1A1D1F] border border-green-500/20 rounded-2xl p-5">
          <div className="flex items-center gap-4">
            <div className="h-12 w-12 rounded-xl bg-green-500/10 flex items-center justify-center text-green-500">
              <CheckCircle2 size={24} />
            </div>
            <div>
              <p className="text-xs font-medium text-[#9aa0a6] uppercase tracking-wider">Sudah Diisi</p>
              <p className="text-2xl font-bold text-green-500">{sudahDiisi}</p>
            </div>
          </div>
        </div>

        <div className={`bg-[#1A1D1F] border rounded-2xl p-5 ${belumDiisi > 0 ? 'border-orange-500/30' : 'border-[#2A2D31]'}`}>
          <div className="flex items-center gap-4">
            <div className={`h-12 w-12 rounded-xl flex items-center justify-center ${belumDiisi > 0 ? 'bg-orange-500/10 text-orange-500' : 'bg-[#2A2D31] text-[#9aa0a6]'}`}>
              <AlertCircle size={24} />
            </div>
            <div>
              <p className="text-xs font-medium text-[#9aa0a6] uppercase tracking-wider">Belum Diisi</p>
              <p className={`text-2xl font-bold ${belumDiisi > 0 ? 'text-orange-500' : 'text-[#e8eaed]'}`}>{belumDiisi}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Progress */}
      <div className="bg-[#1A1D1F] border border-[#2A2D31] rounded-2xl p-4">
        <div className="flex justify-between items-center mb-2">
          <span className="text-sm text-[#9aa0a6]">Progress pengisian harga</span>
          <span className="text-sm font-bold text-[#e5c17b]">{pctDiisi}%</span>
        </div>
        <div className="w-full h-2 bg-[#2A2D31] rounded-full overflow-hidden">
          <div
            className="h-full bg-[#e5c17b] rounded-full transition-all duration-500"
            style={{ width: `${pctDiisi}%` }}
          />
        </div>
      </div>

      {/* Table */}
      <div className="bg-[#1A1D1F] border border-[#2A2D31] rounded-2xl overflow-hidden shadow-sm">
        <Table>
          <TableHeader className="bg-[#1E2124]">
            <TableRow className="hover:bg-transparent border-[#2A2D31]">
              <TableHead className="text-[#9aa0a6] font-semibold">Nama Item</TableHead>
              <TableHead className="text-[#9aa0a6] font-semibold text-center">Satuan Pakai</TableHead>
              <TableHead className="text-[#9aa0a6] font-semibold text-center">Konversi</TableHead>
              <TableHead className="text-[#9aa0a6] font-semibold text-right">Stok Aktual</TableHead>
              <TableHead className="text-[#9aa0a6] font-semibold text-right">Harga Referensi</TableHead>
              <TableHead className="text-[#9aa0a6] font-semibold text-center">Status</TableHead>
              <TableHead className="text-[#9aa0a6] font-semibold text-center w-24">Aksi</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredItems.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="h-32 text-center text-[#9aa0a6]">
                  Tidak ada item ditemukan.
                </TableCell>
              </TableRow>
            ) : (
              filteredItems.map((item) => {
                const isEditing   = editingId === item.id;
                const isSaving    = savingId  === item.id;
                const hasPriceSet = item.harga_referensi > 0;
                const hasKonversi = !!item.satuan_beli && !!item.faktor_konversi;

                return (
                  <TableRow key={item.id} className="border-[#2A2D31] hover:bg-[#1E2124]/50 transition-colors">

                    {/* Nama */}
                    <TableCell className="font-semibold text-[#e8eaed]">{item.nama}</TableCell>

                    {/* Satuan pakai */}
                    <TableCell className="text-center text-[#9aa0a6] text-sm">{item.satuan}</TableCell>

                    {/* Konversi info */}
                    <TableCell className="text-center">
                      {hasKonversi ? (
                        <span className="inline-flex items-center gap-1 text-xs bg-[#2A2D31] text-[#e5c17b] px-2 py-1 rounded-full border border-[#e5c17b]/20">
                          1 {item.satuan_beli}
                          <ArrowRight size={10} />
                          {item.faktor_konversi} {item.satuan}
                        </span>
                      ) : (
                        <span className="text-[#5f6368] text-xs">—</span>
                      )}
                    </TableCell>

                    {/* Stok */}
                    <TableCell className="text-right">
                      <span className={`font-mono font-medium ${
                        item.stok_aktual < 0   ? 'text-red-500'    :
                        item.stok_aktual === 0 ? 'text-[#9aa0a6]' : 'text-[#e8eaed]'
                      }`}>
                        {item.stok_aktual.toLocaleString('id-ID')}
                      </span>
                    </TableCell>

                    {/* Harga — inline edit */}
                    <TableCell className="text-right">
                      {isEditing ? (
                        <div className="flex items-center justify-end gap-1.5">
                          <span className="text-[#9aa0a6] text-sm">Rp</span>
                          <Input
                            ref={inputRef}
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onKeyDown={(e) => handleKeyDown(e, item.id)}
                            type="number"
                            min={0}
                            className="w-32 h-8 text-right bg-[#16181A] border-[#e5c17b] focus:ring-[#e5c17b]/30 font-mono"
                            placeholder="0"
                          />
                        </div>
                      ) : (
                        <span className={`font-mono font-medium ${hasPriceSet ? 'text-[#e8eaed]' : 'text-[#5f6368]'}`}>
                          {hasPriceSet ? `Rp ${item.harga_referensi.toLocaleString('id-ID')}` : '—'}
                        </span>
                      )}
                    </TableCell>

                    {/* Status */}
                    <TableCell className="text-center">
                      {hasPriceSet ? (
                        <Badge className="bg-green-500/10 text-green-500 border-green-500/20 text-xs">Terisi</Badge>
                      ) : (
                        <Badge className="bg-orange-500/10 text-orange-500 border-orange-500/20 text-xs">Belum diisi</Badge>
                      )}
                    </TableCell>

                    {/* Aksi */}
                    <TableCell className="text-center">
                      <div className="flex items-center justify-center gap-1">
                        {isEditing ? (
                          <>
                            <Button
                              size="sm"
                              onClick={() => saveEdit(item.id)}
                              disabled={isSaving}
                              className="h-7 w-7 p-0 bg-green-600 hover:bg-green-500 text-white rounded-lg"
                            >
                              <Check size={13} />
                            </Button>
                            <Button
                              size="sm" variant="ghost"
                              onClick={cancelEdit}
                              disabled={isSaving}
                              className="h-7 w-7 p-0 text-[#9aa0a6] hover:text-red-400 hover:bg-red-400/10 rounded-lg"
                            >
                              <X size={13} />
                            </Button>
                          </>
                        ) : (
                          <>
                            {/* Edit harga langsung */}
                            <Button
                              variant="ghost" size="sm"
                              onClick={() => startEdit(item)}
                              title="Edit harga referensi"
                              className="h-8 w-8 p-0 text-[#9aa0a6] hover:text-[#e5c17b] hover:bg-[#e5c17b]/10 rounded-lg"
                            >
                              <Pencil size={14} />
                            </Button>
                            {/* Pengaturan konversi */}
                            <Button
                              variant="ghost" size="sm"
                              onClick={() => openKonversi(item)}
                              title="Pengaturan konversi satuan"
                              className={`h-8 w-8 p-0 rounded-lg ${
                                hasKonversi
                                  ? 'text-[#e5c17b] hover:bg-[#e5c17b]/10'
                                  : 'text-[#9aa0a6] hover:text-[#e5c17b] hover:bg-[#e5c17b]/10'
                              }`}
                            >
                              <Settings2 size={14} />
                            </Button>
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {/* Footer note */}
      <div className="bg-[#1A1D1F] border border-[#2A2D31] rounded-xl p-4 flex gap-3 items-start">
        <DollarSign size={16} className="text-[#e5c17b] mt-0.5 shrink-0" />
        <div>
          <p className="text-sm font-medium text-[#e8eaed]">Cara kerja harga referensi</p>
          <p className="text-xs text-[#9aa0a6] mt-1 leading-relaxed">
            Klik <strong className="text-[#e8eaed]">✏</strong> untuk edit harga langsung.
            Klik <strong className="text-[#e8eaed]">⚙</strong> untuk set konversi satuan beli — sistem
            otomatis hitung harga referensi per satuan pakai. Update harga kapan saja,
            laporan HPP semua PO langsung ikut terhitung ulang.
          </p>
        </div>
      </div>

      {/* ── Modal Konversi Satuan ─────────────────────────────── */}
      <Dialog open={!!konversiItem} onOpenChange={(o) => { if (!o) closeKonversi(); }}>
        <DialogContent className="bg-[#1A1D1F] border-[#2A2D31] text-[#e8eaed] sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Settings2 size={18} className="text-[#e5c17b]" />
              Konversi Satuan — {konversiItem?.nama}
            </DialogTitle>
            <DialogDescription className="text-[#9aa0a6]">
              Atur satuan pembelian dan faktor konversinya ke satuan pakai.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5 pt-2">
            {/* Satuan pakai (readonly) */}
            <div className="bg-[#2A2D31]/40 rounded-xl px-4 py-3 flex items-center justify-between border border-[#2A2D31]">
              <span className="text-sm text-[#9aa0a6]">Satuan Pakai (di sistem)</span>
              <span className="font-semibold text-[#e8eaed]">{konversiItem?.satuan}</span>
            </div>

            {/* Satuan beli */}
            <div className="space-y-2">
              <Label>Satuan Beli</Label>
              <Input
                value={konversiSatuanBeli}
                onChange={(e) => setKonversiSatuanBeli(e.target.value)}
                placeholder="Contoh: roll, kg, lusin, bal"
                className="bg-[#16181A] border-[#2A2D31] focus:border-[#e5c17b] focus:ring-[#e5c17b]/20"
              />
              <p className="text-xs text-[#9aa0a6]">Kosongkan untuk hapus konversi (item tanpa konversi = satuan beli sama dengan satuan pakai)</p>
            </div>

            {/* Faktor konversi */}
            <div className="space-y-2">
              <Label>
                Faktor Konversi
                {konversiSatuanBeli && (
                  <span className="text-[#9aa0a6] font-normal ml-1">
                    (1 {konversiSatuanBeli} = ? {konversiItem?.satuan})
                  </span>
                )}
              </Label>
              <Input
                value={konversiFaktor}
                onChange={(e) => setKonversiFaktor(e.target.value)}
                type="number"
                min={1}
                placeholder="Contoh: 400"
                disabled={!konversiSatuanBeli}
                className="bg-[#16181A] border-[#2A2D31] focus:border-[#e5c17b] focus:ring-[#e5c17b]/20 disabled:opacity-40"
              />
            </div>

            {/* Harga beli per satuan beli */}
            <div className="space-y-2">
              <Label>
                Harga Beli per {konversiSatuanBeli || 'satuan beli'}
                <span className="text-[#9aa0a6] font-normal ml-1">(Rp)</span>
              </Label>
              <Input
                value={konversiHargaBeli}
                onChange={(e) => setKonversiHargaBeli(e.target.value)}
                type="number"
                min={0}
                placeholder="Contoh: 50000"
                disabled={!konversiSatuanBeli || !konversiFaktor}
                className="bg-[#16181A] border-[#2A2D31] focus:border-[#e5c17b] focus:ring-[#e5c17b]/20 disabled:opacity-40"
              />
            </div>

            {/* Preview hasil */}
            {hargaReferensiPreview !== null && (
              <div className="bg-[#e5c17b]/5 border border-[#e5c17b]/30 rounded-xl p-4 space-y-1.5">
                <p className="text-xs text-[#9aa0a6] font-medium uppercase tracking-wider">Preview Hasil</p>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm text-[#9aa0a6]">
                    Rp {parseFloat(konversiHargaBeli).toLocaleString('id-ID')} / {konversiSatuanBeli}
                  </span>
                  <ArrowRight size={14} className="text-[#e5c17b]" />
                  <span className="text-sm font-bold text-[#e5c17b]">
                    Rp {hargaReferensiPreview.toLocaleString('id-ID')} / {konversiItem?.satuan}
                  </span>
                </div>
                <p className="text-xs text-[#9aa0a6]">
                  Harga referensi akan disimpan sebagai Rp {hargaReferensiPreview.toLocaleString('id-ID')} per {konversiItem?.satuan}
                </p>
              </div>
            )}

            {/* Jika konversi sudah ada tapi harga beli belum diisi */}
            {konversiSatuanBeli && konversiFaktor && !konversiHargaBeli && (
              <div className="bg-[#2A2D31]/40 border border-[#2A2D31] rounded-xl p-3">
                <p className="text-xs text-[#9aa0a6]">
                  Kosongkan harga beli jika ingin set harga referensi manual (pakai tombol ✏ di tabel).
                </p>
              </div>
            )}
          </div>

          <DialogFooter className="pt-4 gap-2">
            <Button
              type="button" variant="ghost"
              onClick={closeKonversi}
              className="text-[#9aa0a6] hover:text-[#e8eaed]"
            >
              Batal
            </Button>
            <Button
              onClick={saveKonversi}
              disabled={konversiSaving}
              className="bg-[#e5c17b] hover:bg-[#d4b06a] text-[#0D0E10] font-semibold min-w-[120px]"
            >
              {konversiSaving ? 'Menyimpan...' : 'Simpan Konversi'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
