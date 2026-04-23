import { getUsers } from '@/lib/actions/master/user.actions';
import { getCurrentUserProfile } from '@/lib/auth/permissions';
import { PageWrapper } from '@/components/ui/PageWrapper';
import { UsersClient } from './UsersClient';
import { redirect } from 'next/navigation';

export const metadata = {
  title: 'Manajemen User & Role | Stitchlyx',
};

export default async function MasterUsersPage() {
  const profile = await getCurrentUserProfile();

  // Route guard: hanya owner yang bisa akses halaman ini
  if (!profile || profile.role !== 'owner') {
    redirect('/app/dashboard');
  }

  const users = await getUsers();

  return (
    <PageWrapper
      title="Manajemen User & Role"
      subtitle="Kelola akses dan jabatan staf kantor. Role menentukan menu dan aksi yang dapat diakses."
    >
      <UsersClient 
        initialUsers={JSON.parse(JSON.stringify(users))} 
        currentUserId={profile.id} 
      />
    </PageWrapper>
  );
}
