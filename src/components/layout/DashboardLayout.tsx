import React from 'react';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { getCurrentUserProfile } from '@/lib/auth/permissions';
import { getAllowedPathsForRole } from '@/lib/actions/master/permission.actions';
import { redirect } from 'next/navigation';
import { Toaster } from 'sonner';

export async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const profile = await getCurrentUserProfile();
  
  if (!profile) {
    redirect('/login');
  }

  // Ambil semua path yang diizinkan untuk role ini dari DB
  const allowedPaths = await getAllowedPathsForRole(profile.role);

  // Derive allowedNavIds dari allowedPaths (parent nav tampil jika minimal 1 child-nya boleh)
  // Nav ID → path prefix mapping
  const NAV_PATH_MAP: Record<string, string> = {
    dashboard:   '/app/dashboard',
    produksi:    '/app/produksi',
    pengiriman:  '/app/pengiriman',
    penggajian:  '/app/penggajian',
    'master-data': '/app/master',
    inventory:   '/app/inventory',
    keuangan:    '/app/keuangan',
    settings:    '/app/settings',
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
