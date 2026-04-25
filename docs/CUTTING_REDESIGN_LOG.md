# CUTTING REDESIGN LOG — Stitchlyx V3

**Tanggal Pengerjaan:** 25 April 2026  
**Scope:** Cutting workflow redesign dari PO-based menjadi bundle-level selection dengan status partial

---

## Overview Perubahan Sistem

### Sebelum Redesign
- Admin memilih **PO** untuk mulai/selesai cutting
- 1 scan = 1 bundle (sistem barcode scan)
- Tidak ada penanganan bundle dengan qty kurang (partial)
- Input pemakaian bahan per-PO, tidak ada breakdown per artikel

### Sesudah Redesign
- Admin expand accordion PO → **pilih bundle spesifik** dengan checkbox
- Mulai Cutting → update status bundle terpilih ke `progress`
- Selesai Cutting → input `qty_aktual` per bundle, input pemakaian bahan per **artikel (warna+size)**
- Bundle dengan `qty_aktual < qty_order` otomatis masuk status `partial`
- Tab baru **"Pending Cutting"** untuk menangani bundle partial → Close Bundle → jadi `selesai`

---

## Status Setiap Phase

| Phase | Status | Deskripsi |
|---|---|---|
| **Phase 1** — SQL Functions | ✅ Selesai | RPC baru di Supabase |
| **Phase 2** — cutting.actions.ts | ✅ Selesai | Server actions TypeScript |
| **Phase 3A** — AntrianCuttingClient | ✅ Selesai | Tab baru + bundle checkbox |
| **Phase 3B** — ModalSelesaiCutting | ✅ Selesai | 3-bagian modal redesign |
| **Phase 3C** — PendingCuttingTab | ✅ Selesai | Tabel pending + close bundle |

---

## Daftar File yang Dibuat / Diubah

### File Baru
| File | Deskripsi |
|---|---|
| `supabase/migrations/20260425123753_update_cutting_functions.sql` | SQL migration Phase 1 |
| `src/app/(dashboard)/app/produksi/antrian-cutting/PendingCuttingTab.tsx` | Component tab pending (self-fetching) |
| `STATUS_LOG.md` | Log Phase 1 (SQL) |
| `STATUS_LOG_PHASE2.md` | Log Phase 2 (server actions) |
| `STATUS_LOG_PHASE3A.md` | Log Phase 3A (client UI) |
| `STATUS_LOG_PHASE3B.md` | Log Phase 3B (modal) |
| `docs/CUTTING_REDESIGN_LOG.md` | Log komprehensif ini |

### File Dimodifikasi
| File | Perubahan Utama |
|---|---|
| `src/lib/actions/produksi/cutting.actions.ts` | Signature baru, fungsi baru, type baru |
| `src/app/(dashboard)/app/produksi/antrian-cutting/AntrianCuttingClient.tsx` | Tab ke-4, bundle checkbox, accordion update |
| `src/app/(dashboard)/app/produksi/antrian-cutting/ModalSelesaiCutting.tsx` | Full redesign 3 bagian |

---

## SQL Functions (Phase 1)

### `mulai_cutting_batch` — Diubah
```sql
mulai_cutting_batch(
  p_bundle_ids  uuid[],
  p_user_id     uuid,
  p_tenant_id   text
) RETURNS jsonb { jumlah_bundle: int }
```
- Lama: menerima `p_po_ids` (update semua bundle dalam PO)
- Baru: menerima `p_bundle_ids` (update bundle spesifik)
- Update `status_tahap.cutting` → `{status:'progress', start_time, updated_by}`

### `selesai_cutting_batch` — Diubah
```sql
selesai_cutting_batch(
  p_bundle_qty  jsonb,  -- [{bundle_id, qty_aktual}]
  p_pemakaian   jsonb,  -- [{inventory_item_id, rate_per_pcs, total_qty_artikel}]
  p_user_id     uuid,
  p_tenant_id   text
) RETURNS jsonb { success, total_qty, partial_count, stok_warnings }
```
- Lama: menerima `p_po_ids` + `p_pemakaian` (format lama)
- Baru: per-bundle qty_aktual → jika kurang dari qty_order → status `partial`
- Deduction: `total_deduction = rate_per_pcs × total_qty_artikel`
- Insert ke `pemakaian_bahan`, kurangi `inventory_item.stok_aktual`

### `close_bundle_cutting` — Baru
```sql
close_bundle_cutting(
  p_bundle_id   uuid,
  p_user_id     uuid,
  p_tenant_id   text
) RETURNS jsonb { success: true }
```
- Update `status_tahap.cutting.status` dari `partial` → `selesai`
- Tambah `closed_at` dan `closed_by`

---

## Server Actions (Phase 2) — `cutting.actions.ts`

| Function | Signature | Keterangan |
|---|---|---|
| `getPOCuttingList()` | `→ POCuttingItem[]` | Status logic: `partial` = progress |
| `mulaiCuttingBatch(bundle_ids)` | `→ {success, jumlah_bundle}` | Ganti dari `po_ids` ke `bundle_ids` |
| `selesaiCuttingBatch(bundle_qty, pemakaian)` | `→ SelesaiCuttingResult` | Format parameter baru, return `partial_count` |
| `closeBundleCutting(bundle_id)` | `→ {success, error?}` | Baru — Phase 2 |
| `getPendingCuttingBundles()` | `→ PendingBundle[]` | Baru — query status `partial` |
| `getInventoryItemsForCutting()` | `→ InventoryItemOption[]` | Tidak berubah |
| `getBundlesForPO(po_id)` | `→ BundleDetailItem[]` | Tambah field `qty_aktual` |
| `getBundlesByIds(bundle_ids)` | `→ BundleForModal[]` | Baru — Phase 3B, fetch untuk modal |

---

## Flow Baru: Mulai → Selesai → Jahit

```
1. HALAMAN ANTRIAN CUTTING (tab "Menunggu")
   └→ Admin klik expand accordion PO
   └→ Tabel bundle muncul dengan checkbox per-bundle
   └→ Admin centang bundle yang akan dipotong
   └→ Klik "Mulai Cutting (N)"
   └→ mulaiCuttingBatch([bundle_ids]) → RPC mulai_cutting_batch
   └→ status_tahap.cutting = {status:'progress', start_time}

2. TAB "SEDANG DIPOTONG"
   └→ Admin expand accordion PO
   └→ Centang bundle yang sudah selesai dipotong
   └→ Klik "Selesai Cutting (N)"
   └→ Modal terbuka: ModalSelesaiCutting

3. MODAL SELESAI CUTTING
   └→ Bagian A: Input qty_aktual per bundle
      - qty_aktual >= qty_order → ✅ Selesai
      - qty_aktual < qty_order → ⚠️ Partial
   └→ Bagian B: Input pemakaian bahan per artikel (warna+size)
      - Pilih inventory item + rate per pcs
      - Preview total realtime: rate × total_qty_aktual_artikel
      - VALIDASI: minimal 1 bahan per artikel
   └→ Bagian C: Summary — bundle selesai/partial, list deduction
   └→ Submit → selesaiCuttingBatch(bundle_qty, pemakaian)
      → RPC selesai_cutting_batch
      → bundle selesai: status → 'selesai'
      → bundle partial: status → 'partial'
      → stok dikurangi, pemakaian_bahan dicatat

4. TAB "PENDING CUTTING" (untuk bundle partial)
   └→ PendingCuttingTab self-fetch getPendingCuttingBundles()
   └→ Tabel: No PO | Barcode | Klien | Warna | Size | Qty Order | Qty Terpotong | Selisih | Aksi
   └→ Klik "Close Bundle" → dialog konfirmasi
   └→ closeBundleCutting(bundle_id) → RPC close_bundle_cutting
   └→ status partial → selesai, closed_at dicatat

5. BUNDLE STATUS = 'SELESAI'
   └→ Bundle siap masuk antrian jahit
   └→ Status scan jahit bisa dimulai
```

---

## Catatan Teknis Penting

### Kolom yang Tidak Ada
- `bundle.updated_at` — **tidak ada**; jejak mutasi disimpan dalam JSONB `status_tahap.cutting`

### Enum
- `tahap_produksi` dipakai untuk insert `pemakaian_bahan.tahap_produksi = 'cutting'::tahap_produksi`

### Status Cutting JSONB
```jsonb
{
  "cutting": {
    "status":       "progress" | "selesai" | "partial",
    "start_time":   "2026-04-25T...",
    "waktu_selesai":"2026-04-25T...",
    "qty_aktual":   150,
    "updated_by":   "uuid-user",
    "closed_at":    "2026-04-25T...",  // hanya untuk partial → close
    "closed_by":    "uuid-user"
  }
}
```

### Formula Pemakaian Bahan
```
total_deduction = rate_per_pcs × total_qty_aktual_artikel
total_qty_aktual_artikel = sum(qty_aktual semua bundle dalam 1 artikel warna+size)
```

### Definisi Artikel
- Artikel = kombinasi unik `warna + size` dalam satu batch selesai cutting
- Pemakaian bahan dihitung per artikel, bukan per bundle

### JSONB Update Safety
- Semua update menggunakan operator `||` (merge) bukan replace penuh
- Key dari tahap lain (jahit, packing, dll) tidak tertimpa

---

## Dependency Graph

```
Phase 1 (SQL RPC)
   └→ Phase 2 (cutting.actions.ts memanggil RPC)
         └→ Phase 3A (AntrianCuttingClient menggunakan actions)
         └→ Phase 3B (ModalSelesaiCutting menggunakan actions)
         └→ Phase 3C (PendingCuttingTab menggunakan actions)
```
