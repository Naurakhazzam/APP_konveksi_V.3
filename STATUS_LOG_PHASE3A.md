# STATUS LOG PHASE 3A — Update `AntrianCuttingClient.tsx`

**Tanggal Pengerjaan:** 25 April 2026

---

## Perubahan di `AntrianCuttingClient.tsx`

### State Baru
| State | Type | Tujuan |
|---|---|---|
| `selectedBundleIds` | `Record<string, Set<string>>` | Menyimpan bundle_id yang dipilih per PO |
| `pendingBundles` | `PendingBundle[]` | Data bundle dengan status `partial` |
| `isLoadingPending` | `boolean` | Loading state untuk tab Pending |

### Helper Baru
| Helper | Deskripsi |
|---|---|
| `toggleBundle(po_id, bundle_id)` | Toggle seleksi satu bundle |
| `toggleAllBundlesForPO(po_id)` | Toggle semua bundle dalam satu PO |
| `allSelectedBundleIds` | Computed: flat list semua bundle_id terpilih |
| `buildBundleQty()` | Build `BundleQtyInput[]` dari selected bundles untuk ModalSelesaiCutting |

### TabKey Diperbarui
- Sebelum: `'menunggu' | 'progress' | 'selesai'`
- Sesudah: `'menunggu' | 'progress' | 'pending' | 'selesai'`

### Tab Baru: "Pending Cutting"
- Posisi: antara Sedang Dipotong dan Selesai
- Badge count merah jika ada bundle pending
- Data diambil via `getPendingCuttingBundles()` saat tab aktif

### Logic Mulai Cutting (Updated)
- Sebelum: kirim `selectedPoIds` ke `mulaiCuttingBatch`
- Sesudah: kirim `allSelectedBundleIds` ke `mulaiCuttingBatch` (bundle-level)
- Tombol disabled jika `allSelectedBundleIds.length === 0`

### Logic Selesai Cutting (Updated)
- Tombol disabled jika tidak ada bundle terpilih (`hasBundleSel`)
- `ModalSelesaiCutting` sekarang mendapat prop `bundleQty={buildBundleQty()}`

### Accordion Bundle (Updated)
- Tambah "Pilih Semua" checkbox di header accordion
- Setiap baris bundle sekarang punya checkbox seleksi
- Status cutting tambah `'partial'` (badge orange)
- Kolom label: "QTY" → "Qty Order", "Cutting" → "Status Cutting"

---

## Component Baru

### `PendingCuttingTab.tsx`
**Lokasi:** `src/app/(dashboard)/app/produksi/antrian-cutting/PendingCuttingTab.tsx`

**Props:**
```ts
interface Props {
  bundles: PendingBundle[];
  onRefresh: () => void;
}
```

**Fitur:**
- Tabel: No PO | Barcode | Warna | Size | Qty Order | Qty Terpotong | Aksi
- Kolom Qty Terpotong: warna orange + persentase
- Kolom Aksi: tombol "Close Bundle" dengan konfirmasi inline (Ya / Batal)
- Memanggil `closeBundleCutting(bundle_id)` saat dikonfirmasi
- `onRefresh()` dipanggil setelah close berhasil

---

## Dependency ke Phase 2

| Function Dipanggil | Dari File |
|---|---|
| `mulaiCuttingBatch(bundle_ids)` | `cutting.actions.ts` — signature baru (bundle_ids) |
| `getPendingCuttingBundles()` | `cutting.actions.ts` — fungsi baru Phase 2 |
| `closeBundleCutting(bundle_id)` | `cutting.actions.ts` — fungsi baru Phase 2 |
| `buildBundleQty()` → `selesaiCuttingBatch(bundle_qty, pemakaian)` | via `ModalSelesaiCutting.tsx` |

---

## Catatan
- `selectedPoIds` state dipertahankan namun tidak lagi digunakan untuk mulai/selesai cutting — hanya untuk filter cetak SPK/Label/Kartu
- Pengguna harus expand accordion PO terlebih dahulu sebelum memilih bundle (bundleCache harus terisi)
- `bundleQty` dikirim ke ModalSelesaiCutting dengan `qty_aktual = qty_per_bundle` (default); UI untuk input custom qty_aktual per bundle dapat ditambahkan di Phase 3B
