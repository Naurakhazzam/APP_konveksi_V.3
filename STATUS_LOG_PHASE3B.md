# STATUS LOG PHASE 3B — Redesign `ModalSelesaiCutting.tsx`

**Tanggal Pengerjaan:** 25 April 2026

---

## Struktur State dalam Component

| State | Type | Deskripsi |
|---|---|---|
| `bundles` | `BundleForModal[]` | Detail bundle yang dipilih (fetch via `getBundlesByIds`) |
| `inventoryItems` | `InventoryItemOption[]` | Semua item inventory untuk dropdown bahan |
| `isLoading` | `boolean` | Loading state saat fetch awal |
| `isSubmitting` | `boolean` | Loading state saat submit |
| `stokWarnings` | `StokWarning[]` | Warning stok kurang dari server |
| `bundleQty` | `Record<string, number>` | Map bundle_id → qty_aktual (default = qty_per_bundle) |
| `bahanPerArtikel` | `Record<string, BahanRow[]>` | Map artikel_key → list baris bahan |

**BahanRow:**
```ts
{ rowId: string; inventory_item_id: string; rate_per_pcs: number }
```

---

## Bagian Modal

### Bagian A — Qty Aktual per Bundle
- Fetch bundle details via `getBundlesByIds(selectedBundleIds)`
- Input `qty_aktual` per bundle (default = `qty_per_bundle`)
- Status otomatis: ✅ Selesai (qty_aktual >= qty_order) / ⚠️ Partial (kurang)

### Bagian B — Pemakaian Bahan per Artikel
- Bundle dikelompokkan berdasarkan kombinasi `warna + size` (artikel)
- Setiap artikel punya list baris bahan: dropdown inventory + input rate_per_pcs + preview total
- Preview total dihitung realtime: `rate_per_pcs × total_qty_aktual_artikel`
- Tombol "+ Tambah Bahan" dan hapus per baris

### Bagian C — Summary
- Tampil di atas tombol submit
- Hitung total bundle selesai vs partial
- List semua deduction: nama bahan → total deduction

---

## Validasi yang Diterapkan

| Validasi | Pesan Error |
|---|---|
| Setiap artikel wajib punya minimal 1 bahan valid | `"Artikel {warna} - {size} belum memiliki bahan..."` |
| Baris bahan valid = `inventory_item_id` tidak kosong dan `rate_per_pcs > 0` | — |

---

## Formula Perhitungan

| Formula | Deskripsi |
|---|---|
| `total_qty_aktual_artikel` | Sum `bundleQty[b.id]` untuk semua bundle dalam satu artikel |
| `total_deduction_per_baris` | `rate_per_pcs × total_qty_aktual_artikel` |
| `total_deduction_per_item` | Sum deduction dari semua artikel yang memakai item yang sama |

**Dikirim ke RPC via:**
```ts
selesaiCuttingBatch(bundle_qty, pemakaian)
// pemakaian: { inventory_item_id, rate_per_pcs, total_qty_artikel }
// RPC menghitung: total_deduction = rate_per_pcs × total_qty_artikel
```

---

## Dependency ke Phase 1 (SQL RPC)

| RPC | Dipanggil via |
|---|---|
| `selesai_cutting_batch(p_bundle_qty, p_pemakaian, p_user_id, p_tenant_id)` | `selesaiCuttingBatch()` Phase 2 |

## Dependency ke Phase 2 (Server Actions)

| Function | Kegunaan |
|---|---|
| `getBundlesByIds(bundle_ids)` | Fetch detail bundle (BARU: ditambah di Phase 3B) |
| `getInventoryItemsForCutting()` | Fetch semua item inventory |
| `selesaiCuttingBatch(bundle_qty, pemakaian)` | Submit hasil cutting |

## File yang Berubah

- `src/lib/actions/produksi/cutting.actions.ts` — tambah `getBundlesByIds` + type `BundleForModal`
- `src/app/(dashboard)/app/produksi/antrian-cutting/ModalSelesaiCutting.tsx` — full redesign
- `src/app/(dashboard)/app/produksi/antrian-cutting/AntrianCuttingClient.tsx` — prop berubah dari `poIds + bundleQty` → `selectedBundleIds`
