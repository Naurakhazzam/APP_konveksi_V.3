'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Factory,
  Wallet,
  Truck,
  Database,
  Package,
  TrendingUp,
  Settings,
  LogOut,
  Menu,
} from 'lucide-react';
import { type UserProfile } from '@/lib/auth/permissions';
import { signOutAction } from '@/lib/auth/actions';
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';

const NAV_MENU = [
  { 
    label: 'Dashboard', 
    path: '/app/dashboard', 
    id: 'dashboard', 
    icon: LayoutDashboard 
  },
  { 
    label: 'Produksi', 
    path: '/app/produksi/input-po',
    matchPath: '/app/produksi',
    id: 'produksi', 
    icon: Factory,
    children: [
      { label: 'Input PO',        path: '/app/produksi/input-po' },
      { label: 'Antrian Cutting', path: '/app/produksi/antrian-cutting' },
      { label: 'Jahit',           path: '/app/produksi/scan/jahit' },
      { label: 'Lubang Kancing',  path: '/app/produksi/scan/lubang-kancing' },
      { label: 'Buang Benang',    path: '/app/produksi/scan/buang-benang' },
      { label: 'QC',              path: '/app/produksi/scan/qc' },
      { label: 'Steam',           path: '/app/produksi/scan/steam' },
      { label: 'Packing',         path: '/app/produksi/scan/packing' },
      { label: 'Monitoring',      path: '/app/produksi/monitoring' },
      { label: 'Approval QTY',    path: '/app/produksi/approval-qty' },
    ]
  },
  { 
    label: 'Pengiriman', 
    path: '/app/pengiriman/buat-surat-jalan',
    matchPath: '/app/pengiriman',
    id: 'pengiriman', 
    icon: Truck,
    children: [
      { label: 'Buat Surat Jalan', path: '/app/pengiriman/buat-surat-jalan' },
      { label: 'Riwayat Kirim',    path: '/app/pengiriman/riwayat' },
    ]
  },
  { 
    label: 'Penggajian', 
    path: '/app/penggajian/rekap-gaji',
    matchPath: '/app/penggajian',
    id: 'penggajian', 
    icon: Wallet,
    children: [
      { label: 'Rekap Gaji', path: '/app/penggajian/rekap-gaji' },
      { label: 'Kasbon',     path: '/app/penggajian/kasbon' },
      { label: 'Slip Gaji',  path: '/app/penggajian/slip-gaji' },
    ]
  },
  { 
    label: 'Master Data', 
    path: '/app/master/karyawan', 
    matchPath: '/app/master',
    id: 'master-data', 
    icon: Database,
    children: [
      { label: 'Master Detail', path: '/app/master/detail' },
      { label: 'Produk & HPP', path: '/app/master/produk' },
      { label: 'Setup Model',  path: '/app/master/model' },
      { label: 'Karyawan', path: '/app/master/karyawan' },
      { label: 'Jabatan', path: '/app/master/jabatan' },
      { label: 'Klien', path: '/app/master/klien' },
      { label: 'Satuan (UOM)', path: '/app/master/satuan' },
      { label: 'Jenis & Alasan Reject', path: '/app/master/reject' },
      { label: 'Kategori Transaksi', path: '/app/master/kategori-trx' },
      { label: 'Komponen HPP',   path: '/app/master/komponen-hpp' },
      { label: 'Aksesori Warna',  path: '/app/master/aksesori-warna' },
      { label: 'User & Role', path: '/app/master/users' },
      { label: 'Reset Factory', path: '/app/master/reset' },
    ]
  },
  { 
    label: 'Inventory', 
    path: '/app/inventory/overview',
    matchPath: '/app/inventory',
    id: 'inventory', 
    icon: Package,
    children: [
      { label: 'Overview Stok',    path: '/app/inventory/overview' },
      { label: 'Transaksi Keluar', path: '/app/inventory/transaksi-keluar' },
      { label: 'Alert Order',      path: '/app/inventory/alert-order' },
    ]
  },
  { 
    label: 'Keuangan', 
    path: '/app/keuangan/ringkasan',
    matchPath: '/app/keuangan',
    id: 'keuangan', 
    icon: TrendingUp,
    children: [
      { label: 'Ringkasan',           path: '/app/keuangan/ringkasan' },
      { label: 'Jurnal Produksi',       path: '/app/keuangan/jurnal-produksi' },
      { label: 'Laporan Per PO',      path: '/app/keuangan/laporan-po' },
      { label: 'Setting Overhead',    path: '/app/keuangan/overhead-setting' },
      { label: 'Laporan Per Bulan',   path: '/app/keuangan/laporan-bulan' },
      { label: 'Laporan Gaji',        path: '/app/keuangan/laporan-gaji' },
      { label: 'Laporan Koreksi QTY', path: '/app/keuangan/laporan-reject' },
    ]
  },
  { 
    label: 'Settings', 
    path: '/app/settings', 
    id: 'settings', 
    icon: Settings 
  },
];

interface SidebarProps {
  profile: UserProfile;
  allowedNavIds: string[];
  allowedPaths: string[];
}

export function Sidebar({ profile, allowedNavIds, allowedPaths }: SidebarProps) {
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);

  const navItems = NAV_MENU
    .filter((item) => allowedNavIds.includes(item.id))
    .map((item) => {
      if (!item.children) return item;
      // Filter children berdasarkan allowedPaths
      const allowedChildren = item.children.filter(child =>
        allowedPaths.some(p => p === child.path || child.path.startsWith(p))
      );
      return { ...item, children: allowedChildren.length > 0 ? allowedChildren : item.children };
    });

  const SidebarContent = () => (
    <div className="flex h-full flex-col bg-[#0D0E10] text-[#e8eaed]">
      {/* Header */}
      <div className="flex h-14 items-center px-6 border-b border-[#2A2D31]">
        <div className="flex items-center gap-2 font-bold tracking-tight text-lg">
          <span className="text-[#e5c17b]">Stitchlyx</span>
          <span className="text-sm font-normal text-[#9aa0a6]">.Syncore</span>
        </div>
      </div>

      {/* Nav */}
      <div className="flex-1 overflow-y-auto py-4 px-3 space-y-1">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = pathname.startsWith(item.matchPath || item.path);

          return (
            <div key={item.id} className="flex flex-col">
              <Link
                href={item.children ? item.children[0].path : item.path}
                onClick={() => !item.children && setIsOpen(false)}
                className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200 ${
                  isActive
                    ? 'bg-[#1A1D1F] text-[#e5c17b] shadow-[inset_2px_0_0_0_#e5c17b]'
                    : 'text-[#9aa0a6] hover:bg-[#16181A] hover:text-[#e8eaed]'
                }`}
              >
                <Icon size={18} />
                {item.label}
              </Link>
              {item.children && isActive && (
                <div className="ml-9 mt-1 flex flex-col space-y-1 border-l border-[#2A2D31] pl-2 mb-1">
                  {item.children.map(child => {
                    const childActive = pathname.startsWith(child.path);
                    return (
                      <Link
                        key={child.path}
                        href={child.path}
                        onClick={() => setIsOpen(false)}
                        className={`block rounded-lg px-3 py-2 text-xs transition-colors ${
                          childActive ? 'text-[#e5c17b] font-medium bg-[#16181A]' : 'text-[#777e85] hover:text-[#e8eaed]'
                        }`}
                      >
                        {child.label}
                      </Link>
                    )
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div className="p-4 border-t border-[#2A2D31] bg-[#0A0B0C]">
        <div className="flex items-center justify-between">
          <div className="flex flex-col overflow-hidden">
            <span className="truncate text-sm font-semibold text-[#e8eaed]">
              {profile.nama}
            </span>
            <span className="truncate text-xs text-[#9aa0a6] capitalize">
              {profile.role.replace('_', ' ')}
            </span>
          </div>
          <form action={signOutAction}>
            <button
              type="submit"
              className="p-2 text-[#9aa0a6] hover:text-[#e65c5c] transition-colors rounded-md hover:bg-[#1A1D1F]"
              title="Logout"
            >
              <LogOut size={18} />
            </button>
          </form>
        </div>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex w-[240px] flex-col h-screen border-r border-[#2A2D31] bg-[#0D0E10] shrink-0">
        <SidebarContent />
      </aside>

      {/* Mobile Sidebar Trigger (only visible on mobile, positioned absolute or handled in TopBar) */}
      <div className="lg:hidden fixed bottom-6 left-1/2 -translate-x-1/2 z-50">
        <Sheet open={isOpen} onOpenChange={setIsOpen}>
          <SheetTrigger 
            render={
              <Button size="icon" className="rounded-full h-12 w-12 bg-[#1A1D1F] border border-[#2A2D31] shadow-2xl text-[#e5c17b] hover:bg-[#2A2D31]">
                <Menu size={24} />
              </Button>
            } 
          />
          <SheetContent side="left" className="p-0 border-r-[#2A2D31] bg-[#0D0E10] w-[280px]">
            <SheetTitle className="sr-only">Menu Navigasi</SheetTitle>
            <SidebarContent />
          </SheetContent>
        </Sheet>
      </div>
    </>
  );
}
