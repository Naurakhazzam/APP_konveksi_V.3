export const TAHAP_LABELS: Record<string, string> = {
  cutting:   'Cutting',
  jahit:     'Jahit',
  bordir:    'Bordir',
  sablon:    'Sablon',
  qc:        'Quality Control (QC)',
  finishing: 'Finishing / Packing',
  gudang:    'Penerimaan Bahan (Gudang)',
};

// Tahap yang wajib punya karyawan aktif saat scan
export const TAHAP_REQUIRES_KARYAWAN: string[] = [
  'cutting',
  'jahit',
  'bordir',
  'sablon',
  'qc',
  'finishing',
];
