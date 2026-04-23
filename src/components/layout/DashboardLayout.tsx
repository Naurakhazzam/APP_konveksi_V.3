import React from 'react';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { getCurrentUserProfile, canAccessPage } from '@/lib/auth/permissions';
import { redirect } from 'next/navigation';

export async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const profile = await getCurrentUserProfile();
  
  if (!profile) {
    redirect('/login');
  }

  const allNavIds = [
    'dashboard',
    'produksi',
    'pengiriman',
    'penggajian',
    'master-data',
    'inventory',
    'keuangan',
    'settings'
  ];

  const allowedNavIds = allNavIds.filter((id) => canAccessPage(profile.role, id));

  return (
    <div className="flex h-screen w-full font-sans antialiased overflow-hidden bg-background">
      <Sidebar profile={profile} allowedNavIds={allowedNavIds} />
      <div className="flex-1 flex flex-col min-w-0">
        <TopBar profile={profile} />
        {/* Konten layout utamanya, bg ini untuk bedakan card dan surface */}
        <main className="flex-1 overflow-y-auto p-4 lg:p-8 bg-[#F5F3EF] dark:bg-[#16181A]">
          <div className="mx-auto max-w-7xl w-full h-full">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
