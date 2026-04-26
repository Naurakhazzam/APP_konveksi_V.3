'use client';

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { saveRolePermissions } from '@/lib/actions/master/permission.actions';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import type { RolePermissionMap, PathPermission } from '@/lib/actions/master/permission.actions';

// Semua menu yang ada di app (sesuai Sidebar NAV_MENU)
const ALL_MENUS = [
  { group: 'Dashboard',     path: '/app/dashboard',                    label: 'Dashboard' },
  { group: 'Produksi',      path: '/app/produksi/input-po',            label: '└ Input PO' },
  { group: 'Produksi',      path: '/app/produksi/po/import',           label: '└ Import PO Massal' },
  { group: 'Produksi',      path: '/app/produksi/antrian-cutting',     label: '└ Antrian Cutting' },
  { group: 'Produksi',      path: '/app/produksi/scan/cutting',        label: '└ Scan Cutting' },
  { group: 'Produksi',      path: '/app/produksi/scan/jahit',          label: '└ Scan Jahit' },
  { group: 'Produksi',      path: '/app/produksi/scan/lubang-kancing', label: '└ Scan Lubang Kancing' },
  { group: 'Produksi',      path: '/app/produksi/scan/buang-benang',   label: '└ Scan Buang Benang' },
  { group: 'Produksi',      path: '/app/produksi/scan/qc',             label: '└ Scan QC' },
  { group: 'Produksi',      path: '/app/produksi/scan/steam',          label: '└ Scan Steam' },
  { group: 'Produksi',      path: '/app/produksi/scan/packing',        label: '└ Scan Packing' },
  { group: 'Produksi',      path: '/app/produksi/monitoring',          label: '└ Monitoring' },
  { group: 'Produksi',      path: '/app/produksi/approval-qty',        label: '└ Approval QTY' },
  { group: 'Pengiriman',    path: '/app/pengiriman/buat-surat-jalan',  label: '└ Buat Surat Jalan' },
  { group: 'Pengiriman',    path: '/app/pengiriman/riwayat',           label: '└ Riwayat Kirim' },
  { group: 'Penggajian',    path: '/app/penggajian/rekap-gaji',        label: '└ Rekap Gaji' },
  { group: 'Penggajian',    path: '/app/penggajian/kasbon',            label: '└ Kasbon' },
  { group: 'Penggajian',    path: '/app/penggajian/slip-gaji',         label: '└ Slip Gaji' },
  { group: 'Master Data',   path: '/app/master/detail',                label: '└ Master Detail' },
  { group: 'Master Data',   path: '/app/master/produk',                label: '└ Produk & HPP' },
  { group: 'Master Data',   path: '/app/master/model',                 label: '└ Setup Model' },
  { group: 'Master Data',   path: '/app/master/karyawan',              label: '└ Karyawan' },
  { group: 'Master Data',   path: '/app/master/jabatan',               label: '└ Jabatan' },
  { group: 'Master Data',   path: '/app/master/klien',                 label: '└ Klien' },
  { group: 'Master Data',   path: '/app/master/satuan',                label: '└ Satuan (UOM)' },
  { group: 'Master Data',   path: '/app/master/reject',                label: '└ Jenis & Alasan Reject' },
  { group: 'Master Data',   path: '/app/master/kategori-trx',          label: '└ Kategori Transaksi' },
  { group: 'Master Data',   path: '/app/master/komponen-hpp',          label: '└ Komponen HPP' },
  { group: 'Master Data',   path: '/app/master/aksesori-warna',        label: '└ Aksesori Warna' },
  { group: 'Master Data',   path: '/app/master/users',                 label: '└ User & Role' },
  { group: 'Inventory',     path: '/app/inventory/overview',           label: '└ Overview Stok' },
  { group: 'Inventory',     path: '/app/inventory/transaksi-keluar',   label: '└ Transaksi Keluar' },
  { group: 'Inventory',     path: '/app/inventory/alert-order',        label: '└ Alert Order' },
  { group: 'Keuangan',      path: '/app/keuangan/ringkasan',           label: '└ Ringkasan' },
  { group: 'Keuangan',      path: '/app/keuangan/jurnal-produksi',     label: '└ Jurnal Produksi' },
  { group: 'Keuangan',      path: '/app/keuangan/laporan-po',          label: '└ Laporan Per PO' },
  { group: 'Keuangan',      path: '/app/keuangan/laporan-bulan',       label: '└ Laporan Per Bulan' },
  { group: 'Keuangan',      path: '/app/keuangan/laporan-gaji',        label: '└ Laporan Gaji' },
  { group: 'Keuangan',      path: '/app/keuangan/laporan-reject',      label: '└ Laporan Koreksi QTY' },
  { group: 'Settings',      path: '/app/settings',                     label: 'Settings' },
];

const EDITABLE_ROLES = [
  { value: 'admin_produksi', label: 'Admin Produksi' },
  { value: 'admin_keuangan', label: 'Admin Keuangan' },
  { value: 'supervisor',     label: 'Supervisor' },
  { value: 'mandor',         label: 'Mandor' },
];

interface Props {
  initialPermissions: RolePermissionMap;
}

export default function PermissionMatrix({ initialPermissions }: Props) {
  const [selectedRole, setSelectedRole] = useState('admin_produksi');
  const [permissions, setPermissions] = useState<RolePermissionMap>(initialPermissions);
  const [saving, setSaving] = useState(false);

  const getCanView = (path: string): boolean => {
    const rolePerms = permissions[selectedRole] ?? [];
    return rolePerms.find(p => p.path === path)?.can_view ?? false;
  };

  const toggle = (path: string) => {
    setPermissions(prev => {
      const rolePerms = [...(prev[selectedRole] ?? [])];
      const idx = rolePerms.findIndex(p => p.path === path);
      if (idx >= 0) {
        rolePerms[idx] = { ...rolePerms[idx], can_view: !rolePerms[idx].can_view };
      } else {
        rolePerms.push({ path, can_view: true });
      }
      return { ...prev, [selectedRole]: rolePerms };
    });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const rolePerms = permissions[selectedRole] ?? [];
      // Pastikan semua path ada di data yang disimpan
      const fullPerms: PathPermission[] = ALL_MENUS.map(menu => ({
        path: menu.path,
        can_view: rolePerms.find(p => p.path === menu.path)?.can_view ?? false,
      }));
      await saveRolePermissions(selectedRole, fullPerms);
      toast.success('Permission berhasil disimpan');
    } catch (err: any) {
      toast.error(err.message || 'Gagal menyimpan permission');
    } finally {
      setSaving(false);
    }
  };

  let lastGroup = '';

  return (
    <div className="rounded-xl border border-[#2A2D31] bg-[#1A1D1F] overflow-hidden">
      {/* Role Selector */}
      <div className="flex items-center justify-between p-4 border-b border-[#2A2D31]">
        <div className="flex gap-2">
          {EDITABLE_ROLES.map(r => (
            <button
              key={r.value}
              onClick={() => setSelectedRole(r.value)}
              className={`px-4 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-colors ${
                selectedRole === r.value
                  ? 'bg-[#e5c17b] text-[#0D0E10]'
                  : 'bg-[#2A2D31] text-[#9aa0a6] hover:text-[#e8eaed]'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
        <Button
          onClick={handleSave}
          disabled={saving}
          className="bg-[#e5c17b] text-[#0D0E10] hover:bg-[#d4b06a] font-bold text-xs uppercase h-8 px-4"
        >
          {saving ? <Loader2 className="h-3 w-3 animate-spin mr-2" /> : null}
          Simpan
        </Button>
      </div>

      {/* Matrix Table */}
      <div className="overflow-y-auto max-h-[500px]">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-[#2A2D31] z-10">
            <tr>
              <th className="text-left px-4 py-2.5 text-[#9aa0a6] font-bold uppercase tracking-widest w-full">Menu / Halaman</th>
              <th className="text-center px-6 py-2.5 text-[#9aa0a6] font-bold uppercase tracking-widest whitespace-nowrap">Tampilkan</th>
            </tr>
          </thead>
          <tbody>
            {ALL_MENUS.map((menu) => {
              const isNewGroup = menu.group !== lastGroup;
              lastGroup = menu.group;
              const checked = getCanView(menu.path);
              const isSubMenu = menu.label.startsWith('└');

              return (
                <React.Fragment key={menu.path}>
                  {isNewGroup && (
                    <tr className="bg-[#16181A]">
                      <td colSpan={2} className="px-4 py-1.5 text-[10px] font-black uppercase tracking-widest text-[#e5c17b]">
                        {menu.group}
                      </td>
                    </tr>
                  )}
                  <tr
                    className="border-t border-[#2A2D31] hover:bg-[#2A2D31]/30 cursor-pointer transition-colors"
                    onClick={() => toggle(menu.path)}
                  >
                    <td className={`px-4 py-2.5 ${isSubMenu ? 'pl-8 text-[#9aa0a6]' : 'text-[#e8eaed] font-semibold'}`}>
                      {menu.label}
                    </td>
                    <td className="text-center px-6 py-2.5">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggle(menu.path)}
                        onClick={e => e.stopPropagation()}
                        className="w-4 h-4 cursor-pointer accent-[#e5c17b]"
                      />
                    </td>
                  </tr>
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="px-4 py-2.5 border-t border-[#2A2D31] bg-[#16181A]">
        <p className="text-[10px] text-[#9aa0a6] italic">
          Permission role <strong className="text-[#e5c17b]">Owner</strong> selalu aktif di semua menu dan tidak dapat diubah.
          Klik baris untuk toggle akses.
        </p>
      </div>
    </div>
  );
}
