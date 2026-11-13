import { cache } from 'react';
import { createClient } from '@/lib/supabase/server';
import { getUserFromClaims } from '@/lib/auth/session';

// ---------------------------------------------------------------------------
// Tipe
// ---------------------------------------------------------------------------

export type UserRole =
  | 'owner'
  | 'admin_produksi'
  | 'admin_keuangan'
  | 'supervisor'
  | 'mandor';

export interface UserProfile {
  id: string;
  nama: string;
  role: UserRole;
  aktif: boolean;
  tenant_id: string;
  created_at: string;
}

// ---------------------------------------------------------------------------
// getCurrentUserProfile
// Ambil user dari session aktif, lalu query tabel user_profile.
// Return null jika tidak ada session atau profile tidak ditemukan.
// ---------------------------------------------------------------------------

// Dibungkus cache() agar dalam satu request hanya query ke DB + Auth sekali,
// meskipun dipanggil dari DashboardLayout, layout.tsx, page.tsx, dan server actions sekaligus.
export const getCurrentUserProfile = cache(async (): Promise<UserProfile | null> => {
  const supabase = await createClient();

  const {
    data: { user },
    error: userError,
  } = await getUserFromClaims(supabase);

  if (userError || !user) return null;

  const { data: profile, error: profileError } = await supabase
    .from('user_profile')
    .select('id, nama, role, aktif, tenant_id, created_at')
    .eq('id', user.id)
    .single();

  if (profileError || !profile) return null;

  return profile as UserProfile;
});

// ---------------------------------------------------------------------------
// Produksi read-only
// admin_keuangan boleh MELIHAT menu produksi (jika dicentang di Permission
// Matrix), tapi tidak boleh mengubah data apa pun di sana.
// ---------------------------------------------------------------------------

export const PRODUKSI_READ_ONLY_MESSAGE =
  'Akses hanya-lihat: role Anda tidak dapat mengubah data produksi.';

export function isProduksiReadOnly(role: UserRole | string | null | undefined): boolean {
  return role === 'admin_keuangan';
}

/** Panggil di awal setiap server action yang MENGUBAH data produksi. */
export async function assertCanEditProduksi(): Promise<UserProfile> {
  const profile = await getCurrentUserProfile();
  if (!profile) throw new Error('Unauthorized');
  if (isProduksiReadOnly(profile.role)) throw new Error(PRODUKSI_READ_ONLY_MESSAGE);
  return profile;
}

// ---------------------------------------------------------------------------
// canAccessPage
// Sesuai matrix akses halaman BR-10 bagian 2.1.
// `page` adalah segment path, contoh: 'master-data', 'produksi/scan-station'
// ---------------------------------------------------------------------------

export function canAccessPage(role: UserRole, page: string): boolean {
  const matrix: Record<string, UserRole[]> = {
    'dashboard':              ['owner', 'admin_produksi', 'admin_keuangan', 'supervisor'],
    'produksi':               ['owner', 'admin_produksi', 'supervisor'],
    'pengiriman':             ['owner', 'admin_produksi', 'admin_keuangan', 'supervisor'],
    'penggajian':             ['owner', 'supervisor'],
    'master-data':            ['owner'],
    'inventory':              ['owner', 'admin_produksi', 'admin_keuangan'],
    'keuangan':               ['owner', 'admin_keuangan', 'supervisor'],
    'settings':               ['owner'],
    'produksi/input-po':      ['owner', 'admin_produksi'],
    'produksi/scan-station':  ['owner', 'admin_produksi', 'mandor'],
    'produksi/monitoring':    ['owner', 'admin_produksi', 'supervisor'],
    'produksi/koreksi':       ['owner', 'admin_produksi'],
    'produksi/approval-qty':  ['owner'],
    'produksi/surat-jalan':   ['owner', 'admin_produksi'],
    'pengiriman/riwayat':     ['owner', 'admin_produksi', 'admin_keuangan', 'supervisor'],
    'penggajian/rekap':       ['owner', 'supervisor'],
    'penggajian/kasbon':      ['owner', 'supervisor'],
    'penggajian/slip':        ['owner', 'supervisor'],
    'keuangan/jurnal-produksi':   ['owner', 'admin_keuangan'],
    'keuangan/buku-kas':          ['owner', 'admin_keuangan'],
    'keuangan/invoice':           ['owner', 'admin_keuangan', 'supervisor'],
    'keuangan/laporan-lr':        ['owner', 'admin_keuangan'],
    'laporan/per-po':         ['owner', 'admin_keuangan', 'supervisor'],
    'laporan/bulanan':        ['owner', 'admin_keuangan', 'supervisor'],
    'laporan/gaji':           ['owner', 'admin_keuangan', 'supervisor'],
    'laporan/reject':         ['owner', 'admin_produksi', 'admin_keuangan', 'supervisor'],
    'audit-log':              ['owner'],
    'user-management':        ['owner'],
  };

  const allowedRoles = matrix[page];

  // Jika page tidak terdaftar di matrix, tolak akses
  if (!allowedRoles) return false;

  return allowedRoles.includes(role);
}

// ---------------------------------------------------------------------------
// permissions
// Checker per aksi spesifik — sesuai BR-10 bagian 2.2.
// Dipanggil di Server Actions sebelum eksekusi aksi sensitif.
// ---------------------------------------------------------------------------

export const permissions = {
  /** Hanya owner yang boleh edit master data */
  canEditMasterData: (role: UserRole): boolean =>
    role === 'owner',

  /** Hanya owner yang boleh approve koreksi QTY surplus */
  canApproveKoreksi: (role: UserRole): boolean =>
    role === 'owner',

  /** Owner, admin keuangan, supervisor boleh lihat margin & HPP realisasi */
  canViewMarginHPP: (role: UserRole): boolean =>
    (['owner', 'admin_keuangan', 'supervisor'] as UserRole[]).includes(role),

  /** Owner dan supervisor boleh kelola kasbon */
  canManageKasbon: (role: UserRole): boolean =>
    (['owner', 'supervisor'] as UserRole[]).includes(role),

  /** Owner dan admin keuangan boleh input jurnal keuangan */
  canInputJurnal: (role: UserRole): boolean =>
    (['owner', 'admin_keuangan'] as UserRole[]).includes(role),

  /** Owner dan admin produksi boleh finalisasi surat jalan */
  canFinalizeSuratJalan: (role: UserRole): boolean =>
    (['owner', 'admin_produksi'] as UserRole[]).includes(role),

  /** Hanya owner yang boleh manage user & assign role */
  canManageUser: (role: UserRole): boolean =>
    role === 'owner',

  /** Owner, admin produksi, dan mandor boleh akses scan station */
  canScanStation: (role: UserRole): boolean =>
    (['owner', 'admin_produksi', 'mandor'] as UserRole[]).includes(role),
} as const;
