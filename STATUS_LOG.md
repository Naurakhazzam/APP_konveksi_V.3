# STATUS LOG — Update Logic Supabase Cutting

**Tanggal Pengerjaan:** 25 April 2026

## Daftar Function yang Dibuat / Diubah

### 1. `mulai_cutting_batch` (Diubah)
**Signature:**
```sql
mulai_cutting_batch(p_bundle_ids uuid[], p_user_id uuid, p_tenant_id text) RETURNS jsonb
```
**Perubahan Logic:**
- Sebelumnya menerima `p_po_ids`. Sekarang menerima array `p_bundle_ids`.
- Mengubah array `bundle` berdasarkan `p_bundle_ids` spesifik, bukan seluruh PO.
- Update properti `status_tahap->'cutting'` dengan menggabungkan JSONB (`||`) agar data sebelumnya tidak terhapus.
- Menambahkan status menjadi `'progress'`, `start_time` menggunakan timestamp UTC sekarang, serta `updated_by`.

### 2. `selesai_cutting_batch` (Diubah)
**Signature:**
```sql
selesai_cutting_batch(p_bundle_qty jsonb, p_pemakaian jsonb, p_user_id uuid, p_tenant_id text) RETURNS jsonb
```
**Perubahan Logic:**
- Penambahan perhitungan per bundle: Jika `qty_aktual < qty_order` (yang diambil dari tabel `po_item.qty_per_bundle`), maka bundle mendapat status baru `'partial'`. Jika terpenuhi, mendapat status `'selesai'`.
- Status `'selesai'` menambahkan `qty_aktual` ke total akumulatif yang dikembalikan.
- Perhitungan stok bahan kini menghitung deduction berdasarkan `rate_per_pcs * total_qty_artikel` dari parameter JSONB `p_pemakaian`.
- Menyisipkan data ke `pemakaian_bahan` dengan referensi `bundle_id` pertama dari iterasi bundle. 
- Warning alert ditambahkan apabila sisa stok bahan setelah pemakaian menunjukkan nilai negatif.

### 3. `close_bundle_cutting` (Baru)
**Signature:**
```sql
close_bundle_cutting(p_bundle_id uuid, p_user_id uuid, p_tenant_id text) RETURNS jsonb
```
**Fungsi:**
- Mengganti state `status_tahap->'cutting'->>'status'` dari `'partial'` menjadi `'selesai'`.
- Menambahkan flag `closed_at` (timestamp) dan `closed_by` (`p_user_id`).

## Catatan Penting
- **Kolom `updated_at` di tabel bundle:** Tidak digunakan, karena track jejak mutasi disimpan langsung ke dalam `status_tahap->'cutting'` menggunakan `updated_by` dan log timestamp `waktu_selesai` / `start_time`.
- **Enum `tahap_produksi`:** Digunakan secara eksplisit sebagai mapping untuk insert record di tabel `pemakaian_bahan` (`'cutting'::tahap_produksi`).
- **JSONB Update Safety:** Update pada kolom JSONB dilakukan dengan menggabungkan (`||`) JSON sebelumnya dengan data baru agar key lain (misalnya tahap jahit atau packing) tidak tertimpa/terhapus.
