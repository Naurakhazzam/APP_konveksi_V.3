import React from 'react';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { getCurrentUserProfile } from '@/lib/auth/permissions';
import { getAllowedPathsForRole } from '@/lib/actions/master/permission.actions';
import { redirect } from 'next/navigation';
import { Toaster } from 'sonner';

// Semua path yang ada di app — owner selalu dapat akses ke semua ini
const ALL_APP_PATHS = [
  '/app/dashboard',
  '/app/produksi/input-po',
  '/app/produksi/po/import',
  '/app/produksi/antrian-cutting',
  '/app/produksi/scan/cutting',
  '/app/produksi/scan/jahit',
  '/app/produksi/scan/lubang-kancing',
  '/app/produksi/scan/buang-benang',
  '/app/produksi/scan/qc',
  '/app/produksi/scan/steam',
  '/app/produksi/scan/packing',
  '/app/produksi/monitoring',
  '/app/produksi/approval-qty',
  '/app/pengiriman/buat-surat-jalan',
  '/app/pengiriman/riwayat',
  '/app/penggajian/rekap-gaji',
  '/app/penggajian/kasbon',
  '/app/penggajian/slip-gaji',
  '/app/master/detail',
  '/app/master/produk',
  '/app/master/model',
  '/app/master/karyawan',
  '/app/master/jabatan',
  '/app/master/klien',
  '/app/master/satuan',
  '/app/master/reject',
  '/app/master/kategori-trx',
  '/app/master/komponen-hpp',
  '/app/master/aksesori-warna',
  '/app/master/users',
  '/app/inventory/overview',
  '/app/inventory/transaksi-keluar',
  '/app/inventory/alert-order',
  '/app/keuangan/ringkasan',
  '/app/keuangan/jurnal-produksi',
  '/app/keuangan/buku-kas',
  '/app/keuangan/invoice',
  '/app/keuangan/laporan-lr',
  '/app/keuangan/laporan-po',
  '/app/keuangan/overhead-setting',
  '/app/keuangan/laporan-bulan',
  '/app/keuangan/laporan-gaji',
  '/app/keuangan/laporan-reject',
  '/app/settings',
];

export async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const profile = await getCurrentUserProfile();

  if (!profile) {
    redirect('/login');
  }

  // Owner selalu dapat semua path — role lain ambil dari DB
  const allowedPaths: string[] = profile.role === 'owner'
    ? ALL_APP_PATHS
    : await getAllowedPathsForRole(profile.role);

  // Nav ID → path prefix mapping
  const NAV_PATH_MAP: Record<string, string> = {
    dashboard:     '/app/dashboard',
    produksi:      '/app/produksi',
    pengiriman:    '/app/pengiriman',
    penggajian:    '/app/penggajian',
    'master-data': '/app/master',
    inventory:     '/app/inventory',
    keuangan:      '/app/keuangan',
    settings:      '/app/settings',
  };

  const allowedNavIds = Object.entries(NAV_PATH_MAP)
    .filter(([, prefix]) => allowedPaths.some(p => p.startsWith(prefix)))
    .map(([id]) => id);

  return (
    <div className="flex h-screen w-full font-sans antialiased overflow-hidden bg-background">
      <Toaster position="top-right" richColors />
      <Sidebar profile={profile} allowedNavIds={allowedNavIds} allowedPaths={allowedPaths} />
      <div className="flex-1 flex flex-col min-w-0">
        <TopBar profile={profile} />
        <main className="flex-1 overflow-y-auto p-4 lg:p-8 bg-[#F5F3EF] dark:bg-[#16181A]">
          <div className="mx-auto max-w-7xl w-full h-full">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
