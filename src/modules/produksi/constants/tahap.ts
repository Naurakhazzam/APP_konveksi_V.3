export const TAHAP_ORDER = [
  'cutting', 'jahit', 'lubang_kancing',
  'buang_benang', 'qc', 'steam', 'packing',
] as const;

export type TahapKey = typeof TAHAP_ORDER[number];

export const TAHAP_CONFIG: Record<TahapKey, {
  label: string;
  slug: string;
  requiresKaryawan: boolean;
  isBorongan: boolean;
  urutan: number;
}> = {
  cutting:        { label: 'Cutting',        slug: 'cutting',        requiresKaryawan: true,  isBorongan: false, urutan: 1 },
  jahit:          { label: 'Jahit',          slug: 'jahit',          requiresKaryawan: true,  isBorongan: false, urutan: 2 },
  lubang_kancing: { label: 'Lubang Kancing', slug: 'lubang-kancing', requiresKaryawan: false, isBorongan: true,  urutan: 3 },
  buang_benang:   { label: 'Buang Benang',   slug: 'buang-benang',   requiresKaryawan: false, isBorongan: true,  urutan: 4 },
  qc:             { label: 'QC',             slug: 'qc',             requiresKaryawan: false, isBorongan: true,  urutan: 5 },
  steam:          { label: 'Steam',          slug: 'steam',          requiresKaryawan: false, isBorongan: true,  urutan: 6 },
  packing:        { label: 'Packing',        slug: 'packing',        requiresKaryawan: false, isBorongan: true,  urutan: 7 },
};

export function getPrevTahap(tahap: TahapKey): TahapKey | null {
  const idx = TAHAP_ORDER.indexOf(tahap);
  return idx > 0 ? TAHAP_ORDER[idx - 1] : null;
}

export function getNextTahap(tahap: TahapKey): TahapKey | null {
  const idx = TAHAP_ORDER.indexOf(tahap);
  return idx < TAHAP_ORDER.length - 1 ? TAHAP_ORDER[idx + 1] : null;
}
