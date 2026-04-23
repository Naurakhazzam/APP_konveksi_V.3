import React, { useState, useEffect } from 'react';
import { getWarnaByModel, getSizeByModel, getProdukId } from '@/lib/actions/produksi/po.actions';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Trash2 } from 'lucide-react';

export interface LineItemState {
  id: string;
  model_id: string;
  warna_id: string;
  size_id: string;
  produk_id: string | null;
  warna_nama: string;
  size_nama: string;
  qty_order: number;
  qty_per_bundle: number;
}

interface Props {
  index: number;
  item: LineItemState;
  modelList: { id: string; nama: string }[];
  onChange: (index: number, updates: Partial<LineItemState>) => void;
  onRemove: (index: number) => void;
  canRemove: boolean;
  disabled: boolean;
}

export function InputPoLineItem({ index, item, modelList, onChange, onRemove, canRemove, disabled }: Props) {
  const [warnaList, setWarnaList] = useState<{ id: string; nama: string }[]>([]);
  const [sizeList, setSizeList] = useState<{ id: string; nama: string }[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!item.model_id) {
      setWarnaList([]);
      setSizeList([]);
      return;
    }
    let active = true;
    setIsLoading(true);
    Promise.all([getWarnaByModel(item.model_id), getSizeByModel(item.model_id)]).then(([warnas, sizes]) => {
      if (active) {
        setWarnaList(warnas);
        setSizeList(sizes);
        setIsLoading(false);
      }
    });
    return () => { active = false; };
  }, [item.model_id]);

  useEffect(() => {
    if (item.model_id && item.warna_id && item.size_id) {
      let active = true;
      getProdukId(item.model_id, item.warna_id, item.size_id).then(pid => {
        if (active && pid !== item.produk_id) {
          onChange(index, { produk_id: pid });
        }
      });
      return () => { active = false; };
    } else if (item.produk_id !== null) {
      onChange(index, { produk_id: null });
    }
  }, [item.model_id, item.warna_id, item.size_id, index, item.produk_id, onChange]);

  const jumlahBundle = Math.ceil((item.qty_order || 0) / (item.qty_per_bundle || 12));
  const hasError = item.model_id && item.warna_id && item.size_id && !item.produk_id && !isLoading;

  const selectClass = "flex h-10 w-full rounded-md border border-[#2A2D31] bg-[#1E2124] px-3 py-2 text-sm text-[#e8eaed] placeholder:text-[#9aa0a6] focus:outline-none focus:ring-1 focus:ring-[#e5c17b] disabled:cursor-not-allowed disabled:opacity-50";

  return (
    <tr className="border-b border-[#2A2D31] hover:bg-[#2A2D31]/10">
      <td className="p-2 align-top">
        <select
          className={selectClass}
          value={item.model_id}
          disabled={disabled}
          onChange={e => onChange(index, { 
            model_id: e.target.value, warna_id: '', size_id: '', warna_nama: '', size_nama: '', produk_id: null 
          })}
        >
          <option value="">Pilih Model...</option>
          {modelList.map(m => <option key={m.id} value={m.id}>{m.nama}</option>)}
        </select>
        {hasError && <div className="text-red-400 text-xs mt-1">Kombinasi produk tidak ditemukan</div>}
      </td>
      <td className="p-2 align-top">
        <select
          className={selectClass}
          value={item.warna_id}
          disabled={disabled || isLoading || !item.model_id}
          onChange={e => {
            const w = warnaList.find(x => x.id === e.target.value);
            onChange(index, { warna_id: e.target.value, warna_nama: w?.nama || '', produk_id: null });
          }}
        >
          <option value="">{isLoading ? 'Memuat...' : 'Pilih Warna...'}</option>
          {warnaList.map(w => <option key={w.id} value={w.id}>{w.nama}</option>)}
        </select>
      </td>
      <td className="p-2 align-top">
        <select
          className={selectClass}
          value={item.size_id}
          disabled={disabled || isLoading || !item.model_id}
          onChange={e => {
            const s = sizeList.find(x => x.id === e.target.value);
            onChange(index, { size_id: e.target.value, size_nama: s?.nama || '', produk_id: null });
          }}
        >
          <option value="">{isLoading ? 'Memuat...' : 'Pilih Size...'}</option>
          {sizeList.map(s => <option key={s.id} value={s.id}>{s.nama}</option>)}
        </select>
      </td>
      <td className="p-2 align-top">
        <Input 
          type="number" 
          min={1} 
          className="bg-[#1E2124] border-[#2A2D31] text-[#e8eaed] h-10 w-24"
          value={item.qty_order || ''} 
          disabled={disabled}
          onChange={e => onChange(index, { qty_order: parseInt(e.target.value) || 0 })}
        />
      </td>
      <td className="p-2 align-top">
        <Input 
          type="number" 
          min={1} 
          className="bg-[#1E2124] border-[#2A2D31] text-[#e8eaed] h-10 w-20"
          value={item.qty_per_bundle || ''} 
          disabled={disabled}
          onChange={e => onChange(index, { qty_per_bundle: parseInt(e.target.value) || 12 })}
        />
      </td>
      <td className="p-2 text-center text-[#e8eaed] font-medium align-middle">
        {jumlahBundle}
      </td>
      <td className="p-2 text-center align-middle">
        <Button 
          type="button"
          variant="ghost" 
          size="icon" 
          disabled={disabled || !canRemove}
          className="text-[#9aa0a6] hover:bg-red-500/10 hover:text-red-400 disabled:opacity-30"
          onClick={() => onRemove(index)}
        >
          <Trash2 className="w-4 h-4" />
        </Button>
      </td>
    </tr>
  );
}
