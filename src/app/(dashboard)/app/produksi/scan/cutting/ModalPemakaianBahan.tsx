'use client';

import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';

interface InventoryItem {
  id: string;
  nama: string;
  satuan: string;
  stok_aktual: number;
  warna_nama: string | null;
}

interface PemakaianRow {
  rowId: string;
  inventory_item_id: string;
  rate_per_pcs: number;
}

interface ModalPemakaianBahanProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  inventoryItems: InventoryItem[];
  onSubmit: (pemakaian: { inventory_item_id: string; rate_per_pcs: number }[]) => void;
  disabled: boolean;
}

function newRow(): PemakaianRow {
  return { rowId: crypto.randomUUID(), inventory_item_id: '', rate_per_pcs: 0 };
}

const selectClass =
  'flex h-9 w-full rounded-md border border-[#2A2D31] bg-[#1E2124] px-3 py-1 text-sm text-[#e8eaed] focus:outline-none focus:ring-1 focus:ring-[#e5c17b] disabled:opacity-50';

export function ModalPemakaianBahan({
  open,
  onOpenChange,
  inventoryItems,
  onSubmit,
  disabled,
}: ModalPemakaianBahanProps) {
  const [rows, setRows] = useState<PemakaianRow[]>([newRow()]);

  const handleAdd = () => setRows((prev) => [...prev, newRow()]);

  const handleRemove = (rowId: string) => {
    if (rows.length > 1) {
      setRows((prev) => prev.filter((r) => r.rowId !== rowId));
    }
  };

  const handleChange = (rowId: string, field: keyof Omit<PemakaianRow, 'rowId'>, value: string) => {
    setRows((prev) =>
      prev.map((r) =>
        r.rowId === rowId
          ? { ...r, [field]: field === 'rate_per_pcs' ? parseFloat(value) || 0 : value }
          : r
      )
    );
  };

  const isValid = rows.every((r) => r.inventory_item_id !== '' && r.rate_per_pcs > 0);

  const handleSubmit = () => {
    if (!isValid) return;
    onSubmit(rows.map(({ inventory_item_id, rate_per_pcs }) => ({ inventory_item_id, rate_per_pcs })));
    setRows([newRow()]);
  };

  const getSatuan = (id: string) =>
    inventoryItems.find((i) => i.id === id)?.satuan ?? '';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="bg-[#16181A] border border-[#2A2D31] text-[#e8eaed] sm:max-w-lg"
        showCloseButton={false}
      >
        <DialogHeader>
          <DialogTitle className="text-[#e8eaed] text-base font-semibold">
            Konfigurasi Pemakaian Bahan
          </DialogTitle>
          <p className="text-xs text-[#9aa0a6] mt-1">
            Artikel ini belum punya config bahan. Tentukan rate pemakaian per pcs untuk bundle pertama.
          </p>
        </DialogHeader>

        <div className="space-y-2 my-2 max-h-64 overflow-y-auto pr-1">
          {rows.map((row) => {
            const satuan = getSatuan(row.inventory_item_id);
            return (
              <div
                key={row.rowId}
                className="grid grid-cols-[1fr_auto_auto] gap-2 items-center"
              >
                {/* Dropdown bahan */}
                <select
                  className={selectClass}
                  value={row.inventory_item_id}
                  disabled={disabled}
                  onChange={(e) => handleChange(row.rowId, 'inventory_item_id', e.target.value)}
                >
                  <option value="">Pilih bahan...</option>
                  {inventoryItems.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.nama}{item.warna_nama ? ` — ${item.warna_nama}` : ''} (stok: {item.stok_aktual} {item.satuan})
                    </option>
                  ))}
                </select>

                {/* Rate input + satuan */}
                <div className="flex items-center gap-1.5">
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    placeholder="0.00"
                    disabled={disabled}
                    value={row.rate_per_pcs || ''}
                    onChange={(e) => handleChange(row.rowId, 'rate_per_pcs', e.target.value)}
                    className="h-9 w-24 rounded-md border border-[#2A2D31] bg-[#1E2124] px-3 text-sm text-[#e8eaed] focus:outline-none focus:ring-1 focus:ring-[#e5c17b] disabled:opacity-50"
                  />
                  {satuan && (
                    <span className="text-xs text-[#9aa0a6] whitespace-nowrap">{satuan}/pcs</span>
                  )}
                </div>

                {/* Hapus baris */}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  disabled={disabled || rows.length <= 1}
                  className="text-[#9aa0a6] hover:bg-red-500/10 hover:text-red-500 disabled:opacity-30"
                  onClick={() => handleRemove(row.rowId)}
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            );
          })}
        </div>

        {/* Tambah baris */}
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          onClick={handleAdd}
          className="w-full border-dashed border-[#e5c17b]/40 text-[#e5c17b] hover:bg-[#e5c17b]/10 hover:border-[#e5c17b] transition-all"
        >
          <Plus className="w-4 h-4 mr-2" />
          Tambah Bahan
        </Button>

        <DialogFooter className="-mx-0 -mb-0 border-t-0 bg-transparent pt-2 flex flex-row justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={disabled}
            onClick={() => onOpenChange(false)}
            className="border-[#2A2D31] text-[#e8eaed] bg-transparent hover:bg-[#2A2D31]"
          >
            Batal
          </Button>
          <Button
            type="button"
            disabled={disabled || !isValid}
            onClick={handleSubmit}
            className="bg-[#e5c17b] text-[#0D0E10] hover:bg-[#e5c17b]/90 font-semibold disabled:opacity-40"
          >
            {disabled ? 'Menyimpan...' : 'Simpan & Lanjut'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
