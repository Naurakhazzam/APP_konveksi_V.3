/**
 * Pencocokan kata kunci untuk daftar bundle (Packing, Buat Surat Jalan, dll).
 *
 * Dipakai bersama oleh server action maupun komponen client, supaya perilaku
 * pencarian di semua halaman persis sama.
 *
 * Aturan: setiap kata di kata kunci harus cocok — urutannya bebas.
 * "khalid putih 2xl" sama saja dengan "2xl khalid putih".
 */

/**
 * Padanan penulisan size. Di database size disimpan sebagai XXL/XXXL, tapi
 * orang di lapangan lazim menulis 2XL/3XL — tanpa padanan ini, mengetik "2XL"
 * menghasilkan nol hasil dan barangnya terlihat seolah tidak ada.
 */
const SIZE_ALIASES: Record<string, string> = {
  s: 's',
  m: 'm',
  l: 'l',
  xl: 'xl',
  xxl: 'xxl', '2xl': 'xxl',
  xxxl: 'xxxl', '3xl': 'xxxl',
  xxxxl: 'xxxxl', '4xl': 'xxxxl',
};

export interface SearchableBundle {
  no_po: string;
  klien_nama: string;
  model_nama: string | null;
  warna: string;
  size: string;
  barcode: string;
}

/** Pecah kata kunci jadi token. Kembalikan array kosong kalau tidak mencari. */
export function tokenizeSearch(search: string): string[] {
  return search.toLowerCase().trim().split(/\s+/).filter(Boolean);
}

export function matchesBundleSearch(item: SearchableBundle, tokens: string[]): boolean {
  if (tokens.length === 0) return true;

  // Size sengaja TIDAK ikut di haystack — dicocokkan terpisah secara persis.
  // Kalau ikut sebagai substring, mencari "XXL" juga akan memunculkan XXXL,
  // dan mencari "L" memunculkan semua yang mengandung huruf l ("Black").
  const haystack = [item.no_po, item.klien_nama, item.model_nama, item.warna, item.barcode]
    .join(' ')
    .toLowerCase();

  // Versi tanpa spasi & strip, supaya "air flow" tetap menemukan "Airflow".
  const rapat = haystack.replace(/[\s-]/g, '');
  const size = (item.size ?? '').toLowerCase();

  return tokens.every(t => {
    const sizeAlias = SIZE_ALIASES[t];
    if (sizeAlias) return size === sizeAlias;
    return haystack.includes(t) || rapat.includes(t) || size.includes(t);
  });
}

/** Bentuk ringkas untuk pemakaian sekali jalan. */
export function matchesBundleQuery(item: SearchableBundle, search: string): boolean {
  return matchesBundleSearch(item, tokenizeSearch(search));
}
