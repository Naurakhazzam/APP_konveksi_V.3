'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle,
  DialogDescription,
  DialogFooter
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { 
  DropdownMenu, 
  DropdownMenuContent, 
  DropdownMenuItem, 
  DropdownMenuTrigger 
} from '@/components/ui/dropdown-menu';
import { Shield, UserX, UserCheck, ChevronDown, Loader2, UserPlus } from 'lucide-react';
import { updateUserRole, toggleUserAktif, createUser } from '@/lib/actions/master/user.actions';
import type { UserRole } from '@/lib/auth/permissions';
import { toast } from 'sonner';
import PermissionMatrix from './PermissionMatrix';
import type { RolePermissionMap } from '@/lib/actions/master/permission.actions';

interface UserData {
  id: string;
  nama: string;
  role: UserRole;
  aktif: boolean;
  email: string;
  created_at: string;
}

interface UsersClientProps {
  initialUsers: UserData[];
  currentUserId: string;
  initialPermissions: RolePermissionMap;
}

const ROLES: { value: UserRole; label: string }[] = [
  { value: 'owner', label: 'Owner' },
  { value: 'admin_produksi', label: 'Admin Produksi' },
  { value: 'admin_keuangan', label: 'Admin Keuangan' },
  { value: 'supervisor', label: 'Supervisor' },
  { value: 'mandor', label: 'Mandor' },
];

export function UsersClient({ initialUsers, currentUserId, initialPermissions }: UsersClientProps) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<'users' | 'permissions'>('users');
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [userToToggle, setUserToToggle] = useState<UserData | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createLoading, setCreateLoading] = useState(false);
  const [createForm, setCreateForm] = useState({
    email: '',
    password: '',
    nama: '',
    role: 'mandor' as UserRole,
  });

  const handleRoleChange = async (userId: string, newRole: UserRole) => {
    if (userId === currentUserId) return;
    
    setLoadingId(userId);
    try {
      await updateUserRole(userId, newRole);
      toast.success('Role berhasil diperbarui');
      router.refresh();
    } catch (err: any) {
      toast.error(err.message || 'Gagal mengubah role');
    } finally {
      setLoadingId(null);
    }
  };

  const handleToggleAktif = async () => {
    if (!userToToggle || userToToggle.id === currentUserId) return;

    setLoadingId(userToToggle.id);
    setConfirmOpen(false);
    try {
      await toggleUserAktif(userToToggle.id);
      toast.success(`User berhasil ${userToToggle.aktif ? 'dinonaktifkan' : 'diaktifkan'}`);
      router.refresh();
    } catch (err: any) {
      toast.error(err.message || 'Gagal mengubah status user');
    } finally {
      setLoadingId(null);
      setUserToToggle(null);
    }
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateLoading(true);
    try {
      const result = await createUser(createForm);
      if (!result.success) throw new Error(result.error);
      toast.success(`User ${createForm.nama} berhasil dibuat`);
      setCreateOpen(false);
      setCreateForm({ email: '', password: '', nama: '', role: 'mandor' as UserRole });
      router.refresh();
    } catch (err: any) {
      toast.error(err.message || 'Gagal membuat user');
    } finally {
      setCreateLoading(false);
    }
  };

  const getRoleBadge = (role: UserRole) => {
    const styles: Record<UserRole, string> = {
      owner: 'bg-red-500/10 text-red-500 border-red-500/20',
      admin_produksi: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
      admin_keuangan: 'bg-purple-500/10 text-purple-500 border-purple-500/20',
      supervisor: 'bg-green-500/10 text-green-500 border-green-500/20',
      mandor: 'bg-slate-500/10 text-slate-400 border-slate-500/20',
    };
    return (
      <Badge variant="outline" className={`capitalize font-medium ${styles[role]}`}>
        {role.replace('_', ' ')}
      </Badge>
    );
  };

  return (
    <div className="space-y-4">
      {/* Tab Navigation */}
      <div className="flex gap-1 border-b border-[#2A2D31] pb-0">
        {[
          { id: 'users', label: 'Daftar User' },
          { id: 'permissions', label: 'Hak Akses per Role' },
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as any)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              activeTab === tab.id
                ? 'border-[#e5c17b] text-[#e5c17b]'
                : 'border-transparent text-[#9aa0a6] hover:text-[#e8eaed]'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'users' && (
        <div className="space-y-4">
          {/* Tombol Tambah User */}
          <div className="flex justify-end">
        <Button
          onClick={() => setCreateOpen(true)}
          className="bg-[#e5c17b] text-[#0D0E10] hover:bg-[#d4b06a] font-bold text-xs uppercase tracking-widest h-9 px-4"
        >
          <UserPlus className="h-4 w-4 mr-2" />
          Tambah User
        </Button>
      </div>

      <div className="rounded-xl border border-[#2A2D31] bg-[#1A1D1F] overflow-hidden shadow-lg">
        <Table>
          <TableHeader className="bg-[#2A2D31]/30">
            <TableRow className="border-[#2A2D31] hover:bg-transparent">
              <TableHead className="text-[#9aa0a6]">Nama & Email</TableHead>
              <TableHead className="text-[#9aa0a6]">Role</TableHead>
              <TableHead className="text-[#9aa0a6]">Status</TableHead>
              <TableHead className="text-[#9aa0a6] text-right">Aksi</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {initialUsers.map((user) => (
              <TableRow key={user.id} className="border-[#2A2D31] transition-colors hover:bg-[#2A2D31]/20">
                <TableCell>
                  <div className="flex flex-col">
                    <span className="font-semibold text-[#e8eaed]">{user.nama} {user.id === currentUserId && <span className="text-[10px] bg-blue-500 text-white px-1.5 py-0.5 rounded ml-2">SAYA</span>}</span>
                    <span className="text-xs text-[#9aa0a6] font-mono">{user.email}</span>
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    {getRoleBadge(user.role)}
                  </div>
                </TableCell>
                <TableCell>
                  {user.aktif ? (
                    <Badge variant="outline" className="bg-green-500/10 text-green-500 border-green-500/20">Aktif</Badge>
                  ) : (
                    <Badge variant="outline" className="bg-red-500/10 text-red-400 border-red-500/20">Nonaktif</Badge>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-2">
                    {user.id !== currentUserId && (
                      <>
                        <DropdownMenu>
                          <DropdownMenuTrigger render={
                            <Button 
                              variant="ghost" 
                              size="sm" 
                              className="h-8 border border-[#2A2D31] text-[#9aa0a6] hover:text-[#e8eaed]"
                              disabled={loadingId === user.id}
                            />
                          }>
                            {loadingId === user.id ? <Loader2 className="h-3 w-3 animate-spin mr-2" /> : <Shield className="h-3 w-3 mr-2" />}
                            Ubah Role
                            <ChevronDown className="h-3 w-3 ml-2" />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="bg-[#1A1D1F] border-[#2A2D31] text-[#e8eaed]">
                            {ROLES.map((role) => (
                              <DropdownMenuItem 
                                key={role.value}
                                onClick={() => handleRoleChange(user.id, role.value)}
                                className={`cursor-pointer hover:bg-[#2A2D31] ${user.role === role.value ? 'bg-[#2A2D31] text-[#e5c17b]' : ''}`}
                              >
                                {role.label}
                              </DropdownMenuItem>
                            ))}
                          </DropdownMenuContent>
                        </DropdownMenu>

                        <Button
                          variant="ghost"
                          size="sm"
                          className={`h-8 border ${user.aktif ? 'text-red-400 border-red-500/20 hover:bg-red-500/10' : 'text-green-400 border-green-500/20 hover:bg-green-500/10'}`}
                          disabled={loadingId === user.id}
                          onClick={() => {
                            setUserToToggle(user);
                            setConfirmOpen(true);
                          }}
                        >
                          {user.aktif ? <UserX className="h-3 w-3 mr-2" /> : <UserCheck className="h-3 w-3 mr-2" />}
                          {user.aktif ? 'Nonaktifkan' : 'Aktifkan'}
                        </Button>
                      </>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      </div>
      )}

      {activeTab === 'permissions' && (
        <PermissionMatrix initialPermissions={initialPermissions} />
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="bg-[#16181A] border-[#2A2D31] text-[#e8eaed]">
          <DialogHeader>
            <DialogTitle>Tambah User Baru</DialogTitle>
            <DialogDescription className="text-[#9aa0a6]">
              User akan langsung bisa login setelah dibuat. Bagikan email dan password kepada pengguna baru.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreateUser} className="space-y-4 mt-2">
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-[#9aa0a6] uppercase tracking-widest">Nama Lengkap</label>
              <input
                type="text"
                required
                value={createForm.nama}
                onChange={(e) => setCreateForm(f => ({ ...f, nama: e.target.value }))}
                className="w-full h-10 px-3 rounded-lg bg-[#16181A] border border-[#2A2D31] text-sm text-[#e8eaed] focus:ring-1 focus:ring-[#e5c17b] outline-none"
                placeholder="contoh: Budi Santoso"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-[#9aa0a6] uppercase tracking-widest">Email</label>
              <input
                type="email"
                required
                value={createForm.email}
                onChange={(e) => setCreateForm(f => ({ ...f, email: e.target.value }))}
                className="w-full h-10 px-3 rounded-lg bg-[#16181A] border border-[#2A2D31] text-sm text-[#e8eaed] focus:ring-1 focus:ring-[#e5c17b] outline-none"
                placeholder="contoh: budi@email.com"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-[#9aa0a6] uppercase tracking-widest">Password Sementara</label>
              <input
                type="text"
                required
                minLength={6}
                value={createForm.password}
                onChange={(e) => setCreateForm(f => ({ ...f, password: e.target.value }))}
                className="w-full h-10 px-3 rounded-lg bg-[#16181A] border border-[#2A2D31] text-sm text-[#e8eaed] focus:ring-1 focus:ring-[#e5c17b] outline-none font-mono"
                placeholder="min. 6 karakter"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-[#9aa0a6] uppercase tracking-widest">Role</label>
              <select
                value={createForm.role}
                onChange={(e) => setCreateForm(f => ({ ...f, role: e.target.value as UserRole }))}
                className="w-full h-10 px-3 rounded-lg bg-[#16181A] border border-[#2A2D31] text-sm text-[#e8eaed] focus:ring-1 focus:ring-[#e5c17b] outline-none"
              >
                <option value="owner">Owner</option>
                <option value="admin_produksi">Admin Produksi</option>
                <option value="admin_keuangan">Admin Keuangan</option>
                <option value="supervisor">Supervisor</option>
                <option value="mandor">Mandor</option>
              </select>
            </div>
            <DialogFooter className="gap-2 sm:gap-0 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setCreateOpen(false)}
                className="border-[#2A2D31] bg-transparent text-[#e8eaed]"
                disabled={createLoading}
              >
                Batal
              </Button>
              <Button
                type="submit"
                disabled={createLoading}
                className="bg-[#e5c17b] text-[#0D0E10] hover:bg-[#d4b06a] font-bold"
              >
                {createLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                {createLoading ? 'Membuat...' : 'Buat User'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="bg-[#16181A] border-[#2A2D31] text-[#e8eaed]">
          <DialogHeader>
            <DialogTitle>Konfirmasi Perubahan Status</DialogTitle>
            <DialogDescription className="text-[#9aa0a6]">
              Apakah Anda yakin ingin {userToToggle?.aktif ? 'menonaktifkan' : 'mengaktifkan'} akun <strong>{userToToggle?.nama}</strong>?
              {userToToggle?.aktif && ' User yang dinonaktifkan tidak akan bisa login ke sistem.'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setConfirmOpen(false)} className="border-[#2A2D31] bg-transparent text-[#e8eaed]">
              Batal
            </Button>
            <Button 
              variant={userToToggle?.aktif ? 'destructive' : 'default'}
              onClick={handleToggleAktif}
              className={userToToggle?.aktif ? '' : 'bg-green-600 hover:bg-green-700'}
            >
              Ya, {userToToggle?.aktif ? 'Nonaktifkan' : 'Aktifkan'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
