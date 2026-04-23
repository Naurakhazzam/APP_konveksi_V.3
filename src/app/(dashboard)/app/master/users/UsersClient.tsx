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
import { Shield, UserX, UserCheck, ChevronDown, Loader2 } from 'lucide-react';
import { updateUserRole, toggleUserAktif } from '@/lib/actions/master/user.actions';
import type { UserRole } from '@/lib/auth/permissions';
import { toast } from 'sonner';

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
}

const ROLES: { value: UserRole; label: string }[] = [
  { value: 'owner', label: 'Owner' },
  { value: 'admin_produksi', label: 'Admin Produksi' },
  { value: 'admin_keuangan', label: 'Admin Keuangan' },
  { value: 'supervisor', label: 'Supervisor' },
  { value: 'mandor', label: 'Mandor' },
];

export function UsersClient({ initialUsers, currentUserId }: UsersClientProps) {
  const router = useRouter();
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [userToToggle, setUserToToggle] = useState<UserData | null>(null);

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
