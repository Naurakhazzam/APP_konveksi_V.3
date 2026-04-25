# STATUS LOG PHASE 2 — Update `cutting.actions.ts`

**Tanggal Pengerjaan:** 25 April 2026

---

## Functions yang Diubah

### 1. `mulaiCuttingBatch` — Signature Diubah
| | Lama | Baru |
|---|---|---|
| Parameter | `po_ids: string[]` | `bundle_ids: string[]` |
| RPC param | `p_po_ids` | `p_bundle_ids` |
| Return type | `{ success, jumlah_bundle, error? }` | Sama |

**Alasan:** Mulai cutting kini berbasis per-bundle (bukan per-PO), sesuai RPC Phase 1.

---

### 2. `selesaiCuttingBatch` — Signature Diubah
| | Lama | Baru |
|---|---|---|
| Param 1 | `po_ids: string[]` | `bundle_qty: BundleQtyInput[]` |
| Param 2 | `pemakaian: PemakaianBahanItem[]` | `pemakaian: PemakaianInput[]` |
| RPC params | `p_po_ids, p_pemakaian` | `p_bundle_qty, p_pemakaian` |
| Return type | `{ success, total_qty, stok_warnings, error? }` | + `partial_count: number` |

**Alasan:** Mendukung status `'partial'` (qty_aktual < qty_order) dan perhitungan pemakaian berbasis `rate_per_pcs × total_qty_artikel`.

---

### 3. `getBundlesForPO` — Return Type Diubah
| | Lama | Baru |
|---|---|---|
| `BundleDetailItem.qty_aktual` | Tidak ada | `number \| null` |

**Alasan:** Perlu menampilkan qty aktual yang sudah dicatat cutting di UI untuk feedback operator.

---

### 4. `getPOCuttingList` — Logic Status Diubah
| | Lama | Baru |
|---|---|---|
| Status 'progress' trigger | `progress \| terima` | `progress \| terima \| partial` |

**Alasan:** Status `'partial'` adalah status baru yang harus dihitung sebagai "masih dalam proses" (bukan selesai).

---

## Functions Baru

### `closeBundleCutting(bundle_id: string)`
```ts
closeBundleCutting(bundle_id: string): Promise<{ success: boolean; error?: string }>
```
- Memanggil RPC `close_bundle_cutting` (Phase 1)
- Mengubah status bundle dari `'partial'` → `'selesai'`

### `getPendingCuttingBundles()`
```ts
getPendingCuttingBundles(): Promise<PendingBundle[]>
```
- Query bundle dengan `status_tahap->'cutting'->>'status' = 'partial'`
- Return field: `id, barcode, no_po, klien_nama, warna, size, qty_order, qty_aktual, tenant_id`

---

## Types Baru yang Di-Export

| Type | Deskripsi |
|---|---|
| `BundleQtyInput` | `{ bundle_id: string; qty_aktual: number }` — input per-bundle untuk selesai cutting |
| `PemakaianInput` | `{ inventory_item_id: string; rate_per_pcs: number; total_qty_artikel: number }` |
| `MulaiBundleInput` | `{ bundle_id: string }` — helper type (referensi) |
| `PendingBundle` | Return type untuk `getPendingCuttingBundles()` |

---

## Dependency ke Phase 1 (RPC)

| Server Action | RPC yang Dipanggil | File SQL |
|---|---|---|
| `mulaiCuttingBatch` | `mulai_cutting_batch(p_bundle_ids, p_user_id, p_tenant_id)` | `20260425123753_update_cutting_functions.sql` |
| `selesaiCuttingBatch` | `selesai_cutting_batch(p_bundle_qty, p_pemakaian, p_user_id, p_tenant_id)` | idem |
| `closeBundleCutting` | `close_bundle_cutting(p_bundle_id, p_user_id, p_tenant_id)` | idem |

---

## File yang Dimodifikasi

- `src/lib/actions/produksi/cutting.actions.ts` — full rewrite dengan signature baru
- `src/app/(dashboard)/app/produksi/antrian-cutting/ModalSelesaiCutting.tsx` — update import dan call signature

> **Catatan:** `bundleQty` di `ModalSelesaiCutting` dibuat opsional (`bundleQty?`) dengan default `[]`  
> agar tidak breaking terhadap pemanggilan lama di `AntrianCuttingClient.tsx`.  
> Untuk fungsionalitas penuh Phase 2, `AntrianCuttingClient` perlu diupdate untuk meneruskan `bundleQty` dari state bundle yang dipilih.
